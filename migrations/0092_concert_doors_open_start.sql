-- Bug #214 (Dominique) — ticketbeheer moet eigen start- en deuren-open-uur
-- kunnen instellen, los van events.start_at (= moment vanaf wanneer de
-- artiesten op het podium staan / de officiële agenda-tijd).
--
-- Praktijk:
--   - doors_open_at: wanneer publiek de zaal binnen mag (meestal 30-60 min
--     vóór concert_start_at)
--   - concert_start_at: officiële aanvangsuur concert (vaak gelijk aan
--     events.start_at, maar kan afwijken — bv. event = "Concert Dancing
--     Voices 17:30" maar deuren 17:00 en muziek 18:00)
--
-- Beide zijn NULLABLE → als ze NULL zijn, valt de UI terug op events.start_at
-- (= huidige gedrag, geen breaking change). Admin kan ze synchroniseren met
-- één klik in /admin/tickets/concert/:id/settings.

ALTER TABLE concerts ADD COLUMN doors_open_at DATETIME;
ALTER TABLE concerts ADD COLUMN concert_start_at DATETIME;
