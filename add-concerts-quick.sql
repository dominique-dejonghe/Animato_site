-- Quick add 3 concerts with ticketing

-- Delete the "Maan en Zon" concert first
DELETE FROM events WHERE titel = 'Maan en Zon';

-- Kerstconcert 2025
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Kerstconcert 2025', 'kerstconcert-2025', 
'Een magische avond vol traditionele kerstliederen en klassieke werken.',
'2025-12-20 20:00:00', '2025-12-20 22:00:00',
'Sint-Pieterskerk Leuven', 'Grote Markt 1, 3000 Leuven',
1, 'Iedereen welkom', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
(last_insert_rowid(), 
'O Holy Night, Ave Maria, Stille Nacht, Joy to the World',
'[{"categorie":"Volwassenen","prijs":18},{"categorie":"Senioren","prijs":15},{"categorie":"Studenten","prijs":12},{"categorie":"Kinderen","prijs":8}]',
400, 0, 1);

-- Voorjaarsconcert 2026  
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Voorjaarsconcert 2026', 'voorjaarsconcert-2026',
'Mozart en Vivaldi meesterwerken met professioneel orkest.',
'2026-05-10 20:00:00', '2026-05-10 22:00:00',
'Concertgebouw Brugge', 't Zand 34, 8000 Brugge',
1, 'Muziekliefhebbers', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
(last_insert_rowid(),
'Ave Verum Corpus (Mozart), Gloria in D (Vivaldi)',
'[{"categorie":"Premium","prijs":35},{"categorie":"Standaard","prijs":22},{"categorie":"Balkon","prijs":18},{"categorie":"Jongeren","prijs":12}]',
650, 0, 1);

-- Zomerconcert 2026
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Carmina Burana 2026', 'carmina-burana-2026',
'Carl Orffs spectaculaire meesterwerk voor groot koor en orkest.',
'2026-06-28 20:30:00', '2026-06-28 22:30:00',
'Concertzaal Antwerpen', 'Koningin Elisabethlei 26, 2018 Antwerpen',
1, 'Klassieke muziek fans', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
(last_insert_rowid(),
'Carl Orff - Carmina Burana (volledig)',
'[{"categorie":"VIP","prijs":65},{"categorie":"Premium","prijs":45},{"categorie":"Standaard","prijs":32},{"categorie":"Balkon","prijs":25},{"categorie":"Studenten","prijs":15}]',
800, 0, 1);
