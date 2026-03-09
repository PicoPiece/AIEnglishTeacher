USE xiaozhi_esp32_server;

-- Check ai_agent_chat_history for summary
SELECT DISTINCT session_id FROM ai_agent_chat_history ORDER BY created_at DESC LIMIT 5;

-- Check if there's a chat summary table
SELECT * FROM ai_agent_context_provider LIMIT 5;

-- Check for memory/summary in ai_model_config
SELECT * FROM ai_model_config WHERE config_value LIKE '%summary%' OR config_key LIKE '%memory%' LIMIT 10;
