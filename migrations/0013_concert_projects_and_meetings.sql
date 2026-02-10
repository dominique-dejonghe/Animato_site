-- Concert Project Management & Meeting Management
-- Version: 0013
-- Date: 2025-12-06
-- Purpose: Concert project planning (tasks, budgets) + Board meeting management (agenda, minutes, action items)

-- =====================================================
-- CONCERT PROJECTS
-- =====================================================

-- Projects zijn gekoppeld aan events (type = 'concert')
-- Elke concert kan een project hebben met taken, budget, en documenten
CREATE TABLE IF NOT EXISTS concert_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE, -- One project per concert
  titel TEXT NOT NULL,
  beschrijving TEXT,
  
  -- Budget tracking
  budget_inkomsten REAL DEFAULT 0, -- Verwachte inkomsten (tickets, sponsors)
  budget_uitgaven REAL DEFAULT 0, -- Verwachte uitgaven (zaal, catering, etc.)
  werkelijke_inkomsten REAL DEFAULT 0,
  werkelijke_uitgaven REAL DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'in_uitvoering', 'afgerond', 'geannuleerd')),
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Project tasks (taken voor het concert)
CREATE TABLE IF NOT EXISTS concert_project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- Task info
  titel TEXT NOT NULL,
  beschrijving TEXT,
  deadline DATE,
  prioriteit TEXT DEFAULT 'medium' CHECK(prioriteit IN ('laag', 'medium', 'hoog', 'urgent')),
  
  -- Assignment
  verantwoordelijke_id INTEGER, -- User ID
  status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'blocked', 'done')),
  
  -- Progress
  notities TEXT,
  completed_at DATETIME,
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES concert_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (verantwoordelijke_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Budget items (inkomsten/uitgaven voor concert)
CREATE TABLE IF NOT EXISTS concert_budget_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- Budget info
  type TEXT NOT NULL CHECK(type IN ('inkomst', 'uitgave')),
  categorie TEXT NOT NULL, -- 'tickets', 'sponsors', 'zaalverhuur', 'catering', 'marketing', etc.
  omschrijving TEXT NOT NULL,
  
  -- Bedragen
  verwacht_bedrag REAL NOT NULL,
  werkelijk_bedrag REAL DEFAULT 0,
  betaald BOOLEAN DEFAULT 0,
  betaaldatum DATE,
  
  -- Metadata
  notities TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES concert_projects(id) ON DELETE CASCADE
);

-- Project documents (contracten, facturen, etc.)
CREATE TABLE IF NOT EXISTS concert_project_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- Document info
  titel TEXT NOT NULL,
  type TEXT, -- 'contract', 'factuur', 'offerte', 'rapport', 'ander'
  url TEXT NOT NULL, -- URL or base64 data URL
  bestandsnaam TEXT,
  grootte_bytes INTEGER,
  
  -- Upload info
  upload_door INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES concert_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id) ON DELETE SET NULL
);

-- =====================================================
-- VERGADERINGEN (MEETINGS)
-- =====================================================

-- Meetings (bestuursvergaderingen, algemene ledenvergaderingen, etc.)
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Meeting info
  titel TEXT NOT NULL, -- 'Bestuursvergadering December 2025'
  type TEXT DEFAULT 'bestuur' CHECK(type IN ('bestuur', 'algemeen', 'sectie', 'commissie')),
  datum DATE NOT NULL,
  start_tijd TEXT, -- '19:00'
  eind_tijd TEXT, -- '21:30'
  
  -- Location
  locatie TEXT,
  locatie_id INTEGER, -- Link to locations table if using managed location
  
  -- Status
  status TEXT DEFAULT 'gepland' CHECK(status IN ('gepland', 'bezig', 'afgerond', 'geannuleerd')),
  
  -- Participants
  organisator_id INTEGER, -- Who scheduled it
  notulist_id INTEGER, -- Who takes notes
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (locatie_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (organisator_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (notulist_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Meeting participants (wie komt er?)
CREATE TABLE IF NOT EXISTS meeting_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  
  -- RSVP
  status TEXT DEFAULT 'uitgenodigd' CHECK(status IN ('uitgenodigd', 'aanwezig', 'afwezig', 'geexcuseerd')),
  notitie TEXT, -- Reason if absent
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(meeting_id, user_id)
);

-- Agenda items (gespreksonderwerpen)
CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  
  -- Agenda item
  titel TEXT NOT NULL,
  beschrijving TEXT,
  duur_minuten INTEGER, -- Verwachte duur
  volgorde INTEGER NOT NULL, -- Order in agenda
  
  -- Owner
  presentator_id INTEGER, -- Who presents this item
  
  -- Related items
  type TEXT DEFAULT 'bespreking' CHECK(type IN ('bespreking', 'beslissing', 'informatie', 'brainstorm')),
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (presentator_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Meeting minutes (notulen)
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL UNIQUE, -- One minutes doc per meeting
  
  -- Content
  aanwezigen TEXT, -- Comma-separated names or JSON
  afwezigen TEXT,
  
  -- Notes per agenda item (stored as JSON or simple text)
  notulen TEXT NOT NULL, -- Main minutes content (could be HTML)
  
  -- Approval
  goedgekeurd BOOLEAN DEFAULT 0,
  goedgekeurd_op DATETIME,
  goedgekeurd_door INTEGER,
  
  -- Metadata
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (goedgekeurd_door) REFERENCES users(id) ON DELETE SET NULL
);

-- Action items (actiepunten)
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  
  -- Action info
  titel TEXT NOT NULL,
  beschrijving TEXT,
  verantwoordelijke_id INTEGER NOT NULL, -- Who is responsible
  deadline DATE,
  
  -- Status
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'cancelled')),
  completed_at DATETIME,
  
  -- Follow-up
  follow_up_meeting_id INTEGER, -- Check status in next meeting
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (verantwoordelijke_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (follow_up_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

-- Meeting documents (bijlagen)
CREATE TABLE IF NOT EXISTS meeting_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  
  -- Document info
  titel TEXT NOT NULL,
  type TEXT, -- 'agenda', 'notulen', 'presentatie', 'rapport', 'ander'
  url TEXT NOT NULL,
  bestandsnaam TEXT,
  grootte_bytes INTEGER,
  
  -- Upload info
  upload_door INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_door) REFERENCES users(id) ON DELETE SET NULL
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Concert Projects
CREATE INDEX IF NOT EXISTS idx_concert_projects_event ON concert_projects(event_id);
CREATE INDEX IF NOT EXISTS idx_concert_projects_status ON concert_projects(status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON concert_project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_responsible ON concert_project_tasks(verantwoordelijke_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON concert_project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_deadline ON concert_project_tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_budget_items_project ON concert_budget_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_docs_project ON concert_project_documents(project_id);

-- Meetings
CREATE INDEX IF NOT EXISTS idx_meetings_datum ON meetings(datum);
CREATE INDEX IF NOT EXISTS idx_meetings_type ON meetings(type);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON meeting_agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting ON meeting_minutes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_responsible ON meeting_action_items(verantwoordelijke_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON meeting_action_items(status);
CREATE INDEX IF NOT EXISTS idx_meeting_docs_meeting ON meeting_documents(meeting_id);
