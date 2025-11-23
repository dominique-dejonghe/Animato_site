-- Add capaciteit column to locations table
-- Migration: 0009

ALTER TABLE locations ADD COLUMN capaciteit INTEGER;

-- Add comment explaining the column
-- capaciteit = maximum aantal personen dat de locatie kan bevatten
