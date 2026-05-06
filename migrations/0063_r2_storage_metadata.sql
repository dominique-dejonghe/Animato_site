-- R2 storage migratie: voeg kolommen toe om R2-keys te tracken zodat we
-- weten welke base64-kolommen vervangen zijn door R2-objecten.

-- photos: voeg r2_key toe (album foto's). 'url' kan ofwel een externe URL zijn,
-- ofwel /r2/<key> voor onze eigen bestanden.
ALTER TABLE photos ADD COLUMN r2_key TEXT;
ALTER TABLE photos ADD COLUMN content_type TEXT;
ALTER TABLE photos ADD COLUMN size_bytes INTEGER;

-- member_photos: zelfde verhaal voor profielfoto's
ALTER TABLE member_photos ADD COLUMN r2_key TEXT;

-- materials: nieuwe kolom om R2-uploads te onderscheiden van Drive-links
ALTER TABLE materials ADD COLUMN r2_key TEXT;

-- albums: cover_url kan nu naar /r2/<key> verwijzen
ALTER TABLE albums ADD COLUMN cover_r2_key TEXT;

-- events: cover_image kan nu naar /r2/<key> verwijzen
ALTER TABLE events ADD COLUMN cover_r2_key TEXT;

-- Index voor snelle reverse-lookups (bij delete van een R2-key)
CREATE INDEX IF NOT EXISTS idx_photos_r2_key ON photos(r2_key);
CREATE INDEX IF NOT EXISTS idx_member_photos_r2_key ON member_photos(r2_key);
CREATE INDEX IF NOT EXISTS idx_materials_r2_key ON materials(r2_key);
