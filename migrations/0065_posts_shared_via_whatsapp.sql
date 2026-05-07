-- 0065_posts_shared_via_whatsapp.sql
-- Feedback #150: voeg een vinkje-kolom toe in /admin/content om aan te geven of
-- een bericht via WhatsApp gedeeld werd. Dit wordt manueel aangevinkt door admin
-- na delen, of automatisch ingevuld wanneer de "Deel via WhatsApp"-knop gebruikt
-- wordt (in een latere iteratie).

ALTER TABLE posts ADD COLUMN shared_via_whatsapp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN shared_via_whatsapp_at DATETIME;
