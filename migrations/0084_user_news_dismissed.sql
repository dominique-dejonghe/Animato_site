-- 0084_user_news_dismissed.sql
-- Per-user dismiss-state voor "Nieuw bericht: ..." items in het
-- "Wat staat er voor jou open?"-widget op /leden.
--
-- Use case: de widget toont recente nieuws-posts sinds previous_login_at.
-- Voorheen bleven die staan omdat previous_login_at niet meebewoog.
-- Nu kan een lid een nieuws-item dismissen (X-knop) of via "Lees"
-- impliciet als gelezen markeren — beide acties triggeren een
-- idempotente INSERT in deze tabel.

CREATE TABLE IF NOT EXISTS user_news_dismissed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_news_dismissed_user
  ON user_news_dismissed(user_id);
CREATE INDEX IF NOT EXISTS idx_user_news_dismissed_post
  ON user_news_dismissed(post_id);
