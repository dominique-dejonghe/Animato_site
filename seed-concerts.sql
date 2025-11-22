-- Test data voor Concert Ticketing Systeem

-- Eerst: Voeg concert events toe aan events table
INSERT INTO events (titel, beschrijving, type, start_at, locatie, is_publiek, created_by) VALUES
  (
    'Voorjaarsconcert 2025',
    'Een prachtig programma met werken van Mozart, Händel en John Rutter. Geniet van een avond vol klassieke koormuziek in een sfeervolle ambiance.',
    'event',
    '2025-05-15 20:00:00',
    'Grote Kerk, Centrum',
    NULL,
    1,
    1
  ),
  (
    'Requiem van Verdi',
    'Een meeslepende uitvoering van Giuseppe Verdi''s monumentale Requiem, een van de grootste meesterwerken uit de koorrepertoireliteratuur.',
    'event',
    '2025-06-20 19:30:00',
    'Concertgebouw, Grote Zaal',
    NULL,
    1,
    1
  ),
  (
    'Kerst Gala Concert 2025',
    'Vier de feestdagen met ons traditionele kerstconcert. Een avond vol bekende kerstliederen en klassieke werken.',
    'event',
    '2025-12-18 20:00:00',
    'Kathedraal Sint-Bavo',
    NULL,
    1,
    1
  );

-- Voeg concert info toe met ticketing details
INSERT INTO concerts (event_id, programma, prijsstructuur, capaciteit, verkocht, ticketing_enabled, poster_url) VALUES
  (
    (SELECT id FROM events WHERE titel = 'Voorjaarsconcert 2025' LIMIT 1),
    'Mozart - Ave Verum Corpus
Händel - Hallelujah (Messiah)
John Rutter - A Gaelic Blessing
John Rutter - For the Beauty of the Earth

Pauze (15 minuten)

Mozart - Requiem (fragmenten)
- Requiem aeternam
- Kyrie
- Lacrimosa',
    '[
      {"categorie": "Volwassenen", "prijs": 18, "beschrijving": "Standaard toegang"},
      {"categorie": "65+/Studenten", "prijs": 15, "beschrijving": "Gereduceerd tarief met legitimatie"},
      {"categorie": "Kinderen (<12)", "prijs": 8, "beschrijving": "Kinderen tot 12 jaar"}
    ]',
    300,
    45,
    1,
    NULL
  ),
  (
    (SELECT id FROM events WHERE titel = 'Requiem van Verdi' LIMIT 1),
    'Giuseppe Verdi - Messa da Requiem

Solisten:
- Sopraan: Maria Jansen
- Alt: Sophie de Vries
- Tenor: Johan Bakker
- Bas: Peter van Dam

Met orkest en groot koor (120 zangers)',
    '[
      {"categorie": "Premium", "prijs": 35, "beschrijving": "Beste plaatsen, eerste 5 rijen"},
      {"categorie": "Standaard", "prijs": 25, "beschrijving": "Reguliere plaatsen"},
      {"categorie": "Balkon", "prijs": 20, "beschrijving": "Balkon plaatsen met goed zicht"},
      {"categorie": "Studenten", "prijs": 12, "beschrijving": "Met studentenpas"}
    ]',
    450,
    128,
    1,
    NULL
  ),
  (
    (SELECT id FROM events WHERE titel = 'Kerst Gala Concert 2025' LIMIT 1),
    'Traditionele Kerstliederen:
- Stille Nacht
- O Denneboom
- Hoor de Englen Zingen d''eer

Klassieke Werken:
- Bach - Weihnachtsoratorium (fragmenten)
- Händel - For unto us a child is born

Pauze met kerstdrank

Populaire Kerstmuziek:
- White Christmas
- The First Noel
- Joy to the World

Groot finale: Hallelujah',
    '[
      {"categorie": "VIP", "prijs": 45, "beschrijving": "Inclusief receptie na afloop"},
      {"categorie": "Volwassenen", "prijs": 22, "beschrijving": "Standaard toegang"},
      {"categorie": "Gezinskaart", "prijs": 60, "beschrijving": "2 volwassenen + 2 kinderen"},
      {"categorie": "Kinderen", "prijs": 10, "beschrijving": "Tot 12 jaar"}
    ]',
    500,
    0,
    1,
    NULL
  );

-- Voeg wat test bestellingen toe
INSERT INTO tickets (concert_id, order_ref, koper_email, koper_naam, koper_telefoon, aantal, categorie, prijs_totaal, status, qr_code, gescand, betaald_at) VALUES
  (
    1,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'jan.janssen@example.com',
    'Jan Janssen',
    '06-12345678',
    2,
    '2x Volwassenen',
    36.00,
    'paid',
    lower(hex(randomblob(16))),
    0,
    datetime('now', '-5 days')
  ),
  (
    1,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'marie.pieters@example.com',
    'Marie Pieters',
    '06-87654321',
    3,
    '2x Volwassenen, 1x Kinderen (<12)',
    44.00,
    'paid',
    lower(hex(randomblob(16))),
    0,
    datetime('now', '-3 days')
  ),
  (
    1,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'henk.devries@example.com',
    'Henk de Vries',
    NULL,
    2,
    '2x 65+/Studenten',
    30.00,
    'paid',
    lower(hex(randomblob(16))),
    1,
    datetime('now', '-1 day')
  ),
  (
    1,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'anna.bakker@example.com',
    'Anna Bakker',
    '06-11223344',
    1,
    '1x Volwassenen',
    18.00,
    'pending',
    lower(hex(randomblob(16))),
    0,
    NULL
  ),
  (
    2,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'peter.smit@example.com',
    'Peter Smit',
    '06-99887766',
    2,
    '2x Premium',
    70.00,
    'paid',
    lower(hex(randomblob(16))),
    0,
    datetime('now', '-2 days')
  ),
  (
    2,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'lisa.berg@example.com',
    'Lisa van den Berg',
    '06-55443322',
    4,
    '4x Standaard',
    100.00,
    'paid',
    lower(hex(randomblob(16))),
    0,
    datetime('now', '-4 days')
  ),
  (
    2,
    'TIX-' || substr(hex(randomblob(4)), 1, 8),
    'thomas.wolf@example.com',
    'Thomas Wolf',
    NULL,
    2,
    '2x Studenten',
    24.00,
    'paid',
    lower(hex(randomblob(16))),
    0,
    datetime('now', '-1 day')
  );
