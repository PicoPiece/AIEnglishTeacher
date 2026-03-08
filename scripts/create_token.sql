INSERT INTO sys_user_token (id, user_id, token, expire_date, update_date, create_date)
VALUES (1, 1, 'eyJ0b2tlbiI6ImVuZ2xpc2h0ZWFjaGVyYWktYWRtaW4tdG9rZW4ifQ', DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW());
SELECT token, expire_date FROM sys_user_token WHERE user_id = 1;
