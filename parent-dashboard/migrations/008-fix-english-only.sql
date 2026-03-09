USE xiaozhi_esp32_server;

-- Fix system prompt: enforce English-only responses
UPDATE ai_agent SET system_prompt = REPLACE(
  system_prompt,
  'Mix Vietnamese explanations when the child seems confused.\nKeep conversations fun and engaging.',
  'ALWAYS respond in English. This is critical - you are an English teacher.\nIf the child seems confused, use simpler English words and shorter sentences.\nOnly use a Vietnamese word if the child explicitly asks \"what does X mean in Vietnamese?\".\nKeep conversations fun and engaging.'
) WHERE agent_name = 'English Teacher';

-- Find and show memory tables
SHOW TABLES LIKE '%memo%';
SHOW TABLES LIKE '%memory%';
SHOW TABLES LIKE '%chat%';

-- Verify prompt update
SELECT id, SUBSTRING(system_prompt, 1, 600) AS prompt_preview FROM ai_agent WHERE agent_name = 'English Teacher';
