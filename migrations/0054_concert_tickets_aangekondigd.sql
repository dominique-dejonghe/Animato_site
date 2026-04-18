-- Add explicit "tickets aangekondigd maar nog niet beschikbaar" flag
-- Lets admin announce tickets are coming without needing a specific pre-sale date yet
ALTER TABLE concerts ADD COLUMN tickets_aangekondigd INTEGER NOT NULL DEFAULT 0;
