-- Prioriteit-kolom voor meeting_action_items
-- 1 = hoog, 2 = normaal, 3 = laag. Default 2 (normaal).
-- Sorteer-feature toegevoegd in /admin/meetings/:id?tab=actions
ALTER TABLE meeting_action_items ADD COLUMN prioriteit INTEGER NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_prioriteit ON meeting_action_items(prioriteit);
