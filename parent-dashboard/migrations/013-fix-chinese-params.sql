-- Fix Chinese system params to English
-- Run: docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 xiaozhi_esp32_server < migrations/013-fix-chinese-params.sql

UPDATE sys_params SET param_value = 'Time flies! Say a warm goodbye to end this conversation.'
WHERE param_code = 'end_prompt.prompt';

UPDATE sys_params SET param_value = 'goodbye;bye bye;see you;stop'
WHERE param_code = 'exit_commands';

UPDATE sys_params SET param_value = 'hello teacher;hi teacher;hey teacher;hello;hi there'
WHERE param_code = 'wakeup_words';
