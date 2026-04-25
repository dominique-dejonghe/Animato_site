-- Migration 0056: Voeg 'lidgeld' toe aan notifications.type CHECK constraint.
-- SQLite kan geen CHECK constraint wijzigen op een bestaande tabel — we
-- moeten de tabel renamen, opnieuw aanmaken met juiste constraint, en data
-- terug kopiëren. Indexes worden ook opnieuw aangemaakt.

PRAGMA foreign_keys=OFF;

-- Stap 1: backup tabel
ALTER TABLE notifications RENAME TO _notifications_old;

-- Stap 2: nieuwe tabel met uitgebreide CHECK constraint
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('nieuws', 'materiaal', 'repetitie', 'concert', 'board', 'systeem', 'lidgeld', 'profiel')),
  titel TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_gelezen INTEGER NOT NULL DEFAULT 0,
  gelezen_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stap 3: data terugkopiëren
INSERT INTO notifications (id, user_id, type, titel, body, link, is_gelezen, gelezen_at, created_at)
  SELECT id, user_id, type, titel, body, link, is_gelezen, gelezen_at, created_at
  FROM _notifications_old;

-- Stap 4: oude tabel weg
DROP TABLE _notifications_old;

-- Stap 5: indexes herstellen (waren vroeger gedefinieerd in 0001_initial_schema.sql)
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_gelezen ON notifications(is_gelezen);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_gelezen, created_at DESC);

PRAGMA foreign_keys=ON;
