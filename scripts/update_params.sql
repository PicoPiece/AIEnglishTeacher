UPDATE sys_params SET param_value = 'ws://192.168.1.48:8000/xiaozhi/v1/' WHERE param_code = 'server.websocket';
UPDATE sys_params SET param_value = 'http://192.168.1.48:8002/xiaozhi/ota/' WHERE param_code = 'server.ota';
SELECT param_code, param_value FROM sys_params WHERE param_code IN ('server.websocket', 'server.ota', 'server.secret');
