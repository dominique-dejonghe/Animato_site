-- Add smoelenboek (member directory) fields to profiles
-- Version: 1.2
-- Date: 2025-11-14

-- Musical preferences for smoelenboek
ALTER TABLE profiles ADD COLUMN favoriete_genre TEXT;
ALTER TABLE profiles ADD COLUMN favoriete_componist TEXT;
ALTER TABLE profiles ADD COLUMN favoriete_werk TEXT;
ALTER TABLE profiles ADD COLUMN jaren_in_koor INTEGER;

-- Social/contact preferences
ALTER TABLE profiles ADD COLUMN website_url TEXT;
ALTER TABLE profiles ADD COLUMN linkedin_url TEXT;

-- Privacy settings
ALTER TABLE profiles ADD COLUMN smoelenboek_zichtbaar INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN toon_telefoon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN toon_email INTEGER NOT NULL DEFAULT 1;
