-- Demo data for Animato Koor website
-- 3 Concerts + Weekly rehearsals

-- =====================================================
-- CONCERTS
-- =====================================================

-- Kerstconcert 2024
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Kerstconcert 2024', 'kerstconcert-2024', 
'Een magische avond vol traditionele kerstliederen en klassieke werken. Het Gemengd Koor Animato brengt u in de juiste stemming voor de feestdagen met een gevarieerd programma vol vreugde en bezinning.',
'2024-12-20 20:00:00', '2024-12-20 22:00:00',
'Sint-Pieterskerk Leuven', 'Grote Markt 1, 3000 Leuven',
1, 'Iedereen welkom', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
((SELECT id FROM events WHERE slug = 'kerstconcert-2024'), 
'Programma:
- O Holy Night (Adam)
- Ave Maria (Schubert)
- Stille Nacht (Gruber)
- Joy to the World (Handel)
- White Christmas (Berlin)
- Hallelujah (Cohen)',
'[{"categorie":"Volwassenen","prijs":18},{"categorie":"Senioren (65+)","prijs":15},{"categorie":"Studenten","prijs":12},{"categorie":"Kinderen (-12)","prijs":8}]',
400, 0, 1);

-- Voorjaarsconcert 2025
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Voorjaarsconcert: Mozart & Vivaldi', 'voorjaarsconcert-2025',
'Een ode aan de lente met meesterwerken van Mozart en Vivaldi. Geniet van het Ave Verum Corpus van Mozart en de Gloria van Vivaldi, uitgevoerd door ons 60-koppig koor met professioneel orkest.',
'2025-05-10 20:00:00', '2025-05-10 22:00:00',
'Concertgebouw Brugge', 't Zand 34, 8000 Brugge',
1, 'Muziekliefhebbers', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
((SELECT id FROM events WHERE slug = 'voorjaarsconcert-2025'),
'Programma:
- Ave Verum Corpus (Mozart)
- Requiem - Lacrimosa (Mozart)
- Gloria in D (Vivaldi)
- Magnificat (Vivaldi)

Met professioneel barok orkest',
'[{"categorie":"Premium (eerste 5 rijen)","prijs":35},{"categorie":"Standaard","prijs":22},{"categorie":"Balkon","prijs":18},{"categorie":"Jongeren (-26)","prijs":12}]',
650, 0, 1);

-- Zomerconcert 2025
INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, is_publiek, doelgroep, created_by) VALUES
('concert', 'Zomerconcert: Carmina Burana', 'zomerconcert-2025',
'De kroon op ons seizoen: Carl Orffs spectaculaire Carmina Burana. Een kolossaal werk voor groot koor, solisten en orkest. Laat u overweldigen door deze meeslepende compositie vol drama en emotie.',
'2025-06-28 20:30:00', '2025-06-28 22:30:00',
'Concertzaal Antwerpen', 'Koningin Elisabethlei 26, 2018 Antwerpen',
1, 'Klassieke muziek liefhebbers', 1);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
((SELECT id FROM events WHERE slug = 'zomerconcert-2025'),
'Programma:
Carl Orff - Carmina Burana (volledig werk)

Solisten:
- Sopraan: Maria Verschueren
- Tenor: Johan De Vries
- Bariton: Peter Janssens

Koor: Gemengd Koor Animato (90 zangers)
Orkest: Brussels Philharmonic',
'[{"categorie":"VIP (incl. receptie)","prijs":65},{"categorie":"Premium","prijs":45},{"categorie":"Standaard","prijs":32},{"categorie":"Balkon","prijs":25},{"categorie":"Studenten","prijs":15}]',
800, 0, 1);

-- =====================================================
-- WEEKLY REHEARSALS (Rest of 2024 + Full 2025)
-- =====================================================

-- Parent recurring event
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, is_recurring, recurrence_rule, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 
'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee! We werken aan ons repertoire voor de komende concerten.',
'2024-11-20 19:30:00', '2024-11-20 21:00:00',
'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',
1, 1,
'{"frequency":"weekly","interval":1,"end_date":"2025-12-31","days_of_week":[3]}',
1);

-- November 2024 (2 occurrences)
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2024-11-20 19:30:00', '2024-11-20 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-11-20', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2024-11-27 19:30:00', '2024-11-27 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-11-27', 1);

-- December 2024 (4 occurrences - skip Dec 25 Kerst)
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2024-12-04 19:30:00', '2024-12-04 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-04', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2024-12-11 19:30:00', '2024-12-11 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-11', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Laatste repetitie voor Kerstconcert!', '2024-12-18 19:30:00', '2024-12-18 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-18', 1);

-- January 2025 (4 occurrences - skip Jan 1 Nieuwjaar)
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Eerste repetitie van het nieuwe jaar!', '2025-01-08 19:30:00', '2025-01-08 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-08', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2025-01-15 19:30:00', '2025-01-15 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-15', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2025-01-22 19:30:00', '2025-01-22 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-22', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', '2025-01-29 19:30:00', '2025-01-29 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-29', 1);

-- Note: Add more months as needed using similar pattern
