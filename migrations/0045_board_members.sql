-- Board Member System
-- Adds is_bestuurslid flag to users table
-- A board member can have any role (admin, moderator, stemleider, lid)
-- This flag controls access to meetings, board projects, etc.

ALTER TABLE users ADD COLUMN is_bestuurslid INTEGER NOT NULL DEFAULT 0;

-- Create index for quick board member lookups
CREATE INDEX IF NOT EXISTS idx_users_bestuurslid ON users(is_bestuurslid);
