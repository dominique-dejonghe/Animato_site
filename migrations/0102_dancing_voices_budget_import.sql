-- Import Dancing Voices begroting uit Excel "Animato Concert Planning en Begroting Oktober 2026.xlsx"
-- Bestaande items in concert_budget_items (project_id=1) worden niet gedupliceerd.
-- Leveranciersinfo (telefoon/email) gaat tijdelijk in 'notities' tot we een
-- echte leveranciers-tabel hebben (zie roadmap).

-- ============================================================
-- 1) Update bestaande kaartverkoop van €7200 → €7800 (390×€20)
-- ============================================================
UPDATE concert_budget_items
SET verwacht_bedrag = 7800,
    notities = COALESCE(notities, '') ||
               CASE WHEN COALESCE(notities,'') = '' THEN '' ELSE x'0a' END ||
               'Excel-import 2026-06-23: 390 verwachte bezoekers × €20 ticketprijs. Werkelijke verkoop wordt live uit Mollie/tickets-tabel getoond op dashboard.'
WHERE project_id = 1 AND type = 'inkomst' AND omschrijving = 'Kaartverkoop';

-- ============================================================
-- 2) Verrijk Huur locatie CC Binder met zaalsplitsing
-- ============================================================
UPDATE concert_budget_items
SET notities = COALESCE(notities, '') ||
               CASE WHEN COALESCE(notities,'') = '' THEN '' ELSE x'0a' END ||
               'Excel-onderverdeling: Hoofdzaal Kollebloem €510 + Cadans €60 + Spil €150 + extra/verzekering €550. Totaal €1270.'
WHERE project_id = 1 AND type = 'uitgave' AND omschrijving = 'Huur locatie CC Binder';

-- ============================================================
-- 3) Inkomsten: nieuwe items
-- ============================================================
INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'inkomst', 'Donaties', 'Vrije giften aan de inkom', 250.00, 0, 0,
       'Excel-import: 50 schenkers × €5 (gemiddelde gift). Vrijblijvend bij binnenkomen.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items
  WHERE project_id = 1 AND type = 'inkomst' AND LOWER(omschrijving) IN ('donaties','vrije giften','vrije giften aan de inkom')
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'inkomst', 'Bar', 'Bar-inkomsten (omzet)', 1250.00, 0, 0,
       'Excel-import: 250 actieve consumenten × €5 gemiddelde baromzet/bezoeker.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items
  WHERE project_id = 1 AND type = 'inkomst' AND LOWER(omschrijving) LIKE '%baromzet%'
);

-- ============================================================
-- 4) Uitgaven: nieuwe items (met leveranciers-notitie placeholders)
-- ============================================================
INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Gastoptredens & Specialisten', 'Dirigent', 250.00, 0, 0,
       'Excel-import: gastdirigent voor Dancing Voices.
Leveranciersinfo (placeholder — vul aan):
  Naam: —
  Telefoon: —
  E-mail: —
  Status: nog te bevestigen'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) = 'dirigent'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Gastoptredens & Specialisten', 'Pianist', 250.00, 0, 0,
       'Excel-import: gastpianist voor Dancing Voices.
Leveranciersinfo (placeholder):
  Naam: —
  Telefoon: —
  E-mail: —
  Status: nog te bevestigen'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) = 'pianist'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Geluid & Video', 'Geluidssysteem', 0, 0, 0,
       'Excel-import: budget nog niet ingevuld.
Contactpersonen Excel-tab "Taken":
  Jarrich Deweer 0491/86 29 71
  Ruben Huygens 0490/56 95 33
  Status: BEZIG'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) LIKE '%geluidssysteem%'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Bar Setup', 'Drank-aankoop', 1000.00, 0, 0,
       'Excel-import: drank-aankoop voor de bar tijdens het concert.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) = 'drank-aankoop'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Bar Setup', 'Barpersoneel — Chiromeisjes', 250.00, 0, 0,
       'Excel-import: vergoeding/donatie voor Chiromeisjes die de bar bemannen.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) LIKE '%chiromeisjes%'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Overige Kosten', 'Bloemen', 300.00, 0, 0,
       'Excel-import: bloemstukken voor dirigent/solisten/zaal.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) = 'bloemen'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Overige Kosten', 'Marketing & drukwerk extra', 120.00, 0, 0,
       'Excel-import: 2 batches extra marketing/drukwerk × €60.
Naast hoofdpost "Drukwerk" (€800).'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) LIKE '%marketing%drukwerk%extra%'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Overige Kosten', 'Mollie transactiekosten', 152.10, 0, 0,
       'Excel-import: 390 verwachte transacties × €0,39 (Mollie iDeal/Bancontact).
Werkelijke kost loopt mee met effectieve verkoop.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) LIKE '%mollie%'
);

INSERT INTO concert_budget_items (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
SELECT 1, 'uitgave', 'Overige Kosten', 'SABAM', 0, 0, 0,
       'Excel-import: SABAM-afdracht voor uitvoering van auteursrechtelijk werk.
Bedrag nog te bepalen op basis van programma.'
WHERE NOT EXISTS (
  SELECT 1 FROM concert_budget_items WHERE project_id = 1 AND type = 'uitgave' AND LOWER(omschrijving) = 'sabam'
);

-- Migration log
INSERT OR IGNORE INTO d1_migrations (name, applied_at)
VALUES ('0102_dancing_voices_budget_import.sql', datetime('now'));
