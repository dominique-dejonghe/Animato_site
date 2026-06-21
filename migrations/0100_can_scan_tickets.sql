-- 0100_can_scan_tickets.sql
-- Voeg can_scan_tickets boolean toe aan users — gebruikt door de QR-scanner
-- om aan niet-admin leden/kaartkopers tijdelijk scan-rechten te kunnen geven.
--
-- 0 = standaard (geen scan-rechten, tenzij admin/moderator/bestuurslid)
-- 1 = expliciet vinkje gezet door admin op /admin/leden/:id

ALTER TABLE users ADD COLUMN can_scan_tickets INTEGER NOT NULL DEFAULT 0;

-- Index voor de zeldzame query "alle users die mogen scannen"
-- (bv. admin-overzicht "wie heeft toegang tot de scanner?")
-- Partial index = alleen rijen met 1, dus klein en snel
CREATE INDEX IF NOT EXISTS idx_users_can_scan ON users(can_scan_tickets) WHERE can_scan_tickets = 1;
