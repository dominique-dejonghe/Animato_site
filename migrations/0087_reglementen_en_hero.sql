-- Migratie 0087: Reglementen documenten + Hero homepage settings
-- 
-- 1) reglementen_documenten: documenten voor het ledenportaal-reglementen
--    Bevat referentie naar materials/url + admin-beheerde metadata.
-- 2) system_settings keys voor hero (homepage video/banner): admin-editbaar
--    via admin-settings UI zonder code-deploy.

CREATE TABLE IF NOT EXISTS reglementen_documenten (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  titel         TEXT NOT NULL,
  beschrijving  TEXT,
  url           TEXT NOT NULL,        -- R2-URL of externe URL
  icoon         TEXT DEFAULT 'fa-file-pdf',  -- FontAwesome icoon class
  volgorde      INTEGER DEFAULT 0,
  is_actief     INTEGER DEFAULT 1,
  uploaded_by   INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reglementen_actief ON reglementen_documenten(is_actief, volgorde);

-- Default hero settings (admin kan via /admin/settings overschrijven)
-- hero_video_type: 'youtube' of 'mp4'
-- hero_video_id:   YouTube video ID (zonder URL prefix) bij type=youtube
-- hero_video_url:  Volledige MP4 URL (R2 of extern) bij type=mp4
-- hero_video_start_sec / end_sec: enkel voor YouTube-loop
-- hero_titel / hero_subtitel: tekst-overlay
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('hero_video_type',      'youtube'),
  ('hero_video_id',        'oXLw5RC0lNo'),
  ('hero_video_url',       ''),
  ('hero_video_start_sec', '6'),
  ('hero_video_end_sec',   '240'),
  ('hero_titel',           'Gemengd Koor Animato'),
  ('hero_subtitel',        'Koor met passie • Samen musiceren sinds 1988');
