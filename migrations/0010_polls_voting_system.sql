-- Polls & Voting System
-- Migration: 0010

-- Polls table (created by admin/dirigent)
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  beschrijving TEXT,
  type TEXT NOT NULL CHECK(type IN ('repertoire', 'datum', 'locatie', 'activiteit', 'bestuur', 'algemeen')),
  created_by INTEGER NOT NULL,
  doelgroep TEXT NOT NULL DEFAULT 'all' CHECK(doelgroep IN ('all', 'S', 'A', 'T', 'B', 'SATB', 'bestuur')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'gesloten', 'concept')),
  start_datum DATETIME,
  eind_datum DATETIME,
  max_stemmen INTEGER DEFAULT 1, -- Hoeveel opties mag je kiezen (1 = single choice, >1 = multiple choice)
  toon_resultaten TEXT NOT NULL DEFAULT 'after_vote' CHECK(toon_resultaten IN ('always', 'after_vote', 'after_close')),
  anoniem BOOLEAN DEFAULT 0, -- 0 = stemmen zijn zichtbaar voor admin, 1 = volledig anoniem
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Poll options (choices for a poll)
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  optie_tekst TEXT NOT NULL,
  optie_beschrijving TEXT,
  volgorde INTEGER DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

-- Poll votes (who voted for what)
CREATE TABLE IF NOT EXISTS poll_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(poll_id, option_id, user_id) -- Kan niet 2x op zelfde optie stemmen
);

-- Member proposals (voorstellen van leden)
CREATE TABLE IF NOT EXISTS member_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  beschrijving TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK(categorie IN ('repertoire', 'activiteit', 'verbetering', 'algemeen')),
  voorgesteld_door INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'in_voting')),
  reviewed_by INTEGER,
  review_opmerking TEXT,
  reviewed_at DATETIME,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (voorgesteld_door) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Proposal votes (upvote/downvote on proposals)
CREATE TABLE IF NOT EXISTS proposal_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES member_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(proposal_id, user_id) -- Kan maar 1x stemmen per voorstel
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status);
CREATE INDEX IF NOT EXISTS idx_polls_doelgroep ON polls(doelgroep);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON poll_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON member_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposal_votes_user ON proposal_votes(user_id);
