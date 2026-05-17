-- ============================================================
-- Migration 0075: Print requests — audit kolommen + vangnet
-- ============================================================
-- De tabel print_requests bestaat live in productie (D1) maar
-- zat tot nu toe niet in version control. Deze migration:
--   1) Garandeert dat de tabel bestaat (vangnet, no-op als die er al is)
--   2) Voegt audit kolommen toe: ready_at, completed_at, updated_at
--      zodat de Historiek-tab écht zinvol wordt (wanneer geprint?
--      wanneer overhandigd?)
-- ============================================================

-- 1. Vangnet: tabel-definitie zoals ze live staat
CREATE TABLE IF NOT EXISTS print_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  material_id INTEGER,
  work_id INTEGER,
  opmerking TEXT,
  status TEXT DEFAULT 'pending',     -- pending | ready | completed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  cost DECIMAL(10,2) DEFAULT 0,
  is_subscription_covered BOOLEAN DEFAULT 0,
  payment_status TEXT DEFAULT 'pending',  -- pending | paid | refunded
  mollie_payment_id TEXT
);

-- 2. Audit-kolommen — wanneer is de status veranderd?
-- SQLite-quirk: bij ALTER TABLE ADD COLUMN mag geen non-constant DEFAULT,
-- dus we zetten updated_at zonder default en backfillen daarna.
ALTER TABLE print_requests ADD COLUMN ready_at DATETIME;
ALTER TABLE print_requests ADD COLUMN completed_at DATETIME;
ALTER TABLE print_requests ADD COLUMN updated_at DATETIME;

-- Backfill: bestaande rijen krijgen updated_at = created_at
UPDATE print_requests SET updated_at = created_at WHERE updated_at IS NULL;

-- 3. Index voor de filter-queries (status is veel gebruikt in WHERE)
CREATE INDEX IF NOT EXISTS idx_print_requests_status ON print_requests(status);
CREATE INDEX IF NOT EXISTS idx_print_requests_user ON print_requests(user_id);
