-- Concert Projects Tables
CREATE TABLE IF NOT EXISTS concert_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  budget_inkomsten REAL DEFAULT 0,
  budget_uitgaven REAL DEFAULT 0,
  werkelijke_inkomsten REAL DEFAULT 0,
  werkelijke_uitgaven REAL DEFAULT 0,
  status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'in_uitvoering', 'afgerond', 'geannuleerd')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS concert_project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  deadline DATE,
  prioriteit TEXT DEFAULT 'medium' CHECK(prioriteit IN ('laag', 'medium', 'hoog', 'urgent')),
  verantwoordelijke_id INTEGER,
  status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'blocked', 'done')),
  notities TEXT,
  completed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES concert_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (verantwoordelijke_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS concert_budget_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('inkomst', 'uitgave')),
  categorie TEXT NOT NULL,
  omschrijving TEXT NOT NULL,
  verwacht_bedrag REAL NOT NULL,
  werkelijk_bedrag REAL DEFAULT 0,
  betaald BOOLEAN DEFAULT 0,
  betaaldatum DATE,
  notities TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES concert_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_concert_projects_event ON concert_projects(event_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON concert_project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_project ON concert_budget_items(project_id);
