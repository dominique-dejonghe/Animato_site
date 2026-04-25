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
 * Gebruikt voor system-wide events zoals nieuwspublicaties.
 */
export async function notifyAllActiveMembers(
  db: D1Database,
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string
): Promise<number> {
  const result = await db.prepare(
    `SELECT id FROM users
     WHERE status = 'actief'
       AND role NOT IN ('bezoeker')
       AND COALESCE(is_test_account, 0) = 0`
  ).all<{ id: number }>()

  const userIds = (result.results || []).map(r => r.id)
  return createNotificationForUsers(db, userIds, type, titel, body, link)
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
