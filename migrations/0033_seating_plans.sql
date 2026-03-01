-- Migration: Seating Plans & Venue Layouts
-- Date: 2026-02-15
-- Description: Infrastructure for visual seating plans, VIP sections, and tier-based pricing

-- 1. Venue Layouts (The templates)
CREATE TABLE IF NOT EXISTS venue_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, -- e.g. "Kerk - Volledig", "CC De Schakel - Balkon gesloten"
  description TEXT,
  rows INTEGER NOT NULL, -- Total rows in grid
  cols INTEGER NOT NULL, -- Total cols in grid
  layout_data TEXT NOT NULL, -- JSON blob storing the grid state (seat types, labels, gaps)
  capacity INTEGER, -- Cached total capacity
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Link Events to Layouts (Add columns to events table)
ALTER TABLE events ADD COLUMN layout_id INTEGER REFERENCES venue_layouts(id);
ALTER TABLE events ADD COLUMN price_config TEXT; -- JSON: {"standard": 20, "vip": 50, "rang1": 15}

-- 3. Update Tickets to support specific seats
ALTER TABLE tickets ADD COLUMN seat_label TEXT; -- "Rij 5, Stoel 12" or "A12"
ALTER TABLE tickets ADD COLUMN seat_row TEXT;
ALTER TABLE tickets ADD COLUMN seat_number TEXT;
ALTER TABLE tickets ADD COLUMN seat_category TEXT; -- "standard", "vip", "wheelchair"
