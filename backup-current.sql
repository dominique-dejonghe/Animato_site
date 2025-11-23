PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" VALUES(1,'0001_initial_schema.sql','2025-11-22 17:46:43');
INSERT INTO "d1_migrations" VALUES(2,'0002_fotoboek_updates.sql','2025-11-22 17:46:44');
INSERT INTO "d1_migrations" VALUES(3,'0003_smoelenboek_fields.sql','2025-11-22 17:46:44');
INSERT INTO "d1_migrations" VALUES(4,'0003_add_event_images.sql','2025-11-22 17:46:44');
INSERT INTO "d1_migrations" VALUES(5,'0004_singer_type.sql','2025-11-22 17:46:44');
INSERT INTO "d1_migrations" VALUES(6,'0004_add_concert_practical_info.sql','2025-11-22 17:46:44');
INSERT INTO "d1_migrations" VALUES(7,'0005_recurring_events.sql','2025-11-22 17:46:45');
INSERT INTO "d1_migrations" VALUES(8,'0006_events_extra_fields.sql','2025-11-22 17:46:45');
INSERT INTO "d1_migrations" VALUES(9,'0007_events_locatie_nullable.sql','2025-11-22 17:46:45');
INSERT INTO "d1_migrations" VALUES(10,'0008_add_drums_stemgroep.sql','2025-11-22 17:46:45');
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'lid' CHECK(role IN ('admin', 'moderator', 'stemleider', 'lid', 'bezoeker')),
  stemgroep TEXT CHECK(stemgroep IN ('S', 'A', 'T', 'B') OR stemgroep IS NULL),
  status TEXT NOT NULL DEFAULT 'actief' CHECK(status IN ('actief', 'inactief', 'proeflid', 'uitgenodigd')),
  two_fa_enabled INTEGER NOT NULL DEFAULT 0,
  two_fa_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "users" VALUES(1,'admin@animato.be','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','admin',NULL,'actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(2,'emma.janssen@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','S','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(3,'sophie.dubois@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','S','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(4,'lisa.peeters@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','stemleider','A','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(5,'marie.vermeulen@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','A','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(6,'thomas.maes@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','T','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(7,'lucas.claes@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','T','proeflid',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(8,'jan.desmet@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','moderator','B','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
INSERT INTO "users" VALUES(9,'pieter.willems@example.com','pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c','lid','B','actief',0,NULL,1,NULL,'2025-11-22 18:27:48','2025-11-22 18:27:48');
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  voornaam TEXT NOT NULL,
  achternaam TEXT NOT NULL,
  telefoon TEXT,
  adres TEXT,
  postcode TEXT,
  stad TEXT,
  geboortedatum DATE,
  foto_url TEXT,
  bio TEXT,
  muzikale_ervaring TEXT,
  instrument TEXT,
  noodcontact_naam TEXT,
  noodcontact_telefoon TEXT, favoriete_genre TEXT, favoriete_componist TEXT, favoriete_werk TEXT, jaren_in_koor INTEGER, website_url TEXT, linkedin_url TEXT, smoelenboek_zichtbaar INTEGER NOT NULL DEFAULT 1, toon_telefoon INTEGER NOT NULL DEFAULT 0, toon_email INTEGER NOT NULL DEFAULT 1, zanger_type TEXT DEFAULT 'amateur',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO "profiles" VALUES(2,1,'Administrator','Animato','+32 470 12 34 56',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(3,2,'Emma','Janssen','+32 471 11 11 11',NULL,NULL,NULL,NULL,NULL,NULL,'5 jaar koorervaring',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(4,3,'Sophie','Dubois','+32 471 22 22 22',NULL,NULL,NULL,NULL,NULL,NULL,'Zangles gevolgd, 2 jaar in koor',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(5,4,'Lisa','Peeters','+32 472 33 33 33',NULL,NULL,NULL,NULL,NULL,NULL,'Stemleider Alt, 10 jaar koorervaring',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(6,5,'Marie','Vermeulen','+32 472 44 44 44',NULL,NULL,NULL,NULL,NULL,NULL,'Pianist, 3 jaar in koor',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(7,6,'Thomas','Maes','+32 473 55 55 55',NULL,NULL,NULL,NULL,NULL,NULL,'Gitarist, nieuw in koor',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(8,7,'Lucas','Claes','+32 473 66 66 66',NULL,NULL,NULL,NULL,NULL,NULL,'Proeflid, geen eerdere koorervaring',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(9,8,'Jan','Desmet','+32 474 77 77 77',NULL,NULL,NULL,NULL,NULL,NULL,'Moderator, 15 jaar koorervaring',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
INSERT INTO "profiles" VALUES(10,9,'Pieter','Willems','+32 474 88 88 88',NULL,NULL,NULL,NULL,NULL,NULL,'Dirigent in opleiding',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  body TEXT NOT NULL,
  excerpt TEXT,
  auteur_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'nieuws' CHECK(type IN ('nieuws', 'board')),
  categorie TEXT CHECK(categorie IN ('algemeen', 'sopraan', 'alt', 'tenor', 'bas', 'bestuur')),
  tags TEXT, 
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  zichtbaarheid TEXT NOT NULL DEFAULT 'publiek' CHECK(zichtbaarheid IN ('publiek', 'leden', 'sopraan', 'alt', 'tenor', 'bas')),
  views INTEGER NOT NULL DEFAULT 0,
  published_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (auteur_id) REFERENCES users(id)
);
INSERT INTO "posts" VALUES(2,'Welkom bij Gemengd Koor Animato!','welkom-bij-animato','<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Bekijk onze <a href="/word-lid">Word lid</a> pagina!</p>',NULL,1,'nieuws',NULL,NULL,1,1,'publiek',1,'2025-11-15 18:27:56','2025-11-22 18:27:56','2025-11-22 18:27:56');
INSERT INTO "posts" VALUES(3,'Aankomend concert: Lenteconcert 2025','lenteconcert-2025','<p>Op zaterdag 15 maart 2025 geven we ons traditionele lenteconcert in de Sint-Pieterskerk. Het programma bestaat uit werken van Mozart, Fauré en Rutter.</p><p>Tickets zijn nu beschikbaar via deze website!</p>',NULL,1,'nieuws',NULL,NULL,0,1,'publiek',1,'2025-11-19 18:27:56','2025-11-22 18:27:56','2025-11-22 18:27:56');
INSERT INTO "posts" VALUES(4,'Eerste repetitie nieuw seizoen','eerste-repetitie-nieuw-seizoen','<p>Welkom terug na de zomervakantie! Onze eerste repetitie van het nieuwe seizoen is op woensdag 4 september om 19:30u. We beginnen meteen met ons programma voor het kerstconcert.</p>',NULL,1,'nieuws',NULL,NULL,0,1,'publiek',1,'2025-11-08 18:27:56','2025-11-22 18:27:56','2025-11-22 18:27:56');
CREATE TABLE post_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_reply_id INTEGER, 
  auteur_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_reply_id) REFERENCES post_replies(id) ON DELETE CASCADE,
  FOREIGN KEY (auteur_id) REFERENCES users(id)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'repetitie' CHECK(type IN ('repetitie', 'concert', 'ander')),
  titel TEXT NOT NULL,
  slug TEXT UNIQUE,
  beschrijving TEXT,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  locatie TEXT NOT NULL,
  adres TEXT,
  doelgroep TEXT NOT NULL DEFAULT 'all', 
  is_publiek INTEGER NOT NULL DEFAULT 0,
  herinnering_verzonden INTEGER NOT NULL DEFAULT 0,
  ics_uid TEXT UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, afbeelding TEXT, is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_rule TEXT, parent_event_id INTEGER REFERENCES events(id), occurrence_date DATE, location_id INTEGER REFERENCES locations(id), max_deelnemers INTEGER, aanmelden_verplicht INTEGER NOT NULL DEFAULT 0, zichtbaar_publiek INTEGER NOT NULL DEFAULT 1, toon_op_homepage INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id));
INSERT INTO "events" VALUES(1,'concert','Kerstconcert 2024','kerstconcert-2024','Een magische avond vol traditionele kerstliederen en klassieke werken. Het Gemengd Koor Animato brengt u in de juiste stemming voor de feestdagen met een gevarieerd programma vol vreugde en bezinning.','2025-12-20 20:00:00','2025-12-20 22:00:00','Sint-Pieterskerk Leuven','Grote Markt 1, 3000 Leuven','Iedereen welkom',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,NULL,NULL,NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(2,'concert','Voorjaarsconcert: Mozart & Vivaldi','voorjaarsconcert-2025','Een ode aan de lente met meesterwerken van Mozart en Vivaldi. Geniet van het Ave Verum Corpus van Mozart en de Gloria van Vivaldi, uitgevoerd door ons 60-koppig koor met professioneel orkest.','2026-05-10 20:00:00','2026-05-10 22:00:00','Concertgebouw Brugge','t Zand 34, 8000 Brugge','Muziekliefhebbers',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,NULL,NULL,NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(3,'concert','Zomerconcert: Carmina Burana','zomerconcert-2025','De kroon op ons seizoen: Carl Orffs spectaculaire Carmina Burana. Een kolossaal werk voor groot koor, solisten en orkest. Laat u overweldigen door deze meeslepende compositie vol drama en emotie.','2026-06-28 20:30:00','2026-06-28 22:30:00','Concertzaal Antwerpen','Koningin Elisabethlei 26, 2018 Antwerpen','Klassieke muziek liefhebbers',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,NULL,NULL,NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(4,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee! We werken aan ons repertoire voor de komende concerten.','2024-11-20 19:30:00','2024-11-20 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,1,'{"frequency":"weekly","interval":1,"end_date":"2025-12-31","days_of_week":[3]}',NULL,NULL,NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(5,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2024-11-20 19:30:00','2024-11-20 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2024-11-20',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(6,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2024-11-27 19:30:00','2024-11-27 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2024-11-27',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(7,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2024-12-04 19:30:00','2024-12-04 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2024-12-04',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(8,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2024-12-11 19:30:00','2024-12-11 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2024-12-11',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(9,'repetitie','Wekelijkse Koorrepetitie',NULL,'Laatste repetitie voor Kerstconcert!','2024-12-18 19:30:00','2024-12-18 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2024-12-18',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(10,'repetitie','Wekelijkse Koorrepetitie',NULL,'Eerste repetitie van het nieuwe jaar!','2025-01-08 19:30:00','2025-01-08 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2025-01-08',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(11,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2025-01-15 19:30:00','2025-01-15 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2025-01-15',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(12,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2025-01-22 19:30:00','2025-01-22 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2025-01-22',NULL,NULL,0,1,0,1);
INSERT INTO "events" VALUES(13,'repetitie','Wekelijkse Koorrepetitie',NULL,'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!','2025-01-29 19:30:00','2025-01-29 21:00:00','Repetitielokaal Animato, Kerkstraat 15, 3000 Leuven',NULL,'all',1,0,NULL,'2025-11-22 18:28:03','2025-11-22 18:28:03',NULL,0,NULL,4,'2025-01-29',NULL,NULL,0,1,0,1);
CREATE TABLE event_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'onbekend' CHECK(status IN ('aanwezig', 'afwezig', 'misschien', 'onbekend')),
  reden TEXT,
  responded_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE concerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  programma TEXT, 
  prijsstructuur TEXT, 
  capaciteit INTEGER,
  verkocht INTEGER NOT NULL DEFAULT 0,
  ticketing_enabled INTEGER NOT NULL DEFAULT 1,
  ticketing_provider TEXT DEFAULT 'intern' CHECK(ticketing_provider IN ('intern', 'extern')),
  externe_ticket_url TEXT,
  uitverkocht INTEGER NOT NULL DEFAULT 0,
  poster_url TEXT, parking TEXT, toegankelijkheid TEXT, duur_info TEXT, sfeer_dresscode TEXT, extra_info TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
INSERT INTO "concerts" VALUES(1,1,replace('Programma:\n- O Holy Night (Adam)\n- Ave Maria (Schubert)\n- Stille Nacht (Gruber)\n- Joy to the World (Handel)\n- White Christmas (Berlin)\n- Hallelujah (Cohen)','\n',char(10)),'[{"categorie":"Volwassenen","prijs":18},{"categorie":"Senioren (65+)","prijs":15},{"categorie":"Studenten","prijs":12},{"categorie":"Kinderen (-12)","prijs":8}]',400,0,1,'intern',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "concerts" VALUES(2,2,replace('Programma:\n- Ave Verum Corpus (Mozart)\n- Requiem - Lacrimosa (Mozart)\n- Gloria in D (Vivaldi)\n- Magnificat (Vivaldi)\n\nMet professioneel barok orkest','\n',char(10)),'[{"categorie":"Premium (eerste 5 rijen)","prijs":35},{"categorie":"Standaard","prijs":22},{"categorie":"Balkon","prijs":18},{"categorie":"Jongeren (-26)","prijs":12}]',650,0,1,'intern',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "concerts" VALUES(3,3,replace('Programma:\nCarl Orff - Carmina Burana (volledig werk)\n\nSolisten:\n- Sopraan: Maria Verschueren\n- Tenor: Johan De Vries\n- Bariton: Peter Janssens\n\nKoor: Gemengd Koor Animato (90 zangers)\nOrkest: Brussels Philharmonic','\n',char(10)),'[{"categorie":"VIP (incl. receptie)","prijs":65},{"categorie":"Premium","prijs":45},{"categorie":"Standaard","prijs":32},{"categorie":"Balkon","prijs":25},{"categorie":"Studenten","prijs":15}]',800,0,1,'intern',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,
  order_ref TEXT NOT NULL UNIQUE,
  koper_email TEXT NOT NULL,
  koper_naam TEXT NOT NULL,
  koper_telefoon TEXT,
  aantal INTEGER NOT NULL DEFAULT 1,
  categorie TEXT NOT NULL,
  prijs_totaal REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'refunded', 'used')),
  betaalmethode TEXT, 
  betaling_id TEXT,
  qr_code TEXT UNIQUE NOT NULL,
  gescand INTEGER NOT NULL DEFAULT 0,
  gescand_at DATETIME,
  betaald_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (concert_id) REFERENCES concerts(id) ON DELETE CASCADE
);
CREATE TABLE works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  componist TEXT NOT NULL,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  jaar INTEGER,
  genre TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  nummer INTEGER, 
  opustype TEXT, 
  toonsoort TEXT,
  tempo TEXT,
  duur_minuten INTEGER,
  moeilijkheidsgraad TEXT CHECK(moeilijkheidsgraad IN ('beginner', 'gemiddeld', 'gevorderd', 'expert')),
  opmerking TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);
CREATE TABLE albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  beschrijving TEXT,
  cover_url TEXT,
  is_publiek INTEGER NOT NULL DEFAULT 0,
  event_id INTEGER, 
  sorteer_volgorde INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, datum DATE, created_by INTEGER REFERENCES users(id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  tags TEXT, 
  mime_type TEXT,
  grootte_bytes INTEGER,
  breedte INTEGER,
  hoogte INTEGER,
  upload_door INTEGER NOT NULL,
  sorteer_volgorde INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, fotograaf TEXT,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id)
);
CREATE TABLE form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('word_lid', 'contact', 'ander')),
  payload TEXT NOT NULL, 
  email TEXT,
  naam TEXT,
  status TEXT NOT NULL DEFAULT 'nieuw' CHECK(status IN ('nieuw', 'verwerkt', 'gearchiveerd')),
  consent INTEGER NOT NULL DEFAULT 0,
  ip_adres TEXT,
  user_agent TEXT,
  verwerkt_door INTEGER,
  verwerkt_at DATETIME,
  notities TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (verwerkt_door) REFERENCES users(id)
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('nieuws', 'materiaal', 'repetitie', 'concert', 'board', 'systeem')),
  titel TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_gelezen INTEGER NOT NULL DEFAULT 0,
  gelezen_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actie TEXT NOT NULL,
  entity_type TEXT NOT NULL, 
  entity_id INTEGER,
  meta TEXT, 
  ip_adres TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
  beschrijving TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "settings" VALUES(14,'site_naam','Gemengd Koor Animato','string','Officiële naam van het koor','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(15,'site_tagline','Koor met passie','string','Tagline onder logo','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(16,'theme_primary_color','#00A9CE','string','Primaire kleur (cyan/turquoise)','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(17,'theme_secondary_color','#1B4D5C','string','Secundaire kleur (donkere teal)','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(18,'theme_accent_color','#F59E0B','string','Accentkleur (amber)','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(19,'contact_email','info@animato.be','string','Algemeen contactadres','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(20,'contact_telefoon','+32 470 12 34 56','string','Algemeen telefoonnummer','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(21,'adres_straat','Koorstraat 1','string','Straatnaam en huisnummer','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(22,'adres_postcode','1000','string','Postcode','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(23,'adres_stad','Brussel','string','Stad','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(24,'enable_ticketing','true','boolean','Ticketing module ingeschakeld','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(25,'enable_2fa','false','boolean','2FA optioneel voor leden','2025-11-22 18:27:48');
INSERT INTO "settings" VALUES(26,'max_file_size_mb','50','number','Maximale bestandsgrootte in MB','2025-11-22 18:27:48');
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL,
  adres TEXT NOT NULL,
  postcode TEXT,
  stad TEXT,
  land TEXT DEFAULT 'België',
  google_maps_url TEXT,
  google_maps_embed TEXT,
  latitude REAL,
  longitude REAL,
  notities TEXT,
  is_actief INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "materials" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id INTEGER NOT NULL,
  stem TEXT NOT NULL CHECK(stem IN ('S', 'A', 'T', 'B', 'SA', 'TB', 'SATB', 'piano', 'orgel', 'drums', 'algemeen')),
  type TEXT NOT NULL CHECK(type IN ('pdf', 'audio', 'video', 'zip', 'link')),
  titel TEXT NOT NULL,
  bestandsnaam TEXT,
  url TEXT NOT NULL,
  mime_type TEXT,
  grootte_bytes INTEGER,
  versie INTEGER NOT NULL DEFAULT 1,
  zichtbaar_voor TEXT NOT NULL DEFAULT 'alle_leden', 
  beschrijving TEXT,
  upload_door INTEGER NOT NULL,
  is_actief INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id)
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" VALUES('d1_migrations',10);
INSERT INTO "sqlite_sequence" VALUES('locations',3);
INSERT INTO "sqlite_sequence" VALUES('materials',0);
INSERT INTO "sqlite_sequence" VALUES('users',9);
INSERT INTO "sqlite_sequence" VALUES('profiles',10);
INSERT INTO "sqlite_sequence" VALUES('settings',26);
INSERT INTO "sqlite_sequence" VALUES('posts',4);
INSERT INTO "sqlite_sequence" VALUES('audit_logs',4);
INSERT INTO "sqlite_sequence" VALUES('events',13);
INSERT INTO "sqlite_sequence" VALUES('concerts',3);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_stemgroep ON users(stemgroep);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_posts_type ON posts(type);
CREATE INDEX idx_posts_categorie ON posts(categorie);
CREATE INDEX idx_posts_auteur ON posts(auteur_id);
CREATE INDEX idx_posts_published ON posts(is_published, published_at);
CREATE INDEX idx_posts_zichtbaarheid ON posts(zichtbaarheid);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_start ON events(start_at);
CREATE INDEX idx_events_publiek ON events(is_publiek);
CREATE INDEX idx_events_doelgroep ON events(doelgroep);
CREATE INDEX idx_photos_album ON photos(album_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_gelezen ON notifications(is_gelezen);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_events_afbeelding ON events(afbeelding);
CREATE INDEX idx_events_parent ON events(parent_event_id);
CREATE INDEX idx_events_recurring ON events(is_recurring);
CREATE INDEX idx_events_location ON events(location_id);
CREATE INDEX idx_events_created_by ON events(created_by);
