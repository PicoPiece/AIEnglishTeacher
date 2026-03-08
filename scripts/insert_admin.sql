INSERT INTO sys_user (id, username, password, super_admin, status, create_date, update_date)
VALUES (1, 'admin', '$2a$12$QBl.laYKfGQzwm6o.n3vdOiYmZMOVMjbXtSRvk6VhSH46.xMloW6G', 1, 1, NOW(), NOW());
SELECT id, username, super_admin, status FROM sys_user;
