-- Migration: Custom Forms for Activities
-- Date: 2026-02-08

-- 1. Custom Fields Definition (The Form Schema)
CREATE TABLE IF NOT EXISTS activity_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK(field_type IN ('text', 'textarea', 'select', 'radio', 'checkbox')),
  options TEXT, -- Comma separated options for select/radio
  is_required BOOLEAN DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- 2. Custom Answers (The User Data)
CREATE TABLE IF NOT EXISTS activity_custom_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL,
  field_id INTEGER NOT NULL,
  value TEXT,
  FOREIGN KEY (registration_id) REFERENCES activity_registrations(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES activity_custom_fields(id) ON DELETE CASCADE
);

CREATE INDEX idx_custom_fields_activity ON activity_custom_fields(activity_id);
CREATE INDEX idx_custom_answers_registration ON activity_custom_answers(registration_id);
