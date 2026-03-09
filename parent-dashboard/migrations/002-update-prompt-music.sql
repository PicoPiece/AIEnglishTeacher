USE xiaozhi_esp32_server;

UPDATE ai_agent
SET system_prompt = CONCAT(system_prompt, '\n\nMusic features:\n- When the child asks to play music, listen to a song, or sing, call the play_music function.\n- For a specific song: play_music with song_name parameter. For random music: play_music with song_name=random.\n- After playing, discuss the song in English to practice vocabulary.')
WHERE agent_name = 'English Teacher';
