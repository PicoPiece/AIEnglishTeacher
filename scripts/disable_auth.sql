UPDATE sys_params SET param_value = 'false' WHERE param_code = 'server.auth.enabled';
SELECT param_code, param_value FROM sys_params WHERE param_code = 'server.auth.enabled';
