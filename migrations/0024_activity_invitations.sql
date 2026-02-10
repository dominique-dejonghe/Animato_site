-- Migration: Activity Invitations Tracking
-- Date: 2026-02-07

CREATE TABLE IF NOT EXISTS activity_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'seen')),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  seen_at DATETIME,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id)
);

CREATE INDEX idx_activity_invitations_activity ON activity_invitations(activity_id);
