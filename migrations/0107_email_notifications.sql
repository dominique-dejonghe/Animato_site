-- Email notificatie-integratie (Resend) — 2026-07-08
--
-- Achtergrond:
--   Tot nu was 'user_notification_prefs.enabled' één toggle die enkel de IN-APP
--   notificatie stuurde. Nu splitsen we dat op zodat een lid per notificatie-type
--   kan kiezen: in-app aan/uit én email aan/uit onafhankelijk.
--
-- Ontwerp:
--   - We voegen een tweede kolom email_enabled toe naast de bestaande enabled.
--   - Beide zijn NOT NULL DEFAULT 1 — nieuwe leden krijgen dus alles AAN.
--   - Bestaande rijen (opt-outs die al bestaan) behouden hun in-app keuze,
--     maar krijgen email_enabled = 1 (default). Dat is bewust: als een lid
--     eerder de in-app UIT zette, kan hij email nu apart uitschakelen.
--
-- Nieuwe notif_type-waarden die deze migratie voorbereidt:
--   'gift'         → gift/donatie ontvangen (bedank-mail schenker)
--   'ledenaanvraag' → nieuwe registratie-aanvraag (naar admins)
--   'contact'      → contactformulier-bericht (naar webmaster)
--   'feedback'     → beta-feedback / bug-melding (naar admins)
--   'deadline'     → taak-deadline nadert (3 dagen vooraf)
--   'agenda'       → nieuw agenda-item / concert
--   'verjaardag'   → verjaardag van een koorlid deze week

ALTER TABLE user_notification_prefs
  ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 1;

-- Index voor snelle lookup bij email-fan-out (bv. bulk-mails per stemgroep)
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_email
  ON user_notification_prefs(user_id, notif_type, email_enabled);
