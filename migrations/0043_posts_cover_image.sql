-- Add cover_image column to posts table (#76)
-- Allows uploading a cover/thumbnail image for news posts
ALTER TABLE posts ADD COLUMN cover_image TEXT;
