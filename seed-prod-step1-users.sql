-- Step 1: Users and Profiles
PRAGMA foreign_keys = OFF;

INSERT INTO users (id, email, password_hash, role, stemgroep, status, email_verified) VALUES 
(1, 'admin@animato.be', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'admin', NULL, 'actief', 1),
(2, 'emma.janssen@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'S', 'actief', 1),
(3, 'sophie.dubois@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'S', 'actief', 1),
(4, 'lisa.peeters@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'stemleider', 'A', 'actief', 1),
(5, 'marie.vermeulen@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'A', 'actief', 1),
(6, 'thomas.maes@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'T', 'actief', 1),
(7, 'lucas.claes@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'T', 'proeflid', 1),
(8, 'jan.desmet@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'moderator', 'B', 'actief', 1),
(9, 'pieter.willems@example.com', 'pbkdf2_sha256$100000$8120c2c12a644e5df5066397703fbe0e$81b51c4fec5b183af63d5e53603c14bcf73158aaf740cd8bdc75ae087ffa88fc9294d436035680d062e2117ad3af785c44b0a24d82258c2f895dcb16828e823c', 'lid', 'B', 'actief', 1);

INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) VALUES 
(1, 'Administrator', 'Animato', '+32 470 12 34 56', NULL),
(2, 'Emma', 'Janssen', '+32 471 11 11 11', '5 jaar koorervaring'),
(3, 'Sophie', 'Dubois', '+32 471 22 22 22', 'Zangles gevolgd, 2 jaar in koor'),
(4, 'Lisa', 'Peeters', '+32 472 33 33 33', 'Stemleider Alt, 10 jaar koorervaring'),
(5, 'Marie', 'Vermeulen', '+32 472 44 44 44', 'Pianist, 3 jaar in koor'),
(6, 'Thomas', 'Maes', '+32 473 55 55 55', 'Gitarist, nieuw in koor'),
(7, 'Lucas', 'Claes', '+32 473 66 66 66', 'Proeflid, geen eerdere koorervaring'),
(8, 'Jan', 'Desmet', '+32 474 77 77 77', 'Moderator, 15 jaar koorervaring'),
(9, 'Pieter', 'Willems', '+32 474 88 88 88', 'Dirigent in opleiding');

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

PRAGMA foreign_keys = ON;
