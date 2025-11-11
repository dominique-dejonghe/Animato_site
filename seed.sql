-- Seed data voor Gemengd Koor Animato
-- Test data voor development en demonstratie

-- =====================================================
-- ADMIN USER
-- =====================================================

-- Admin user (wachtwoord: admin123 - moet worden gewijzigd!)
-- Hash is bcrypt van 'admin123'
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('admin@animato.be', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'admin', NULL, 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon) VALUES 
(1, 'Administrator', 'Animato', '+32 470 12 34 56');

-- =====================================================
-- TEST LEDEN (per stemgroep)
-- =====================================================

-- Sopranen
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('emma.janssen@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'S', 'actief', 1),
('sophie.dubois@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'S', 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
(2, 'Emma', 'Janssen', '+32 471 11 11 11', '5 jaar koorervaring'),
(3, 'Sophie', 'Dubois', '+32 471 22 22 22', 'Zangles gevolgd, 2 jaar in koor');

-- Alten
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('lisa.peeters@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'stemleider', 'A', 'actief', 1),
('marie.vermeulen@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'A', 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
(4, 'Lisa', 'Peeters', '+32 472 33 33 33', 'Stemleider Alt, 10 jaar koorervaring'),
(5, 'Marie', 'Vermeulen', '+32 472 44 44 44', 'Pianist, 3 jaar in koor');

-- Tenoren
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('thomas.maes@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'T', 'actief', 1),
('lucas.claes@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'T', 'proeflid', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
(6, 'Thomas', 'Maes', '+32 473 55 55 55', 'Gitarist, nieuw in koor'),
(7, 'Lucas', 'Claes', '+32 473 66 66 66', 'Proeflid, geen eerdere koorervaring');

-- Bassen
INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES 
('jan.desmet@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'moderator', 'B', 'actief', 1),
('pieter.willems@example.com', '$2a$10$XQq3VzX5VvNzMxJxvGq5Ju8yHm3pCqPjN8nZ6bYsYdKfwF8tY1yGS', 'lid', 'B', 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
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
(
  'Welkom bij Gemengd Koor Animato!',
  'welkom-bij-animato',
  '<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Bekijk onze <a href="/word-lid">Word lid</a> pagina!</p>',
  1,
  'nieuws',
  1,
  1,
  'publiek',
  datetime('now', '-7 days')
),
(
  'Aankomend concert: Lenteconcert 2025',
  'lenteconcert-2025',
  '<p>Op zaterdag 15 maart 2025 geven we ons traditionele lenteconcert in de Sint-Pieterskerk. Het programma bestaat uit werken van Mozart, Fauré en Rutter.</p><p>Tickets zijn nu beschikbaar via deze website!</p>',
  1,
  'nieuws',
  0,
  1,
  'publiek',
  datetime('now', '-3 days')
),
(
  'Nieuwe partituren beschikbaar',
  'nieuwe-partituren-beschikbaar',
  '<p>Beste leden, de partituren voor het Requiem van Fauré zijn nu beschikbaar in het ledenportaal onder "Materiaal". Download ze en begin vast te oefenen!</p>',
  1,
  'nieuws',
  0,
  1,
  'leden',
  datetime('now', '-1 day')
);

-- =====================================================
-- MESSAGEBOARD POSTS
-- =====================================================

INSERT INTO posts (titel, slug, body, auteur_id, type, categorie, is_published, zichtbaarheid, published_at) VALUES 
(
  'Welkom op het interne berichtenbord!',
  'welkom-berichtenbord',
  '<p>Hier kunnen we met elkaar communiceren over repetities, stukken en andere kooraangelegenheden. Veel plezier!</p>',
  1,
  'board',
  'algemeen',
  1,
  'leden',
  datetime('now', '-10 days')
),
(
  'Tips voor de hoge passages in Fauré',
  'tips-faure-sopraan',
  '<p>Beste sopranen, hier wat tips voor de moeilijke passages in het Sanctus...</p>',
  2,
  'board',
  'sopraan',
  1,
  'sopraan',
  datetime('now', '-2 days')
);

-- =====================================================
-- AGENDA - REPETITIES
-- =====================================================

INSERT INTO events (type, titel, beschrijving, start_at, end_at, locatie, adres, doelgroep, is_publiek, ics_uid) VALUES 
(
  'repetitie',
  'Repetitie Alle Stemmen',
  'Repetitie volledig koor - focus op Fauré Requiem',
  datetime('now', '+2 days', '+19 hours'),
  datetime('now', '+2 days', '+21 hours'),
  'Repetitielokaal Animato',
  'Koorstraat 1, 1000 Brussel',
  'all',
  0,
  'rep-' || hex(randomblob(16))
),
(
  'repetitie',
  'Sectierepetitie Sopranen & Alten',
  'Gedetailleerde doorname vrouwenstemmen',
  datetime('now', '+5 days', '+19 hours'),
  datetime('now', '+5 days', '+21 hours'),
  'Repetitielokaal Animato',
  'Koorstraat 1, 1000 Brussel',
  'SA',
  0,
  'rep-' || hex(randomblob(16))
),
(
  'repetitie',
  'Sectierepetitie Tenoren & Bassen',
  'Gedetailleerde doorname mannenstemmen',
  datetime('now', '+6 days', '+19 hours'),
  datetime('now', '+6 days', '+21 hours'),
  'Repetitielokaal Animato',
  'Koorstraat 1, 1000 Brussel',
  'TB',
  0,
  'rep-' || hex(randomblob(16))
);

-- =====================================================
-- CONCERTEN
-- =====================================================

INSERT INTO events (type, titel, slug, beschrijving, start_at, end_at, locatie, adres, doelgroep, is_publiek, ics_uid) VALUES 
(
  'concert',
  'Lenteconcert 2025',
  'lenteconcert-2025',
  'Ons traditionele lenteconcert met werken van Mozart, Fauré en Rutter',
  datetime('now', '+90 days', '+20 hours'),
  datetime('now', '+90 days', '+22 hours'),
  'Sint-Pieterskerk',
  'Kerkplein 5, 1000 Brussel',
  'all',
  1,
  'concert-' || hex(randomblob(16))
);

INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, ticketing_enabled, poster_url) VALUES 
(
  4,
  '<h3>Programma</h3><ul><li><strong>Mozart</strong> - Ave Verum Corpus</li><li><strong>Fauré</strong> - Requiem (volledige uitvoering)</li><li><strong>Rutter</strong> - The Lord Bless You and Keep You</li></ul>',
  '[{"categorie":"Volwassenen","prijs":15},{"categorie":"Studenten & 65+","prijs":10},{"categorie":"Kinderen < 12","prijs":5}]',
  250,
  1,
  '/static/posters/lenteconcert-2025.jpg'
);

-- =====================================================
-- MUZIEKWERKEN & MATERIAAL
-- =====================================================

-- Werk 1: Fauré Requiem
INSERT INTO works (componist, titel, beschrijving, jaar, genre) VALUES 
('Gabriel Fauré', 'Requiem Op. 48', 'Een van de mooiste requiems uit de romantiek, met nadruk op troost en vrede.', 1890, 'Klassiek/Romantiek');

INSERT INTO pieces (work_id, titel, nummer, opustype, toonsoort, moeilijkheidsgraad) VALUES 
(1, 'I. Introït et Kyrie', 1, 'beweging', 'd klein', 'gemiddeld'),
(1, 'II. Offertoire', 2, 'beweging', 'b klein', 'gemiddeld'),
(1, 'III. Sanctus', 3, 'beweging', 'Es groot', 'gevorderd'),
(1, 'IV. Pie Jesu', 4, 'beweging', 'Bes groot', 'gemiddeld'),
(1, 'V. Agnus Dei', 5, 'beweging', 'F groot', 'gemiddeld'),
(1, 'VI. Libera me', 6, 'beweging', 'd klein', 'gevorderd'),
(1, 'VII. In Paradisum', 7, 'beweging', 'D groot', 'gemiddeld');

-- Materiaal (placeholders - in productie komen hier echte bestanden)
INSERT INTO materials (piece_id, stem, type, titel, bestandsnaam, url, versie, zichtbaar_voor, upload_door) VALUES 
(1, 'SATB', 'pdf', 'Introït et Kyrie - Volledige partituur', 'faure-introit-full.pdf', '/materials/faure-introit-full.pdf', 1, 'alle_leden', 1),
(1, 'S', 'pdf', 'Introït et Kyrie - Sopraan', 'faure-introit-sopraan.pdf', '/materials/faure-introit-sopraan.pdf', 1, 'stem_specifiek', 1),
(1, 'A', 'pdf', 'Introït et Kyrie - Alt', 'faure-introit-alt.pdf', '/materials/faure-introit-alt.pdf', 1, 'stem_specifiek', 1),
(1, 'T', 'pdf', 'Introït et Kyrie - Tenor', 'faure-introit-tenor.pdf', '/materials/faure-introit-tenor.pdf', 1, 'stem_specifiek', 1),
(1, 'B', 'pdf', 'Introït et Kyrie - Bas', 'faure-introit-bas.pdf', '/materials/faure-introit-bas.pdf', 1, 'stem_specifiek', 1),
(1, 'S', 'audio', 'Oefentrack Sopraan', 'faure-introit-sopraan.mp3', '/materials/faure-introit-sopraan.mp3', 1, 'stem_specifiek', 1),
(1, 'A', 'audio', 'Oefentrack Alt', 'faure-introit-alt.mp3', '/materials/faure-introit-alt.mp3', 1, 'stem_specifiek', 1),
(1, 'T', 'audio', 'Oefentrack Tenor', 'faure-introit-tenor.mp3', '/materials/faure-introit-tenor.mp3', 1, 'stem_specifiek', 1),
(1, 'B', 'audio', 'Oefentrack Bas', 'faure-introit-bas.mp3', '/materials/faure-introit-bas.mp3', 1, 'stem_specifiek', 1);

-- Werk 2: Mozart Ave Verum Corpus
INSERT INTO works (componist, titel, beschrijving, jaar, genre) VALUES 
('Wolfgang Amadeus Mozart', 'Ave Verum Corpus K. 618', 'Korte maar prachtige motet, een van Mozarts laatste werken.', 1791, 'Klassiek');

INSERT INTO pieces (work_id, titel, nummer, opustype, toonsoort, moeilijkheidsgraad) VALUES 
(2, 'Ave Verum Corpus', 1, 'volledig', 'D groot', 'beginner');

INSERT INTO materials (piece_id, stem, type, titel, bestandsnaam, url, versie, zichtbaar_voor, upload_door) VALUES 
(8, 'SATB', 'pdf', 'Ave Verum Corpus - Volledige partituur', 'mozart-ave-verum-full.pdf', '/materials/mozart-ave-verum-full.pdf', 1, 'alle_leden', 1);

-- =====================================================
-- FOTOALBUMS
-- =====================================================

INSERT INTO albums (titel, slug, beschrijving, is_publiek, event_id, sorteer_volgorde) VALUES 
('Kerstconcert 2024', 'kerstconcert-2024', 'Foto''s van ons kerstconcert in december 2024', 1, NULL, 1),
('Repetities 2024-2025', 'repetities-2024-2025', 'Sfeerbeelden van onze repetities', 0, NULL, 2);

-- Photos (placeholders)
INSERT INTO photos (album_id, url, thumbnail_url, caption, upload_door, sorteer_volgorde) VALUES 
(1, '/photos/kerstconcert-01.jpg', '/photos/thumbs/kerstconcert-01.jpg', 'Het volledige koor tijdens finale', 1, 1),
(1, '/photos/kerstconcert-02.jpg', '/photos/thumbs/kerstconcert-02.jpg', 'Onze dirigent in actie', 1, 2),
(1, '/photos/kerstconcert-03.jpg', '/photos/thumbs/kerstconcert-03.jpg', 'Het publiek geniet', 1, 3);

-- =====================================================
-- AUDIT LOG (voorbeelden)
-- =====================================================

INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES 
(1, 'user_login', 'user', 1, '{"ip":"127.0.0.1","method":"password"}'),
(1, 'post_created', 'post', 1, '{"titel":"Welkom bij Gemengd Koor Animato!"}'),
(1, 'event_created', 'event', 1, '{"titel":"Repetitie Alle Stemmen"}');
