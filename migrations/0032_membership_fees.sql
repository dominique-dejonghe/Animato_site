-- Migration: Enhance membership years with fees
-- Date: 2026-02-14
-- Description: Add fee configuration directly to membership years for snapshotting

-- ALTER TABLE membership_years ADD COLUMN fee_base DECIMAL(10,2) DEFAULT 0;
-- ALTER TABLE membership_years ADD COLUMN fee_full DECIMAL(10,2) DEFAULT 0; -- With paper/sheets
-- ALTER TABLE membership_years ADD COLUMN description TEXT;
