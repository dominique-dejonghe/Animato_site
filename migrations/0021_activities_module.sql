-- Migration: Activities & Invitations Module
-- Date: 2026-02-07

-- 1. Activities (Extends events with registration logic)
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  price_member DECIMAL(10,2) DEFAULT 0.00,
  price_guest DECIMAL(10,2) DEFAULT 0.00,
  deadline DATETIME,
  max_guests INTEGER DEFAULT 0, -- 0 = member only, 1 = partner, 99 = unlimited
  intro_text TEXT, -- Text shown in invitation email/page
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- 2. Activity Registrations (RSVP)
CREATE TABLE IF NOT EXISTS activity_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  guest_count INTEGER DEFAULT 0, -- 0 means member comes alone
  dietary_requirements TEXT,
  amount DECIMAL(10,2) DEFAULT 0.00,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'confirmed', 'cancelled')),
  mollie_payment_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id) -- One registration per user per activity
);

-- Update events table if needed (adding 'activiteit' to types is implicit in logic, no schema change needed if type is text)
