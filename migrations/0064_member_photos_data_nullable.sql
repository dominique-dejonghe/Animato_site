-- member_photos.data wordt vervangen door R2 (r2_key kolom)
-- Maak 'data' nullable zodat nieuwe uploads alleen r2_key hoeven te zetten.
-- SQLite ondersteunt geen ALTER COLUMN DROP NOT NULL → recreate-table truc.

-- 1. Hernoem oude tabel
ALTER TABLE member_photos RENAME TO member_photos_old;

-- 2. Maak nieuwe tabel met data NULLABLE
CREATE TABLE member_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  data TEXT,                                          -- nu nullable (was NOT NULL)
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  r2_key TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Kopieer data over
INSERT INTO member_photos (id, user_id, data, content_type, size_bytes, created_at, updated_at, r2_key)
SELECT id, user_id, data, content_type, size_bytes, created_at, updated_at, r2_key
FROM member_photos_old;

-- 4. Drop oude tabel
DROP TABLE member_photos_old;

-- 5. Index voor lookup op r2_key
CREATE INDEX IF NOT EXISTS idx_member_photos_r2_key ON member_photos(r2_key);
