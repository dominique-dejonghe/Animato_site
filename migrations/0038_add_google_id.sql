-- Add google_id to users table for OAuth
ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
