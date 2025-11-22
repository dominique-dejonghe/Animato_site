-- Step 2: Posts
PRAGMA foreign_keys = OFF;

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

PRAGMA foreign_keys = ON;
