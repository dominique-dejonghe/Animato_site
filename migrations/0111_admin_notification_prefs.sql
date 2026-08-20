-- Opt-out toggles voor admin/bestuur notificaties
-- Default: 1 = ingeschakeld (mail wordt verzonden). Zet op 0 om af te melden.

ALTER TABLE users ADD COLUMN notify_ticket_sales INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_weekly_report INTEGER DEFAULT 1;

-- Zorg dat bestaande rows correct 1 zijn (SQLite ALTER met DEFAULT vult NULL,
-- dus expliciet backfill voor zekerheid)
UPDATE users SET notify_ticket_sales = 1 WHERE notify_ticket_sales IS NULL;
UPDATE users SET notify_weekly_report = 1 WHERE notify_weekly_report IS NULL;
