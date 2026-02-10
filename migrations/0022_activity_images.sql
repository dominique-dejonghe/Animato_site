-- Migration: Add image_url to activities
-- Date: 2026-02-07

ALTER TABLE activities ADD COLUMN image_url TEXT;
