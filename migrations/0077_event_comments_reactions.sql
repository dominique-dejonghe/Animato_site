-- ============================================================
-- Migration 0077: Reacties + emoji-reacties op events
-- ============================================================
-- Bestaande post_replies en post_reactions hebben een harde FK naar
-- posts(id), dus we kunnen ze niet hergebruiken voor events.
-- Twee aparte tabellen met dezelfde structuur als de post-versie.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  parent_reply_id INTEGER,
  auteur_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_reply_id) REFERENCES event_replies(id) ON DELETE CASCADE,
  FOREIGN KEY (auteur_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('like','love','laugh','wow','sad')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_replies_event ON event_replies(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reactions_event ON event_reactions(event_id);
