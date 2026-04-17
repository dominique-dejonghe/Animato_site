-- Add is_test_account column for hidden test/demo accounts
-- Test accounts can log in but don't appear in member lists, counts, or leaderboards
ALTER TABLE users ADD COLUMN is_test_account INTEGER NOT NULL DEFAULT 0;
