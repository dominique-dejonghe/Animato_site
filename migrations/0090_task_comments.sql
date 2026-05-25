-- =====================================================
-- Task comments — polymorf voor meeting_action_items + concert_project_tasks
-- Ondersteunt threading via parent_id (één niveau diep is genoeg voor MVP)
-- =====================================================

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Polymorphic link naar taak
  task_type TEXT NOT NULL CHECK(task_type IN ('meeting_action', 'project_task')),
  task_id INTEGER NOT NULL,

  -- Auteur
  user_id INTEGER NOT NULL,

  -- Thread support: NULL = top-level comment, anders verwijst naar parent comment
  parent_id INTEGER,

  -- Inhoud
  body TEXT NOT NULL,

  -- Lifecycle
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,  -- soft delete zodat thread-structuur niet breekt

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES task_comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task        ON task_comments(task_type, task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user        ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_parent      ON task_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created     ON task_comments(created_at);
