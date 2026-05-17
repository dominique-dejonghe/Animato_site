-- ============================================================
-- Migration 0076: Email-log voor printservice
-- ============================================================
-- Houdt bij welke mails verstuurd zijn vanuit /admin/prints,
-- naar wie, met welk onderwerp, en of het lukte (success/fail).
-- Zo kan je in de detail-modal zien wat er al gemaild is, en
-- bij een failure direct zien WAAROM.
-- ============================================================

CREATE TABLE IF NOT EXISTS print_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_request_id INTEGER NOT NULL,
  email_type TEXT NOT NULL,           -- 'ready' | 'reminder' | 'payment_reminder'
  recipient TEXT NOT NULL,            -- e-mail adres
  subject TEXT,
  success INTEGER NOT NULL DEFAULT 0, -- 0 = fail, 1 = ok
  error_msg TEXT,                     -- ingevuld bij failure
  sent_by_user_id INTEGER,            -- welke admin trok aan de hendel
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (print_request_id) REFERENCES print_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_print_email_log_request ON print_email_log(print_request_id);
CREATE INDEX IF NOT EXISTS idx_print_email_log_sent_at ON print_email_log(sent_at DESC);
