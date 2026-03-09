USE xiaozhi_esp32_server;

-- Revert intent_model_id and mem_model_id
UPDATE ai_agent SET intent_model_id = 'Intent_intent_llm', mem_model_id = 'Memory_mem_local_short'
WHERE id = '364609f2c11d489f9dd9e561df3d0568';

UPDATE ai_agent SET intent_model_id = 'Intent_function_call', mem_model_id = 'Memory_nomem'
WHERE id = '9710d57291fe44609cf74838f226727d';

-- Check intent module config - the LLM used for intent is stored here
SELECT id, model_name, model_type, config_json FROM ai_model_config WHERE id LIKE 'Intent%';
