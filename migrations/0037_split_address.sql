-- Address split migration
-- Add new columns for detailed address information to profiles table
-- Keep 'adres' column for legacy data / fallback

-- Check if columns exist before adding them (to avoid duplicates if re-running)
-- SQLite doesn't support 'IF NOT EXISTS' for ADD COLUMN directly in all versions, 
-- but we can try adding them one by one. If one fails, others might succeed if separate.
-- However, migrations are atomic. 
-- The error 'duplicate column name: postcode' suggests 'postcode' might already exist or the migration partially ran.
-- Let's assume 'postcode' and 'stad' (as gemeente) might exist.
-- In previous schemas, we had 'adres', 'postcode', 'stad'. 
-- Let's check schema first. Ah, I can't check schema in SQL file easily without errors.

-- Based on previous tool output, 'profiles' table had: 
-- id, user_id, voornaam, achternaam, telefoon, adres, postcode, stad, geboortedatum...
-- So 'postcode' and 'stad' ALREADY EXIST!
-- We should only add 'straat', 'huisnummer', 'bus', 'land'.
-- And maybe rename 'stad' to 'gemeente' or just use 'stad'. 
-- Let's use 'gemeente' as alias for 'stad' in UI, but keep DB clean?
-- Or add 'gemeente' and copy 'stad' to it?
-- Let's try to add only missing columns.

ALTER TABLE profiles ADD COLUMN straat TEXT;
ALTER TABLE profiles ADD COLUMN huisnummer TEXT;
ALTER TABLE profiles ADD COLUMN bus TEXT;
ALTER TABLE profiles ADD COLUMN land TEXT DEFAULT 'België';
-- Note: postcode and stad (gemeente) already exist in schema


