-- Wachtlijst voor uitverkochte concerten
-- Bezoekers kunnen zich zonder account inschrijven wanneer de admin
-- 'waitlist_enabled = 1' zet op een uitverkocht concert.

ALTER TABLE concerts ADD COLUMN waitlist_enabled INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS concert_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,

  -- Inschrijver
  naam TEXT NOT NULL,
  email TEXT NOT NULL,
  telefoon TEXT,
  aantal_gewenst INTEGER DEFAULT 1,
  notities TEXT,

  -- Follow-up
  status TEXT DEFAULT 'wachtend' CHECK(status IN ('wachtend', 'gecontacteerd', 'geboekt', 'afgemeld')),
  notified_at DATETIME,
  admin_notes TEXT,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (concert_id) REFERENCES concerts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_waitlist_concert ON concert_waitlist(concert_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON concert_waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON concert_waitlist(email);
