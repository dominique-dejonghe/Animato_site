-- =====================================================
-- Migration 0113: Task ↔ Budget alignment (Option A)
-- =====================================================
-- Voegt drie kolommen toe aan concert_project_tasks EN meeting_action_items:
--   budget_impact_type  ('inkomst' | 'uitgave' | NULL)
--   budget_bedrag       (REAL, bedrag in EUR)
--   budget_item_id      (FK → concert_budget_items(id), gezet zodra we auto-syncen)
--
-- Op form-save wordt een gekoppeld budget_item aangemaakt/bijgewerkt als
-- budget_impact_type + budget_bedrag zijn ingevuld. De sync-logica leeft in
-- de route-handlers (Cloudflare Workers heeft geen triggers).
--
-- Voor meeting_action_items geldt: enkel te gebruiken als de bijhorende
-- vergadering aan een concert-project gekoppeld is (UI toont anders 'grijs').

-- Project-taken
ALTER TABLE concert_project_tasks ADD COLUMN budget_impact_type TEXT
  CHECK (budget_impact_type IN ('inkomst','uitgave'));
ALTER TABLE concert_project_tasks ADD COLUMN budget_bedrag REAL;
ALTER TABLE concert_project_tasks ADD COLUMN budget_item_id INTEGER
  REFERENCES concert_budget_items(id) ON DELETE SET NULL;

-- Meeting-actiepunten
ALTER TABLE meeting_action_items ADD COLUMN budget_impact_type TEXT
  CHECK (budget_impact_type IN ('inkomst','uitgave'));
ALTER TABLE meeting_action_items ADD COLUMN budget_bedrag REAL;
ALTER TABLE meeting_action_items ADD COLUMN budget_item_id INTEGER
  REFERENCES concert_budget_items(id) ON DELETE SET NULL;

-- Indexes zodat we vanuit de budgetlijst snel terug naar de bron kunnen navigeren.
CREATE INDEX IF NOT EXISTS idx_project_tasks_budget_item
  ON concert_project_tasks(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_action_items_budget_item
  ON meeting_action_items(budget_item_id);
