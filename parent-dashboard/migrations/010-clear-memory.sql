USE xiaozhi_esp32_server;

-- Check current summary_memory content
SELECT id, agent_name, LEFT(summary_memory, 200) AS current_memory FROM ai_agent;

-- Reset summary_memory to English for our agents
UPDATE ai_agent SET summary_memory = 'The student enjoys music and is learning English at a beginner level. They like dinosaurs and animals.'
WHERE agent_name = 'English Teacher';

-- Verify
SELECT id, agent_name, summary_memory FROM ai_agent WHERE agent_name = 'English Teacher';
