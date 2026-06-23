-- Tijdelijke instelling: laat koorleden zelf hun "lid sinds"-datum invullen.
-- Bedoeld voor 1-malige opkuis-actie (tot 31 juli 2026).
-- Default '0' (uit) — admin zet aan via /admin/modules, en zet terug uit als de
-- actie klaar is. Vanaf dan kunnen enkel admins via /admin/leden/:id de datum
-- nog wijzigen.

INSERT INTO system_settings (key, value)
VALUES ('lid_sinds_self_edit_enabled', '0')
ON CONFLICT(key) DO NOTHING;
