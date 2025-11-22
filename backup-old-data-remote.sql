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
INSERT INTO "users" VALUES(1,'admin@animato.be','54fb0f74e1f4d60cff393a320004e52b:cc6355f95394c2a265bc000d317234629df1fd75d52f0bb06a8567d8cc8dfa98','admin',NULL,'actief',0,NULL,1,'2025-11-22 18:14:25','2025-11-22 17:47:03','2025-11-22 17:47:03');
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
INSERT INTO "profiles" VALUES(1,1,'Administrator','Animato','+32 470 12 34 56',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,0,1,'amateur');
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
INSERT INTO "posts" VALUES(1,'Welkom bij Gemengd Koor Animato!','welkom-bij-animato','<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Neem contact met ons op!</p>',NULL,1,'nieuws',NULL,NULL,1,1,'publiek',0,'2025-11-21 17:53:27','2025-11-22 17:53:27','2025-11-22 17:53:27');
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
INSERT INTO "audit_logs" VALUES(1,1,'user_login','user',1,'{"method":"password","remember":false}',NULL,NULL,'2025-11-22 17:54:18');
INSERT INTO "audit_logs" VALUES(2,1,'user_login','user',1,'{"method":"password","remember":false}',NULL,NULL,'2025-11-22 18:09:26');
INSERT INTO "audit_logs" VALUES(3,1,'user_login','user',1,'{"method":"password","remember":false}',NULL,NULL,'2025-11-22 18:14:25');
CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
  beschrijving TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "settings" VALUES(1,'site_naam','Gemengd Koor Animato','string','Officiële naam van het koor','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(2,'site_tagline','Koor met passie','string','Tagline onder logo','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(3,'theme_primary_color','#00A9CE','string','Primaire kleur (cyan/turquoise)','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(4,'theme_secondary_color','#1B4D5C','string','Secundaire kleur (donkere teal)','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(5,'theme_accent_color','#F59E0B','string','Accentkleur (amber)','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(6,'contact_email','info@animato.be','string','Algemeen contactadres','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(7,'contact_telefoon','+32 470 12 34 56','string','Algemeen telefoonnummer','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(8,'adres_straat','Koorstraat 1','string','Straatnaam en huisnummer','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(9,'adres_postcode','1000','string','Postcode','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(10,'adres_stad','Brussel','string','Stad','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(11,'enable_ticketing','true','boolean','Ticketing module ingeschakeld','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(12,'enable_2fa','false','boolean','2FA optioneel voor leden','2025-11-22 17:53:27');
INSERT INTO "settings" VALUES(13,'max_file_size_mb','8','number','Maximale bestandsgrootte in MB','2025-11-22 17:53:27');
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
INSERT INTO "locations" VALUES(1,'Repetitielokaal Koor','Koorstraat 1','1000','Brussel','België',NULL,NULL,NULL,NULL,NULL,1,'2025-11-22 17:46:45','2025-11-22 17:46:45');
INSERT INTO "locations" VALUES(2,'Sint-Pieterskerk','Sint-Pietersplein 1','9000','Gent','België',NULL,NULL,NULL,NULL,NULL,1,'2025-11-22 17:46:45','2025-11-22 17:46:45');
INSERT INTO "locations" VALUES(3,'Concertgebouw','Concertgebouwplein 1','8000','Brugge','België',NULL,NULL,NULL,NULL,NULL,1,'2025-11-22 17:46:45','2025-11-22 17:46:45');
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
INSERT INTO "sqlite_sequence" VALUES('users',1);
INSERT INTO "sqlite_sequence" VALUES('profiles',1);
INSERT INTO "sqlite_sequence" VALUES('settings',13);
INSERT INTO "sqlite_sequence" VALUES('posts',1);
INSERT INTO "sqlite_sequence" VALUES('audit_logs',3);
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
