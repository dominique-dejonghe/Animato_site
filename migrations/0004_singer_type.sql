-- Add singer type field to profiles
-- This allows members to indicate their singing experience level

ALTER TABLE profiles ADD COLUMN zanger_type TEXT DEFAULT 'amateur';
-- Options: amateur, semi-professioneel, professioneel, student
