-- Module Settings
-- Allows admins to enable/disable features dynamically

CREATE TABLE IF NOT EXISTS module_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL UNIQUE,
  module_name TEXT NOT NULL,
  module_description TEXT,
  is_enabled INTEGER DEFAULT 1,
  category TEXT DEFAULT 'general', -- general, content, members, admin
  sort_order INTEGER DEFAULT 0,
  icon TEXT, -- Font Awesome icon class
  updated_by INTEGER,
  updated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Seed default modules
INSERT INTO module_settings (module_key, module_name, module_description, is_enabled, category, sort_order, icon) VALUES
  -- Content Modules
  ('nieuws', 'Nieuws & Berichten', 'Nieuwsartikelen en board posts voor leden', 1, 'content', 1, 'fa-newspaper'),
  ('agenda', 'Agenda & Events', 'Evenementenkalender met repetities en concerten', 1, 'content', 2, 'fa-calendar-alt'),
  ('concerten', 'Concerten & Ticketing', 'Concertbeheer met kaartverkoop', 1, 'content', 3, 'fa-ticket-alt'),
  ('fotoboek', 'Fotoboek', 'Fotogalerij voor leden en publiek', 1, 'content', 4, 'fa-images'),
  
  -- Member Modules
  ('materiaal', 'Materiaal & Partituren', 'SATB partituren en oefentracks voor leden', 1, 'members', 10, 'fa-music'),
  ('polls', 'Polls & Stemmingen', 'Stemmen op voorstellen en dirigent keuzes', 1, 'members', 11, 'fa-poll'),
  ('voorstellen', 'Leden Voorstellen', 'Voorstellen indienen en upvoten/downvoten', 1, 'members', 12, 'fa-lightbulb'),
  ('activiteiten', 'Activiteiten & Feesten', 'Sociale events met inschrijving en betaling', 1, 'members', 13, 'fa-glass-cheers'),
  ('karaoke', 'Karaoke Module', 'Song selectie voor karaoke avonden met duet matching', 1, 'members', 14, 'fa-microphone'),
  
  -- Admin Modules
  ('projecten', 'Projectbeheer', 'Concert projecten met taken en budgetten', 1, 'admin', 20, 'fa-tasks'),
  ('vergaderingen', 'Vergaderingen', 'Meeting management met notulen en actiepunten', 1, 'admin', 21, 'fa-handshake'),
  ('finance', 'Lidgelden', 'Financial tracking voor lidmaatschappen', 1, 'admin', 22, 'fa-euro-sign'),
  ('printservice', 'Printservice', 'Print request management voor partituren', 1, 'admin', 23, 'fa-print'),
  ('voice_analyzer', 'Stem Analyzer', 'Voice range analysis tool voor stemgroep indeling', 0, 'admin', 24, 'fa-microphone-alt');

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_module_settings_enabled ON module_settings(is_enabled);
CREATE INDEX IF NOT EXISTS idx_module_settings_category ON module_settings(category);
