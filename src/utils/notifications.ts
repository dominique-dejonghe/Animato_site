// Notifications utility - simple helpers around the `notifications` table.
//
// Doel (#116): leden krijgen een lijst van zaken die hun aandacht vragen
// (lidgeld openstaand, nieuw nieuwsbericht, …). De UI toont 'ongelezen'
// items met een badge in de header en een lijst op /leden/profiel.

export type NotificationType =
  | 'nieuws'
  | 'materiaal'
  | 'repetitie'
  | 'concert'
  | 'board'
  | 'systeem'
  | 'lidgeld'
  | 'profiel'

/**
 * Maak één notificatie aan voor één gebruiker.
 * Niet-blokkerend: bij een fout loggen we maar laten we de hoofdactie
 * (bv. nieuwsbericht publiceren) gewoon doorgaan.
 */
export async function createNotification(
  db: D1Database,
  userId: number,
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO notifications (user_id, type, titel, body, link)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(userId, type, titel, body || null, link || null).run()
  } catch (e) {
    console.error('createNotification failed:', e)
  }
}

/**
 * Maak één notificatie aan voor meerdere gebruikers tegelijk.
 * Gebruikt batch-insert via meerdere prepared statements om sneller te zijn
 * dan een loop van afzonderlijke run() calls.
 */
