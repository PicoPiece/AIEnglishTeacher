#!/bin/bash
# Apply SD sync patches to xiaozhi-esp32-server container
set -e

CONTAINER="xiaozhi-esp32-server"
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Applying SD sync patches to $CONTAINER ==="

# 1. Copy new files
echo "[1/8] Copying connection_registry.py..."
docker cp "$PATCH_DIR/connection_registry.py" "$CONTAINER:/opt/xiaozhi-esp32-server/core/connection_registry.py"

echo "[2/8] Copying sd_sync_handler.py..."
docker cp "$PATCH_DIR/sd_sync_handler.py" "$CONTAINER:/opt/xiaozhi-esp32-server/core/api/sd_sync_handler.py"

# 3. Patch connection.py - add import and register/unregister calls
echo "[3/8] Patching connection.py..."
docker exec "$CONTAINER" python3 -c "
import re

with open('/opt/xiaozhi-esp32-server/core/connection.py', 'r') as f:
    content = f.read()

# Check if already patched
if 'connection_registry' in content:
    print('connection.py already patched, skipping')
else:
    # Add import after 'from core.utils.dialogue import Message, Dialogue'
    content = content.replace(
        'from core.utils.dialogue import Message, Dialogue',
        'from core.utils.dialogue import Message, Dialogue\nfrom core import connection_registry',
    )

    # Add register after 'self.device_id = self.headers.get(\"device-id\", None)'
    content = content.replace(
        'self.device_id = self.headers.get(\"device-id\", None)\n\n            # 认证通过,继续处理',
        'self.device_id = self.headers.get(\"device-id\", None)\n            if self.device_id:\n                connection_registry.register(self.device_id, self)\n\n            # 认证通过,继续处理',
    )

    # Add unregister in the finally block, before _save_and_close
    content = content.replace(
        '        finally:\n            try:\n                await self._save_and_close(ws)',
        '        finally:\n            if self.device_id:\n                connection_registry.unregister(self.device_id, self)\n            try:\n                await self._save_and_close(ws)',
        1,  # only first occurrence
    )

    with open('/opt/xiaozhi-esp32-server/core/connection.py', 'w') as f:
        f.write(content)
    print('connection.py patched successfully')
"

# 4. Patch http_server.py - add SD sync routes
echo "[4/8] Patching http_server.py..."
docker exec "$CONTAINER" python3 -c "
with open('/opt/xiaozhi-esp32-server/core/http_server.py', 'r') as f:
    content = f.read()

if 'sd_sync_handler' in content:
    print('http_server.py already patched, skipping')
else:
    # Add import
    content = content.replace(
        'from core.api.vision_handler import VisionHandler',
        'from core.api.vision_handler import VisionHandler\nfrom core.api.sd_sync_handler import SDSyncHandler',
    )

    # Add handler init
    content = content.replace(
        'self.vision_handler = VisionHandler(config)',
        'self.vision_handler = VisionHandler(config)\n        self.sd_sync_handler = SDSyncHandler(config)',
    )

    # Add routes after vision routes
    content = content.replace(
        '''web.options(
                            \"/mcp/vision/explain\", self.vision_handler.handle_options
                        ),
                    ]
                )''',
        '''web.options(
                            \"/mcp/vision/explain\", self.vision_handler.handle_options
                        ),
                    ]
                )

                # SD sync API
                app.add_routes(
                    [
                        web.get(\"/api/sd-sync/devices\", self.sd_sync_handler.handle_list_devices),
                        web.post(\"/api/sd-sync/{mac}\", self.sd_sync_handler.handle_sync),
                        web.options(\"/api/sd-sync/{mac}\", self.sd_sync_handler.handle_options),
                    ]
                )''',
    )

    with open('/opt/xiaozhi-esp32-server/core/http_server.py', 'w') as f:
        f.write(content)
    print('http_server.py patched successfully')
"

# 5. Copy auto-sync module
echo "[5/8] Copying sd_auto_sync.py..."
docker cp "$PATCH_DIR/sd_auto_sync.py" "$CONTAINER:/opt/xiaozhi-esp32-server/core/providers/tools/device_mcp/sd_auto_sync.py"

# 6. Patch mcp_handler.py - add auto-sync trigger
echo "[6/8] Patching mcp_handler.py for auto-sync..."
docker exec "$CONTAINER" python3 -c "
with open('/opt/xiaozhi-esp32-server/core/providers/tools/device_mcp/mcp_handler.py', 'r') as f:
    content = f.read()

if 'sd_auto_sync' in content:
    print('mcp_handler.py already patched')
else:
    content = content.replace(
        'TAG = __name__',
        'TAG = __name__\n\ntry:\n    from core.providers.tools.device_mcp.sd_auto_sync import auto_sync_sd_files as _sd_auto_sync\nexcept ImportError:\n    _sd_auto_sync = None',
    )
    old = '''                    # 刷新工具缓存，确保MCP工具被包含在函数列表中
                    if hasattr(conn, \\\"func_handler\\\") and conn.func_handler:
                        conn.func_handler.tool_manager.refresh_tools()
                        conn.func_handler.current_support_functions()
            return'''
    new = '''                    # 刷新工具缓存，确保MCP工具被包含在函数列表中
                    if hasattr(conn, \\\"func_handler\\\") and conn.func_handler:
                        conn.func_handler.tool_manager.refresh_tools()
                        conn.func_handler.current_support_functions()

                    if _sd_auto_sync is not None:
                        asyncio.create_task(_sd_auto_sync(conn, mcp_client))
            return'''
    content = content.replace(old, new)
    with open('/opt/xiaozhi-esp32-server/core/providers/tools/device_mcp/mcp_handler.py', 'w') as f:
        f.write(content)
    print('mcp_handler.py patched successfully')
"

# 7. Copy play_music.py plugin
echo "[7/8] Copying play_music.py..."
docker cp "$PATCH_DIR/play_music.py" "$CONTAINER:/opt/xiaozhi-esp32-server/plugins_func/functions/play_music.py"

# 8. Patch plugin_executor.py - add play_music to necessary functions
echo "[8/8] Patching plugin_executor.py to include play_music..."
docker exec "$CONTAINER" python3 -c "
with open('/opt/xiaozhi-esp32-server/core/providers/tools/server_plugins/plugin_executor.py', 'r') as f:
    content = f.read()

old = '        necessary_functions = [\"handle_exit_intent\", \"get_lunar\"]'
new = '        necessary_functions = [\"handle_exit_intent\", \"get_lunar\", \"play_music\"]'
if 'play_music' in content:
    print('plugin_executor.py already patched')
else:
    content = content.replace(old, new)
    with open('/opt/xiaozhi-esp32-server/core/providers/tools/server_plugins/plugin_executor.py', 'w') as f:
        f.write(content)
    print('plugin_executor.py patched successfully')
"

# 9. Replace base prompt template (Chinese → English)
echo "[9/9] Replacing agent-base-prompt.txt (Chinese → English)..."
docker cp "$PATCH_DIR/agent-base-prompt.txt" "$CONTAINER:/opt/xiaozhi-esp32-server/agent-base-prompt.txt"

echo ""
echo "=== All patches applied! ==="
echo "Restart the container: docker restart $CONTAINER"
