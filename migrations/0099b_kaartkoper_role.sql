-- 0099b_kaartkoper_role.sql
-- Voegt rol 'kaartkoper' toe + magic-link velden voor passwordless onboarding.
--
-- AANPAK: tabel-rebuild met FK's UIT (SQLite official recipe voor schema-wijziging).
-- `defer_foreign_keys` werkt NIET voor cascading deletes — alleen `foreign_keys=OFF`.
--
-- VEREISTE VOORWAARDE: migratie 0099a moet eerst gelopen hebben, zodat
-- feedback_comments.user_id nullable is (en die schema-inconsistentie niet
-- opnieuw FK-failures veroorzaakt).

PRAGMA foreign_keys = OFF;

-- ── Stap 1: nieuwe users tabel met uitgebreide CHECK + magic-link kolommen ──
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'lid' CHECK(role IN ('admin','moderator','stemleider','lid','bezoeker','dirigent','pianist','kaartkoper')),
  stemgroep TEXT CHECK(stemgroep IN ('S','A','T','B','Dirigent','Pianist') OR stemgroep IS NULL),
  status TEXT NOT NULL DEFAULT 'actief' CHECK(status IN ('actief','inactief','proeflid','uitgenodigd')),
  two_fa_enabled INTEGER NOT NULL DEFAULT 0,
  two_fa_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  google_id TEXT,
  is_bestuurslid INTEGER NOT NULL DEFAULT 0,
  is_test_account INTEGER NOT NULL DEFAULT 0,
  last_login DATETIME,
  previous_login_at TIMESTAMP DEFAULT NULL,
  welcome_splash_seen INTEGER DEFAULT 0,
  welcome_splash_seen_at TEXT,
  last_seen_at DATETIME,
  show_online_status INTEGER NOT NULL DEFAULT 1,
  account_setup_token TEXT,
  account_setup_token_expires DATETIME,
  account_setup_completed INTEGER NOT NULL DEFAULT 1
);

-- ── Stap 2: data kopiëren (alle bestaande users krijgen setup_completed=1) ──
INSERT INTO users_new (
  id, email, password_hash, role, stemgroep, status, two_fa_enabled,
  two_fa_secret, email_verified, last_login_at, created_at, updated_at,
  google_id, is_bestuurslid, is_test_account, last_login, previous_login_at,
  welcome_splash_seen, welcome_splash_seen_at, last_seen_at, show_online_status,
  account_setup_token, account_setup_token_expires, account_setup_completed
) SELECT
  id, email, password_hash, role, stemgroep, status, two_fa_enabled,
  two_fa_secret, email_verified, last_login_at, created_at, updated_at,
  google_id, is_bestuurslid, is_test_account, last_login, previous_login_at,
  welcome_splash_seen, welcome_splash_seen_at, last_seen_at, show_online_status,
  NULL, NULL, 1
FROM users;

-- ── Stap 3: oude tabel weg, nieuwe op zijn plaats ──
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- ── Stap 4: indexen herstellen ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_welcome_splash ON users(welcome_splash_seen, role);
CREATE INDEX IF NOT EXISTS idx_users_setup_token ON users(account_setup_token);

-- ── Stap 5: FK's weer aan ──
PRAGMA foreign_keys = ON;
