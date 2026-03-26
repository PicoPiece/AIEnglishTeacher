"""Auto-sync SD card files when device connects and MCP is ready.

Called from mcp_handler.py after all tools are fetched.
Runs in background so it doesn't block the connection flow.

1-call design: self.list_sd_music() returns compact text summary.
Format: [folder_name] N songs: name1; name2; ...
We parse this and save folder summaries to DB for dashboard display.

Patch: copy to /opt/xiaozhi-esp32-server/core/providers/tools/device_mcp/sd_auto_sync.py
"""

import re
import json
import asyncio
import os
import pymysql
from config.logger import setup_logging

TAG = __name__
logger = setup_logging()

SD_TOOL_NAME = "self_list_sd_music"
MCP_TIMEOUT = 15


def _parse_compact_summary(text: str) -> list:
    """Parse compact text summary from firmware into structured data.

    Input format (one line per folder):
      [01 Baby shark song] 3 songs: Baby Shark Doo Doo; Baby Shark Remix; ...
      [02 KLE pro 8 phan] 45 songs: 001AG; 002AG; ...

    Returns list of dicts: [{folder, file_count, names: [str]}]
    """
    results = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"\[(.+?)\]\s*(\d+)\s*songs?:\s*(.*)", line)
        if m:
            folder = m.group(1).strip()
            count = int(m.group(2))
            names_str = m.group(3).strip()
            names = [n.strip() for n in names_str.split(";") if n.strip()]
            results.append({"folder": folder, "file_count": count, "names": names})
        else:
            m2 = re.match(r"\[(.+?)\]\s*(\d+)\s*songs?", line)
            if m2:
                results.append({"folder": m2.group(1).strip(), "file_count": int(m2.group(2)), "names": []})
    return results


def _save_summary_to_db(mac: str, folders: list) -> int:
    """Save parsed folder summaries to device_sd_files table.

    Each folder becomes one row with category=folder name, filename=summary.
    Individual song names stored as semicolon-separated in filepath field for search.
    """
    if not folders:
        return 0
    db = None
    try:
        db = pymysql.connect(
            host=os.environ.get("DB_HOST", "xiaozhi-esp32-server-db"),
            port=int(os.environ.get("DB_PORT", "3306")),
            user=os.environ.get("PATCH_DB_USER", "patch_worker"),
            password=os.environ.get("PATCH_DB_PASS", "patch_worker_pass"),
            database="xiaozhi_esp32_server",
            cursorclass=pymysql.cursors.DictCursor,
        )
        cursor = db.cursor()
        cursor.execute("SELECT NOW() AS now")
        now_val = cursor.fetchone()["now"]

        total_files = 0
        synced_keys = []

        for f in folders:
            folder = f["folder"]
            count = f["file_count"]
            names = f.get("names", [])
            total_files += count

            filepath_key = f"__folder__/{folder}"
            display_name = f"{folder} ({count} songs)"

            cursor.execute(
                """INSERT INTO device_sd_files
                   (mac_address, filepath, filename, file_size, category, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                     filename = VALUES(filename),
                     file_size = VALUES(file_size),
                     category = VALUES(category),
                     last_seen_at = VALUES(last_seen_at)""",
                (mac, filepath_key, display_name, count, folder, now_val),
            )
            synced_keys.append(filepath_key)

            for name in names:
                file_key = f"{folder}/{name}"
                cursor.execute(
                    """INSERT INTO device_sd_files
                       (mac_address, filepath, filename, file_size, category, last_seen_at)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON DUPLICATE KEY UPDATE
                         filename = VALUES(filename),
                         file_size = VALUES(file_size),
                         category = VALUES(category),
                         last_seen_at = VALUES(last_seen_at)""",
                    (mac, file_key, name, 0, folder, now_val),
                )
                synced_keys.append(file_key)

        if synced_keys:
            placeholders = ",".join(["%s"] * len(synced_keys))
            cursor.execute(
                f"DELETE FROM device_sd_files WHERE mac_address = %s AND filepath NOT IN ({placeholders})",
                [mac] + synced_keys,
            )

        db.commit()
        cursor.close()
        return total_files
    except Exception as e:
        logger.bind(tag=TAG).error(f"SD auto-sync DB error: {e}")
        return -1
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


async def auto_sync_sd_files(conn, mcp_client):
    """Single MCP call to get SD card summary and save to DB."""
    device_id = getattr(conn, "device_id", None)
    if not device_id:
        return

    if not mcp_client.has_tool(SD_TOOL_NAME):
        return

    logger.bind(tag=TAG).info(f"SD auto-sync starting for {device_id}")

    try:
        await asyncio.sleep(1)

        if not await mcp_client.is_ready():
            logger.bind(tag=TAG).warning(f"SD auto-sync: MCP not ready for {device_id}")
            return

        from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool

        result = await call_mcp_tool(conn, mcp_client, SD_TOOL_NAME, "{}", timeout=MCP_TIMEOUT)
        logger.bind(tag=TAG).info(f"SD auto-sync response for {device_id}: {str(result)[:500]}")

        if not result or not isinstance(result, str):
            logger.bind(tag=TAG).warning(f"SD auto-sync: empty or invalid response for {device_id}")
            return

        # Try parsing as compact text format first (new firmware)
        folders = _parse_compact_summary(result)

        if not folders:
            # Fallback: try JSON format (old firmware compatibility)
            try:
                items = json.loads(result)
                if isinstance(items, list):
                    for it in items:
                        if it.get("type") == "folder":
                            folders.append({"folder": it["name"], "file_count": 0, "names": []})
            except (json.JSONDecodeError, TypeError):
                pass

        if folders:
            total = sum(f["file_count"] for f in folders)
            logger.bind(tag=TAG).info(
                f"SD auto-sync: {len(folders)} folders, ~{total} total files for {device_id}"
            )
            count = _save_summary_to_db(device_id, folders)
            logger.bind(tag=TAG).info(f"SD auto-sync complete for {device_id}: {count} files indexed")
        else:
            logger.bind(tag=TAG).info(f"SD auto-sync: no music found on {device_id}")

    except asyncio.TimeoutError:
        logger.bind(tag=TAG).warning(f"SD auto-sync timeout for {device_id}")
    except asyncio.CancelledError:
        logger.bind(tag=TAG).warning(f"SD auto-sync cancelled for {device_id}")
    except Exception as e:
        logger.bind(tag=TAG).error(f"SD auto-sync error for {device_id}: {e}")
