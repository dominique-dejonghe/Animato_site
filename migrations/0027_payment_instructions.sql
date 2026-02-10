-- Migration: Add payment_instruction to activities
ALTER TABLE activities ADD COLUMN payment_instruction TEXT;
