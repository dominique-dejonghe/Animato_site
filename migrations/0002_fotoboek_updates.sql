-- Update fotoboek schema voor beter admin management
-- Version: 1.1
-- Date: 2025-11-14

-- Add datum field to albums
ALTER TABLE albums ADD COLUMN datum DATE;

-- Add created_by field to albums
ALTER TABLE albums ADD COLUMN created_by INTEGER REFERENCES users(id);

-- Add fotograaf field to photos (friendly name instead of just upload_door)
ALTER TABLE photos ADD COLUMN fotograaf TEXT;
