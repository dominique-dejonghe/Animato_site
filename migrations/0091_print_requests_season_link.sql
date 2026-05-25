-- =====================================================
-- Migration 0091 — Koppeling print_requests ↔ seizoen
-- =====================================================
-- Context: Full-leden (€50 lidgeld) krijgen automatisch alle papieren
-- partituren voor het seizoen. Tot nu toe was er geen expliciete link
-- tussen een print_request en het seizoen waar het bij hoort.
--
-- Met deze kolom kunnen we:
--   - per seizoen filteren (welke distributies voor 2026-2027?)
--   - per lid zien hoeveel van het seizoen-pakket al geleverd is
--   - bulk-operaties uitvoeren ("markeer hele pakket voor lid X als geleverd")
--   - statistieken bouwen ("X% van de Full-leden heeft hun pakket compleet")
--
-- NULL = legacy data van vóór deze migratie (geen seizoen toegekend).
-- Voor nieuwe distributies vult de code dit veld altijd in.

ALTER TABLE print_requests ADD COLUMN season_id INTEGER REFERENCES membership_years(id);

-- Index voor snel filteren per seizoen
CREATE INDEX IF NOT EXISTS idx_print_requests_season_id ON print_requests(season_id);

-- Combined index voor de meest voorkomende query:
-- "alle prints van lid X voor seizoen Y"
CREATE INDEX IF NOT EXISTS idx_print_requests_user_season ON print_requests(user_id, season_id);
