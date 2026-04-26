-- #feedback-mijn-tickets: voeg assigned_to kolom toe aan feedback tabel
-- Een feedback-ticket kan toegewezen worden aan een admin (zowel handmatig als automatisch).
-- Dit maakt het mogelijk om in /admin/feedback te filteren op "mijn tickets" of "mijn hertesten".

ALTER TABLE feedback ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_assigned_to ON feedback(assigned_to);
