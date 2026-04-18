-- Voorverkoop start datum voor concerten
-- Als NULL: huidige gedrag (tickets direct beschikbaar als ticketing_enabled=1)
-- Als datum in de toekomst: toon "Voorverkoop start op X" ipv bestelknop
-- Als datum in het verleden: normale ticketverkoop

ALTER TABLE concerts ADD COLUMN voorverkoop_start_at DATETIME;

-- Index voor snelle filtering (bv. "welke concerten gaan binnenkort in voorverkoop")
CREATE INDEX IF NOT EXISTS idx_concerts_voorverkoop_start ON concerts(voorverkoop_start_at);
