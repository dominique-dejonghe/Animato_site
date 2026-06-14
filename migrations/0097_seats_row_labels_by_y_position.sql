-- Migratie 0097: hertoewijs row_label op basis van échte y-positie (i.p.v. oude label)
-- ============================================================================
-- Context: migratie 0096 verkletterde de boel voor plan 1 en plan 2 omdat ze
-- partitioneerde op het oude row_label. Voor plannen waar het oude label al
-- vervuild was (één label over meerdere y-coördinaten, of rijen zonder label),
-- bleef die vervuiling bewaard onder een nieuwe letter.
--
-- Voorbeeld plan 1 (cc Binder) NA migratie 0096:
--   row_label='A'  → 115 stoelen verspreid over y=40..700 (héle zaal!)
--   row_label='B'  → 52 stoelen verspreid over y=140..420
--   row_label='C'  → 26 stoelen op y=180 (klopt)
--   ...rij F mist, rij H,I,J,K,L kloppen
--
-- Deze migratie wist het oude row_label en herberekent het op basis van de
-- werkelijke y-positie. Stoelen op dezelfde y zitten in dezelfde fysieke rij,
-- en krijgen samen één letter. Rangschikking vooraan-naar-achteren (kleinste y
-- eerst → A).
--
-- VEILIG: row_label-wijzigingen hebben geen impact op seat_id (primary key).
-- ticket_seats blijft daardoor 100% gekoppeld aan dezelfde fysieke stoel.
-- De 19 bestaande paid ticket_seats (2 echte kopers) behouden hun seat-binding,
-- ze zien straks gewoon een ander rij-letter — wat sowieso correcter is.
--
-- Plan 4 (Ter Dilft) blijft ongemoeid: dat plan heeft 200 unieke y-waardes en
-- is handmatig met letters opgezet. SQL-detectie: COUNT(DISTINCT y) > 50.
--
-- IDEMPOTENT: deze migratie kan veilig overnieuw lopen want hij is gewoon een
-- y-positie-based UPDATE. Geen filter op "Rij %" meer nodig.
-- ============================================================================

UPDATE seats
SET row_label = (
  WITH plan_rows AS (
    -- Per (plan_id, y) → rang in volgorde van y oplopend. Eén unieke y = één rij.
    -- DENSE_RANK i.p.v. RANK zodat opeenvolgende y's opeenvolgende letters krijgen.
    SELECT
      plan_id,
      y AS row_y,
      DENSE_RANK() OVER (PARTITION BY plan_id ORDER BY y) AS rnk
    FROM seats
    GROUP BY plan_id, y
  )
  SELECT
    CASE
      WHEN rnk <= 26 THEN CHAR(64 + rnk)
      WHEN rnk <= 26 + 26*26 THEN
        CHAR(64 + ((rnk - 27) / 26) + 1) || CHAR(64 + ((rnk - 27) % 26) + 1)
      ELSE 'Z' || CAST(rnk AS TEXT)
    END
  FROM plan_rows
  WHERE plan_rows.plan_id = seats.plan_id
    AND plan_rows.row_y = seats.y
)
WHERE plan_id IN (
  -- Alleen plannen met een 'redelijk grid'-structuur. Plan 4 (Ter Dilft) heeft
  -- 200 unieke y-waardes en is handmatig opgezet → niet aanraken.
  SELECT plan_id
  FROM seats
  GROUP BY plan_id
  HAVING COUNT(DISTINCT y) <= 50
);
