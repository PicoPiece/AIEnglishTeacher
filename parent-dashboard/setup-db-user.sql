-- Run this on the server to create a MySQL user for the parent dashboard.
-- Execute with:
--   docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 < setup-db-user.sql

CREATE USER IF NOT EXISTS 'parent_reader'@'%' IDENTIFIED BY 'parent_readonly_pass';

-- Read-only access to core xiaozhi tables
GRANT SELECT ON xiaozhi_esp32_server.sys_user TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_device TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_agent TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_agent_chat_history TO 'parent_reader'@'%';

-- Allow parent to update prompt and voice settings
GRANT UPDATE (system_prompt, tts_voice_id) ON xiaozhi_esp32_server.ai_agent TO 'parent_reader'@'%';

-- Read TTS voice options for voice picker
GRANT SELECT ON xiaozhi_esp32_server.ai_tts_voice TO 'parent_reader'@'%';

-- Admin operations: manage users, devices, agents
GRANT INSERT, UPDATE ON xiaozhi_esp32_server.sys_user TO 'parent_reader'@'%';
GRANT UPDATE (user_id, agent_id, alias) ON xiaozhi_esp32_server.ai_device TO 'parent_reader'@'%';
GRANT INSERT, UPDATE ON xiaozhi_esp32_server.ai_agent TO 'parent_reader'@'%';

-- Full access to parent-owned music/playlist/schedule tables
GRANT ALL ON xiaozhi_esp32_server.parent_music TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_playlist TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_playlist_item TO 'parent_reader'@'%';
GRANT ALL ON xiaozhi_esp32_server.parent_play_schedule TO 'parent_reader'@'%';

FLUSH PRIVILEGES;
