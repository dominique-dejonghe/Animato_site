-- Migration 0058: Retest history voor feedback items
-- Houdt bij wie wat getest heeft, wanneer, op welke deploy, met resultaat

CREATE TABLE IF NOT EXISTS feedback_retest_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  tester_user_id INTEGER NOT NULL,
  deploy_ref TEXT,                  -- bv. "ab621afb" of commit hash
  result TEXT NOT NULL CHECK(result IN ('werkt', 'werkt_niet', 'partieel', 'meer_info')),
  notes TEXT,
  tested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
  FOREIGN KEY (tester_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retest_feedback_id ON feedback_retest_history(feedback_id);
CREATE INDEX IF NOT EXISTS idx_retest_tester_id ON feedback_retest_history(tester_user_id);
CREATE INDEX IF NOT EXISTS idx_retest_tested_at ON feedback_retest_history(tested_at DESC);
