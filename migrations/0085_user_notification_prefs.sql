-- 0085_user_notification_prefs.sql
-- Per-user opt-in/opt-out per notificatie-type.
--
-- Design-keuze: in plaats van een 'enabled BOOLEAN' per gewenst type apart op
-- te slaan, gebruiken we een sparse-junction style: een rij in deze tabel
-- betekent 'OPT-OUT' voor dat type. Geen rij = default (= aan).
--
-- Voordelen:
--   * Default-on zonder dat we voor elke nieuwe user 8 rijen moeten seeden.
--   * Migratie-friendly: nieuwe NotificationType waarden in de code werken
--     automatisch met deze tabel, zonder schema-aanpassing.
--   * Cheap reads: één LEFT JOIN volstaat om in de notify-helper te checken
--     'is deze user opted-out?'.
--
-- Bewust GEEN check-constraint op het type-veld: NotificationType wordt in
-- TypeScript afgedwongen, en we willen geen migratie nodig hebben elke keer
-- als we een nieuw type toevoegen.

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  notif_type TEXT NOT NULL,           -- matcht NotificationType in code
  -- enabled=0 = expliciet uitgezet door user; we slaan alleen op wanneer ze
  -- afwijken van de default (= aan). Toekomstig kan dit ook 1 worden als we
  -- ooit een type default-off willen maken.
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, notif_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user
  ON user_notification_prefs(user_id);
