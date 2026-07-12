// Notifications utility - simple helpers around the `notifications` table.
//
// Doel (#116): leden krijgen een lijst van zaken die hun aandacht vragen
// (lidgeld openstaand, nieuw nieuwsbericht, …). De UI toont 'ongelezen'
// items met een badge in de header en een lijst op /leden/profiel.
//
// EMAIL-INTEGRATIE (2026-07-08):
//   Elke notif-type heeft nu ook een EMAIL-variant. Standaard sturen we
//   én in-app én email; leden kunnen per type kiezen (opt-out) via
//   /leden/profiel#notificaties. Zie migratie 0107_email_notifications.sql
//   voor de `email_enabled` kolom.
//
//   Om emails te sturen bij createNotification, gebruik notifyUser() (nieuw)
//   i.p.v. createNotification() rechtstreeks — die eerste kijkt naar de
//   email-preferences en roept sendEmail() aan als het aan staat.

import { sendEmail, notificationEmail } from './email'

export type NotificationType =
  | 'nieuws'
  | 'materiaal'
  | 'repetitie'
  | 'concert'
  | 'board'
  | 'systeem'
  | 'lidgeld'
  | 'profiel'
  | 'taak'
  | 'gift'           // Bedank-mail schenker
  | 'ledenaanvraag'  // Nieuwe registratie-aanvraag naar admin
  | 'contact'        // Contactformulier-bericht naar webmaster
  | 'feedback'       // Beta-feedback / bug-melding naar admins
  | 'deadline'       // Taak-deadline nadert
  | 'agenda'         // Nieuw agenda-item / concert
  | 'verjaardag'     // Verjaardag koorlid

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
 * ⭐ NIEUW (email-integratie): Notify één user via in-app + email.
 *
 * Deze functie is de aanbevolen vervanger voor `createNotification` als
 * je óók een email wilt sturen. Ze:
 *   1. Zet altijd een in-app notificatie (tenzij enabled=0)
 *   2. Stuurt een email indien:
 *        - email_enabled != 0 in prefs
 *        - user actief is (status='actief', geen bezoeker/testaccount)
 *        - RESEND_API_KEY beschikbaar
 *
 * De email is niet-blokkerend: faalt Resend, dan blijft de in-app
 * notificatie wél staan en logt de functie de fout.
 *
 * @param opts.emailSubject  Optioneel — als leeg gebruiken we `titel`
 * @param opts.emailBodyHtml Optioneel — als leeg bouwt notificationEmail() een default
 */
export interface NotifyUserOptions {
  emailSubject?: string
  emailBodyHtml?: string
  /** Als true: sla email over (bv. wanneer de trigger óók een aparte email stuurt) */
  skipEmail?: boolean
  /** Als true: sla in-app over (zelden gebruikt — voor admin-only mails) */
  skipInApp?: boolean
}

export async function notifyUser(
  db: D1Database,
  resendApiKey: string | undefined,
  userId: number,
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string,
  opts: NotifyUserOptions = {}
): Promise<{ inApp: boolean; email: boolean }> {
  const result = { inApp: false, email: false }

  // 1. Prefs + user info in één ronde
  let prefs: { enabled: number; email_enabled: number } | null = null
  let userInfo: { email: string; voornaam: string | null; status: string; role: string; is_test_account: number } | null = null
  try {
    const [prefsRow, userRow] = await Promise.all([
      db.prepare(
        `SELECT enabled, email_enabled FROM user_notification_prefs
         WHERE user_id = ? AND notif_type = ? LIMIT 1`
      ).bind(userId, type).first<{ enabled: number; email_enabled: number }>(),
      db.prepare(
        `SELECT u.email, p.voornaam, u.status, u.role,
                COALESCE(u.is_test_account, 0) AS is_test_account
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = ? LIMIT 1`
      ).bind(userId).first<{ email: string; voornaam: string | null; status: string; role: string; is_test_account: number }>()
    ])
    prefs = prefsRow || null
    userInfo = userRow || null
  } catch (e) {
    console.error('[notifyUser] prefs/user lookup failed:', e)
  }

  // 2. In-app: default aan, tenzij expliciet opt-out
  const inAppEnabled = !prefs || prefs.enabled === 1
  if (!opts.skipInApp && inAppEnabled) {
    await createNotification(db, userId, type, titel, body, link)
    result.inApp = true
  }

  // 3. Email: default aan, tenzij expliciet opt-out
  const emailEnabled = !prefs || prefs.email_enabled === 1
  const canReceiveEmail = userInfo
    && userInfo.email
    && userInfo.status === 'actief'
    && userInfo.role !== 'bezoeker'
    && userInfo.is_test_account === 0
  if (!opts.skipEmail && emailEnabled && canReceiveEmail && resendApiKey) {
    try {
      const emailHtml = opts.emailBodyHtml || notificationEmail({
        voornaam: userInfo.voornaam,
        titel,
        body: body || '',
        link,
        type,
      })
      const ok = await sendEmail({
        to: userInfo.email,
        subject: opts.emailSubject || titel,
        html: emailHtml,
      }, resendApiKey)
      result.email = ok
    } catch (e) {
      console.error('[notifyUser] sendEmail failed:', e)
    }
  }

  return result
}

