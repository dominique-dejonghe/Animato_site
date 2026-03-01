-- Migration: Walkthrough Module
-- Date: 2026-02-11
-- Description: Interactive guided tours for admin and member onboarding

-- =====================================================
-- TOUR DEFINITIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS walkthrough_tours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_role TEXT NOT NULL CHECK(target_role IN ('admin', 'lid', 'stemleider', 'moderator', 'all')),
  is_active INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0, -- Auto-start on first login
  sort_order INTEGER DEFAULT 0,
  icon TEXT DEFAULT 'fas fa-route',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TOUR STEPS
-- =====================================================

CREATE TABLE IF NOT EXISTS walkthrough_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_element TEXT, -- CSS selector: '#dashboard-stats', '.menu-item'
  target_url TEXT, -- '/admin/leden', '/leden/materiaal'
  position TEXT DEFAULT 'bottom' CHECK(position IN ('top', 'bottom', 'left', 'right', 'center')),
  action_text TEXT DEFAULT 'Volgende',
  requires_interaction INTEGER DEFAULT 0, -- Must click element to proceed
  highlight_padding INTEGER DEFAULT 10, -- Pixels around highlighted element
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tour_id) REFERENCES walkthrough_tours(id) ON DELETE CASCADE
);

-- =====================================================
-- USER PROGRESS TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS walkthrough_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tour_id INTEGER NOT NULL,
  current_step INTEGER DEFAULT 1,
  completed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  completed_at DATETIME,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, tour_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tour_id) REFERENCES walkthrough_tours(id) ON DELETE CASCADE
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_walkthrough_tours_role ON walkthrough_tours(target_role);
CREATE INDEX IF NOT EXISTS idx_walkthrough_tours_active ON walkthrough_tours(is_active);
CREATE INDEX IF NOT EXISTS idx_walkthrough_steps_tour ON walkthrough_steps(tour_id);
CREATE INDEX IF NOT EXISTS idx_walkthrough_progress_user ON walkthrough_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_walkthrough_progress_tour ON walkthrough_progress(tour_id);

-- =====================================================
-- SEED TOURS
-- =====================================================

-- Reset tables to ensure IDs match
DELETE FROM walkthrough_steps;
DELETE FROM walkthrough_progress;
DELETE FROM walkthrough_tours;
DELETE FROM sqlite_sequence WHERE name='walkthrough_tours';
DELETE FROM sqlite_sequence WHERE name='walkthrough_steps';

-- Tour 1: Admin Basics (auto-start voor nieuwe admins)
INSERT OR IGNORE INTO walkthrough_tours (tour_key, title, description, target_role, is_active, auto_start, sort_order, icon) VALUES
('admin-basics', 'Admin Basics', 'Leer de basis van het admin panel kennen in 5 minuten', 'admin', 1, 1, 1, 'fas fa-graduation-cap');

INSERT OR IGNORE INTO walkthrough_steps (tour_id, step_number, title, description, target_element, target_url, position) VALUES
(1, 1, '👋 Welkom bij Admin!', 'Welkom in je admin console! Deze tour laat je in 5 minuten alle belangrijke functies zien. Je kunt op elk moment stoppen door op ESC te drukken.', '.admin-dashboard', '/admin', 'bottom'),
(1, 2, '📊 Dashboard Statistieken', 'Hier zie je real-time overzicht: aantal leden, posts, events en meer. Deze cijfers updaten automatisch.', '.stats-grid', '/admin', 'bottom'),
(1, 3, '🎯 Snelle Acties', 'Via deze shortcuts kom je snel bij veel-gebruikte functies: nieuw lid toevoegen, content publiceren, event aanmaken.', '.quick-actions-grid', '/admin', 'bottom'),
(1, 4, '📋 Menu Navigatie', 'In de sidebar vind je alle admin modules. Klik op een item om naar die sectie te gaan.', 'aside.bg-animato-secondary', '/admin', 'right'),
(1, 5, '🎛️ Module Beheer', 'Hier kun je modules aan/uit zetten. Handig om features te activeren die je wilt gebruiken!', 'a[href="/admin/modules"]', '/admin', 'right');

-- Tour 2: Karaoke Module Setup
INSERT OR IGNORE INTO walkthrough_tours (tour_key, title, description, target_role, is_active, auto_start, sort_order, icon) VALUES
('karaoke-admin', 'Karaoke Module Setup', 'Stel de karaoke module in voor je volgende feest', 'admin', 1, 0, 2, 'fas fa-microphone');

INSERT OR IGNORE INTO walkthrough_steps (tour_id, step_number, title, description, target_element, target_url, position) VALUES
(2, 1, '🎤 Karaoke Dashboard', 'Dit is je karaoke overzicht. Hier beheer je songs, events en zie je populaire keuzes.', '.karaoke-dashboard', '/admin/karaoke', 'bottom'),
(2, 2, '🎵 Song Library', 'Hier beheer je alle beschikbare karaoke songs. Voeg nieuwe nummers toe of bewerk bestaande.', 'a[href="/admin/karaoke/songs"]', '/admin/karaoke', 'right'),
(2, 3, '📅 Karaoke Event', 'Maak een nieuw karaoke event aan: koppel aan een agenda-item, stel deadline in, en sta duetten toe.', 'a[href="/admin/karaoke/events/nieuw"]', '/admin/karaoke/events', 'bottom'),
(2, 4, '💑 Duet Matching', 'Bekijk hier automatische duet suggesties op basis van song keuzes. Perfect voor een leuk feest!', 'a[href="/admin/karaoke/matching"]', '/admin/karaoke', 'right');

