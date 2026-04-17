-- Track material opens/downloads
CREATE TABLE IF NOT EXISTS material_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast counting per material
CREATE INDEX IF NOT EXISTS idx_material_views_material ON material_views(material_id);

-- Index for user-specific queries (has this user viewed it?)
CREATE INDEX IF NOT EXISTS idx_material_views_user_mat ON material_views(user_id, material_id);
