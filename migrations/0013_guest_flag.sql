-- 標記訪客帳戶：只有 is_guest=1 的帳戶才能用「名字=帳號=密碼」免密登入，避免搶走已註冊帳號
ALTER TABLE player_credentials ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
