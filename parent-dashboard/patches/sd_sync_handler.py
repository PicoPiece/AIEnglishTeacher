"""SD card file sync API handler.

Adds POST /api/sd-sync/<mac> endpoint that triggers MCP self_list_sd_music
on the connected device and stores results in device_sd_files table.

Patch: copy to /opt/xiaozhi-esp32-server/core/api/sd_sync_handler.py
"""

import json
import pymysql
import os
from aiohttp import web
from core.api.base_handler import BaseHandler
from core import connection_registry
from config.logger import setup_logging

TAG = __name__
logger = setup_logging()


def _db_connect():
    return pymysql.connect(
        host=os.environ.get("DB_HOST", "xiaozhi-esp32-server-db"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user="root",
        password=os.environ.get("MYSQL_ROOT_PASSWORD", "123456"),
        database="xiaozhi_esp32_server",
        cursorclass=pymysql.cursors.DictCursor,
    )


def _save_files_to_db(mac: str, file_list: list) -> int:
    """Upsert SD file list to database. Returns count of files saved, -1 on error."""
    try:
        db = _db_connect()
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
        logger.bind(tag=TAG).error(f"SD sync DB error: {e}")
        return -1


class SDSyncHandler(BaseHandler):
    def __init__(self, config: dict):
        super().__init__(config)

    async def handle_list_devices(self, request: web.Request) -> web.Response:
        """GET /api/sd-sync/devices -- list connected devices with MCP."""
        devices = connection_registry.list_devices()
        result = []
        for did in devices:
            conn = connection_registry.get(did)
            has_mcp = bool(conn and hasattr(conn, "mcp_client") and conn.mcp_client)
            mcp_ready = False
            tools = []
            if has_mcp and conn.mcp_client:
                mcp_ready = conn.mcp_client.ready
                tools = list(conn.mcp_client.tools.keys())
            result.append({
                "device_id": did,
                "mcp": has_mcp,
                "mcp_ready": mcp_ready,
                "tools": tools,
            })
        resp = web.json_response({"devices": result})
        self._add_cors_headers(resp)
        return resp

    async def handle_sync(self, request: web.Request) -> web.Response:
        """POST /api/sd-sync/<mac> -- trigger MCP list_sd_music and save to DB."""
        mac = request.match_info.get("mac", "")
        if not mac:
            return self._error_response("Missing mac address", 400)

        conn = connection_registry.get(mac)
        if conn is None:
            return self._error_response(
                f"Device {mac} not connected. Connected: {connection_registry.list_devices()}",
                404, online=False,
            )

        if not hasattr(conn, "mcp_client") or not conn.mcp_client:
            return self._error_response("Device connected but MCP not initialized", 400, online=True)

        if not await conn.mcp_client.is_ready():
            return self._error_response("MCP client not ready yet, wait a moment", 503, online=True)

        tool_name = "self_list_sd_music"
        if not conn.mcp_client.has_tool(tool_name):
            available = list(conn.mcp_client.tools.keys())
            return self._error_response(
                f"Device does not have '{tool_name}' tool. Available: {available}",
                400, online=True, tools=available,
            )

        try:
            from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool

            result = await call_mcp_tool(conn, conn.mcp_client, tool_name, "{}", timeout=15)
            logger.bind(tag=TAG).info(f"SD sync MCP result for {mac}: {str(result)[:300]}")

            file_list = json.loads(result) if isinstance(result, str) else result
            if not isinstance(file_list, list):
                return self._error_response(
                    f"Unexpected MCP response: {str(result)[:500]}", 500
                )

            count = _save_files_to_db(mac, file_list)
            resp = web.json_response({"success": True, "count": count, "files": file_list})
            self._add_cors_headers(resp)
            return resp

        except TimeoutError:
            return self._error_response("MCP call timed out (device didn't respond in 15s)", 504)
        except Exception as e:
            logger.bind(tag=TAG).error(f"SD sync error for {mac}: {e}")
            return self._error_response(str(e), 500)

    def _error_response(self, msg, status, **extra):
        resp = web.json_response({"error": msg, **extra}, status=status)
        self._add_cors_headers(resp)
        return resp
