-- Migratie 0083: nieuwe-lid aankondiging tracking
--
-- Doel: wanneer een nieuw koorlid wordt goedgekeurd, krijgen alle
-- bestaande leden bij hun eerstvolgende login een feestelijke popup
-- ("\ud83c\udf89 Welkom aan ons nieuw koorlid Rudy!"). De popup bundelt alle
-- ongelezen nieuwe leden van de afgelopen 14 dagen.
--
-- Strategie:
-- - Tabel member_announcement_seen tracked per (viewer_user_id, new_member_user_id)
--   of de viewer de aankondiging al heeft gezien.
-- - "Niet in de tabel" = nog niet gezien.
-- - Bij sluiten van de popup: INSERT row per nieuw lid \u2192 nooit meer tonen.
--
-- We bundelen leden tot 14 dagen oud (filter in query op users.created_at).
-- Ouder dan 14 dagen \u2192 niet meer aankondigen, ook niet voor users die
-- net inloggen voor het eerst sinds maanden.
--
-- Pre-seed: voor alle bestaande leden die al actief zijn voor deze feature,
-- markeer recente nieuwe leden EXCEPT Rudy (id=89) als "gezien". Anders
-- krijgt iedereen popup voor leden die er al een paar dagen zijn.

CREATE TABLE IF NOT EXISTS member_announcement_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer_user_id INTEGER NOT NULL,
  new_member_user_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(viewer_user_id, new_member_user_id),
  FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (new_member_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_announcement_viewer
  ON member_announcement_seen(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_member_announcement_new_member
  ON member_announcement_seen(new_member_user_id);

-- Backfill: markeer alle huidige users-met-een-account als "hebben al gezien"
-- voor recente nieuwe leden, BEHALVE Rudy (id=89). Zo krijgt iedereen morgen
-- alleen Rudy in zijn popup, niet 4 leden van de laatste 2 weken.
--
-- Concreet: voor elke combinatie (viewer = alle users, new_member = recente
-- leden uitgezonderd Rudy), maak een 'seen' record aan met datum 'nu'.
-- Rudy zelf moet ook in deze pre-seed staan (hij ziet zichzelf niet als
-- nieuw lid aangekondigd worden).

INSERT OR IGNORE INTO member_announcement_seen (viewer_user_id, new_member_user_id, seen_at)
SELECT
  v.id AS viewer_user_id,
  nm.id AS new_member_user_id,
  CURRENT_TIMESTAMP
FROM users v
CROSS JOIN users nm
WHERE nm.role = 'lid'
  AND date(nm.created_at) >= date('now', '-14 days')
  AND nm.id != 89  -- Rudy mag wel worden aangekondigd
  AND v.id != nm.id;  -- niemand ziet zichzelf in de feed

-- Bovendien: Rudy zelf moet zichzelf ook niet zien in de popup
INSERT OR IGNORE INTO member_announcement_seen (viewer_user_id, new_member_user_id, seen_at)
VALUES (89, 89, CURRENT_TIMESTAMP);
