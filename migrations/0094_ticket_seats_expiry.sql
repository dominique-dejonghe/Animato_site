-- 0094: ticket_seats verbeteringen voor Phase 4
-- Doel: stale-lock cleanup mogelijk maken + admin-traceerbaarheid

-- 1. lock_expires_at: wanneer mag een 'locked' stoel vrijgegeven worden bij stale-cleanup?
--    NULL = geen expiry (bv. handmatige admin-blokkade, of pre-existing rows)
ALTER TABLE ticket_seats ADD COLUMN lock_expires_at DATETIME;

-- 2. created_by: voor admin-handmatige toewijzingen (welke admin heeft dit gereserveerd?)
--    NULL voor publieke webshop-orders.
ALTER TABLE ticket_seats ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 3. note: vrij tekstveld voor admin-aantekeningen (papieren reservatie, naam VIP-gast,...)
ALTER TABLE ticket_seats ADD COLUMN note TEXT;

-- 4. Index voor stale-lock cleanup queries
CREATE INDEX IF NOT EXISTS idx_ticket_seats_lock_expires
  ON ticket_seats(status, lock_expires_at)
  WHERE status = 'locked';

-- 5. Index voor admin "wie zit waar"-view (per concert, snelle lookup)
CREATE INDEX IF NOT EXISTS idx_ticket_seats_concert_status
  ON ticket_seats(concert_id, status);
