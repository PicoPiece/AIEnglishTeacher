USE xiaozhi_esp32_server;

-- Update custom EdgeTTS to use multilingual voice (supports English + Chinese)
UPDATE ai_model_config
SET config_json = JSON_SET(config_json, '$.voice', 'en-US-AnaNeural')
WHERE id = '163650e761a0b034658f0e4520419936';

-- Also update default EdgeTTS
UPDATE ai_model_config
SET config_json = JSON_SET(config_json, '$.voice', 'en-US-AnaNeural')
WHERE id = 'TTS_EdgeTTS';

SELECT id, model_name, config_json FROM ai_model_config WHERE model_type = 'tts';
