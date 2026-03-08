# Parent Dashboard Enhancement Plan

**Branch:** `hdang/enhance_dashboard`
**Base:** `master` @ `2476d60`

---

## Current State

The parent dashboard already has:
- Login (sys_user auth with bcrypt/SHA-256)
- Device list with firmware version, last connected time
- Chat history viewer (sessions, messages as chat bubbles)
- Per-device AI settings (structured prompt editor: child name, age, level, topics)
- Vietnamese UI with Tailwind CSS

---

## Phase 1: Enhanced Device Info Panel (DB-only, no firmware changes)

### 1.1 Device Status Card (on Dashboard)

Upgrade the device card to show more info from `ai_device` table:

```
┌────────────────────────────────────┐
│ 🟢 English Teacher AI        v2.2.3│
│ Board: english-teacher-ai          │
│ Kết nối: 2 phút trước             │
│ Agent: English Teacher             │
│                                    │
│ [Lịch sử] [Cài đặt] [Thống kê]   │
└────────────────────────────────────┘
```

**Data sources (all from MySQL):**
- `ai_device`: mac_address, alias, board, app_version, last_connected_at, agent_id
- `ai_agent`: agent_name (JOIN on agent_id)
- Online/Offline: derive from `last_connected_at` (< 5 min = online)

**Changes:**
- `server.js`: Update `/dashboard` query to JOIN `ai_agent` for agent_name
- `dashboard.ejs`: Add agent name, online/offline badge

### 1.2 Learning Statistics Page

New page: `/device/:mac/stats`

**Metrics (all from `ai_agent_chat_history`):**
- Total conversations (distinct session_id)
- Total messages
- Average session duration
- Messages per day (last 7 days chart)
- Most active hours
- Last 7 days activity heatmap

**Changes:**
- `server.js`: New route `/device/:mac/stats` with aggregation queries
- New view: `views/stats.ejs` with simple bar chart (CSS-only, no JS library)

### 1.3 Navigation Improvements

- Add bottom tab bar / sidebar for mobile
- Add breadcrumb navigation
- Dashboard → Device → (Sessions | Settings | Stats)

---

## Phase 2: Music Player & Passive Learning

### 2.1 Database Schema (new tables, owned by parent-dashboard)

```sql
-- New tables in xiaozhi_esp32_server database
CREATE TABLE parent_music (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  title VARCHAR(200) NOT NULL,
  artist VARCHAR(100) DEFAULT '',
  category VARCHAR(50) DEFAULT 'general',
  filename VARCHAR(255) NOT NULL,
  duration_sec INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE parent_playlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE parent_playlist_item (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT NOT NULL,
  music_id INT NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (playlist_id) REFERENCES parent_playlist(id) ON DELETE CASCADE,
  FOREIGN KEY (music_id) REFERENCES parent_music(id) ON DELETE CASCADE
);

CREATE TABLE parent_play_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  mac_address VARCHAR(32) NOT NULL,
  playlist_id INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week VARCHAR(20) DEFAULT '1,2,3,4,5,6,7',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES parent_playlist(id) ON DELETE CASCADE
);
```

### 2.2 Music Upload & Library

New page: `/music`

- Upload MP3 files (multer, store in `/data/music/`)
- List all uploaded songs with play preview (HTML5 audio)
- Category filter: Phonics, Nursery Rhymes, Vocabulary, Stories, Custom
- Delete songs

**Changes:**
- `server.js`: New routes `/music`, `POST /music/upload`, `DELETE /music/:id`
- New view: `views/music.ejs`
- Add `multer` dependency
- Docker: volume mount `/data/music` for persistent storage

### 2.3 Playlist Manager

New page: `/playlists`

- Create/edit/delete playlists
- Drag-and-drop ordering (or simple up/down buttons)
- Assign songs from library to playlists

**Changes:**
- `server.js`: CRUD routes for playlists
- New view: `views/playlist.ejs`

### 2.4 Play Now & Schedule

On device page, add Music section:
- "Play Now" button → sends command to ESP32 via xiaozhi-server WebSocket
- Schedule: pick playlist + time range + days of week
- Schedule engine: node-cron or node-schedule checking active schedules

