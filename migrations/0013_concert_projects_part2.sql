-- Meeting Management Tables
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  type TEXT DEFAULT 'bestuur' CHECK(type IN ('bestuur', 'algemeen', 'sectie', 'commissie')),
  datum DATE NOT NULL,
  start_tijd TEXT,
  eind_tijd TEXT,
  locatie TEXT,
  locatie_id INTEGER,
  status TEXT DEFAULT 'gepland' CHECK(status IN ('gepland', 'bezig', 'afgerond', 'geannuleerd')),
  organisator_id INTEGER,
  notulist_id INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (locatie_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (organisator_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (notulist_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'uitgenodigd' CHECK(status IN ('uitgenodigd', 'aanwezig', 'afwezig', 'geexcuseerd')),
  notitie TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  duur_minuten INTEGER,
  volgorde INTEGER NOT NULL,
  presentator_id INTEGER,
  type TEXT DEFAULT 'bespreking' CHECK(type IN ('bespreking', 'beslissing', 'informatie', 'brainstorm')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (presentator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL UNIQUE,
  aanwezigen TEXT,
  afwezigen TEXT,
  notulen TEXT NOT NULL,
  goedgekeurd BOOLEAN DEFAULT 0,
  goedgekeurd_op DATETIME,
  goedgekeurd_door INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (goedgekeurd_door) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  verantwoordelijke_id INTEGER NOT NULL,
  deadline DATE,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'cancelled')),
  completed_at DATETIME,
  follow_up_meeting_id INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (verantwoordelijke_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (follow_up_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_datum ON meetings(datum);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON meeting_agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_responsible ON meeting_action_items(verantwoordelijke_id);
