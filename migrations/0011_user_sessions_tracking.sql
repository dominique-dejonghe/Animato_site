-- User Sessions Tracking Migration
-- Version: 0011
-- Date: 2025-11-25
-- Purpose: Track user login/logout sessions with duration

-- =====================================================
-- USER SESSIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT NOT NULL,
  login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_at DATETIME,
  duration_seconds INTEGER, -- Calculated on logout
  ip_address TEXT,
  user_agent TEXT,
  login_method TEXT DEFAULT 'password' CHECK(login_method IN ('password', '2fa', 'oauth', 'remember_me')),
  is_active INTEGER NOT NULL DEFAULT 1, -- 1 = still logged in, 0 = logged out
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions(login_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
