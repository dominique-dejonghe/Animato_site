-- =====================================================================
-- Local development schema patch
-- =====================================================================
-- The migrations under migrations/ cannot be replayed from an empty
-- database in a single linear order: a number of early "feature" files
-- (e.g. 0002_finance_and_print, 0046_photos_storage, 0063_r2_storage_metadata,
-- 0064_member_photos_data_nullable) were authored against a database that
-- already contained tables/columns created by higher-numbered migrations,
-- and several later files supersede them. scripts/setup-dev-db.sh applies the
-- replayable subset listed in scripts/dev-migration-order.txt; this file then
-- creates the handful of objects that only exist in the non-replayable
-- migrations but are still referenced by the current application code.
--
-- Every statement is written to be idempotent (CREATE TABLE IF NOT EXISTS).
-- The ADD COLUMN statements are applied individually and tolerantly by
-- setup-dev-db.sh (a duplicate-column error is ignored), so they are kept in
-- a separate section below.

-- --- Missing tables --------------------------------------------------

-- Membership seasons (source: 0002_finance_and_print.sql). fee_base / fee_full
-- were left commented-out in 0032_membership_fees.sql but are read by the
-- finance/lidgeld code, so they are included here.
CREATE TABLE IF NOT EXISTS membership_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT UNIQUE NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT 0,
  fee_base DECIMAL(10,2) DEFAULT 0,
  fee_full DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO membership_years (season, start_date, end_date, is_active, fee_base, fee_full)
VALUES ('2025-2026', '2025-09-01', '2026-08-31', 1, 25.00, 65.00);

-- Per-user membership records (source: 0002_finance_and_print.sql).
CREATE TABLE IF NOT EXISTS user_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  year_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('basis', 'full')),
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

-- Profile photos, final shape (source: 0064_member_photos_data_nullable.sql,
-- which is a rebuild of the original table and includes the r2_key column
-- added in 0063_r2_storage_metadata.sql).
CREATE TABLE IF NOT EXISTS member_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  data TEXT,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  r2_key TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_member_photos_r2_key ON member_photos(r2_key);

-- New-member announcement tracking (source: 0083_new_member_announcements.sql).
-- Only the table definition is reproduced; the migration's id-specific backfill
-- is intentionally omitted.
CREATE TABLE IF NOT EXISTS member_announcement_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer_user_id INTEGER NOT NULL,
  new_member_user_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(viewer_user_id, new_member_user_id),
  FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (new_member_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_member_announcement_viewer ON member_announcement_seen(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_member_announcement_new_member ON member_announcement_seen(new_member_user_id);
