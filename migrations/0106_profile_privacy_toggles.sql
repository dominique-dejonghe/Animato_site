-- Extra privacy-toggles op profiel: koorlid kiest zelf welke info gedeeld wordt.
-- Datum: 2026-07-02
--
-- Reeds bestaand (uit 0003_smoelenboek_fields.sql):
--   smoelenboek_zichtbaar (default 1)
--   toon_telefoon         (default 0)
--   toon_email            (default 1)
--
-- Nieuw hieronder — defaults zijn bewust conservatief:
--   toon_foto           = 1  (foto is al openbaar in listings)
--   toon_bio            = 1  (dat is exact waarvoor bio bedoeld is)
--   toon_stemgroep      = 1  (koor-context, niet privé)
--   toon_geboortedatum  = 0  (leeftijd is privacygevoelig)
--   toon_adres          = 0  (woonadres → nooit standaard delen)
--   toon_favorieten     = 1  (favoriete werk/componist/genre — muzikale info, koor-relevant)

ALTER TABLE profiles ADD COLUMN toon_foto INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN toon_bio INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN toon_stemgroep INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN toon_geboortedatum INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN toon_adres INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN toon_favorieten INTEGER NOT NULL DEFAULT 1;
