-- Allow 'system' user_id for pre-loaded shared content visible to all users.
-- Run: docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 xiaozhi_esp32_server < migrations/011-system-content.sql

-- No schema change needed; user_id is VARCHAR and accepts 'system' value.
-- The generate-starter-content.js script inserts with user_id = 'system'.
-- Music queries are updated to: WHERE user_id = ? OR user_id = 'system'

-- Grant permissions for system content
GRANT ALL ON xiaozhi_esp32_server.parent_music TO 'parent_reader'@'%';
FLUSH PRIVILEGES;
