-- Existing open orders retain their original reservation and fee rules.
ALTER TABLE orders ADD COLUMN fee_scheme INTEGER NOT NULL DEFAULT 0 CHECK(fee_scheme IN (0,1));
ALTER TABLE trades ADD COLUMN fee_amount REAL NOT NULL DEFAULT 0 CHECK(fee_amount>=0);
CREATE TABLE fee_revenue (id INTEGER PRIMARY KEY CHECK(id=1), amount REAL NOT NULL DEFAULT 0 CHECK(amount>=0));
INSERT INTO fee_revenue(id) VALUES(1);
