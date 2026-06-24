-- Capaciteit Dancing Voices in CC Binder: 6 stoelen weg voor PA (geluidssysteem)
-- 401 (volledige zaal) → 395 verkoopbaar
--
-- Reden: in het zaalplan staan de 6 PA-stoelen nog als 'available' maar
-- worden fysiek bezet door geluidssysteem. Tot we weten EXACT welke
-- stoelnummers, blokkeren we niet in seats-tabel — we cappen enkel
-- de verkoop-capaciteit op concert-niveau.
--
-- TODO (later, met info Jarrich/Ruben): markeer de juiste 6 seats als
--   status='blocked' in de seats-tabel zodat ze ook visueel grijs zijn
--   op de zaalplattegrond. Dan kan capaciteit terug naar 401 omdat de
--   verkoop-query in tickets.tsx automatisch enkel 'available'-stoelen telt.

UPDATE concerts
SET capaciteit = 395
WHERE id = 7 AND capaciteit = 401;

-- Documentatie-notitie in budget_items voor de voorzitter
UPDATE concert_budget_items
SET notities = COALESCE(notities, '') ||
               CASE WHEN COALESCE(notities,'') = '' THEN '' ELSE x'0a' END ||
               'Capaciteit-cap: 401 stoelen in zaalplan → 395 verkoopbaar (6 stoelen voor PA/geluidssysteem).'
WHERE project_id = 1 AND type = 'uitgave'
  AND LOWER(omschrijving) LIKE '%geluidssysteem%';
