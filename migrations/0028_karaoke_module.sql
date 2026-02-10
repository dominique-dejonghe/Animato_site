-- Migration: Karaoke Module
-- Date: 2026-02-10
-- Description: Complete karaoke song library, events, and member selections

-- 1. Karaoke Songs Library (Master song catalog)
CREATE TABLE IF NOT EXISTS karaoke_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT, -- 'Pop', 'Rock', 'Nederlands', 'Dance', 'Ballad', etc.
  language TEXT DEFAULT 'nl', -- 'nl', 'en', 'fr', 'de', etc.
  difficulty TEXT CHECK(difficulty IN ('easy', 'medium', 'hard')),
  type TEXT DEFAULT 'solo' CHECK(type IN ('solo', 'duet', 'group')),
  duration_seconds INTEGER, -- Song length in seconds
  youtube_url TEXT,
  spotify_url TEXT,
  sunvig_id TEXT, -- Original SUNVIG catalog ID
  tags TEXT, -- JSON array for additional tags
  is_active BOOLEAN DEFAULT 1,
  popularity_score INTEGER DEFAULT 0, -- Track how often it's chosen
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Karaoke Events (Linked to events table)
CREATE TABLE IF NOT EXISTS karaoke_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER UNIQUE NOT NULL, -- Link to main events table
  max_songs_per_member INTEGER DEFAULT 3,
  allow_duets BOOLEAN DEFAULT 1,
  allow_song_requests BOOLEAN DEFAULT 1, -- Can members request songs not in library?
  selection_deadline DATETIME,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'completed')),
  intro_text TEXT, -- Instructions for members
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- 3. Member Song Selections
CREATE TABLE IF NOT EXISTS karaoke_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karaoke_event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  preference_order INTEGER DEFAULT 1, -- 1 = first choice, 2 = second, 3 = third
  duet_partner_id INTEGER, -- NULL for solo, user_id for duet partner
  duet_status TEXT DEFAULT 'none' CHECK(duet_status IN ('none', 'requested', 'accepted', 'declined')),
  notes TEXT, -- Member notes: "I can sing high/low part", "Please pair me with X"
  admin_confirmed BOOLEAN DEFAULT 0, -- Admin can lock/confirm selections
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (karaoke_event_id) REFERENCES karaoke_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES karaoke_songs(id) ON DELETE CASCADE,
  FOREIGN KEY (duet_partner_id) REFERENCES users(id),
  UNIQUE(karaoke_event_id, user_id, song_id) -- Can't select same song twice
);

-- 4. Song Requests (Members requesting songs not in library)
CREATE TABLE IF NOT EXISTS karaoke_song_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karaoke_event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  requested_title TEXT NOT NULL,
  requested_artist TEXT NOT NULL,
  reason TEXT, -- "Dit nummer past perfect bij mijn stem"
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'added')),
  admin_notes TEXT,
  approved_song_id INTEGER, -- Link to karaoke_songs if approved and added
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (karaoke_event_id) REFERENCES karaoke_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_song_id) REFERENCES karaoke_songs(id)
);

-- 5. Karaoke Playlists (Curated song collections)
CREATE TABLE IF NOT EXISTS karaoke_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, -- "80s Classics", "Easy Starters", "Romantic Duets"
  description TEXT,
  created_by INTEGER NOT NULL,
  is_public BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 6. Playlist Songs (Many-to-many)
CREATE TABLE IF NOT EXISTS karaoke_playlist_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  order_number INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES karaoke_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES karaoke_songs(id) ON DELETE CASCADE,
  UNIQUE(playlist_id, song_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_karaoke_songs_artist ON karaoke_songs(artist);
CREATE INDEX IF NOT EXISTS idx_karaoke_songs_genre ON karaoke_songs(genre);
CREATE INDEX IF NOT EXISTS idx_karaoke_songs_language ON karaoke_songs(language);
CREATE INDEX IF NOT EXISTS idx_karaoke_songs_type ON karaoke_songs(type);
CREATE INDEX IF NOT EXISTS idx_karaoke_selections_event ON karaoke_selections(karaoke_event_id);
CREATE INDEX IF NOT EXISTS idx_karaoke_selections_user ON karaoke_selections(user_id);
CREATE INDEX IF NOT EXISTS idx_karaoke_selections_song ON karaoke_selections(song_id);
CREATE INDEX IF NOT EXISTS idx_karaoke_requests_event ON karaoke_song_requests(karaoke_event_id);
CREATE INDEX IF NOT EXISTS idx_karaoke_requests_status ON karaoke_song_requests(status);
