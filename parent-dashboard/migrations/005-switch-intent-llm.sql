USE xiaozhi_esp32_server;

-- Check current config
SELECT id, agent_name, llm_model_id, intent_model_id, mem_model_id FROM ai_agent WHERE agent_name = 'English Teacher';

-- Switch intent LLM from ChatGLM to DeepSeek (ChatGLM has ASCII encoding bug)
UPDATE ai_agent SET intent_model_id = 'LLM_DeepSeekLLM' WHERE agent_name = 'English Teacher';

-- Switch memory LLM too
UPDATE ai_agent SET mem_model_id = 'LLM_DeepSeekLLM' WHERE agent_name = 'English Teacher';

-- Verify
SELECT id, agent_name, llm_model_id, intent_model_id, mem_model_id FROM ai_agent WHERE agent_name = 'English Teacher';
