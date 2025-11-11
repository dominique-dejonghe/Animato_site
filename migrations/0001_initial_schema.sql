-- Initial database schema for Gemengd Koor Animato
-- Version: 1.0
-- Date: 2025-11-11

-- =====================================================
-- USERS & AUTHENTICATION
-- =====================================================

-- Users table (core authentication)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'lid' CHECK(role IN ('admin', 'moderator', 'stemleider', 'lid', 'bezoeker')),
  stemgroep TEXT CHECK(stemgroep IN ('S', 'A', 'T', 'B') OR stemgroep IS NULL),
  status TEXT NOT NULL DEFAULT 'actief' CHECK(status IN ('actief', 'inactief', 'proeflid', 'uitgenodigd')),
  two_fa_enabled INTEGER NOT NULL DEFAULT 0,
  two_fa_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User profiles (extended information)
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  voornaam TEXT NOT NULL,
  achternaam TEXT NOT NULL,
  telefoon TEXT,
  adres TEXT,
  postcode TEXT,
  stad TEXT,
  geboortedatum DATE,
  foto_url TEXT,
  bio TEXT,
  muzikale_ervaring TEXT,
  instrument TEXT,
  noodcontact_naam TEXT,
  noodcontact_telefoon TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- CONTENT MANAGEMENT
-- =====================================================

-- Posts (nieuws & messageboard)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  body TEXT NOT NULL,
  excerpt TEXT,
  auteur_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'nieuws' CHECK(type IN ('nieuws', 'board')),
  categorie TEXT CHECK(categorie IN ('algemeen', 'sopraan', 'alt', 'tenor', 'bas', 'bestuur')),
  tags TEXT, -- JSON array
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  zichtbaarheid TEXT NOT NULL DEFAULT 'publiek' CHECK(zichtbaarheid IN ('publiek', 'leden', 'sopraan', 'alt', 'tenor', 'bas')),
  views INTEGER NOT NULL DEFAULT 0,
  published_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (auteur_id) REFERENCES users(id)
);

-- Post replies (messageboard threads)
CREATE TABLE IF NOT EXISTS post_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_reply_id INTEGER, -- Voor nested replies
  auteur_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_reply_id) REFERENCES post_replies(id) ON DELETE CASCADE,
  FOREIGN KEY (auteur_id) REFERENCES users(id)
);

-- =====================================================
-- AGENDA & EVENTS
-- =====================================================

-- Events (repetities, concerten, andere events)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'repetitie' CHECK(type IN ('repetitie', 'concert', 'ander')),
  titel TEXT NOT NULL,
  slug TEXT UNIQUE,
  beschrijving TEXT,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  locatie TEXT NOT NULL,
  adres TEXT,
  doelgroep TEXT NOT NULL DEFAULT 'all', -- 'all', 'S', 'A', 'T', 'B', 'SA', 'TB', 'SAT', etc.
  is_publiek INTEGER NOT NULL DEFAULT 0,
  herinnering_verzonden INTEGER NOT NULL DEFAULT 0,
  ics_uid TEXT UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Event aanwezigheid
CREATE TABLE IF NOT EXISTS event_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'onbekend' CHECK(status IN ('aanwezig', 'afwezig', 'misschien', 'onbekend')),
  reden TEXT,
  responded_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- CONCERTEN & TICKETING
-- =====================================================

-- Concerts (uitbreiding van events)
CREATE TABLE IF NOT EXISTS concerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  programma TEXT, -- Beschrijving van het programma
  prijsstructuur TEXT, -- JSON: [{"categorie": "Volwassenen", "prijs": 15}, ...]
  capaciteit INTEGER,
  verkocht INTEGER NOT NULL DEFAULT 0,
  ticketing_enabled INTEGER NOT NULL DEFAULT 1,
  ticketing_provider TEXT DEFAULT 'intern' CHECK(ticketing_provider IN ('intern', 'extern')),
  externe_ticket_url TEXT,
  uitverkocht INTEGER NOT NULL DEFAULT 0,
  poster_url TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,
  order_ref TEXT NOT NULL UNIQUE,
  koper_email TEXT NOT NULL,
  koper_naam TEXT NOT NULL,
  koper_telefoon TEXT,
  aantal INTEGER NOT NULL DEFAULT 1,
  categorie TEXT NOT NULL,
  prijs_totaal REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'refunded', 'used')),
  betaalmethode TEXT, -- 'stripe', 'mollie', etc.
  betaling_id TEXT,
  qr_code TEXT UNIQUE NOT NULL,
  gescand INTEGER NOT NULL DEFAULT 0,
  gescand_at DATETIME,
  betaald_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (concert_id) REFERENCES concerts(id) ON DELETE CASCADE
);

