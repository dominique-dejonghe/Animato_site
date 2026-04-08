-- QR Check-in system for repetitie attendance tracking
-- Each repetitie event gets a unique QR token, members scan to check in

-- QR tokens per repetitie event
CREATE TABLE IF NOT EXISTS qr_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  valid_from DATETIME,
  valid_until DATETIME,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Check-in registrations
CREATE TABLE IF NOT EXISTS qr_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qr_checkins_user ON qr_checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_qr_checkins_event ON qr_checkins(event_id);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_tokens(token);