**Integration with xiaozhi-server:**
- Option A: Call xiaozhi-server's REST API to trigger play_music plugin
- Option B: Direct WebSocket message to device (more complex)
- Option C: Store music URL, use MCP `self.music.play_song` via voice command

**Recommended: Option A** - xiaozhi-server already has play_music plugin infrastructure.

### 2.5 Music Streaming Endpoint

- `GET /api/music/stream/:id` - serve MP3 file with proper headers
- Support range requests for seeking
- Device (ESP32) fetches audio from this URL

### 2.6 Pre-loaded Content (free, no copyright issues)

Include starter content:
- Generate phonics MP3s using EdgeTTS (A-Z pronunciation)
- Generate number songs (1-20)
- Generate daily vocabulary sets by topic

Script: `scripts/generate-starter-content.js` using EdgeTTS API

---

## Phase 3: Real-time Device Status (requires server proxy)

### 3.1 Device Status API

- Query xiaozhi-server for real-time device state
- Approach: parent-dashboard connects to xiaozhi-server's WebSocket (port 8000)
  or polls a status endpoint

**Data available from firmware `GetDeviceStatusJson()`:**
- `audio_speaker.volume` (0-100)
- `screen.brightness`, `screen.theme`
- `battery.level`, `battery.charging`
- `network.ssid`, `network.signal` (strong/medium/weak)
- `chip.temperature`

### 3.2 Remote Control

- Adjust volume from web
- Play/pause music from web
- Change theme (light/dark)

**Approach:** Send MCP commands via xiaozhi-server:
- `self.audio_speaker.set_volume` → change volume
- `self.screen.set_brightness` → change brightness
- `self.screen.set_theme` → change theme

### 3.3 Push Notifications

- Device goes offline → notify parent (browser push notification or email)
- Low battery alert
- Daily learning summary

---

## Implementation Priority

| Priority | Task | Effort | Dependencies |
|:--------:|------|:------:|:------------:|
| **P0** | 1.1 Enhanced device card | 1h | None |
| **P0** | 1.2 Learning statistics | 2h | None |
| **P0** | 1.3 Navigation improvements | 1h | None |
| **P1** | 2.1 Music DB schema | 30m | None |
| **P1** | 2.2 Music upload & library | 3h | 2.1 |
| **P1** | 2.3 Playlist manager | 2h | 2.1, 2.2 |
| **P1** | 2.5 Music streaming endpoint | 1h | 2.2 |
| **P1** | 2.6 Pre-loaded content | 2h | 2.2 |
| **P2** | 2.4 Play now & schedule | 4h | 2.3, xiaozhi-server API |
| **P3** | 3.1 Real-time device status | 4h | xiaozhi-server WebSocket |
| **P3** | 3.2 Remote control | 3h | 3.1 |
| **P3** | 3.3 Push notifications | 3h | 3.1 |

---

## File Changes Summary

### New files:
- `views/stats.ejs` - Learning statistics page
- `views/music.ejs` - Music library page
- `views/playlist.ejs` - Playlist manager page
- `scripts/generate-starter-content.js` - Generate phonics/vocab MP3s
- `migrations/001-music-tables.sql` - Music DB schema

### Modified files:
- `server.js` - New routes, music upload, stats queries
- `views/dashboard.ejs` - Enhanced device cards
- `views/device.ejs` - Add stats & music links
- `views/partials/header.ejs` - Navigation updates
- `setup-db-user.sql` - Grant permissions on new tables
- `package.json` - Add multer, node-cron dependencies
- `docker-compose.yml` - Add music volume mount
- `Dockerfile` - Ensure /data/music directory exists

---

## DB Permission Updates

```sql
-- Additional grants for music feature
GRANT ALL ON xiaozhi_esp32_server.parent_music TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_playlist TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_playlist_item TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_play_schedule TO 'parent_reader'@'%';
FLUSH PRIVILEGES;
```

---

## Suggested Implementation Order

1. **Phase 1 complete** → commit → test on server
2. **Phase 2.1-2.3** (music schema + upload + playlist) → commit → test
3. **Phase 2.4-2.6** (play/schedule + starter content) → commit → test
4. **Phase 3** (real-time) → future iteration

Start with Phase 1 first? All P0 tasks (~4h total effort).
