-- Complete seed data voor Gemengd Koor Animato - PRODUCTION
-- All passwords are PBKDF2 hash of 'admin123'
-- PBKDF2 hash: pbkdf2_sha256$100000$randomsalt$hashedpassword

-- =====================================================
-- ADMIN USER & TEST USERS
-- =====================================================

-- Admin user (password: admin123)
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('admin@animato.be', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'admin', NULL, 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon) VALUES 
(1, 'Administrator', 'Animato', '+32 470 12 34 56');

-- Test Leden (per stemgroep) - password: admin123
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('emma.janssen@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'S', 'actief', 1),
('sophie.dubois@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'S', 'actief', 1),
('lisa.peeters@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'stemleider', 'A', 'actief', 1),
('marie.vermeulen@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'A', 'actief', 1),
('thomas.maes@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'T', 'actief', 1),
('lucas.claes@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'T', 'proeflid', 1),
('jan.desmet@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'moderator', 'B', 'actief', 1),
('pieter.willems@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'B', 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
(2, 'Emma', 'Janssen', '+32 471 11 11 11', '5 jaar koorervaring'),
(3, 'Sophie', 'Dubois', '+32 471 22 22 22', 'Zangles gevolgd, 2 jaar in koor'),
(4, 'Lisa', 'Peeters', '+32 472 33 33 33', 'Stemleider Alt, 10 jaar koorervaring'),
(5, 'Marie', 'Vermeulen', '+32 472 44 44 44', 'Pianist, 3 jaar in koor'),
(6, 'Thomas', 'Maes', '+32 473 55 55 55', 'Gitarist, nieuw in koor'),
(7, 'Lucas', 'Claes', '+32 473 66 66 66', 'Proeflid, geen eerdere koorervaring'),
(8, 'Jan', 'Desmet', '+32 474 77 77 77', 'Moderator, 15 jaar koorervaring'),
(9, 'Pieter', 'Willems', '+32 474 88 88 88', 'Dirigent in opleiding');

-- =====================================================
-- SITE INSTELLINGEN
-- =====================================================

INSERT INTO settings (key, value, type, beschrijving) VALUES 
('site_naam', 'Gemengd Koor Animato', 'string', 'Officiële naam van het koor'),
('site_tagline', 'Koor met passie', 'string', 'Tagline onder logo'),
('theme_primary_color', '#00A9CE', 'string', 'Primaire kleur (cyan/turquoise)'),
('theme_secondary_color', '#1B4D5C', 'string', 'Secundaire kleur (donkere teal)'),
('theme_accent_color', '#F59E0B', 'string', 'Accentkleur (amber)'),
('contact_email', 'info@animato.be', 'string', 'Algemeen contactadres'),
('contact_telefoon', '+32 470 12 34 56', 'string', 'Algemeen telefoonnummer'),
('adres_straat', 'Koorstraat 1', 'string', 'Straatnaam en huisnummer'),
('adres_postcode', '1000', 'string', 'Postcode'),
('adres_stad', 'Brussel', 'string', 'Stad'),
('enable_ticketing', 'true', 'boolean', 'Ticketing module ingeschakeld'),
('enable_2fa', 'false', 'boolean', '2FA optioneel voor leden'),
('max_file_size_mb', '50', 'number', 'Maximale bestandsgrootte in MB');

-- =====================================================
-- NIEUWS
-- =====================================================

INSERT INTO posts (titel, slug, body, auteur_id, type, is_pinned, is_published, zichtbaarheid, published_at) VALUES 
('Welkom bij Gemengd Koor Animato!', 'welkom-bij-animato', 
'<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Bekijk onze <a href="/word-lid">Word lid</a> pagina!</p>',
1, 'nieuws', 1, 1, 'publiek', datetime('now', '-7 days')),

('Aankomend concert: Lenteconcert 2025', 'lenteconcert-2025',
'<p>Op zaterdag 15 maart 2025 geven we ons traditionele lenteconcert in de Sint-Pieterskerk. Het programma bestaat uit werken van Mozart, Fauré en Rutter.</p><p>Tickets zijn nu beschikbaar via deze website!</p>',
1, 'nieuws', 0, 1, 'publiek', datetime('now', '-3 days')),

('Eerste repetitie nieuw seizoen', 'eerste-repetitie-nieuw-seizoen',
'<p>Welkom terug na de zomervakantie! Onze eerste repetitie van het nieuwe seizoen is op woensdag 4 september om 19:30u. We beginnen meteen met ons programma voor het kerstconcert.</p>',
1, 'nieuws', 0, 1, 'publiek', datetime('now', '-14 days'));

-- =====================================================
-- CONCERTEN & EVENTS
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
-- WEKELIJKSE REPETITIES (2024-2025)
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

-- November 2024 repetities
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2024-11-20 19:30:00', '2024-11-20 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-11-20', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2024-11-27 19:30:00', '2024-11-27 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-11-27', 1);

-- December 2024 repetities
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2024-12-04 19:30:00', '2024-12-04 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-04', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2024-12-11 19:30:00', '2024-12-11 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-11', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Laatste repetitie voor Kerstconcert!', 
'2024-12-18 19:30:00', '2024-12-18 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2024-12-18', 1);

-- January 2025 repetities
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date, created_by) VALUES
('repetitie', 'Wekelijkse Koorrepetitie', 'Eerste repetitie van het nieuwe jaar!', 
'2025-01-08 19:30:00', '2025-01-08 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-08', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2025-01-15 19:30:00', '2025-01-15 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-15', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2025-01-22 19:30:00', '2025-01-22 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-22', 1),
('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!', 
'2025-01-29 19:30:00', '2025-01-29 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 
(SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), '2025-01-29', 1);
