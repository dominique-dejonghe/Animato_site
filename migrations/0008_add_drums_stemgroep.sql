-- Migration: Add 'drums' to materials.stem CHECK constraint
-- SQLite doesn't support ALTER for CHECK constraints, so we need to recreate the table

-- Step 1: Create new table with updated constraint
CREATE TABLE materials_new (
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

-- Step 2: Copy all data from old table to new table
INSERT INTO materials_new 
SELECT * FROM materials;

-- Step 3: Drop old table
DROP TABLE materials;

-- Step 4: Rename new table to original name
ALTER TABLE materials_new RENAME TO materials;

-- Step 5: Recreate indexes if any existed
-- (None needed based on current schema)
