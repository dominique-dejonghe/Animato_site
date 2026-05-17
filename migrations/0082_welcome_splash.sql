-- Migratie 0082: welcome-splash voor nieuwe koorleden
--
-- Doel: wanneer een aanvrager wordt goedgekeurd en zijn role=lid wordt,
-- toont de site bij zijn eerste login een feestelijk welcome-scherm
-- met confetti. Daarna nooit meer.
--
-- Strategie: één boolean kolom welcome_splash_seen op users.
-- Default 0 = nog niet gezien. Bestaande leden krijgen ook 0 \u2014
-- maar omdat ze allemaal al actief zijn voor deze feature bestond,
-- markeren we ze direct als "gezien" (zie UPDATE onderaan) zodat
-- enkel echt-nieuwe leden de splash krijgen.
--
-- Uitzondering: Rudy Met den Ancxt (id=89) \u2014 op expliciete vraag
-- van Dominique houden we zijn vlag op 0 zodat hij de splash krijgt
-- bij zijn volgende login.

ALTER TABLE users ADD COLUMN welcome_splash_seen INTEGER DEFAULT 0;

-- Markeer alle bestaande leden als "al gezien" \u2014 behalve Rudy.
-- Iedereen die nu al lid is, mag bij hun volgende login geen verrassing
-- krijgen voor een feature die niet bestond toen ze lid werden.
UPDATE users
SET welcome_splash_seen = 1
WHERE role = 'lid' AND id != 89;

-- Audit-trail kolom (optioneel maar handig voor debugging)
ALTER TABLE users ADD COLUMN welcome_splash_seen_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_welcome_splash ON users(welcome_splash_seen, role);
