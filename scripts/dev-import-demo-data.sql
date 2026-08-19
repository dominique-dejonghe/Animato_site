-- =====================================================================
-- Demo content for the local development database
-- =====================================================================
-- Populates the (otherwise empty) dev site with representative content:
-- site settings, news posts, three concerts, and a weekly-rehearsal series.
--
-- Adapted from the repo's seed-production-full.sql, which targets an older
-- schema (its `events` inserts use `adres`/`created_by`, which no longer exist,
-- and its user rows use a Django-style `pbkdf2_sha256$...` hash that the current
-- auth code rejects). Here the address is folded into `locatie`, the obsolete
-- columns are dropped, and the user/profile rows are intentionally omitted so
-- the working PBKDF2 accounts from dev-seed.sql are kept. `auteur_id`/creator
-- references point at user id 1 (admin@animato.be), seeded first by dev-seed.sql.
--
-- All statements are idempotent (INSERT OR IGNORE on unique keys). setup-dev-db.sh
-- only runs this file when no concerts exist yet, so the non-unique rehearsal rows
-- are not duplicated on re-runs.

-- --- Site settings ---------------------------------------------------
INSERT OR IGNORE INTO settings (key, value, type, beschrijving) VALUES
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

-- --- News -------------------------------------------------------------
INSERT OR IGNORE INTO posts (titel, slug, body, auteur_id, type, is_pinned, is_published, zichtbaarheid, published_at) VALUES
  ('Welkom bij Gemengd Koor Animato!', 'welkom-bij-animato',
   '<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Bekijk onze <a href="/word-lid">Word lid</a> pagina!</p>',
   1, 'nieuws', 1, 1, 'publiek', datetime('now', '-7 days')),
  ('Aankomend concert: Lenteconcert 2025', 'lenteconcert-2025',
   '<p>Op zaterdag 15 maart 2025 geven we ons traditionele lenteconcert in de Sint-Pieterskerk. Het programma bestaat uit werken van Mozart, Fauré en Rutter.</p><p>Tickets zijn nu beschikbaar via deze website!</p>',
   1, 'nieuws', 0, 1, 'publiek', datetime('now', '-3 days')),
  ('Eerste repetitie nieuw seizoen', 'eerste-repetitie-nieuw-seizoen',
   '<p>Welkom terug na de zomervakantie! Onze eerste repetitie van het nieuwe seizoen is op woensdag 4 september om 19:30u. We beginnen meteen met ons programma voor het kerstconcert.</p>',
   1, 'nieuws', 0, 1, 'publiek', datetime('now', '-14 days'));

-- --- Concerts (events + concerts detail) -----------------------------
-- Dates are relative to "now" so the concerts show up as upcoming in the app.
INSERT OR IGNORE INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, is_publiek, doelgroep) VALUES
  ('concert', 'Kerstconcert', 'kerstconcert-2024',
   'Een magische avond vol traditionele kerstliederen en klassieke werken. Het Gemengd Koor Animato brengt u in de juiste stemming voor de feestdagen met een gevarieerd programma vol vreugde en bezinning.',
   date('now', '+40 days') || ' 20:00:00', date('now', '+40 days') || ' 22:00:00', 'Sint-Pieterskerk Leuven, Grote Markt 1, 3000 Leuven', 1, 'Iedereen welkom'),
  ('concert', 'Voorjaarsconcert: Mozart & Vivaldi', 'voorjaarsconcert-2025',
   'Een ode aan de lente met meesterwerken van Mozart en Vivaldi. Geniet van het Ave Verum Corpus van Mozart en de Gloria van Vivaldi, uitgevoerd door ons 60-koppig koor met professioneel orkest.',
   date('now', '+80 days') || ' 20:00:00', date('now', '+80 days') || ' 22:00:00', 'Concertgebouw Brugge, ''t Zand 34, 8000 Brugge', 1, 'Muziekliefhebbers'),
  ('concert', 'Zomerconcert: Carmina Burana', 'zomerconcert-2025',
   'De kroon op ons seizoen: Carl Orffs spectaculaire Carmina Burana. Een kolossaal werk voor groot koor, solisten en orkest. Laat u overweldigen door deze meeslepende compositie vol drama en emotie.',
   date('now', '+160 days') || ' 20:30:00', date('now', '+160 days') || ' 22:30:00', 'Concertzaal Antwerpen, Koningin Elisabethlei 26, 2018 Antwerpen', 1, 'Klassieke muziek liefhebbers');

