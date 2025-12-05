-- Voice Range Analysis Migration
-- Version: 0012
-- Date: 2025-11-25
-- Purpose: Store voice range analysis results for stemgroep recommendations

-- =====================================================
-- VOICE ANALYSIS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS voice_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT, -- For anonymous submissions (not yet registered)
  
  -- Audio info
  audio_duration_seconds REAL,
  audio_format TEXT, -- 'audio/wav', 'audio/mp3', etc.
  
  -- Analysis results
  lowest_note TEXT, -- 'C3', 'G2', etc.
  lowest_frequency REAL, -- Hz
  highest_note TEXT, -- 'A5', 'F5', etc.
  highest_frequency REAL, -- Hz
  comfortable_range_notes TEXT, -- 'G3-E5' (most stable pitches)
  total_semitones INTEGER, -- Range in semitones
  
  -- AI Recommendations
  primary_stemgroep TEXT CHECK(primary_stemgroep IN ('S', 'A', 'T', 'B')),
  primary_confidence REAL, -- 0.0 to 1.0
  secondary_stemgroep TEXT CHECK(secondary_stemgroep IN ('S', 'A', 'T', 'B') OR secondary_stemgroep IS NULL),
  secondary_confidence REAL,
  
  -- Additional metadata
  voice_type TEXT, -- 'Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass'
  tessitura TEXT, -- Comfortable singing range description
  notes TEXT, -- Additional notes or recommendations
  
  -- Status
  status TEXT DEFAULT 'completed' CHECK(status IN ('processing', 'completed', 'failed')),
  error_message TEXT,
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_analyses_user ON voice_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_analyses_email ON voice_analyses(email);
CREATE INDEX IF NOT EXISTS idx_voice_analyses_created ON voice_analyses(created_at);
CREATE INDEX IF NOT EXISTS idx_voice_analyses_primary_stemgroep ON voice_analyses(primary_stemgroep);
