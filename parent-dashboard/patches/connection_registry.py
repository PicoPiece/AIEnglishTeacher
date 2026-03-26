"""Global connection registry for active device connections.

Allows external HTTP handlers to look up a live ConnectionHandler
by device_id (MAC address) and call MCP tools on it.

Patch: copy to /opt/xiaozhi-esp32-server/core/connection_registry.py
"""

from config.logger import setup_logging

TAG = __name__
logger = setup_logging()

_connections = {}


def register(device_id: str, conn):
    """Register an active device connection."""
    _connections[device_id] = conn
    logger.bind(tag=TAG).info(f"Registry: device {device_id} connected (total: {len(_connections)})")


def unregister(device_id: str):
    """Remove a device connection from registry."""
    removed = _connections.pop(device_id, None)
    if removed:
        logger.bind(tag=TAG).info(f"Registry: device {device_id} disconnected (total: {len(_connections)})")


def get(device_id: str):
    """Get connection handler for a device, or None."""
    return _connections.get(device_id)


def list_devices():
    """List all connected device IDs."""
    return list(_connections.keys())
