-- Migration 0071: Historische snapshots van koor-demografie
-- =============================================================
-- Maandelijkse momentopname van leeftijds-statistieken zodat we
-- evolutie kunnen tonen (gem. leeftijd, aantal per stemgroep, ...).
--
-- Snapshots worden lazy gemaakt bij bezoek aan /admin/leeftijden
-- (als laatste snapshot ouder is dan 25 dagen). Geen aparte cron nodig.
--
-- Eén rij per snapshot_date. We bewaren JSON met de volledige breakdown
-- zodat we later vrij kunnen rapporteren zonder het schema te wijzigen.

CREATE TABLE IF NOT EXISTS member_stats_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,         -- YYYY-MM-DD
  total_active INTEGER NOT NULL,              -- totaal actieve leden
  with_dob INTEGER NOT NULL,                  -- met geboortedatum gevuld
  avg_age REAL,                               -- gemiddelde leeftijd
  min_age INTEGER,
  max_age INTEGER,
  female_count INTEGER NOT NULL DEFAULT 0,    -- S + A
  male_count INTEGER NOT NULL DEFAULT 0,      -- T + B
  female_avg REAL,
  male_avg REAL,
  -- Volledige breakdown per stemgroep + leeftijdsbuckets
  -- {"S":{"n":25,"avg":54.5},"A":{...},"T":{...},"B":{...},"buckets":{"u30":5,"d30":3,...}}
  details_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_stats_date ON member_stats_snapshots(snapshot_date DESC);
