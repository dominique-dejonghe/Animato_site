-- Bestuurslid-badge: voeg vrije-tekst functie toe aan profiles
-- (bv. 'Voorzitter', 'Penningmeester', 'Secretaris', ...).
-- users.is_bestuurslid (boolean) bestaat al sinds 0045_board_members.sql,
-- maar de UI-badge die in 8a573d2 (10-batch) werd uitgerold leest óók
-- p.bestuurs_functie — die kolom ontbrak in productie en veroorzaakte
-- D1_ERROR 'no such column' op /leden/smoelenboek.

ALTER TABLE profiles ADD COLUMN bestuurs_functie TEXT;
