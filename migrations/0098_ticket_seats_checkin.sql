-- Migration 0098: ticket_seats check-in fields
-- Doel: per-zitplaats check-in tracking bij concertingang.
-- Een ticket-order kan meerdere ticket_seats hebben (gezin van 4 = 4 rijen);
-- die kunnen op verschillende momenten arriveren. Daarom per-rij check-in,
-- niet op tickets-niveau (waar tickets.gescand al bestaat maar te grof is).
--
-- checked_in_at  : NULL = nog niet aangekomen, anders timestamp van eerste scan
-- checked_in_by  : NULL of admin user_id die de scan deed (voor audit)

ALTER TABLE ticket_seats ADD COLUMN checked_in_at DATETIME;
ALTER TABLE ticket_seats ADD COLUMN checked_in_by INTEGER REFERENCES users(id);

-- Index voor de live status-pagina ("hoeveel zijn er ingecheckt?")
CREATE INDEX IF NOT EXISTS idx_ticket_seats_checkin
  ON ticket_seats(concert_id, checked_in_at);