-- Tour 3: Leden Portal Onboarding (auto-start voor nieuwe leden)
INSERT OR IGNORE INTO walkthrough_tours (tour_key, title, description, target_role, is_active, auto_start, sort_order, icon) VALUES
('leden-basics', 'Eerste Stappen Ledenportaal', 'Ontdek alles wat je als koorlid kunt doen', 'lid', 1, 1, 3, 'fas fa-user-friends');

INSERT OR IGNORE INTO walkthrough_steps (tour_id, step_number, title, description, target_element, target_url, position) VALUES
(3, 1, '🎵 Welkom bij Animato!', 'Welkom in het ledenportaal! Hier vind je alles: materiaal, agenda, berichten en meer. Laten we een korte rondleiding doen.', '.dashboard-welcome', '/leden', 'bottom'),
(3, 2, '📋 Jouw Dashboard', 'Dit is je persoonlijke dashboard. Zie je volgende repetitie, nieuwe materialen en belangrijke berichten.', '.dashboard-grid', '/leden', 'bottom'),
(3, 3, '👤 Profiel Invullen', 'Vul je profiel compleet in! Dit helpt bij contact informatie, noodcontacten en stemgroep indeling.', 'a[href="/leden/profiel"]', '/leden', 'right'),
(3, 4, '🎼 Materiaal Downloaden', 'Download hier partituren en oefentracks speciaal voor jouw stemgroep (SATB).', 'a[href="/leden/materiaal"]', '/leden', 'right'),
(3, 5, '📅 Agenda & Aanwezigheid', 'Bekijk repetities en concerten. Geef aan of je er bent - dit helpt de dirigent met planning!', 'a[href="/leden/agenda"]', '/leden', 'right');

-- Tour 4: Karaoke voor Leden
INSERT OR IGNORE INTO walkthrough_tours (tour_key, title, description, target_role, is_active, auto_start, sort_order, icon) VALUES
('karaoke-leden', 'Karaoke Songs Kiezen', 'Kies je favoriete karaoke songs voor het volgende feest', 'lid', 1, 0, 4, 'fas fa-music');

INSERT OR IGNORE INTO walkthrough_steps (tour_id, step_number, title, description, target_element, target_url, position) VALUES
(4, 1, '🎤 Karaoke Events', 'Hier zie je alle karaoke events waarvoor je songs kunt kiezen. Klik op een event om te beginnen.', '.karaoke-events-list', '/leden/karaoke', 'bottom'),
(4, 2, '🎵 Song Selectie', 'Browse door de song library. Gebruik filters om je favoriete genre of artiest te vinden.', '.song-grid', '/leden/karaoke/1/select', 'bottom'),
(4, 3, '✅ Maximaal 3 Songs', 'Je kunt maximaal 3 songs kiezen per event. Klik op "Selecteren" om een song te kiezen.', '.song-card', '/leden/karaoke/1/select', 'bottom'),
(4, 4, '💑 Duet Notitie', 'Wil je een duet doen? Voeg een notitie toe bij je song selectie om aan te geven met wie!', '.add-note-button', '/leden/karaoke/1/select', 'bottom');

-- Tour 5: Polls & Voorstellen
INSERT OR IGNORE INTO walkthrough_tours (tour_key, title, description, target_role, is_active, auto_start, sort_order, icon) VALUES
('polls-voorstellen', 'Stemmen & Voorstellen', 'Leer hoe je kunt stemmen en eigen voorstellen indienen', 'lid', 1, 0, 5, 'fas fa-vote-yea');

INSERT OR IGNORE INTO walkthrough_steps (tour_id, step_number, title, description, target_element, target_url, position) VALUES
(5, 1, '📊 Polls Overzicht', 'Hier vind je alle polls van de dirigent. Stem mee over repertoire, concertdata en meer!', '.polls-list', '/leden/polls', 'bottom'),
(5, 2, '✅ Stemmen', 'Klik op een poll om te stemmen. Sommige polls staan meerdere keuzes toe, andere slechts één.', '.poll-card', '/leden/polls', 'bottom'),
(5, 3, '💡 Eigen Voorstellen', 'Heb je een idee voor het koor? Dien hier je voorstel in! Andere leden kunnen stemmen.', 'a[href="/leden/voorstellen"]', '/leden', 'right'),
(5, 4, '👍 Upvote/Downvote', 'Vind je een voorstel leuk? Geef een upvote! Zo ziet de dirigent wat populair is.', '.vote-buttons', '/leden/voorstellen', 'bottom');

-- Add walkthrough module to module_settings
INSERT OR IGNORE INTO module_settings (module_key, module_name, module_description, is_enabled, category, sort_order, icon) VALUES
('walkthrough', 'Walkthrough & Tours', 'Interactieve guided tours voor nieuwe gebruikers (admin en leden)', 1, 'admin', 6, 'fas fa-route');
