# Music Playback Feature

Parent-managed music playback on ESP32 device via xiaozhi-server.

## Overview

Parents upload English learning music (phonics, nursery rhymes, vocabulary songs, stories) through the web dashboard. The child can request music playback by voice command on the ESP32 device. The server's `play_music` plugin picks up files from the shared music directory and streams audio to the device.

```
┌─────────────────┐     upload     ┌──────────────────────┐    shared volume    ┌─────────────────────┐
│  Parent (Web)   │ ──────────────→│   Parent Dashboard   │ ──────────────────→ │  xiaozhi-server     │
│  Browser        │                │   :8005               │   /data/music ↔     │  play_music plugin  │
└─────────────────┘                │   Node.js/Express     │   /opt/.../music    │  Python             │
                                   └──────────────────────┘                     └─────────┬───────────┘
                                                                                          │ WebSocket
┌─────────────────┐     voice      ┌──────────────────────┐    function_call     ─────────┘
│  Child (ESP32)  │ ──────────────→│  ASR (Groq Whisper)  │ ──→ LLM (DeepSeek)
│  "play music!"  │ ←──audio────── │  TTS (EdgeTTS)       │ ←── play_music()
└─────────────────┘                └──────────────────────┘
```

## Components

### 1. Parent Dashboard (Web UI)

**URL:** `http://<server-ip>:8005`

| Page | Route | Description |
|------|-------|-------------|
| Music Library | `/music` | Upload, list, filter by category, preview, delete songs |
| Playlists | `/playlists` | Create/delete playlists, group songs |
| Playlist Detail | `/playlists/:id` | Add/remove songs in a playlist |
| Schedules | `/schedules` | Set timed playback per device (future use) |

**Music categories:** Phonics, Nursery Rhymes, Vocabulary, Stories, English Songs, General

**Upload specs:**
- Formats: MP3, WAV, OGG, M4A
- Max size: 100MB per file
- Files saved as: `<sanitized-title>_<hash>.<ext>` (readable by play_music plugin)

**Key files:**
- `parent-dashboard/server.js` — Express routes, multer upload, DB queries
- `parent-dashboard/views/music.ejs` — Music library UI
- `parent-dashboard/views/playlists.ejs` — Playlist list UI
- `parent-dashboard/views/playlist-detail.ejs` — Playlist detail UI
- `parent-dashboard/views/schedules.ejs` — Schedule management UI

### 2. Database Tables

Migration: `parent-dashboard/migrations/001-music-tables.sql`

```sql
parent_music          — Uploaded songs (title, artist, category, filename, file_size)
parent_playlist       — Named playlists per user
parent_playlist_item  — Songs in a playlist (many-to-many)
parent_play_schedule  — Timed playback rules per device (future)
```

### 3. Shared Music Volume (Docker)

The parent dashboard and xiaozhi-server share the same music directory via Docker volume mount:

```yaml
# parent-dashboard/docker-compose.yml
volumes:
  - /home/picopiece/xiaozhi-server/music:/data/music

# xiaozhi-server docker-compose (existing)
volumes:
  - ./music:/opt/xiaozhi-esp32-server/music
```

Both containers see the same files at `/home/picopiece/xiaozhi-server/music` on the host.

### 4. play_music Plugin (Server-side)

Patched version: `parent-dashboard/patches/play_music.py`

Changes from upstream xiaozhi-esp32-server:
- All Chinese text responses translated to English (required for EdgeTTS `en-US-AriaNeural`)
- Function description in English for LLM tool calling
- English keyword extraction (`play music`, `play song`, `listen to`)
- Fuzzy matching threshold lowered to 0.3 for English song names

**How it works:**
1. Plugin scans `./music/` directory every 60 seconds for new files
2. When LLM calls `play_music(song_name)`, plugin finds best match or picks random
3. Sends audio file via WebSocket to ESP32 device
4. TTS announces song name before playback

### 5. LLM Configuration

**Agent settings** (in `ai_agent` table):

