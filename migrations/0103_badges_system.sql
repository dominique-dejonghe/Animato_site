-- Badges-systeem: gamification voor koorleden
-- Inspiratie: Tesla badges-scherm
-- Twee tabellen:
--   badges: definitie/catalogus van alle beschikbare badges
--   user_badges: welke gebruiker welke badge wanneer heeft verdiend

-- ============================================================
-- 1. CATALOGUS van beschikbare badges
-- ============================================================
CREATE TABLE IF NOT EXISTS badges (
  badge_key       TEXT PRIMARY KEY,
  naam            TEXT NOT NULL,
  beschrijving    TEXT NOT NULL,
  icon            TEXT NOT NULL,         -- FontAwesome class, bv 'fa-user-check'
  kleur           TEXT NOT NULL,         -- Tailwind kleur-suffix, bv 'emerald', 'amber', 'rose'
  categorie       TEXT NOT NULL,         -- 'engagement','profiel','muziek','community','milestone'
  zeldzaamheid    TEXT NOT NULL DEFAULT 'gewoon', -- 'gewoon','zeldzaam','episch','legendarisch'
  criteria_type   TEXT NOT NULL,         -- machine-leesbare type: 'login_count','poll_vote','profile_complete', ...
  criteria_value  INTEGER DEFAULT 1,     -- drempelwaarde (bv 5 logins, 3 polls)
  zichtbaar       INTEGER NOT NULL DEFAULT 1,  -- 0 = verborgen tot verdiend (easter-egg)
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. WIE heeft WAT verdiend
-- ============================================================
CREATE TABLE IF NOT EXISTS user_badges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  badge_key   TEXT NOT NULL,
  earned_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  meta        TEXT,                       -- optionele JSON metadata (bv. count bij milestone)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (badge_key) REFERENCES badges(badge_key) ON DELETE CASCADE,
  UNIQUE(user_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_key);

-- ============================================================
-- 3. SEED de catalogus met initiële badges
-- ============================================================

-- === ENGAGEMENT (logins, activiteit) ===
INSERT OR IGNORE INTO badges (badge_key, naam, beschrijving, icon, kleur, categorie, zeldzaamheid, criteria_type, criteria_value, sort_order) VALUES
  ('first_login',       'Welkom aan boord',     'Voor de allereerste keer ingelogd op het ledenportaal.',  'fa-door-open',       'sky',     'engagement', 'gewoon',       'login_count',       1,  10),
  ('login_streak_5',    'Trouwe bezoeker',      'Op 5 verschillende dagen ingelogd.',                       'fa-calendar-check',  'emerald', 'engagement', 'gewoon',       'login_count',       5,  11),
  ('login_streak_25',   'Stamgast',             '25 dagen actief in het ledenportaal.',                     'fa-fire',            'orange',  'engagement', 'zeldzaam',     'login_count',       25, 12),
  ('login_streak_100',  'Ambassadeur',          '100 dagen actief — een ware Animato-fan!',                 'fa-medal',           'amber',   'engagement', 'episch',       'login_count',       100,13);

-- === PROFIEL ===
INSERT OR IGNORE INTO badges (badge_key, naam, beschrijving, icon, kleur, categorie, zeldzaamheid, criteria_type, criteria_value, sort_order) VALUES
  ('profile_photo',     'Mijn beste profiel',   'Profielfoto geüpload.',                                    'fa-camera-retro',    'pink',    'profiel',    'gewoon',       'has_profile_photo', 1,  20),
  ('profile_complete',  'Compleet',             'Alle profielvelden ingevuld (naam, foto, telefoon, adres).','fa-id-card-clip',   'indigo',  'profiel',    'gewoon',       'profile_complete',  1,  21),
  ('bio_written',       'Verteller',            'Eigen bio geschreven in profiel.',                         'fa-feather-pointed', 'purple',  'profiel',    'gewoon',       'has_bio',           1,  22);

-- === MUZIEK ===
INSERT OR IGNORE INTO badges (badge_key, naam, beschrijving, icon, kleur, categorie, zeldzaamheid, criteria_type, criteria_value, sort_order) VALUES
  ('voice_test',        'Stem in kaart',        'Stem-bereiktest uitgevoerd.',                              'fa-microphone-lines','violet',  'muziek',     'gewoon',       'voice_test_done',   1,  30),
  ('voice_test_3',      'Toonladder-meester',   'Stem-test 3 keer gedaan om vooruitgang te volgen.',         'fa-music',           'fuchsia', 'muziek',     'zeldzaam',     'voice_test_done',   3,  31);

-- === COMMUNITY (polls, voorstellen, agenda) ===
INSERT OR IGNORE INTO badges (badge_key, naam, beschrijving, icon, kleur, categorie, zeldzaamheid, criteria_type, criteria_value, sort_order) VALUES
  ('first_poll_vote',   'Stem laten horen',     'Eerste poll-stem uitgebracht.',                            'fa-square-poll-vertical','teal','community',  'gewoon',       'poll_vote_count',   1,  40),
  ('poll_voter_5',      'Democratisch',         'Aan 5 polls deelgenomen.',                                 'fa-check-to-slot',   'cyan',    'community',  'zeldzaam',     'poll_vote_count',   5,  41),
  ('agenda_response',   'Aanwezig!',            'Voor het eerst een aan-/afwezigheid ingevuld in agenda.',  'fa-calendar-day',    'lime',    'community',  'gewoon',       'agenda_response_count', 1,  42),
  ('agenda_response_10','Repetitie-fan',        'Op 10 agenda-events aan-/afwezigheid bevestigd.',          'fa-hand-sparkles',   'green',   'community',  'zeldzaam',     'agenda_response_count', 10, 43);

-- === MILESTONE (lid sinds, jubilea) ===
INSERT OR IGNORE INTO badges (badge_key, naam, beschrijving, icon, kleur, categorie, zeldzaamheid, criteria_type, criteria_value, sort_order) VALUES
  ('member_1y',         '1 jaar Animato',       'Een jaar lang lid van Animato.',                            'fa-cake-candles',    'rose',    'milestone',  'zeldzaam',     'membership_years',  1,  50),
  ('member_5y',         '5 jaar Animato',       'Vijf jaar trouw lid van het koor.',                         'fa-star',            'amber',   'milestone',  'episch',       'membership_years',  5,  51),
  ('member_10y',        '10 jaar Animato',      'Tien jaar deel van de Animato-familie!',                    'fa-crown',           'yellow',  'milestone',  'legendarisch', 'membership_years',  10, 52),
  ('birthday_lover',    'Verjaardags-kind',     'Op je verjaardag ingelogd. Proficiat!',                     'fa-gift',            'red',     'milestone',  'zeldzaam',     'birthday_login',    1,  53)
;
