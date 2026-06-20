-- 0099a_fix_feedback_comments_nullable.sql
-- ────────────────────────────────────────────────────────────────────────────
-- FIX schema-inconsistentie:
--   feedback_comments.user_id was INTEGER NOT NULL
--   maar FK feedback_comments.user_id REFERENCES users(id) ON DELETE SET NULL
--
-- Deze twee zijn intern tegenstrijdig: bij DELETE op users moet user_id op
-- NULL gezet worden, maar NOT NULL blokkeert dat. Dit zorgt o.a. dat de
-- users tabel niet meer ge-rebuild kan worden (voor CHECK constraint update).
--
-- Fix: tabel-rebuild met user_id INTEGER (nullable), data behouden.
-- Productie heeft 210 rijen, allen met user_id NOT NULL → veilig.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE feedback_comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  user_id INTEGER,                       -- ← was NOT NULL, nu nullable
  message TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO feedback_comments_new (id, feedback_id, user_id, message, is_admin, created_at)
SELECT id, feedback_id, user_id, message, is_admin, created_at
FROM feedback_comments;

DROP TABLE feedback_comments;

ALTER TABLE feedback_comments_new RENAME TO feedback_comments;

-- Index herstellen (alleen idx_feedback_comments_feedback_id bestond)
CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id
  ON feedback_comments(feedback_id);
