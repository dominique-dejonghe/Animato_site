-- Add source column to qr_checkins: 'qr' = self-scan, 'admin' = manual registration by admin
-- Only qr-source check-ins count towards the streak leaderboard.

ALTER TABLE qr_checkins ADD COLUMN source TEXT NOT NULL DEFAULT 'qr';

-- Optional index for faster filtering on source (e.g. streak calc)
CREATE INDEX IF NOT EXISTS idx_qr_checkins_source ON qr_checkins(source);
