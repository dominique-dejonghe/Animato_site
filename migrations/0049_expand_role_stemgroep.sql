-- Expand role and stemgroep CHECK constraints to include 'dirigent' and 'pianist'
-- SQLite doesn't support ALTER CHECK, so we recreate the table

-- Step 1: Create new table with expanded constraints
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'lid' CHECK(role IN ('admin', 'moderator', 'stemleider', 'lid', 'bezoeker', 'dirigent', 'pianist')),
  stemgroep TEXT CHECK(stemgroep IN ('S', 'A', 'T', 'B') OR stemgroep IS NULL),
  status TEXT NOT NULL DEFAULT 'actief' CHECK(status IN ('actief', 'inactief', 'proeflid', 'uitgenodigd')),
  two_fa_enabled INTEGER NOT NULL DEFAULT 0,
  two_fa_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  google_id TEXT,
  is_bestuurslid INTEGER NOT NULL DEFAULT 0
);

-- Step 2: Copy data
INSERT INTO users_new SELECT * FROM users;

-- Step 3: Drop old table
DROP TABLE users;

-- Step 4: Rename new table
ALTER TABLE users_new RENAME TO users;

-- Step 5: Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
