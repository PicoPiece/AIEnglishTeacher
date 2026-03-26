# Architecture Backlog

Issues identified during deep code review (March 2026).
Prioritized by impact. Fix when the relevant trigger occurs.

---

## P1 — Fix Soon

### 1. String-replace patching is fragile
**What:** `apply_sd_sync_patches.sh` uses `docker exec python3 -c "content.replace(...)"` with exact substring matching (including Chinese comments). Any upstream refactor silently skips the patch.

**Impact:** Upgrades break SD sync, auto-sync, play_music, connection registry — with no error.

**Trigger:** Next upstream `xiaozhi-esp32-server` image update.

**Fix:** Pin upstream image SHA. Add a patch verification step (checksum or grep for expected result). Long-term: fork with patches as git commits, or contribute a plugin API upstream.

---

### 2. No automated tests
**What:** No test files, no `test` script in `package.json`. Auth, IDOR, patch integration, and MCP flow are only tested manually.

**Impact:** Regressions caught in production only.

**Trigger:** Before any large refactor or feature addition.

**Fix:** Add API integration tests (supertest + test DB) for critical routes: login, history access, playlist IDOR, settings save. Add patch smoke test in CI.

---

### 3. In-memory session store
**What:** `express-session` with default MemoryStore. Restarts log everyone out. Cannot scale horizontally.

**Impact:** UX disruption on every dashboard restart/deploy.

**Trigger:** When adding HA, multiple dashboard replicas, or frequent deploys.

**Fix:** Use `connect-redis` or `express-mysql-session` as session store.

---

### 4. Upstream cache bug (DEVICE_PROMPT read vs CONFIG write)
**What:** In `xiaozhi-esp32-server/core/utils/prompt_manager.py`, `get_quick_prompt` reads from `CacheType.DEVICE_PROMPT` but writes to `CacheType.CONFIG`. Cache always misses → DB hit on every call.

**Impact:** Performance (unnecessary DB queries per connection). Not a correctness bug since it always falls through to fresh data.

**Trigger:** When performance tuning or contributing upstream.

**Fix:** Report upstream or patch `set()` call to use `CacheType.DEVICE_PROMPT`.

---

## P2 — Fix Later

### 5. Blocking PyMySQL in async context
**What:** `sd_auto_sync.py`, `play_music.py`, `sd_sync_handler.py` use synchronous `pymysql.connect()` inside async handlers. Blocks the asyncio event loop during DB calls.

**Impact:** Latency spikes under concurrent device connections. Single blocked call delays all WebSocket traffic.

**Trigger:** When device count exceeds ~50 or latency becomes noticeable.

**Fix:** Migrate to `aiomysql` or run DB calls in `asyncio.to_thread()`.

---

### 6. In-memory connection registry (single-process constraint)
**What:** `connection_registry.py` is a module-level Python dict. Only works within one process.

**Impact:** Cannot scale WebSocket tier to multiple Python processes.

**Trigger:** When needing clustered/HA WebSocket handling.

**Fix:** Move registry to Redis pub/sub or shared state. Document single-instance as current constraint.

---

### 7. Missing CSRF protection
**What:** All POST routes rely on session cookie only. No CSRF token.

**Impact:** Malicious sites can submit forms while parent is logged in. Mitigated by `sameSite: 'lax'` cookie flag (added in this review).

**Trigger:** If switching cookie policy or if targeted attacks become a concern.

**Fix:** Add `csurf` middleware + hidden token in all forms.

---

### 8. Chat history query performance at scale
**What:** Queries use `DATE(created_at) = CURDATE()` and full-table aggregates on `ai_agent_chat_history`. No composite indexes aligned to dashboard queries.

**Impact:** Dashboard becomes slow as chat history grows (>100K rows).

**Trigger:** When query latency exceeds 500ms or DB CPU spikes.

**Fix:** Add composite indexes: `(mac_address, created_at)`, `(session_id, created_at)`. Use range predicates instead of `DATE()`. Consider materialized daily summaries.

---

### 9. Data model gaps
**What:**
- `device_sd_files` has no FK to `ai_device` → orphan rows after device delete
- `parent_playlist_item.sd_file_id` has no FK → broken playlist references
- `TEMPLATE_AGENT_ID` hardcoded in `server.js` → breaks if DB differs per environment

**Trigger:** When adding device deletion, or deploying to a second environment.

**Fix:** Add FKs with `ON DELETE CASCADE` where safe. Move template ID to env var or `sys_params` table.

---

### 10. Voice preview concurrent write race
**What:** Two simultaneous preview requests for the same `voiceId` can both see missing cache and both call `generatePreview()`, writing to the same file concurrently.

**Impact:** Corrupt/partial MP3 file served to one user.

**Trigger:** Multiple parents previewing the same voice simultaneously.

**Fix:** Use a lock file or in-memory mutex per `voiceId` during generation.

---

## Completed (this review session)

- [x] DB connection leaks in all patch files (added `finally` blocks)
- [x] `sd_sync_handler.py` incompatible with new firmware compact text format
- [x] `play_music.py` env var mismatch (`DB_ROOT_PASS` → `MYSQL_ROOT_PASSWORD`)
- [x] `connection_registry.py` reconnect race condition (identity check on unregister)
- [x] `apply_sd_sync_patches.sh` missing `play_music.py` deployment step
- [x] `server.js` IDOR on chat history (auth before data load)
- [x] `server.js` unvalidated `device` query param on music page
- [x] `server.js` settings POST validation dropped voice list
- [x] `sd_auto_sync.py` inconsistent cleanup threshold (`>= 3` → `if synced_keys`)
- [x] `sd_sync_handler.py` info disclosure (device list in error)
- [x] `server.js` Redis `flushall()` → removed (cache is in-memory, not Redis)
- [x] `/api/device/:mac/status` endpoint missing (auto-refresh broken)
- [x] Session cookie missing `sameSite` and `secure` flags
- [x] Voice preview cache not invalidated on voice mapping change
- [x] `music.ejs` file size label mismatch (50MB → 100MB)
- [x] `device-status.ejs` Vietnamese text missing diacritics (15 fixes)
- [x] `crypto` require ordering (moved to top-level imports)
- [x] IDOR on playlist add-song and schedule creation
- [x] Python patches using MySQL root → dedicated `patch_worker` user
- [x] SD sync API unauthenticated → shared secret header
