-- Photos storage table: stores photo binary data separately from profiles
-- This replaces the inline base64 data in profiles.foto_url
-- Photos are served via /api/photos/:userId with proper image headers and caching

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  data TEXT NOT NULL,          -- base64-encoded image data (without data:image prefix)
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
