-- ============================================================
-- Migration 0086: Engagement features
-- ============================================================
-- Doel:
--   1. last_seen_at + show_online_status op users (heartbeat + privacy)
--   2. comment_reactions: polymorphic reacties op replies/comments
--      van event_replies, post_replies, post_comments, feedback_comments
--   3. user_dismissed_spotlights: weggeklikte spotlight-banners onthouden
--   4. section_last_visits: per-user "wanneer was ik laatst in deze sectie"
--      voor "Nieuw sinds vorige bezoek"-badges
-- ============================================================

-- ---- 1. Activity tracking & privacy --------------------------
ALTER TABLE users ADD COLUMN last_seen_at DATETIME;
ALTER TABLE users ADD COLUMN show_online_status INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);

-- ---- 2. Polymorphic comment reactions ------------------------
-- target_type identificeert welke tabel: 'event_reply', 'post_reply',
-- 'post_comment', 'feedback_comment'. Target_id verwijst naar de rij
-- in die tabel. Geen harde FK want polymorphic.
CREATE TABLE IF NOT EXISTS comment_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('event_reply', 'post_reply', 'post_comment', 'feedback_comment')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reaction TEXT NOT NULL CHECK(reaction IN ('like', 'love', 'laugh', 'music', 'clap', 'pray')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_type, target_id, user_id, reaction),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_target ON comment_reactions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user ON comment_reactions(user_id);

-- ---- 3. Weggeklikte spotlights -------------------------------
-- spotlight_key bijv. 'birthday:42:2026-05-18' of 'newmember:91' of 'random:37:2026-W20'
CREATE TABLE IF NOT EXISTS user_dismissed_spotlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  spotlight_key TEXT NOT NULL,
  dismissed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, spotlight_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dismissed_spotlights_user ON user_dismissed_spotlights(user_id);

-- ---- 4. Section last visits ----------------------------------
-- Per (user, section) onthouden wanneer ze die sectie laatst bezochten.
-- section bv. 'agenda', 'bestanden', 'nieuws', 'forum'.
CREATE TABLE IF NOT EXISTS section_last_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  last_visit_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, section),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_section_visits_user ON section_last_visits(user_id);
