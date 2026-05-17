-- Migratie 0081: hernoem show_in_breadcrumb → show_in_nav
-- Reden: kolom wordt nu gebruikt voor header-navigatie ipv breadcrumb-balkje.
-- Functioneel duidelijker dan oude naam.
--
-- Tegelijk: nieuwe kolom nav_order toegevoegd zodat admin kan bepalen
-- waar in de header-balk een pagina verschijnt (lager = eerder).
-- Default 100 zodat nieuwe pagina's achteraan komen.

ALTER TABLE editable_pages RENAME COLUMN show_in_breadcrumb TO show_in_nav;
ALTER TABLE editable_pages ADD COLUMN nav_order INTEGER DEFAULT 100;

-- Drop oude index, maak nieuwe
DROP INDEX IF EXISTS idx_editable_pages_breadcrumb;
CREATE INDEX IF NOT EXISTS idx_editable_pages_nav ON editable_pages(show_in_nav, nav_order);
