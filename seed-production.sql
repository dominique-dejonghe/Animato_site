-- Minimale seed data voor productie
-- Admin user is al aangemaakt, dus we skippen die

-- =====================================================
-- SITE INSTELLINGEN
-- =====================================================

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
('max_file_size_mb', '8', 'number', 'Maximale bestandsgrootte in MB');

-- =====================================================
-- WELKOM NIEUWSBERICHT
-- =====================================================

INSERT OR IGNORE INTO posts (titel, slug, body, auteur_id, type, is_pinned, is_published, zichtbaarheid, published_at) VALUES 
(
  'Welkom bij Gemengd Koor Animato!',
  'welkom-bij-animato',
  '<p>Welkom op de vernieuwde website van Gemengd Koor Animato! Hier vind je alle informatie over onze repetities, concerten en activiteiten.</p><p>Als lid kun je inloggen voor toegang tot het ledenportaal met partituren, oefenmateriaal en het interne berichtenbord.</p><p>Interesse om lid te worden? Neem contact met ons op!</p>',
  1,
  'nieuws',
  1,
  1,
  'publiek',
  datetime('now', '-1 days')
);
