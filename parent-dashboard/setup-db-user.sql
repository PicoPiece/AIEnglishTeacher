-- Run this on the server to create a MySQL user for the parent dashboard.
-- Execute with:
--   docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 < setup-db-user.sql

CREATE USER IF NOT EXISTS 'parent_reader'@'%' IDENTIFIED BY 'parent_readonly_pass';

GRANT SELECT ON xiaozhi_esp32_server.sys_user TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_device TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_agent TO 'parent_reader'@'%';
GRANT SELECT ON xiaozhi_esp32_server.ai_agent_chat_history TO 'parent_reader'@'%';

-- Allow parent to update only the system_prompt column (for prompt customization)
GRANT UPDATE (system_prompt) ON xiaozhi_esp32_server.ai_agent TO 'parent_reader'@'%';

FLUSH PRIVILEGES;
