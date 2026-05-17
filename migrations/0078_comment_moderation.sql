-- Migration 0078: Centrale comment-moderatie
--
-- Doel: één uniforme moderatie-laag over alle comment-tabellen op de site.
--   * post_comments   (nieuws-comments — legacy, mist is_deleted/updated_at)
--   * post_replies    (board-comments)
--   * event_replies   (agenda-comments)
--
-- Wijzigingen:
--   1. post_comments harmoniseren met de andere twee:
--        + is_deleted  (soft-delete)
--        + updated_at  (audit trail)
--   2. Alle drie tabellen krijgen flag-kolommen voor "verdacht maar nog niet verwijderd":
--        + is_flagged       (0/1)
--        + flagged_by       (user_id van moderator die markeerde)
--        + flagged_reason   (optionele notitie)
--        + flagged_at       (wanneer gevlagd)
--
-- Trade-off: soft-delete betekent dat rijen blijven liggen. Bewust gekozen —
-- forensisch bewijs bij spamcampagne is waardevoller dan een schone DB.
-- Permanent purge gebeurt handmatig via admin-UI, niet automatisch.

-- =====================================================
-- 1. post_comments harmoniseren
-- =====================================================
ALTER TABLE post_comments ADD COLUMN is_deleted INTEGER DEFAULT 0;
-- SQLite verbiedt non-constant defaults bij ALTER TABLE → updated_at NULL by default,
-- code zet CURRENT_TIMESTAMP bij elke update expliciet via SQL.
ALTER TABLE post_comments ADD COLUMN updated_at TIMESTAMP;

-- =====================================================
-- 2. Flag-kolommen op alle 3 tabellen
-- =====================================================
ALTER TABLE post_comments ADD COLUMN is_flagged INTEGER DEFAULT 0;
ALTER TABLE post_comments ADD COLUMN flagged_by INTEGER;
ALTER TABLE post_comments ADD COLUMN flagged_reason TEXT;
ALTER TABLE post_comments ADD COLUMN flagged_at TIMESTAMP;

ALTER TABLE post_replies ADD COLUMN is_flagged INTEGER DEFAULT 0;
ALTER TABLE post_replies ADD COLUMN flagged_by INTEGER;
ALTER TABLE post_replies ADD COLUMN flagged_reason TEXT;
ALTER TABLE post_replies ADD COLUMN flagged_at TIMESTAMP;

ALTER TABLE event_replies ADD COLUMN is_flagged INTEGER DEFAULT 0;
ALTER TABLE event_replies ADD COLUMN flagged_by INTEGER;
ALTER TABLE event_replies ADD COLUMN flagged_reason TEXT;
ALTER TABLE event_replies ADD COLUMN flagged_at TIMESTAMP;

-- =====================================================
-- 3. Indexen voor moderatie-queries
-- =====================================================
-- Snel filteren op "gevlagd" en "verwijderd" status (voor de mod queue)
CREATE INDEX IF NOT EXISTS idx_post_comments_flagged ON post_comments(is_flagged, is_deleted);
CREATE INDEX IF NOT EXISTS idx_post_replies_flagged ON post_replies(is_flagged, is_deleted);
CREATE INDEX IF NOT EXISTS idx_event_replies_flagged ON event_replies(is_flagged, is_deleted);

-- Voor spammer-detectie: snel COUNT per user_id in een tijdsvenster
CREATE INDEX IF NOT EXISTS idx_post_comments_user_created ON post_comments(user_id, created_at);
