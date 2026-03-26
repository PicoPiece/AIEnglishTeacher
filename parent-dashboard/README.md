# Parent Dashboard - AI English Teacher

Web dashboard for parents to manage their child's AI English Teacher device — view conversation history, configure AI voice, manage SD card music, and monitor device status.

## Architecture

- **Backend:** Node.js + Express + EJS
- **Database:** MySQL (`xiaozhi_esp32_server`) — shared with xiaozhi server
- **Auth:** Session-based login using `sys_user` credentials (same as web console)
- **Deployment:** Docker container on same network as xiaozhi server stack
- **Server Patches:** Python patches applied to `xiaozhi-esp32-server` for SD card sync API

## Features

- **Conversation History** — Browse chat sessions per device, chat bubble UI
- **AI Voice Settings** — Choose TTS voice for each device, preview voices
- **SD Card Music** — Auto-synced file list from device's SD card (syncs every time child presses talk button)
- **Playlists** — Create playlists mixing server-hosted and SD card music
- **Device Status** — Online/offline indicator, device info
- **Admin Panel** — Quick setup for new devices, agent configuration
- **Mobile-friendly** responsive design

## Deployment

### 1. Create MySQL user and run migrations

```bash
cat setup-db-user.sql | docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456
cat migrations/012-sd-card-music.sql | docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456
cat migrations/013-fix-chinese-params.sql | docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456
```

### 2. Build and start dashboard

```bash
docker compose up -d --build
```

### 3. Apply server patches (SD card sync)

The SD card auto-sync requires patches to `xiaozhi-esp32-server`:

```bash
bash patches/apply_sd_sync_patches.sh
docker restart xiaozhi-esp32-server
```

This adds:
- **Connection registry** — tracks connected devices by MAC address
- **SD sync HTTP API** — `POST /api/sd-sync/{mac}` on port 8003
- **Auto-sync on connect** — when device connects and MCP is ready, automatically calls `self.list_sd_music` and saves file list to DB

### 4. Cloudflare Tunnel (optional)

Add public hostname in Cloudflare Zero Trust:
- Dashboard: `http://localhost:8005`

## Database Tables

| Table | Purpose |
|-------|---------|
| `sys_user` | Authentication |
| `ai_device` | Devices linked to user |
| `ai_agent` | Agent config (TTS voice, LLM, ASR, prompt) |
| `ai_agent_chat_history` | Conversation messages |
| `ai_tts_voice` | Available TTS voices |
| `ai_model_config` | Model configurations |
| `device_sd_files` | SD card file list per device (auto-synced) |
| `parent_music` | Server-hosted music files |
| `parent_playlist` / `parent_playlist_item` | User-created playlists |

## Server Patches

Files in `patches/` are applied to the `xiaozhi-esp32-server` container:

| File | Target | Purpose |
|------|--------|---------|
| `connection_registry.py` | `core/connection_registry.py` | Global dict of active device connections |
| `sd_sync_handler.py` | `core/api/sd_sync_handler.py` | HTTP API for triggering MCP SD sync |
| `sd_auto_sync.py` | `core/providers/tools/device_mcp/sd_auto_sync.py` | Auto-sync SD files when device connects |
| `play_music.py` | `plugins_func/functions/play_music.py` | Enhanced music plugin with SD card support |
| `apply_sd_sync_patches.sh` | — | Script to apply all patches |

**Note:** Patches must be re-applied after `xiaozhi-esp32-server` container is recreated (not needed for simple restart).

## SD Card Music Flow

```
Child presses button → Device connects WebSocket → MCP initializes
  → Tools list received → MCP ready
  → auto_sync_sd_files() runs in background
    → Calls self.list_sd_music on device
    → Device scans SD card recursively
    → Returns JSON file list → Saved to device_sd_files table
  → Child talks normally (not blocked by sync)

Parent opens Dashboard → SD Card page → sees auto-updated file list
```

## Troubleshooting

**SD card files not showing:**
- Files sync automatically when child presses the talk button
- Check server logs: `docker logs xiaozhi-esp32-server | grep auto-sync`
- Ensure device firmware has `self.list_sd_music` MCP tool implemented

**Voice preview not working:**
- Check `voice-previews` Docker volume exists
- Verify `edge-tts-universal` package is installed

**Device not connecting:**
- Check Cloudflare Tunnel config for WebSocket endpoint
- Verify `sys_params.server.websocket` URL is correct
