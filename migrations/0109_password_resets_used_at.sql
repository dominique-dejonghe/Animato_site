-- 0109_password_resets_used_at.sql
--
-- BUG-FIX: de code query't op `used_at IS NULL` maar de originele tabel in
-- 0001_initial_schema.sql had enkel een `used`-vlag (INTEGER 0/1). Migratie
-- 0036_feedback_and_reset.sql probeerde met `CREATE TABLE IF NOT EXISTS`
-- de nieuwe kolommen op te leggen — maar IF NOT EXISTS is een no-op zodra
-- de tabel al bestond. Gevolg op productie: kolom `used_at` ontbreekt,
-- klik op reset-link → D1_ERROR: no such column: used_at.
--
-- Fix: voeg de kolom alsnog toe. Bestaande rijen krijgen NULL — dat is
-- correct, want "used_at IS NULL" = "nog niet gebruikt". Voor rijen waar
-- `used=1` staat kopiëren we een placeholder-tijdstip zodat oude gebruikte
-- links niet plots weer geldig lijken.

ALTER TABLE password_resets ADD COLUMN used_at DATETIME;

-- Migreer historische used-vlag naar used_at (best-effort: exacte gebruik-
-- tijdstip is nergens bijgehouden, we nemen created_at als benadering).
UPDATE password_resets SET used_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE used = 1;
