-- Migration 0108: cleanup vervuilde user_sessions.session_token
--
-- Bug: elke JWT begint met dezelfde 32 karakters (base64-header
-- `{"alg":"HS256","typ":"JWT"}` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpX`).
-- De oude code deed `token.substring(0, 32)` voor de session_token kolom,
-- waardoor élke actieve sessie exact dezelfde "token" had. Gevolg:
--   1. Heartbeat-UPDATE raakte ALLE actieve sessies tegelijk → hun updated_at
--      werd synchroon bijgewerkt → /admin/audit toonde "1s geleden" bij iedereen.
--   2. Logout-UPDATE zou álle sessies tegelijk sluiten (of niets — WHERE match
--      was gigantisch), wat feitelijk niemand keurig uitlogde.
--
-- De code (auth.tsx / middleware/auth.ts) gebruikt nu SHA-256 hash. Bestaande
-- rijen met de foute prefix zijn nutteloos en moeten opgeruimd:
--   - is_active → 0 (want we kunnen ze niet meer per user targeten)
--   - updated_at → login_at (we weten geen echte laatste activiteit)
--   - session_token → NULL-achtige placeholder zodat we geen future collisions
--     krijgen als per ongeluk iemand's echte hash "eyJhbG..." zou beginnen
--     (kan niet, want SHA-256 is hex, maar defensief is beter).
--
-- Volgende keer dat de user inlogt maakt de app gewoon een nieuwe rij met de
-- juiste hash. De ledenlijst-'is_online' teller herstelt zichzelf dan.

UPDATE user_sessions
   SET is_active   = 0,
       updated_at  = login_at,
       logout_at   = COALESCE(logout_at, login_at),
       -- duration_seconds bewust NIET geraakt: als het NULL was blijft het NULL
       -- (de duur is namelijk onbekend), en /admin/audit toont dan gewoon "—"
       -- in plaats van een verzonnen getal.
       session_token = 'legacy-broken-' || id
 WHERE session_token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpX'
   AND is_active = 1;
