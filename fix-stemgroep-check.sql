PRAGMA foreign_keys=OFF;

CREATE TABLE users_backup2 AS SELECT * FROM users;

DROP TABLE users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'lid' CHECK(role IN ('admin','moderator','stemleider','lid','bezoeker','dirigent','pianist')),
  stemgroep TEXT CHECK(stemgroep IN ('S','A','T','B','Dirigent','Pianist') OR stemgroep IS NULL),
  status TEXT NOT NULL DEFAULT 'actief' CHECK(status IN ('actief','inactief','proeflid','uitgenodigd')),
  two_fa_enabled INTEGER NOT NULL DEFAULT 0,
  two_fa_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  google_id TEXT,
  is_bestuurslid INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users SELECT * FROM users_backup2;

DROP TABLE users_backup2;

PRAGMA foreign_keys=ON;
