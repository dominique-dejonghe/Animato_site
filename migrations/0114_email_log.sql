-- 0114: Email log — houd elke Resend-mail bij voor troubleshoot & audit
--
-- Aanleiding (Dominique, 2026-08-22): mails vertrekken via Resend, niet via
-- eigen SMTP. Ze duiken dus niet op in info@gemengdkooranimato.be. Zonder
-- log is er geen manier om te bevestigen dat een ticket-mail of password-
-- reset-mail effectief buitengegaan is.
--
-- Design-keuze (bewust, met Dominique afgestemd):
--   • Alleen METADATA loggen (geen body). Voldoende voor "is het vertrokken?"
--     en respecteert privacy/opslag (D1 is niet ontworpen voor MB's per rij).
--   • ALLES bewaren, geen auto-cleanup. D1 is spotgoedkoop en de log is
--     forensisch nut. Later kan een admin-actie bulk-delete triggeren als
--     nodig.
--   • status: 'sent' bij Resend-2xx, 'failed' bij Resend-error of netwerk-
--     uitzondering. 'skipped' voor calls die never-tried zijn (bv. lege
--     RESEND_API_KEY, gebruiker-preferenties opt-out).

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
    -- Categorieën (uitbreidbaar, geen CHECK-constraint zodat nieuwe types
    -- niet meteen schema-migratie vereisen):
    --   ticket_confirmation, ticket_resend, password_reset, contact_form,
    --   word_lid, admin_notification, weekly_report, waitlist_notification,
    --   activity_invitation, feedback_reply, newsletter, other
  status TEXT NOT NULL DEFAULT 'sent',
    -- sent | failed | skipped
  resend_message_id TEXT,           -- Resend geeft 'id' terug op success
  error_message TEXT,               -- op failed: HTTP-status + Resend-body-fragment
  from_address TEXT,                -- afzender die effectief gebruikt is
  reply_to TEXT,
  attachments_count INTEGER NOT NULL DEFAULT 0,
  related_entity_type TEXT,         -- 'ticket_order', 'concert', 'user', 'waitlist' …
  related_entity_id INTEGER,        -- optionele koppeling met domein-entiteit
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON email_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_category ON email_log(category, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient);
CREATE INDEX IF NOT EXISTS idx_email_log_entity ON email_log(related_entity_type, related_entity_id);