| Field | Value | Why |
|-------|-------|-----|
| `llm_model_id` | `LLM_DeepSeekLLM` | Main conversation LLM |
| `intent_model_id` | `Intent_function_call` | Uses DeepSeek's native function calling (avoids ChatGLM encoding bug) |
| `summary_memory` | English text only | Prevents LLM from responding in Chinese/Vietnamese |

**System prompt** must include music instructions:
```
Music features:
- When the child asks to play music, listen to a song, or sing, call the play_music function.
- For a specific song: play_music with song_name parameter. For random music: play_music with song_name=random.
- After playing, discuss the song in English to practice vocabulary.
```

Migration: `parent-dashboard/migrations/002-update-prompt-music.sql`

## Deployment

### Prerequisites
- xiaozhi-esp32-server running in Docker with `./music` volume
- MySQL database accessible from parent-dashboard container
- Shared Docker network (`xiaozhi-server_default`)

### Steps

```bash
# 1. Create music tables
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> xiaozhi_esp32_server \
  < parent-dashboard/migrations/001-music-tables.sql

# 2. Grant permissions to dashboard DB user
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> \
  < parent-dashboard/setup-db-user.sql

# 3. Patch play_music plugin (English responses)
docker cp parent-dashboard/patches/play_music.py \
  xiaozhi-esp32-server:/opt/xiaozhi-esp32-server/plugins_func/functions/play_music.py

# 4. Update agent prompt with music instructions
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> xiaozhi_esp32_server \
  < parent-dashboard/migrations/002-update-prompt-music.sql

# 5. Switch intent to function_call (if using Intent_intent_llm)
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> xiaozhi_esp32_server \
  < parent-dashboard/migrations/006-fix-intent-clean.sql

# 6. Clear Chinese summary memory
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> xiaozhi_esp32_server \
  < parent-dashboard/migrations/010-clear-memory.sql

# 7. Fix English-only prompt
docker exec -i xiaozhi-esp32-server-db mysql -uroot -p<pass> xiaozhi_esp32_server \
  < parent-dashboard/migrations/008-fix-english-only.sql

# 8. Build and start parent dashboard
cd parent-dashboard
docker compose up -d --build

# 9. Restart xiaozhi-server to reload plugin + config
docker restart xiaozhi-esp32-server
```

## QA Test Cases

### Upload & Library

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | Upload MP3 file with title "Baby Shark" | File saved as `Baby-Shark_<hash>.mp3`, visible in library | |
| 2 | Upload file without title | Filename derived from original file name | |
| 3 | Upload file > 100MB | Error message "File quá lớn" | |
| 4 | Upload non-audio file (.txt, .jpg) | File rejected silently | |
| 5 | Filter by category (Phonics) | Only songs with category "phonics" shown | |
| 6 | Delete a song | File removed from disk + DB, not in library | |
| 7 | Preview/play song in browser | Audio plays in inline HTML5 player | |

### Playlist Management

| # | Test | Expected | Status |
|---|------|----------|--------|
| 8 | Create playlist "Morning Songs" | Playlist appears in list | |
| 9 | Add songs to playlist | Songs listed in playlist detail | |
| 10 | Remove song from playlist | Song removed, still in library | |
| 11 | Delete playlist | Playlist gone, songs remain in library | |

### Voice Playback on Device

| # | Test | Expected | Status |
|---|------|----------|--------|
| 12 | Say "play music" | ESP32 plays a song from the library, TTS announces song name in English | |
| 13 | Say "play Baby Shark" | Fuzzy match finds Baby Shark file, plays it | |
| 14 | Upload new song via dashboard, wait 60s, say "play music" | New song available (plugin rescans every 60s) | |
| 15 | Delete all songs, say "play music" | Graceful error, no crash | |
| 16 | LLM response language | ALL responses in English only (no Chinese/Vietnamese) | |

### Sync Verification

