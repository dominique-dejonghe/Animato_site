-- Add comment column to proposal_votes (#65)
-- Allows users to leave a comment when voting on proposals
ALTER TABLE proposal_votes ADD COLUMN comment TEXT;
