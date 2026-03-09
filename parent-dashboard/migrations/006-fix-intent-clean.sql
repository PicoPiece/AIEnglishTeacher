USE xiaozhi_esp32_server;

-- 1. Revert broken changes from previous attempt
UPDATE ai_agent SET
  intent_model_id = 'Intent_function_call',
  mem_model_id = 'Memory_mem_local_short',
  llm_model_id = 'LLM_DeepSeekLLM'
WHERE id = '364609f2c11d489f9dd9e561df3d0568';

UPDATE ai_agent SET
  intent_model_id = 'Intent_function_call',
  mem_model_id = 'Memory_nomem'
WHERE id = '9710d57291fe44609cf74838f226727d';

-- 2. Verify
SELECT id, agent_name, llm_model_id, intent_model_id, mem_model_id FROM ai_agent;
