-- Add YouTube video support to photos table
-- media_type: 'photo' (default) or 'youtube'
-- youtube_id: the 11-character YouTube video ID

ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE photos ADD COLUMN youtube_id TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_media_type ON photos(media_type);
