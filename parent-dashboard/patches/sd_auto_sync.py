"""Auto-sync SD card files when device connects and MCP is ready.

Called from mcp_handler.py after all tools are fetched.
Runs in background so it doesn't block the connection flow.

Patch: copy to /opt/xiaozhi-esp32-server/core/providers/tools/device_mcp/sd_auto_sync.py
"""

import json
import asyncio
import os
import pymysql
from config.logger import setup_logging

TAG = __name__
logger = setup_logging()

SD_TOOL_NAME = "self_list_sd_music"


def _save_files_to_db(mac: str, file_list: list) -> int:
    try:
        db = pymysql.connect(
            host=os.environ.get("DB_HOST", "xiaozhi-esp32-server-db"),
            port=int(os.environ.get("DB_PORT", "3306")),
            user="root",
            password=os.environ.get("MYSQL_ROOT_PASSWORD", "xiaozhi_esp32_123456"),
            database="xiaozhi_esp32_server",
            cursorclass=pymysql.cursors.DictCursor,
        )
        cursor = db.cursor()
        cursor.execute("SELECT NOW() AS now")
        now_val = cursor.fetchone()["now"]

        synced_paths = []
        for f in file_list:
            filepath = f.get("path", "")
            if not filepath:
                continue
            filename = f.get("name", os.path.splitext(os.path.basename(filepath))[0])
            file_size = f.get("size", 0)
            parts = filepath.replace("\\", "/").split("/")
            parts = [p for p in parts if p]
            parent_dir = parts[-2] if len(parts) > 1 else ""
            category = parent_dir if parent_dir and parent_dir != "sdcard" else "general"

            cursor.execute(
                """INSERT INTO device_sd_files (mac_address, filepath, filename, file_size, category, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE filename = VALUES(filename), file_size = VALUES(file_size),
                                            category = VALUES(category), last_seen_at = VALUES(last_seen_at)""",
                (mac, filepath, filename, file_size, category, now_val),
            )
            synced_paths.append(filepath)

        if synced_paths:
            placeholders = ",".join(["%s"] * len(synced_paths))
            cursor.execute(
                f"DELETE FROM device_sd_files WHERE mac_address = %s AND filepath NOT IN ({placeholders})",
                [mac] + synced_paths,
            )

        db.commit()
        cursor.close()
        db.close()
        return len(synced_paths)
    except Exception as e:
        logger.bind(tag=TAG).error(f"SD auto-sync DB error: {e}")
        return -1


async def auto_sync_sd_files(conn, mcp_client):
    """Call list_sd_music on device and save results. Non-blocking background task."""
    device_id = getattr(conn, "device_id", None)
    if not device_id:
        return

    if not mcp_client.has_tool(SD_TOOL_NAME):
        return

    logger.bind(tag=TAG).info(f"SD auto-sync starting for {device_id}")

    try:
        await asyncio.sleep(2)

        if not await mcp_client.is_ready():
            logger.bind(tag=TAG).warning(f"SD auto-sync: MCP not ready for {device_id}")
            return

        from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool
        result = await call_mcp_tool(conn, mcp_client, SD_TOOL_NAME, "{}", timeout=30)
        logger.bind(tag=TAG).info(f"SD auto-sync result for {device_id}: {str(result)[:200]}")

        file_list = json.loads(result) if isinstance(result, str) else result
        if not isinstance(file_list, list):
            logger.bind(tag=TAG).warning(f"SD auto-sync: unexpected response type for {device_id}")
            return

        count = _save_files_to_db(device_id, file_list)
        logger.bind(tag=TAG).info(f"SD auto-sync complete for {device_id}: {count} files saved")

    except asyncio.TimeoutError:
        logger.bind(tag=TAG).warning(f"SD auto-sync timeout for {device_id} (device busy?)")
    except Exception as e:
        logger.bind(tag=TAG).error(f"SD auto-sync error for {device_id}: {e}")