export async function createNotificationForUsers(
  db: D1Database,
  userIds: number[],
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<number> {
  if (userIds.length === 0) return 0
  try {
    const stmts = userIds.map(uid =>
      db.prepare(
        `INSERT INTO notifications (user_id, type, titel, body, link)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(uid, type, titel, body || null, link || null)
    )
    await db.batch(stmts)
    return userIds.length
  } catch (e) {
    console.error('createNotificationForUsers failed:', e)
    return 0
  }
}

/**
 * Notify ALL active members (excluding visitors and test accounts).
 * Filtert leden uit die expliciet opt-out hebben gezet voor dit type.
 * Gebruikt voor system-wide events zoals nieuwspublicaties.
 */
export async function notifyAllActiveMembers(
  db: D1Database,
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<number> {
  // LEFT JOIN op user_notification_prefs: enkel users zónder opt-out (enabled=0)
  // voor dit type krijgen de notificatie. Geen rij = default aan.
  const result = await db.prepare(
    `SELECT u.id FROM users u
     LEFT JOIN user_notification_prefs p
       ON p.user_id = u.id AND p.notif_type = ?
     WHERE u.status = 'actief'
       AND u.role NOT IN ('bezoeker')
       AND COALESCE(u.is_test_account, 0) = 0
       AND (p.id IS NULL OR p.enabled = 1)`
  ).bind(type).all<{ id: number }>()

  const userIds = (result.results || []).map(r => r.id)
  return createNotificationForUsers(db, userIds, type, titel, body, link)
}

/**
 * Notify alle actieve leden van één of meerdere stemgroepen ('S','A','T','B').
 * Bij visibility='alle_leden' (lege stems-array) valt dit terug op
 * notifyAllActiveMembers. Honoreert óók de opt-out preferences.
 *
 * Gebruikt voor materials-uploads: alleen sopranen krijgen notif over een
 * sopraan-partij, etc.
 */
export async function notifyActiveMembersByStemgroep(
  db: D1Database,
  stems: string[],   // bv. ['S','A'] of [] voor alle leden
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<number> {
  // Lege array of expliciet alle = fallback naar alle leden
  if (!stems || stems.length === 0) {
    return notifyAllActiveMembers(db, type, titel, body, link)
  }
  // Bouw placeholders dynamisch: stems kan 1..4 elementen hebben
  const placeholders = stems.map(() => '?').join(',')
  const result = await db.prepare(
    `SELECT u.id FROM users u
     LEFT JOIN user_notification_prefs p
       ON p.user_id = u.id AND p.notif_type = ?
     WHERE u.status = 'actief'
       AND u.role NOT IN ('bezoeker')
       AND COALESCE(u.is_test_account, 0) = 0
       AND UPPER(u.stemgroep) IN (${placeholders})
       AND (p.id IS NULL OR p.enabled = 1)`
  ).bind(type, ...stems.map(s => s.toUpperCase())).all<{ id: number }>()

  const userIds = (result.results || []).map(r => r.id)
  return createNotificationForUsers(db, userIds, type, titel, body, link)
}

/**
 * Notify één specifieke user, MAAR alleen als die niet opt-out heeft voor
 * dit type. Wrapper rond createNotification.
 *
 * Gebruikt voor user-specifieke triggers zoals "iemand reageerde op je post".
 */
export async function notifyUserIfEnabled(
  db: D1Database,
  userId: number,
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<boolean> {
  try {
    const pref = await db.prepare(
      `SELECT enabled FROM user_notification_prefs
       WHERE user_id = ? AND notif_type = ?
       LIMIT 1`
    ).bind(userId, type).first<{ enabled: number }>()
    // Geen rij = default aan; rij met enabled=0 = opt-out
    if (pref && pref.enabled === 0) return false
    await createNotification(db, userId, type, titel, body, link)
    return true
  } catch (e) {
    console.error('notifyUserIfEnabled failed:', e)
    return false
  }
}

/**
 * Lees prefs van één user. Retourneert een map { type: enabled? } voor alle
 * notificatie-types — types die niet in de DB staan krijgen default true.
 */
export async function getUserNotificationPrefs(
  db: D1Database,
  userId: number
): Promise<Record<NotificationType, boolean>> {
  const allTypes: NotificationType[] = [
    'nieuws','materiaal','repetitie','concert','board','systeem','lidgeld','profiel'
  ]
  const defaults = allTypes.reduce((acc, t) => {
    acc[t] = true
    return acc
  }, {} as Record<NotificationType, boolean>)
  try {
    const result = await db.prepare(
      `SELECT notif_type, enabled FROM user_notification_prefs WHERE user_id = ?`
    ).bind(userId).all<{ notif_type: string; enabled: number }>()
    for (const r of (result.results || [])) {
      if (r.notif_type in defaults) {
        defaults[r.notif_type as NotificationType] = r.enabled === 1
      }
    }
  } catch (e) { /* ignore */ }
  return defaults
}

/**
 * Update de preferences in bulk. Items met enabled=true verwijderen we uit
 * de tabel (geen rij = default aan); items met enabled=false zetten we
 * expliciet op enabled=0. Atomic via db.batch().
 */
export async function setUserNotificationPrefs(
  db: D1Database,
  userId: number,
  prefs: Partial<Record<NotificationType, boolean>>
): Promise<void> {
  const stmts: D1PreparedStatement[] = []
  for (const [type, enabled] of Object.entries(prefs)) {
    if (enabled) {
      // Default = aan: rij weg
      stmts.push(db.prepare(
        `DELETE FROM user_notification_prefs WHERE user_id = ? AND notif_type = ?`
      ).bind(userId, type))
    } else {
      // Opt-out: upsert
      stmts.push(db.prepare(
        `INSERT INTO user_notification_prefs (user_id, notif_type, enabled, updated_at)
         VALUES (?, ?, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, notif_type) DO UPDATE SET enabled=0, updated_at=CURRENT_TIMESTAMP`
      ).bind(userId, type))
    }
  }
  if (stmts.length > 0) {
    await db.batch(stmts)
  }
}

/**
 * Get unread count for the header badge. Cheap query thanks to the
 * idx_notifications_user_unread compound index.
 */
export async function getUnreadCount(db: D1Database, userId: number): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) as cnt FROM notifications
       WHERE user_id = ? AND is_gelezen = 0`
    ).bind(userId).first<{ cnt: number }>()
    return row?.cnt || 0
  } catch (e) {
    return 0
  }
}

/**
 * Get notifications for a user, newest first.
 */
export async function getNotificationsForUser(
  db: D1Database,
  userId: number,
  limit: number = 50,
  unreadOnly: boolean = false
): Promise<any[]> {
  try {
    const where = unreadOnly ? 'AND is_gelezen = 0' : ''
    const result = await db.prepare(
      `SELECT id, type, titel, body, link, is_gelezen, gelezen_at, created_at
       FROM notifications
       WHERE user_id = ? ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(userId, limit).all()
    return result.results || []
  } catch (e) {
    return []
  }
}

/**
 * Mark single notification as read.
 */
export async function markAsRead(db: D1Database, notificationId: number, userId: number): Promise<boolean> {
  try {
    const r = await db.prepare(
      `UPDATE notifications
       SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    ).bind(notificationId, userId).run()
    return (r.meta?.changes || 0) > 0
  } catch (e) {
    return false
  }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(db: D1Database, userId: number): Promise<number> {
  try {
    const r = await db.prepare(
      `UPDATE notifications
       SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND is_gelezen = 0`
    ).bind(userId).run()
    return r.meta?.changes || 0
  } catch (e) {
    return 0
  }
}

/**
 * Get icon + colour metadata for a notification type.
 * Used by the UI to render visually distinct notifications.
 */
export function getNotificationStyle(type: NotificationType): { icon: string; bg: string; color: string } {
  const styles: Record<NotificationType, { icon: string; bg: string; color: string }> = {
    nieuws:    { icon: 'fas fa-newspaper',     bg: 'bg-blue-100',    color: 'text-blue-600' },
    materiaal: { icon: 'fas fa-folder',         bg: 'bg-purple-100',  color: 'text-purple-600' },
    repetitie: { icon: 'fas fa-music',          bg: 'bg-green-100',   color: 'text-green-600' },
    concert:   { icon: 'fas fa-microphone',     bg: 'bg-pink-100',    color: 'text-pink-600' },
    board:     { icon: 'fas fa-users-cog',      bg: 'bg-amber-100',   color: 'text-amber-700' },
    systeem:   { icon: 'fas fa-cog',            bg: 'bg-gray-100',    color: 'text-gray-600' },
    lidgeld:   { icon: 'fas fa-euro-sign',      bg: 'bg-orange-100',  color: 'text-orange-600' },
    profiel:   { icon: 'fas fa-user-edit',      bg: 'bg-indigo-100',  color: 'text-indigo-600' }
  }
  return styles[type] || styles.systeem
}
