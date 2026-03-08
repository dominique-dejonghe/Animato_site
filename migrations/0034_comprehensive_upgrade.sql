-- Migration: Comprehensive Upgrade (Seating, CRM, Finance, Comms)
-- Date: 2026-03-01

-- =====================================================
-- 1. SEATING PLANS & TICKETING V2
-- =====================================================

-- Zaalplannen (Layouts)
CREATE TABLE IF NOT EXISTS seating_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  width INTEGER DEFAULT 800, -- Canvas width
  height INTEGER DEFAULT 600, -- Canvas height
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Stoelen / Zones
CREATE TABLE IF NOT EXISTS seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  section_name TEXT, -- 'Parterre', 'Balkon', etc.
  row_label TEXT, -- 'Rij 1', 'A', etc.
  seat_number TEXT, -- '1', '2', etc.
  x INTEGER NOT NULL, -- X coordinate on canvas
  y INTEGER NOT NULL, -- Y coordinate on canvas
  type TEXT DEFAULT 'standard' CHECK(type IN ('standard', 'wheelchair', 'companion', 'restricted_view')),
  status TEXT DEFAULT 'available' CHECK(status IN ('available', 'blocked', 'reserved')),
  category_id INTEGER, -- Link to price category if specific
  FOREIGN KEY (plan_id) REFERENCES seating_plans(id) ON DELETE CASCADE
);

-- Link Concert to Seating Plan
ALTER TABLE concerts ADD COLUMN seating_plan_id INTEGER REFERENCES seating_plans(id);

-- Ticket - Seat Link (Many-to-Many not needed if 1 ticket = 1 seat, but kept flexible)
CREATE TABLE IF NOT EXISTS ticket_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  seat_id INTEGER NOT NULL,
  concert_id INTEGER NOT NULL, -- Denormalized for easier querying
  status TEXT DEFAULT 'locked' CHECK(status IN ('locked', 'sold', 'released')),
  locked_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- For temporary holds during checkout
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (seat_id) REFERENCES seats(id),
  FOREIGN KEY (concert_id) REFERENCES concerts(id),
  UNIQUE(seat_id, concert_id) -- A seat can only be sold once per concert
);

-- =====================================================
-- 2. CRM & RELATIONS
-- =====================================================

-- Relatie Tags/Types
CREATE TABLE IF NOT EXISTS user_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('lid', 'sympathisant', 'vrijwilliger', 'sponsor', 'oud_lid', 'erelid')),
  notes TEXT,
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- 3. FINANCE & DONATIONS
-- =====================================================

-- Donation Campaigns (e.g., "Vrienden van Animato")
CREATE TABLE IF NOT EXISTS donation_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  goal_amount REAL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Donations
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, -- Optional (can be anonymous)
  campaign_id INTEGER,
  amount REAL NOT NULL,
  message TEXT,
  is_anonymous BOOLEAN DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled')),
  payment_provider TEXT,
  payment_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES donation_campaigns(id) ON DELETE SET NULL
);

-- Update Membership Fees logic
-- We'll use a new table to define fee structures per season
CREATE TABLE IF NOT EXISTS membership_fee_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT NOT NULL, -- '2025-2026'
  title TEXT NOT NULL, -- 'Standaard', 'Sociaal Tarief', 'Steunend Lid'
  amount REAL NOT NULL,
  description TEXT,
  allow_extra_donation BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 4. COMMUNICATIONS
-- =====================================================

-- Message Templates
CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, -- Internal name
  subject TEXT, -- Email subject
  body TEXT NOT NULL, -- Markdown/HTML content
  category TEXT DEFAULT 'general' CHECK(category IN ('general', 'payment', 'event', 'reminder')),
  variables TEXT, -- JSON array of available variables e.g. ["{{naam}}", "{{bedrag}}"]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notification Subscriptions (Target Groups)
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'nieuws', 'concerten', 'materiaal_sopraan', etc.
  channel TEXT DEFAULT 'email' CHECK(channel IN ('email', 'push')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, type, channel)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seats_plan ON seats(plan_id);
CREATE INDEX IF NOT EXISTS idx_ticket_seats_concert ON ticket_seats(concert_id);
CREATE INDEX IF NOT EXISTS idx_user_relations_type ON user_relations(type);
CREATE INDEX IF NOT EXISTS idx_donations_campaign ON donations(campaign_id);
