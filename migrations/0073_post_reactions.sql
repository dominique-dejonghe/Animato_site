-- 0073: Emoji-reacties op posts (duim, hartje, etc.)
-- Doel: leden kunnen een emoji-reactie achterlaten zonder te moeten typen
-- Een user kan max 1 reactie per post hebben (switchen = update, zelfde nog eens = wegnemen)
--
-- Datamodel:
--   post_reactions — één rij per (post, user) combinatie
--   type = 'like' (👍), 'love' (❤️), 'laugh' (😄), 'wow' (😮), 'sad' (😢)

CREATE TABLE IF NOT EXISTS post_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('like', 'love', 'laugh', 'wow', 'sad')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user ON post_reactions(user_id);
