-- Enhanced feedback statuses: add 'hertesten' and 'meer_info_nodig'
-- Also add 'browser_info' field for better bug context

-- Step 1: Create new table with expanded status CHECK constraint
CREATE TABLE IF NOT EXISTS feedback_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT CHECK(type IN ('bug', 'feature', 'other')) DEFAULT 'bug',
  message TEXT NOT NULL,
  url TEXT,
  screenshot TEXT,
  browser_info TEXT,
  status TEXT CHECK(status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten', 'resolved', 'rejected')) DEFAULT 'open',
  admin_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Step 2: Copy existing data
INSERT INTO feedback_new (id, user_id, type, message, url, screenshot, status, admin_notes, created_at, updated_at)
SELECT id, user_id, type, message, url, screenshot, status, admin_notes, created_at, updated_at
FROM feedback;

-- Step 3: Drop old table
DROP TABLE IF EXISTS feedback;

-- Step 4: Rename new table
ALTER TABLE feedback_new RENAME TO feedback;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
