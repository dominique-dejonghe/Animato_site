CREATE TABLE IF NOT EXISTS member_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  favorite_member_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (favorite_member_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, favorite_member_id)
);

CREATE INDEX IF NOT EXISTS idx_member_favorites_user ON member_favorites(user_id);
