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
    old = _connections.get(device_id)
    if old is not None and old is not conn:
        logger.bind(tag=TAG).warning(
            f"Registry: device {device_id} replacing stale connection"
        )
    _connections[device_id] = conn
    logger.bind(tag=TAG).info(f"Registry: device {device_id} connected (total: {len(_connections)})")


def unregister(device_id: str, conn=None):
    """Remove a device connection from registry.

    If conn is provided, only remove if it matches the registered connection.
    This prevents a late-running finally block from removing a newer connection.
    """
    current = _connections.get(device_id)
    if current is None:
        return
    if conn is not None and current is not conn:
        logger.bind(tag=TAG).debug(
            f"Registry: skipping unregister for {device_id} (stale conn)"
        )
        return
    del _connections[device_id]
    logger.bind(tag=TAG).info(f"Registry: device {device_id} disconnected (total: {len(_connections)})")


def get(device_id: str):
    """Get connection handler for a device, or None."""
    return _connections.get(device_id)


def list_devices():
    """List all connected device IDs."""
    return list(_connections.keys())
