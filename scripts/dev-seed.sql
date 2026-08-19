-- =====================================================================
-- Local development seed
-- =====================================================================
-- Creates a small set of test accounts for local development / demos.
-- All accounts use the password: admin123
--
-- NOTE: the password_hash below is a PBKDF2 hash (saltHex:hashHex,
-- 100k iterations, SHA-256) matching src/utils/auth.ts. The bcrypt hashes in
-- the legacy seed.sql do NOT work with the current auth code, which is why this
-- dedicated dev seed exists.

INSERT OR IGNORE INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES
  ('admin@animato.be',            '6abd910a6629abf59bdd7d2b2215e4a7:670bcb155b8e1dc2bf274de0c62ade749ffc07376d6f7c573a38495c551d8e79', 'admin',      NULL, 'actief', 1),
  ('lisa.peeters@example.com',    '6abd910a6629abf59bdd7d2b2215e4a7:670bcb155b8e1dc2bf274de0c62ade749ffc07376d6f7c573a38495c551d8e79', 'stemleider', 'A',  'actief', 1),
  ('jan.desmet@example.com',      '6abd910a6629abf59bdd7d2b2215e4a7:670bcb155b8e1dc2bf274de0c62ade749ffc07376d6f7c573a38495c551d8e79', 'moderator',  'B',  'actief', 1),
  ('emma.janssen@example.com',    '6abd910a6629abf59bdd7d2b2215e4a7:670bcb155b8e1dc2bf274de0c62ade749ffc07376d6f7c573a38495c551d8e79', 'lid',        'S',  'actief', 1),
  ('thomas.maes@example.com',     '6abd910a6629abf59bdd7d2b2215e4a7:670bcb155b8e1dc2bf274de0c62ade749ffc07376d6f7c573a38495c551d8e79', 'lid',        'T',  'actief', 1);

INSERT OR IGNORE INTO profiles (user_id, voornaam, achternaam)
SELECT id,
       CASE email
         WHEN 'admin@animato.be'         THEN 'Administrator'
         WHEN 'lisa.peeters@example.com' THEN 'Lisa'
         WHEN 'jan.desmet@example.com'   THEN 'Jan'
         WHEN 'emma.janssen@example.com' THEN 'Emma'
         WHEN 'thomas.maes@example.com'  THEN 'Thomas'
       END,
       CASE email
         WHEN 'admin@animato.be'         THEN 'Animato'
         WHEN 'lisa.peeters@example.com' THEN 'Peeters'
         WHEN 'jan.desmet@example.com'   THEN 'Desmet'
         WHEN 'emma.janssen@example.com' THEN 'Janssen'
         WHEN 'thomas.maes@example.com'  THEN 'Maes'
       END
FROM users
WHERE email IN ('admin@animato.be','lisa.peeters@example.com','jan.desmet@example.com','emma.janssen@example.com','thomas.maes@example.com');