| # | Test | Expected | Status |
|---|------|----------|--------|
| 17 | Upload on dashboard → check server | `docker exec xiaozhi-esp32-server ls music/` shows new file | |
| 18 | Delete on dashboard → check server | File removed from both dashboard DB and server music dir | |
| 19 | File naming | Server sees readable filename matching song title | |

## Pre-loaded Content (Task 2.6)

76 starter audio files generated with EdgeTTS (`en-US-AriaNeural`):

| Category | Count | Content |
|----------|-------|---------|
| Phonics | 26 | A-Z, letter + sound + example word |
| Numbers | 20 | 1-20, number + spelling |
| Dinosaurs vocab | 10 | Word + sentence + "Can you say...?" |
| Space vocab | 10 | Word + sentence + "Can you say...?" |
| Animals vocab | 10 | Word + sentence + "Can you say...?" |

Script: `parent-dashboard/scripts/generate-starter-content.js`

```bash
docker exec -e DB_HOST=xiaozhi-esp32-server-db \
  -e DB_USER=parent_reader -e DB_PASS=parent_readonly_pass \
  -e DB_NAME=xiaozhi_esp32_server -e MUSIC_DIR=/data/music \
  parent-dashboard node /app/scripts/generate-starter-content.js
```

Files are stored with `user_id = 'system'` and visible to all users.

## Device Status Dashboard (Phase 3)

### Status Page: `/device/:mac/status`

Shows real-time device info with 30-second auto-refresh:
- Connection status (Online/Offline from `last_connected_at`)
- Device info (board, firmware, MAC, agent)
- Today's learning summary (sessions, messages, student messages)
- All-time totals
- Music library stats (songs, playlists, schedules)
- Last spoken sentence by child

### API Endpoints

- `GET /api/device/:mac/status` — JSON: isOnline, today stats
- `GET /api/device/:mac/daily-summary` — JSON: sessions, messages, active minutes, recent words

## Single-Turn Listen Mode (Firmware)

Changed `GetDefaultListeningMode()` in `main/application.cc` to return `kListeningModeManualStop`.

**Behavior:** After AI finishes speaking, device goes to Idle. Child reads screen, thinks, then presses BOOT button to speak again. No auto-listen.

**Repo:** `https://github.com/PicoPiece/AIEnglishTeacherXiaozhiFw` branch `hdang/PicoAIEng`

## Known Issues & Limitations

1. **Playlist selection not integrated with plugin** — The `play_music` plugin plays from the entire music directory, not from a specific playlist. Playlist management on dashboard is for future scheduled playback.
2. **60-second scan delay** — After upload, plugin needs up to 60 seconds to detect new files.
3. **No playback queue** — Plugin plays one song then stops. No continuous playlist playback yet.
4. **Schedule playback** — UI exists but server-side trigger is not yet implemented (Phase 3).
5. **Memory drift** — `summary_memory` can drift back to Chinese if the Memory module summarizes with a Chinese-biased LLM. Monitor and re-clear if needed.

## Migration Scripts Reference

| File | Purpose | When to Run |
|------|---------|-------------|
| `001-music-tables.sql` | Create music/playlist/schedule tables | Initial setup |
| `002-update-prompt-music.sql` | Add music instructions to system prompt | Initial setup |
| `006-fix-intent-clean.sql` | Switch to `Intent_function_call` | If using `Intent_intent_llm` |
| `008-fix-english-only.sql` | Enforce English-only in prompt | Initial setup |
| `010-clear-memory.sql` | Reset Chinese summary_memory to English | When memory drifts to Chinese |
| `011-system-content.sql` | Grant permissions for system shared content | Before running generate script |

## Dev Notes

- `parent-dashboard/patches/play_music.py` must be manually `docker cp`'d after each xiaozhi-server rebuild
- The `sanitizeFilename()` function in `server.js` strips special chars and limits to 120 chars
- Music streaming endpoint (`/api/music/stream/:id`) supports HTTP Range requests for seeking
- All dashboard routes require authentication via `requireAuth` middleware
