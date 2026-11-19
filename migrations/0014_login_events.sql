CREATE TABLE login_events (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER REFERENCES accounts(id), username TEXT, method TEXT NOT NULL, success INTEGER NOT NULL, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_login_events_time ON login_events(id DESC);
