-- Add recurring event fields to events table
ALTER TABLE events ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN recurrence_rule TEXT; -- JSON: {frequency, interval, end_date, days_of_week}
ALTER TABLE events ADD COLUMN parent_event_id INTEGER REFERENCES events(id);
ALTER TABLE events ADD COLUMN occurrence_date DATE; -- For individual occurrences

-- Create locations table for reusable locations
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL,
  adres TEXT NOT NULL,
  postcode TEXT,
  stad TEXT,
  land TEXT DEFAULT 'België',
  google_maps_url TEXT,
  google_maps_embed TEXT,
  latitude REAL,
  longitude REAL,
  notities TEXT,
  is_actief INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add location_id to events table
ALTER TABLE events ADD COLUMN location_id INTEGER REFERENCES locations(id);

-- Create index for recurring events
CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_events_recurring ON events(is_recurring);
CREATE INDEX IF NOT EXISTS idx_events_location ON events(location_id);

-- Seed some common locations
INSERT INTO locations (naam, adres, stad, postcode, is_actief) VALUES 
('Repetitielokaal Koor', 'Koorstraat 1', 'Brussel', '1000', 1),
('Sint-Pieterskerk', 'Sint-Pietersplein 1', 'Gent', '9000', 1),
('Concertgebouw', 'Concertgebouwplein 1', 'Brugge', '8000', 1);
