-- 0067: Voeg previous_login_at toe aan users (#116)
-- Doel: bij login bewaren we de "vorige" login-tijd zodat we op het dashboard
-- "wat is nieuw sinds je laatste bezoek?" correct kunnen tonen.
-- last_login_at = huidige session, previous_login_at = de session ervóór.

ALTER TABLE users ADD COLUMN previous_login_at TIMESTAMP DEFAULT NULL;
