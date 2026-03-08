DELETE FROM sys_user_token;
DELETE FROM sys_user;

INSERT INTO sys_user (id, username, password, super_admin, status, create_date, update_date)
VALUES (1, 'admin', '$2a$10$dXJ3SW6G7P50lGmMkkmwe.20cQQubK3.HZWzG3YB1tlRy.fqvM/BG', 1, 1, NOW(), NOW());

INSERT INTO sys_user_token (id, user_id, token, expire_date, update_date, create_date)
VALUES (1, 1, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', DATE_ADD(NOW(), INTERVAL 365 DAY), NOW(), NOW());

SELECT u.id, u.username, u.super_admin, t.token, t.expire_date 
FROM sys_user u JOIN sys_user_token t ON u.id = t.user_id;
