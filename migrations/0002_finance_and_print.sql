-- Migration: Finance and Print Logic
-- Date: 2026-02-07

-- 1. System Settings (Global configuration like prices)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default pricing values
INSERT OR IGNORE INTO system_settings (key, value, description) VALUES 
  ('membership_fee_base', '25.00', 'Basis lidgeld per jaar'),
  ('membership_fee_paper', '40.00', 'Toeslag voor papieren partituren abonnement'),
  ('price_per_page', '0.15', 'Prijs per geprinte pagina voor losse bestellingen'),
  ('current_season', '2025-2026', 'Huidig koorseizoen');

-- 2. Membership Years (Seasons)
CREATE TABLE IF NOT EXISTS membership_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT UNIQUE NOT NULL, -- e.g., "2025-2026"
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO membership_years (season, is_active) VALUES ('2025-2026', 1);

-- 3. User Memberships (Links User to Year and Plan)
CREATE TABLE IF NOT EXISTS user_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  year_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('basis', 'full')), -- 'basis' = €25, 'full' = €65
  amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  mollie_payment_id TEXT,
  mollie_payment_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (year_id) REFERENCES membership_years(id),
  UNIQUE(user_id, year_id)
);

-- 4. Update Materials table to include page count
-- SQLite doesn't support IF NOT EXISTS for columns, so we try adding it.
-- If it fails (already exists), the script continues.
ALTER TABLE materials ADD COLUMN page_count INTEGER DEFAULT 0;

-- 5. Update Print Requests table for financial tracking
ALTER TABLE print_requests ADD COLUMN cost DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE print_requests ADD COLUMN is_subscription_covered BOOLEAN DEFAULT 0; -- True if user has 'full' membership
ALTER TABLE print_requests ADD COLUMN payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'free')); -- 'free' for subscription items
ALTER TABLE print_requests ADD COLUMN mollie_payment_id TEXT;
