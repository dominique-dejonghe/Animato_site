-- Migration: Make event_id optional in concert_projects
-- Projects can now exist without being linked to a concert/event
-- Examples: "Organisatie Busreis", "Ledenwerving 2026", "Nieuwe Uniformen"

-- SQLite doesn't support ALTER COLUMN, so we recreate the table
-- Step 1: Create new table with nullable event_id
CREATE TABLE IF NOT EXISTS concert_projects_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER, -- Now NULLABLE - standalone projects allowed
  titel TEXT NOT NULL,
  beschrijving TEXT,
  categorie TEXT DEFAULT 'algemeen' CHECK(categorie IN ('concert', 'evenement', 'organisatie', 'financieel', 'communicatie', 'materiaal', 'algemeen')),
  
  -- Budget tracking
  budget_inkomsten REAL DEFAULT 0,
  budget_uitgaven REAL DEFAULT 0,
  werkelijke_inkomsten REAL DEFAULT 0,
  werkelijke_uitgaven REAL DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'in_uitvoering', 'afgerond', 'geannuleerd')),
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Step 2: Copy data from old table
INSERT INTO concert_projects_new (id, event_id, titel, beschrijving, categorie, budget_inkomsten, budget_uitgaven, werkelijke_inkomsten, werkelijke_uitgaven, status, created_at, updated_at)
SELECT id, event_id, titel, beschrijving, 'concert', budget_inkomsten, budget_uitgaven, werkelijke_inkomsten, werkelijke_uitgaven, status, created_at, updated_at
FROM concert_projects;

-- Step 3: Drop old table
DROP TABLE IF EXISTS concert_projects;

-- Step 4: Rename new table
ALTER TABLE concert_projects_new RENAME TO concert_projects;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_concert_projects_event ON concert_projects(event_id);
CREATE INDEX IF NOT EXISTS idx_concert_projects_status ON concert_projects(status);
CREATE INDEX IF NOT EXISTS idx_concert_projects_categorie ON concert_projects(categorie);
