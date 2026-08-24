-- Columns that only exist in the non-replayable migrations but are read/written
-- by the current application code. Each line is a single, self-contained ALTER
-- applied tolerantly by setup-dev-db.sh (a "duplicate column" error is ignored),
-- so this file stays idempotent across re-runs.
-- Sources: 0002_finance_and_print, 0063_r2_storage_metadata,
-- 0042_feedback_enhanced_statuses, 0028/0031 karaoke.
ALTER TABLE photos ADD COLUMN r2_key TEXT;
ALTER TABLE photos ADD COLUMN content_type TEXT;
ALTER TABLE photos ADD COLUMN size_bytes INTEGER;
ALTER TABLE materials ADD COLUMN page_count INTEGER DEFAULT 0;
ALTER TABLE materials ADD COLUMN r2_key TEXT;
ALTER TABLE albums ADD COLUMN cover_r2_key TEXT;
ALTER TABLE events ADD COLUMN cover_r2_key TEXT;
ALTER TABLE karaoke_songs ADD COLUMN cover_url TEXT;
ALTER TABLE feedback ADD COLUMN screenshot TEXT;
ALTER TABLE feedback ADD COLUMN browser_info TEXT;
ALTER TABLE events ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN recurrence_rule TEXT;
ALTER TABLE events ADD COLUMN parent_event_id INTEGER;
ALTER TABLE events ADD COLUMN occurrence_date DATE;
ALTER TABLE profiles ADD COLUMN gemeente TEXT;
