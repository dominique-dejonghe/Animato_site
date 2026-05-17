-- Migration 0079: breadcrumb-toggle voor editable_pages
--
-- Doel: per pagina kunnen aangeven of de pagina in een breadcrumb getoond
-- moet worden of niet. Default = 1 (zichtbaar).
--
-- Geen non-constant defaults bij ALTER TABLE in SQLite — gewoon INTEGER met
-- DEFAULT 1. Bestaande rijen krijgen automatisch waarde 1.

ALTER TABLE editable_pages ADD COLUMN show_in_breadcrumb INTEGER DEFAULT 1;

-- Index voor toekomstige queries die op breadcrumb-zichtbaarheid filteren
-- (bv. een sitemap of nav-generator)
CREATE INDEX IF NOT EXISTS idx_editable_pages_breadcrumb ON editable_pages(show_in_breadcrumb);
