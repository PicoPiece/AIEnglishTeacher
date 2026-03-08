#!/usr/bin/env python3
"""Update .config.yaml with correct secret and endpoints."""
import sys

config_path = sys.argv[1] if len(sys.argv) > 1 else "/home/picopiece/xiaozhi-server/data/.config.yaml"
server_ip = sys.argv[2] if len(sys.argv) > 2 else "192.168.1.48"
secret = "01ea340b-17a8-4fce-92fc-68d41027176a"

with open(config_path, "r") as f:
    content = f.read()

# Update manager-api URL for Docker internal
content = content.replace(
    "url: http://127.0.0.1:8002/xiaozhi",
    "url: http://xiaozhi-esp32-server-web:8002/xiaozhi"
)

# Update secret
content = content.replace(
    "secret: \u4f60\u7684server.secret\u503c",
    f"secret: {secret}"
)

# Update vision_explain
content = content.replace(
    "vision_explain: http://\u4f60\u7684ip\u6216\u8005\u57df\u540d:\u7aef\u53e3\u53f7/mcp/vision/explain",
    f"vision_explain: http://{server_ip}:8003/mcp/vision/explain"
)

with open(config_path, "w") as f:
    f.write(content)

print(f"Config updated: secret={secret[:20]}..., server_ip={server_ip}")
print("Done.")