INSERT OR IGNORE INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled) VALUES
  ((SELECT id FROM events WHERE slug = 'kerstconcert-2024'),
   'Programma:' || char(10) || '- O Holy Night (Adam)' || char(10) || '- Ave Maria (Schubert)' || char(10) || '- Stille Nacht (Gruber)' || char(10) || '- Joy to the World (Handel)' || char(10) || '- White Christmas (Berlin)' || char(10) || '- Hallelujah (Cohen)',
   '[{"categorie":"Volwassenen","prijs":18},{"categorie":"Senioren (65+)","prijs":15},{"categorie":"Studenten","prijs":12},{"categorie":"Kinderen (-12)","prijs":8}]',
   400, 0, 1),
  ((SELECT id FROM events WHERE slug = 'voorjaarsconcert-2025'),
   'Programma:' || char(10) || '- Ave Verum Corpus (Mozart)' || char(10) || '- Requiem - Lacrimosa (Mozart)' || char(10) || '- Gloria in D (Vivaldi)' || char(10) || '- Magnificat (Vivaldi)',
   '[{"categorie":"Premium (eerste 5 rijen)","prijs":35},{"categorie":"Standaard","prijs":22},{"categorie":"Balkon","prijs":18},{"categorie":"Jongeren (-26)","prijs":12}]',
   650, 0, 1),
  ((SELECT id FROM events WHERE slug = 'zomerconcert-2025'),
   'Programma:' || char(10) || 'Carl Orff - Carmina Burana (volledig werk)' || char(10) || 'Koor: Gemengd Koor Animato (90 zangers)',
   '[{"categorie":"VIP (incl. receptie)","prijs":65},{"categorie":"Premium","prijs":45},{"categorie":"Standaard","prijs":32},{"categorie":"Balkon","prijs":25},{"categorie":"Studenten","prijs":15}]',
   800, 0, 1);

-- --- Weekly rehearsals ------------------------------------------------
INSERT OR IGNORE INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, is_publiek, is_recurring, recurrence_rule) VALUES
  ('repetitie', 'Wekelijkse Koorrepetitie', 'wekelijkse-koorrepetitie',
   'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee! We werken aan ons repertoire voor de komende concerten.',
   date('now', '+3 days') || ' 19:30:00', date('now', '+3 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, 1,
   '{"frequency":"weekly","interval":1,"days_of_week":[3]}');

-- Nine upcoming weekly rehearsal occurrences (relative to now).
INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, is_publiek, parent_event_id, occurrence_date) VALUES
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+3 days')  || ' 19:30:00', date('now', '+3 days')  || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+3 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+10 days') || ' 19:30:00', date('now', '+10 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+10 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+17 days') || ' 19:30:00', date('now', '+17 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+17 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+24 days') || ' 19:30:00', date('now', '+24 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+24 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Repetitie ter voorbereiding van het Kerstconcert.', date('now', '+31 days') || ' 19:30:00', date('now', '+31 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+31 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+38 days') || ' 19:30:00', date('now', '+38 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+38 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+45 days') || ' 19:30:00', date('now', '+45 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+45 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+52 days') || ' 19:30:00', date('now', '+52 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+52 days')),
  ('repetitie', 'Wekelijkse Koorrepetitie', 'Wekelijkse repetitie voor alle leden.', date('now', '+59 days') || ' 19:30:00', date('now', '+59 days') || ' 21:00:00', 'Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven', 1, (SELECT id FROM events WHERE is_recurring = 1 LIMIT 1), date('now', '+59 days'));
