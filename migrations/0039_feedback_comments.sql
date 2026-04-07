-- Feedback conversation / comments system
-- Allows back-and-forth communication between admin and feedback submitter

CREATE TABLE IF NOT EXISTS feedback_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id ON feedback_comments(feedback_id);
