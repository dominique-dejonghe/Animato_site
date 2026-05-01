-- Migration 0060: Voeg 'vergadering' toe aan events.type CHECK-constraint
-- Reden: bestuursvergaderingen, algemene ledenvergaderingen etc. moeten in de agenda
-- kunnen verschijnen. SQLite ondersteunt geen ALTER op CHECK; dus tabel-recreate.

PRAGMA foreign_keys=OFF;

CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('repetitie', 'concert', 'vergadering', 'activiteit', 'uitstap', 'workshop', 'ander')),
  slug TEXT UNIQUE,
  start_at DATETIME NOT NULL,
  end_at DATETIME,
  locatie TEXT,
  beschrijving TEXT,
  image_url TEXT,
  is_publiek BOOLEAN DEFAULT 0,
  doelgroep TEXT DEFAULT 'all',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  layout_id INTEGER REFERENCES venue_layouts(id),
  price_config TEXT,
  max_deelnemers INTEGER,
  aanmelden_verplicht INTEGER NOT NULL DEFAULT 0,
  zichtbaar_publiek INTEGER NOT NULL DEFAULT 1,
  toon_op_homepage INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  parent_event_id INTEGER,
  occurrence_date DATE,
  seating_plan_id INTEGER
);

INSERT INTO events_new SELECT * FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

PRAGMA foreign_keys=ON;
