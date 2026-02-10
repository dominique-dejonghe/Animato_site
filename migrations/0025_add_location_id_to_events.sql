-- Migration: Add location_id to events table
-- Date: 2026-02-07

ALTER TABLE events ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
