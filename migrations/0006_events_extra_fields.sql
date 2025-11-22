-- Add missing fields to events table for better event management

-- Add attendance/registration fields
ALTER TABLE events ADD COLUMN max_deelnemers INTEGER;
ALTER TABLE events ADD COLUMN aanmelden_verplicht INTEGER NOT NULL DEFAULT 0;

-- Add visibility fields
ALTER TABLE events ADD COLUMN zichtbaar_publiek INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN toon_op_homepage INTEGER NOT NULL DEFAULT 0;

-- Add audit field
ALTER TABLE events ADD COLUMN created_by INTEGER REFERENCES users(id);

-- Create index for created_by lookups
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);
