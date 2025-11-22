-- Add practical information fields to concerts table
-- These fields allow admins to manage practical details for concert pages

ALTER TABLE concerts ADD COLUMN parking TEXT;
ALTER TABLE concerts ADD COLUMN toegankelijkheid TEXT;
ALTER TABLE concerts ADD COLUMN duur_info TEXT;
ALTER TABLE concerts ADD COLUMN sfeer_dresscode TEXT;
ALTER TABLE concerts ADD COLUMN extra_info TEXT;
