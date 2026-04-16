-- Add lid_sinds field to profiles
-- Tracks the actual date a member joined Animato (not system registration date)
-- For existing members: backfilled from users.created_at (editable by admin)
-- For new members: automatically set on registration

ALTER TABLE profiles ADD COLUMN lid_sinds DATE;

-- Backfill from users.created_at for all existing profiles
UPDATE profiles SET lid_sinds = (
  SELECT DATE(u.created_at) FROM users u WHERE u.id = profiles.user_id
) WHERE lid_sinds IS NULL;
