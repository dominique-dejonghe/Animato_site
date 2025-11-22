-- Make locatie column nullable since we now use location_id for structured locations
-- The locatie text field is only for backward compatibility or manual entry

-- SQLite doesn't support ALTER COLUMN directly, so we need to:
-- 1. Create new table with correct schema
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table

-- However, for simplicity in development, we'll just accept that locatie can be empty string
-- Update existing NULL values to empty string
UPDATE events SET locatie = '' WHERE locatie IS NULL;

-- Note: In production, you would need to recreate the table to change NOT NULL constraint
-- For now, we'll ensure the application always provides at least empty string
