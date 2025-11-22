-- Add image field to events table for concert visuals
-- This allows uploading promotional images for concerts

ALTER TABLE events ADD COLUMN afbeelding TEXT;

-- Index for faster queries filtering by events with images
CREATE INDEX IF NOT EXISTS idx_events_afbeelding ON events(afbeelding);
