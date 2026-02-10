-- Migration: Update event types to include 'activiteit', 'uitstap', 'workshop'
-- Date: 2026-02-07

-- 1. Create new table with updated constraints AND new image_url column
CREATE TABLE events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('repetitie', 'concert', 'activiteit', 'uitstap', 'workshop', 'ander')),
  slug TEXT UNIQUE,
  start_at DATETIME NOT NULL,
  end_at DATETIME,
  locatie TEXT,
  beschrijving TEXT,
  image_url TEXT, -- Newly added here
  is_publiek BOOLEAN DEFAULT 0,
  doelgroep TEXT DEFAULT 'all',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copy data (excluding image_url as it didn't exist)
INSERT INTO events_v2 (id, titel, type, slug, start_at, end_at, locatie, beschrijving, is_publiek, doelgroep, created_at, updated_at)
SELECT id, titel, type, slug, start_at, end_at, locatie, beschrijving, is_publiek, doelgroep, created_at, updated_at
FROM events;

-- 3. Swap tables
DROP TABLE events;
ALTER TABLE events_v2 RENAME TO events;

-- 4. Recreate indexes
CREATE INDEX idx_events_start_at_v2 ON events(start_at);
CREATE INDEX idx_events_slug_v2 ON events(slug);