-- =====================================================
-- MUZIEK & MATERIAAL
-- =====================================================

-- Werken (componist + titel)
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  componist TEXT NOT NULL,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  jaar INTEGER,
  genre TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Stukken (delen van een werk)
CREATE TABLE IF NOT EXISTS pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  nummer INTEGER, -- Volgorde binnen werk
  opustype TEXT, -- 'volledig', 'deel', 'beweging'
  toonsoort TEXT,
  tempo TEXT,
  duur_minuten INTEGER,
  moeilijkheidsgraad TEXT CHECK(moeilijkheidsgraad IN ('beginner', 'gemiddeld', 'gevorderd', 'expert')),
  opmerking TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

-- Materiaal (partituren, oefentracks)
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id INTEGER NOT NULL,
  stem TEXT NOT NULL CHECK(stem IN ('S', 'A', 'T', 'B', 'SA', 'TB', 'SATB', 'piano', 'orgel', 'algemeen')),
  type TEXT NOT NULL CHECK(type IN ('pdf', 'audio', 'video', 'zip', 'link')),
  titel TEXT NOT NULL,
  bestandsnaam TEXT,
  url TEXT NOT NULL,
  mime_type TEXT,
  grootte_bytes INTEGER,
  versie INTEGER NOT NULL DEFAULT 1,
  zichtbaar_voor TEXT NOT NULL DEFAULT 'alle_leden', -- 'alle_leden', 'stem_specifiek', 'admin'
  beschrijving TEXT,
  upload_door INTEGER NOT NULL,
  is_actief INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id)
);

-- =====================================================
-- MEDIA & ALBUMS
-- =====================================================

-- Albums (fotogalerij)
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  beschrijving TEXT,
  cover_url TEXT,
  is_publiek INTEGER NOT NULL DEFAULT 0,
  event_id INTEGER, -- Koppeling aan event (optioneel)
  sorteer_volgorde INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  tags TEXT, -- JSON array
  mime_type TEXT,
  grootte_bytes INTEGER,
  breedte INTEGER,
  hoogte INTEGER,
  upload_door INTEGER NOT NULL,
  sorteer_volgorde INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id)
);

-- =====================================================
-- FORMULIEREN & SUBMISSIONS
-- =====================================================

-- Form submissions (Word lid, Contact)
CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('word_lid', 'contact', 'ander')),
  payload TEXT NOT NULL, -- JSON data
  email TEXT,
  naam TEXT,
  status TEXT NOT NULL DEFAULT 'nieuw' CHECK(status IN ('nieuw', 'verwerkt', 'gearchiveerd')),
  consent INTEGER NOT NULL DEFAULT 0,
  ip_adres TEXT,
  user_agent TEXT,
  verwerkt_door INTEGER,
  verwerkt_at DATETIME,
  notities TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (verwerkt_door) REFERENCES users(id)
);

-- =====================================================
-- NOTIFICATIES
-- =====================================================

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('nieuws', 'materiaal', 'repetitie', 'concert', 'board', 'systeem')),
  titel TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_gelezen INTEGER NOT NULL DEFAULT 0,
  gelezen_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- SYSTEM & AUDIT
-- =====================================================

-- Audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actie TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'user', 'post', 'event', 'material', etc.
  entity_id INTEGER,
  meta TEXT, -- JSON met extra info
  ip_adres TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Site instellingen
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
  beschrijving TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES (Performance optimization)
-- =====================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_stemgroep ON users(stemgroep);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Posts
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_categorie ON posts(categorie);
CREATE INDEX IF NOT EXISTS idx_posts_auteur ON posts(auteur_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(is_published, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_zichtbaarheid ON posts(zichtbaarheid);

-- Events
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_publiek ON events(is_publiek);
CREATE INDEX IF NOT EXISTS idx_events_doelgroep ON events(doelgroep);

-- Materials
CREATE INDEX IF NOT EXISTS idx_materials_piece ON materials(piece_id);
CREATE INDEX IF NOT EXISTS idx_materials_stem ON materials(stem);
CREATE INDEX IF NOT EXISTS idx_materials_actief ON materials(is_actief);

-- Photos
CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_gelezen ON notifications(is_gelezen);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
