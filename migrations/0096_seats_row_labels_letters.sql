-- Migratie 0096: hernoem rij-labels naar concertzaal-conventie (A, B, C, ..., Z, AA, AB, ...)
-- ============================================================================
-- Context: de zaalplan-editor genereerde voorheen labels als "Rij 1", "Rij 2"...
-- Sinds de letter-update gebruikt de editor letters (A, B, ...). Plan 4 (Ter Dilft)
-- is al manueel met letters opgezet en wordt overgeslagen. Plan 1 (cc Binder) en
-- Plan 2 (GC De Nestel) krijgen nu een ruimtelijke A→Z mapping op basis van y-coordinaat
-- (van vooraan naar achteren), zodat de nummering ook logisch is voor zalen waar de
-- oude "Rij N" data niet meer in volgorde stond.
--
-- VEILIG: nul verkochte tickets op het moment van migratie (gecheckt 2026-06-13).
-- IDEMPOTENT: filter row_label LIKE 'Rij %' zorgt dat een tweede run niets meer doet.
-- ============================================================================

UPDATE seats
SET row_label = (
  WITH ranked AS (
    SELECT
      plan_id,
      row_label AS old_label,
      RANK() OVER (PARTITION BY plan_id ORDER BY MIN(y)) AS rnk
    FROM seats s2
    WHERE plan_id != 4 AND row_label LIKE 'Rij %'
    GROUP BY plan_id, row_label
  )
  SELECT
    CASE
      WHEN rnk <= 26 THEN CHAR(64 + rnk)
      WHEN rnk <= 26 + 26*26 THEN
        CHAR(64 + ((rnk - 27) / 26) + 1) || CHAR(64 + ((rnk - 27) % 26) + 1)
      ELSE 'Z' || CAST(rnk AS TEXT)
    END
  FROM ranked
  WHERE ranked.plan_id = seats.plan_id
    AND ranked.old_label = seats.row_label
)
WHERE plan_id != 4
  AND row_label LIKE 'Rij %';
