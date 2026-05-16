-- 0074: Sorteervolgorde voor projecttaken
-- Doel: handmatige volgorde via pijltjes ▲▼ in de takenlijst
-- Backfill: huidige volgorde (oudste eerst) wordt 0, 1, 2, ... per project

ALTER TABLE concert_project_tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill bestaande rijen — kleinere sort_order = hoger in de lijst
UPDATE concert_project_tasks
SET sort_order = (
  SELECT COUNT(*) FROM concert_project_tasks t2
  WHERE t2.project_id = concert_project_tasks.project_id
    AND t2.id < concert_project_tasks.id
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_sort
  ON concert_project_tasks(project_id, sort_order);