/**
 * ⭐ NIEUW: Notify meerdere users via in-app (batch) + email (parallel).
 *
 * Voor grote fan-outs (nieuwspublicatie, materiaal-upload) — schaalt beter
 * dan notifyUser() in een loop. In-app gebruikt db.batch(), email gebruikt
 * Promise.allSettled met bounded concurrency (max 5 parallel).
 */
export async function notifyUsers(
  db: D1Database,
  resendApiKey: string | undefined,
  userIds: number[],
  type: NotificationType,
  titel: string,
  body?: string,
  link?: string,
  opts: NotifyUserOptions = {}
): Promise<{ inApp: number; email: number }> {
  const result = { inApp: 0, email: 0 }
  if (userIds.length === 0) return result

  // 1. Haal prefs + user info voor ALLE users in één query
  const placeholders = userIds.map(() => '?').join(',')
  let rows: Array<{ user_id: number; email: string; voornaam: string | null; enabled: number; email_enabled: number; status: string; role: string; is_test_account: number }> = []
  try {
    const q = await db.prepare(
      `SELECT u.id AS user_id, u.email, p.voornaam, u.status, u.role,
              COALESCE(u.is_test_account, 0) AS is_test_account,
              COALESCE(np.enabled, 1) AS enabled,
              COALESCE(np.email_enabled, 1) AS email_enabled
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_notification_prefs np
         ON np.user_id = u.id AND np.notif_type = ?
       WHERE u.id IN (${placeholders})`
    ).bind(type, ...userIds).all<any>()
    rows = (q.results || []) as any[]
  } catch (e) {
    console.error('[notifyUsers] lookup failed:', e)
    return result
  }

  const inAppTargets = rows.filter(r => r.enabled === 1)
  const emailTargets = rows.filter(r =>
    r.email_enabled === 1
    && r.email
    && r.status === 'actief'
    && r.role !== 'bezoeker'
    && r.is_test_account === 0
  )

  // 2. In-app in één batch
  if (!opts.skipInApp && inAppTargets.length > 0) {
    result.inApp = await createNotificationForUsers(
      db, inAppTargets.map(r => r.user_id), type, titel, body, link
    )
  }

  // 3. Email met bounded concurrency (max 5 parallel)
  if (!opts.skipEmail && emailTargets.length > 0 && resendApiKey) {
    const CONCURRENCY = 5
    for (let i = 0; i < emailTargets.length; i += CONCURRENCY) {
      const batch = emailTargets.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (r) => {
        const emailHtml = opts.emailBodyHtml || notificationEmail({
          voornaam: r.voornaam,
          titel, body: body || '', link, type,
        })
        return sendEmail({
          to: r.email,
          subject: opts.emailSubject || titel,
          html: emailHtml,
        }, resendApiKey)
      }))
      for (const rr of results) {
        if (rr.status === 'fulfilled' && rr.value) result.email++
      }
    }
  }

  return result
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
  link?: string,
  resendApiKey?: string
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
  if (resendApiKey) {
    // Nieuwe route: in-app + email in één helper (respecteert email_enabled)
    const r = await notifyUsers(db, resendApiKey, userIds, type, titel, body, link)
    return r.inApp
  }
  // Backwards-compat: alleen in-app
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
  link?: string,
  resendApiKey?: string
): Promise<number> {
  // Lege array of expliciet alle = fallback naar alle leden
  if (!stems || stems.length === 0) {
    return notifyAllActiveMembers(db, type, titel, body, link, resendApiKey)
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
  if (resendApiKey) {
    const r = await notifyUsers(db, resendApiKey, userIds, type, titel, body, link)
    return r.inApp
  }
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

/** Type per notif_type: { inApp: bool, email: bool } */
export interface NotifPref { inApp: boolean; email: boolean }

/** Alle types die een lid kan aan/uit zetten. Volgorde bepaalt UI-volgorde. */
export const USER_TOGGLEABLE_TYPES: NotificationType[] = [
  'nieuws', 'materiaal', 'repetitie', 'concert', 'agenda',
  'taak', 'deadline', 'lidgeld', 'gift', 'board', 'systeem', 'profiel',
  'verjaardag',
]

/**
 * Lees prefs van één user. Retourneert een map met per type een {inApp, email}
 * boolean. Types die niet in de DB staan krijgen default {true, true}.
 */
export async function getUserNotificationPrefs(
  db: D1Database,
  userId: number
): Promise<Record<NotificationType, NotifPref>> {
  const defaults: Record<string, NotifPref> = {}
  for (const t of USER_TOGGLEABLE_TYPES) {
    defaults[t] = { inApp: true, email: true }
  }
  try {
    const result = await db.prepare(
      `SELECT notif_type, enabled, email_enabled FROM user_notification_prefs WHERE user_id = ?`
    ).bind(userId).all<{ notif_type: string; enabled: number; email_enabled: number }>()
    for (const r of (result.results || [])) {
      if (r.notif_type in defaults) {
        defaults[r.notif_type] = {
          inApp: r.enabled === 1,
          email: r.email_enabled === 1,
        }
      }
    }
  } catch (e) { /* ignore */ }
  return defaults as Record<NotificationType, NotifPref>
}

/**
 * Update de preferences in bulk. Voor elk type: als beide op default staan
 * (inApp=true én email=true) verwijderen we de rij; anders upsert met de
 * actuele waarden. Atomic via db.batch().
 */
export async function setUserNotificationPrefs(
  db: D1Database,
  userId: number,
  prefs: Partial<Record<NotificationType, NotifPref>>
): Promise<void> {
  const stmts: D1PreparedStatement[] = []
  for (const [type, pref] of Object.entries(prefs)) {
    if (!pref) continue
    if (pref.inApp && pref.email) {
      // Beide default = aan: rij weg (bespaart storage én kleine race met defaults)
      stmts.push(db.prepare(
        `DELETE FROM user_notification_prefs WHERE user_id = ? AND notif_type = ?`
      ).bind(userId, type))
    } else {
      // Iets is uit: upsert de exacte waarden
      stmts.push(db.prepare(
        `INSERT INTO user_notification_prefs (user_id, notif_type, enabled, email_enabled, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, notif_type) DO UPDATE
           SET enabled = excluded.enabled,
               email_enabled = excluded.email_enabled,
               updated_at = CURRENT_TIMESTAMP`
      ).bind(userId, type, pref.inApp ? 1 : 0, pref.email ? 1 : 0))
    }
  }
  if (stmts.length > 0) {
    await db.batch(stmts)
  }
}

/**
 * Verwijder notificaties die naar een (verwijderd) event verwijzen.
 *
 * Wordt aangeroepen vanuit alle DELETE-FROM-events code paths zodat leden geen
 * dode links meer in hun notificatielijst zien (die zou leiden tot een 404
 * "Pagina niet gevonden"). Matcht zowel /agenda/{slug} als /concerten/{slug}.
 *
 * - Werkt best-effort: faalt stilletjes, gooit nooit (event-delete mag niet
 *   stuk gaan door een notificatie-cleanup failure).
 * - Slug-matching is tolerant: zowel exact als met query-strings na de slug
 *   (bv. /agenda/concert-jubile?source=email).
 */
export async function cleanupNotificationsForEvent(
  db: D1Database,
  slug: string | null | undefined
): Promise<number> {
  if (!slug) return 0
  try {
    const paths = [
      `/agenda/${slug}`,
      `/concerten/${slug}`,
    ]
    let totalDeleted = 0
    for (const path of paths) {
      // Match exact path OR path met query string (?foo=bar) of trailing slash
      const r = await db.prepare(
        `DELETE FROM notifications
         WHERE link = ? OR link LIKE ? OR link LIKE ?`
      ).bind(path, path + '?%', path + '/%').run()
      totalDeleted += Number((r.meta as any)?.changes || 0)
    }
    if (totalDeleted > 0) {
      console.log(`[notifications] cleaned up ${totalDeleted} stale notification(s) for deleted event slug="${slug}"`)
    }
    return totalDeleted
  } catch (e) {
    console.error('cleanupNotificationsForEvent failed:', e)
    return 0
  }
}

/**
 * Get unread count for the header badge.
 *
 * Filtert dode event-links uit zodat de badge nooit notificaties telt die
 * naar verwijderde events leiden (zou inconsistent zijn met de UI die de
 * dode rijen wegfiltert).
 */
export async function getUnreadCount(db: D1Database, userId: number): Promise<number> {
  try {
    // We tellen ALLE ongelezen items op met een event-link (of zonder link),
    // en trekken er de items af waarvan de link naar een niet-bestaand event wijst.
    // In de praktijk is het aantal ongelezen items klein, dus dit blijft snel.
    const rows = await db.prepare(
      `SELECT id, link FROM notifications
       WHERE user_id = ? AND is_gelezen = 0`
    ).bind(userId).all<any>()
    const all = rows.results || []
    if (all.length === 0) return 0

    const slugRegex = /^\/(?:agenda|concerten)\/([^/?#]+)/
    const slugSet = new Set<string>()
    for (const n of all) {
      if (!n.link) continue
      const m = String(n.link).match(slugRegex)
      if (m) slugSet.add(m[1])
    }

    if (slugSet.size === 0) return all.length

    const slugs = Array.from(slugSet)
    const placeholders = slugs.map(() => '?').join(',')
    const existingResult = await db.prepare(
      `SELECT slug FROM events WHERE slug IN (${placeholders})`
    ).bind(...slugs).all<any>()
    const existingSlugs = new Set((existingResult.results || []).map((r: any) => r.slug))

    let count = 0
    for (const n of all) {
      if (!n.link) { count++; continue }
      const m = String(n.link).match(slugRegex)
      if (!m) { count++; continue }
      if (existingSlugs.has(m[1])) count++
    }
    return count
  } catch (e) {
    return 0
  }
}

/**
 * Get notifications for a user, newest first.
 *
 * Defensieve filter: notificaties met een link naar /agenda/{slug} of
 * /concerten/{slug} waar het bijbehorende event NIET (meer) bestaat worden
 * uit het resultaat gefilterd EN meteen uit de database verwijderd (best-effort).
 * Zo zien leden nooit dode links die zouden leiden naar 'Pagina niet gevonden'.
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
    ).bind(userId, limit).all<any>()
    const rows = result.results || []

    // Collect unieke slugs uit event-links
    const slugRegex = /^\/(?:agenda|concerten)\/([^/?#]+)/
    const slugSet = new Set<string>()
    for (const n of rows) {
      if (!n.link) continue
      const m = String(n.link).match(slugRegex)
      if (m) slugSet.add(m[1])
    }

    if (slugSet.size === 0) return rows

    // Check welke slugs nog bestaan in events
    const slugs = Array.from(slugSet)
    const placeholders = slugs.map(() => '?').join(',')
    const existingResult = await db.prepare(
      `SELECT slug FROM events WHERE slug IN (${placeholders})`
    ).bind(...slugs).all<any>()
    const existingSlugs = new Set((existingResult.results || []).map((r: any) => r.slug))

    // Splits in 'levend' vs 'dood'
    const deadIds: number[] = []
    const liveRows: any[] = []
    for (const n of rows) {
      if (!n.link) { liveRows.push(n); continue }
      const m = String(n.link).match(slugRegex)
      if (!m) { liveRows.push(n); continue }
      if (existingSlugs.has(m[1])) {
        liveRows.push(n)
      } else {
        deadIds.push(n.id)
      }
    }

    // Ruim dode notificaties stil op (fire-and-forget; mag falen)
    if (deadIds.length > 0) {
      try {
        const delPlaceholders = deadIds.map(() => '?').join(',')
        await db.prepare(
          `DELETE FROM notifications WHERE id IN (${delPlaceholders}) AND user_id = ?`
        ).bind(...deadIds, userId).run()
        console.log(`[notifications] auto-cleaned ${deadIds.length} stale notification(s) for user ${userId}`)
      } catch (e) {
        // niet-fataal — gebruiker ziet ze gewoon weg uit de UI
      }
    }

    return liveRows
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
    nieuws:        { icon: 'fas fa-newspaper',       bg: 'bg-blue-100',    color: 'text-blue-600' },
    materiaal:     { icon: 'fas fa-folder',          bg: 'bg-purple-100',  color: 'text-purple-600' },
    repetitie:     { icon: 'fas fa-music',           bg: 'bg-green-100',   color: 'text-green-600' },
    concert:       { icon: 'fas fa-microphone',      bg: 'bg-pink-100',    color: 'text-pink-600' },
    board:         { icon: 'fas fa-users-cog',       bg: 'bg-amber-100',   color: 'text-amber-700' },
    systeem:       { icon: 'fas fa-cog',             bg: 'bg-gray-100',    color: 'text-gray-600' },
    lidgeld:       { icon: 'fas fa-euro-sign',       bg: 'bg-orange-100',  color: 'text-orange-600' },
    profiel:       { icon: 'fas fa-user-edit',       bg: 'bg-indigo-100',  color: 'text-indigo-600' },
    taak:          { icon: 'fas fa-clipboard-check', bg: 'bg-purple-100',  color: 'text-purple-700' },
    gift:          { icon: 'fas fa-gift',            bg: 'bg-rose-100',    color: 'text-rose-600' },
    ledenaanvraag: { icon: 'fas fa-user-plus',       bg: 'bg-teal-100',    color: 'text-teal-700' },
    contact:       { icon: 'fas fa-envelope',        bg: 'bg-sky-100',     color: 'text-sky-700' },
    feedback:      { icon: 'fas fa-bug',             bg: 'bg-red-100',     color: 'text-red-700' },
    deadline:      { icon: 'fas fa-hourglass-half',  bg: 'bg-yellow-100',  color: 'text-yellow-700' },
    agenda:        { icon: 'fas fa-calendar-alt',    bg: 'bg-cyan-100',    color: 'text-cyan-700' },
    verjaardag:    { icon: 'fas fa-birthday-cake',   bg: 'bg-pink-100',    color: 'text-pink-500' },
  }
  return styles[type] || styles.systeem
}

/**
 * Human-readable label per type — voor de UI van /leden/profiel#notificaties.
 */
export function getNotificationLabel(type: NotificationType): { label: string; beschrijving: string } {
  const labels: Record<NotificationType, { label: string; beschrijving: string }> = {
    nieuws:        { label: 'Nieuwsberichten',     beschrijving: 'Als er een nieuw bericht wordt gepubliceerd voor jouw stemgroep of alle leden' },
    materiaal:     { label: 'Oefenmateriaal',      beschrijving: 'Nieuw partituur of oefen-mp3 voor jouw stemgroep' },
    repetitie:     { label: 'Repetities',          beschrijving: 'Nieuwe repetitie in de agenda of wijzigingen' },
    concert:       { label: 'Concerten',           beschrijving: 'Nieuwe concert-details, tickets, of concertwijzigingen' },
    agenda:        { label: 'Agenda-items',        beschrijving: 'Andere activiteiten en events' },
    taak:          { label: 'Taken toegewezen',    beschrijving: 'Als er een taak of actiepunt aan jou wordt toegewezen' },
    deadline:      { label: 'Deadline-herinnering', beschrijving: '3 dagen voor de deadline van een toegewezen taak' },
    lidgeld:       { label: 'Lidgeld',             beschrijving: 'Openstaand lidgeld, betaalverzoeken en bevestigingen' },
    gift:          { label: 'Bedankje bij gift',   beschrijving: 'Bevestiging als je een gift/donatie doet' },
    board:         { label: 'Bestuurlijk',         beschrijving: 'Alleen voor bestuursleden — notulen, agenda, actiepunten' },
    systeem:       { label: 'Systeem',             beschrijving: 'Belangrijke systeemmeldingen (blijven altijd staan, kritiek)' },
    profiel:       { label: 'Profiel',             beschrijving: 'Herinnering om je profiel aan te vullen' },
    verjaardag:    { label: 'Verjaardagen',        beschrijving: 'Wekelijkse samenvatting van verjaardagen in het koor' },
    ledenaanvraag: { label: 'Ledenaanvragen',      beschrijving: 'Admin-only — nieuwe registratie-aanvraag' },
    contact:       { label: 'Contactformulier',    beschrijving: 'Admin-only — nieuw bericht via contactformulier' },
    feedback:      { label: 'Beta feedback',       beschrijving: 'Admin-only — nieuwe bug-melding of feedback' },
  }
  return labels[type] || { label: type, beschrijving: '' }
}
