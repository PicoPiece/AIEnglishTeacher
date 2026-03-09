USE xiaozhi_esp32_server;
SELECT id, model_name, model_type, config_json FROM ai_model_config WHERE model_type = 'llm';
