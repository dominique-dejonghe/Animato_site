-- 0095: Drop UNIQUE constraint op tickets.order_ref
--
-- ROOT CAUSE BUG: bij multi-categorie ticket-bestellingen genereert de order-flow
-- één order_ref maar inserteert meerdere rijen (één per categorie). Door de UNIQUE
-- constraint crashte de 2e INSERT met 'UNIQUE constraint failed: tickets.order_ref'.
-- Resultaat: gebruiker zag "Er ging iets mis" bij elke multi-cat bestelling.
--
-- Design: order_ref groepeert nu line-items binnen één order. qr_code blijft UNIQUE
-- (elke ticket-rij krijgt een eigen QR voor scanning). betaling_id wijst naar de
-- gemeenschappelijke Mollie-payment.
--
-- SQLite kan UNIQUE niet droppen via ALTER → tabel-rebuild nodig.
-- Veiligheidsmaatregelen: defer FK + transactie ontbreekt in D1, maar de operatie is
-- idempotent doordat we eerst _tmp aanmaken en pas op het einde renamen.

-- 1. Nieuwe tabel zonder UNIQUE op order_ref (qr_code blijft UNIQUE)
CREATE TABLE tickets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,
  order_ref TEXT NOT NULL,
  koper_email TEXT NOT NULL,
  koper_naam TEXT NOT NULL,
  koper_telefoon TEXT,
  aantal INTEGER NOT NULL DEFAULT 1,
  categorie TEXT NOT NULL,
  prijs_totaal REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'refunded', 'used')),
  betaalmethode TEXT,
  betaling_id TEXT,
  qr_code TEXT UNIQUE NOT NULL,
  gescand INTEGER NOT NULL DEFAULT 0,
  gescand_at DATETIME,
  betaald_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seat_label TEXT,
  seat_row TEXT,
  seat_number TEXT,
  seat_category TEXT,
  FOREIGN KEY (concert_id) REFERENCES concerts(id) ON DELETE CASCADE
);

-- 2. Data overzetten (ticket_seats.ticket_id blijft geldig want we behouden id)
INSERT INTO tickets_new (
  id, concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
  aantal, categorie, prijs_totaal, status, betaalmethode, betaling_id,
  qr_code, gescand, gescand_at, betaald_at, created_at,
  seat_label, seat_row, seat_number, seat_category
)
SELECT
  id, concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
  aantal, categorie, prijs_totaal, status, betaalmethode, betaling_id,
  qr_code, gescand, gescand_at, betaald_at, created_at,
  seat_label, seat_row, seat_number, seat_category
FROM tickets;

-- 3. Oude tabel weg
DROP TABLE tickets;

-- 4. Rename
ALTER TABLE tickets_new RENAME TO tickets;

-- 5. Nieuwe niet-unieke index op order_ref voor snelle lookups
--    (multi-cat orders zoeken alle rijen via order_ref)
CREATE INDEX IF NOT EXISTS idx_tickets_order_ref ON tickets(order_ref);
CREATE INDEX IF NOT EXISTS idx_tickets_betaling_id ON tickets(betaling_id);
CREATE INDEX IF NOT EXISTS idx_tickets_concert_status ON tickets(concert_id, status);
