// Cron-endpoints voor scheduled email-notificaties.
//
// Cloudflare Pages ondersteunt geen native Scheduled Workers. Deze endpoints
// worden dus door een externe cron-service (cron-job.org, GitHub Actions,
// UptimeRobot heartbeat, …) opgeroepen. Beveiligd met een gedeeld geheim
// via de `x-cron-secret` header (env var CRON_SECRET).
//
// Aanbevolen schema:
//   - /api/cron/deadlines   → dagelijks om 08:00 Brussels (07:00 UTC winter / 06:00 UTC zomer)
//   - /api/cron/verjaardagen → wekelijks maandag 08:00 Brussels
//
// Beide endpoints zijn idempotent: dubbele calls op dezelfde dag doen niets
// dubbels (dedup-check via de notifications tabel).

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { queryAll } from '../utils/db'
import { notifyUsers } from '../utils/notifications'
import { sendWeeklyReport } from '../utils/admin-notifications'
import { getSiteUrl } from '../utils/site-url'

const app = new Hono<{ Bindings: Bindings }>()

// Shared secret check middleware
app.use('/api/cron/*', async (c, next) => {
  const secret = c.env.CRON_SECRET
  const provided = c.req.header('x-cron-secret') || c.req.query('secret')
  if (!secret) {
    // Als geen CRON_SECRET geconfigureerd is, blokkeren we alles (fail-safe)
    return c.json({ error: 'CRON_SECRET not configured' }, 503)
  }
  if (provided !== secret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// =====================================================
// DEADLINE REMINDERS — dagelijks
// =====================================================
// Vindt alle open taken (project-taken + meeting-actions) waarvan de deadline
// exact 3 dagen weg is en de assignee nog niet gepingd is vandaag.
//
// Dedup-strategie: check op notifications met type='deadline' voor deze user
// waarvan link naar dezelfde task verwijst en created_at van vandaag is.

app.get('/api/cron/deadlines', async (c) => {
  const db = c.env.DB
  const now = new Date()
  const startedAt = now.toISOString()

  // We willen taken waarvan deadline in [today+3d 00:00, today+3d 23:59:59] valt.
  const threeDaysAhead = new Date(now)
  threeDaysAhead.setUTCDate(threeDaysAhead.getUTCDate() + 3)
  const dayStart = new Date(Date.UTC(
    threeDaysAhead.getUTCFullYear(),
    threeDaysAhead.getUTCMonth(),
    threeDaysAhead.getUTCDate(),
    0, 0, 0
  )).toISOString()
  const dayEnd = new Date(Date.UTC(
    threeDaysAhead.getUTCFullYear(),
    threeDaysAhead.getUTCMonth(),
    threeDaysAhead.getUTCDate(),
    23, 59, 59
  )).toISOString()

  const results: any = { projectTasks: 0, meetingActions: 0, errors: [] as string[] }

  // 1) Project-taken (tabel: tasks — kolom: assigned_to, due_date, status)
  //    Alleen taken met status open/wip (niet 'done'/'cancelled')
  try {
    const rows = await queryAll<any>(db, `
      SELECT t.id, t.titel, t.due_date, t.assigned_to, p.titel AS project_titel
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assigned_to IS NOT NULL
        AND t.due_date IS NOT NULL
        AND t.due_date >= ?
        AND t.due_date <= ?
        AND COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'gedaan')
    `, [dayStart, dayEnd])

    for (const t of rows) {
      // Dedup: heeft deze user vandaag al een deadline-notif voor deze taak?
      const link = `/leden/taken/${t.id}`
      const existing = await db.prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND type = 'deadline' AND link = ?
           AND date(created_at) = date('now')
         LIMIT 1`
      ).bind(t.assigned_to, link).first()
      if (existing) continue

      const dueLabel = new Date(t.due_date).toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      await notifyUsers(
        db, c.env.RESEND_API_KEY,
        [t.assigned_to], 'deadline',
        `⏰ Deadline nadert: ${t.titel}`,
        `Je taak "${t.titel}"${t.project_titel ? ` (${t.project_titel})` : ''} heeft deadline op ${dueLabel}. Nog 3 dagen te gaan.`,
        link
      )
      results.projectTasks++
    }
  } catch (e: any) {
    results.errors.push(`tasks: ${e?.message || e}`)
  }

  // 2) Meeting-actions (tabel: meeting_actions — kolom: assigned_to, due_date, status)
  try {
    const rows = await queryAll<any>(db, `
      SELECT ma.id, ma.actiepunt, ma.due_date, ma.assigned_to, m.titel AS meeting_titel
      FROM meeting_actions ma
      LEFT JOIN meetings m ON m.id = ma.meeting_id
      WHERE ma.assigned_to IS NOT NULL
        AND ma.due_date IS NOT NULL
        AND ma.due_date >= ?
        AND ma.due_date <= ?
        AND COALESCE(ma.status, 'open') NOT IN ('done', 'cancelled', 'gedaan')
    `, [dayStart, dayEnd])

    for (const a of rows) {
      const link = `/leden/vergaderingen`
      const existing = await db.prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND type = 'deadline'
           AND link = ? AND titel LIKE ?
           AND date(created_at) = date('now')
         LIMIT 1`
      ).bind(a.assigned_to, link, `%${a.actiepunt.slice(0, 40)}%`).first()
      if (existing) continue

      const dueLabel = new Date(a.due_date).toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      await notifyUsers(
        db, c.env.RESEND_API_KEY,
        [a.assigned_to], 'deadline',
        `⏰ Actiepunt-deadline nadert: ${a.actiepunt.slice(0, 60)}`,
        `Actiepunt uit vergadering "${a.meeting_titel || ''}" heeft deadline op ${dueLabel}. Nog 3 dagen te gaan.`,
        link
      )
      results.meetingActions++
    }
  } catch (e: any) {
    results.errors.push(`meeting_actions: ${e?.message || e}`)
  }

  return c.json({
    ok: true,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ...results,
  })
})

// =====================================================
// VERJAARDAGEN — wekelijks (maandagochtend)
// =====================================================
// Zoekt verjaardagen van actieve leden in het komende weekvenster (7 dagen
// vanaf vandaag). Stuurt één samenvattings-notif per actieve gebruiker die
// opt-in staat voor 'verjaardag'. Dedup: één keer per week.

app.get('/api/cron/verjaardagen', async (c) => {
  const db = c.env.DB
  const startedAt = new Date().toISOString()

  try {
    // Bepaal de aankomende 7 dagen (dag/maand-tuples, jaar-onafhankelijk)
    const today = new Date()
    const upcoming: Array<{ day: number; month: number }> = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() + i)
      upcoming.push({ day: d.getUTCDate(), month: d.getUTCMonth() + 1 })
    }

    // Fetch alle verjaardagen die matchen (dag+maand)
    const orClauses = upcoming.map(() =>
      `(CAST(strftime('%d', p.geboortedatum) AS INTEGER) = ? AND CAST(strftime('%m', p.geboortedatum) AS INTEGER) = ?)`
    ).join(' OR ')
    const params: any[] = []
    for (const u of upcoming) params.push(u.day, u.month)

    const jarigenRows = await queryAll<any>(db, `
      SELECT p.voornaam, p.achternaam, p.geboortedatum, u.stemgroep,
             CAST(strftime('%d', p.geboortedatum) AS INTEGER) AS gebdag,
             CAST(strftime('%m', p.geboortedatum) AS INTEGER) AS gebmaand
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.role != 'bezoeker'
        AND COALESCE(u.is_test_account, 0) = 0
        AND p.geboortedatum IS NOT NULL
        AND (${orClauses})
      ORDER BY gebmaand, gebdag, p.voornaam
    `, params)

    if (jarigenRows.length === 0) {
      return c.json({ ok: true, jarigen: 0, notified: 0, started_at: startedAt })
    }

    // Bouw een leesbare lijst
    const dagnamen = ['zo','ma','di','wo','do','vr','za']
    const maandnamen = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
    const lijstItems = jarigenRows.map((j: any) => {
      // Vind welke van de komende 7 dagen dit matcht
      const idx = upcoming.findIndex(u => u.day === j.gebdag && u.month === j.gebmaand)
      const wanneer = idx === 0 ? 'vandaag' : idx === 1 ? 'morgen' : `${dagnamen[(today.getUTCDay() + idx) % 7]} ${j.gebdag} ${maandnamen[j.gebmaand - 1]}`
      const naam = `${j.voornaam || ''} ${j.achternaam || ''}`.trim()
      return `• ${naam} — ${wanneer}${j.stemgroep ? ` (${j.stemgroep})` : ''}`
    })
    const body = `De komende 7 dagen zijn er verjaardagen om te vieren:\n\n${lijstItems.join('\n')}\n\nStuur een berichtje via het smoelenboek of tijdens de repetitie! 🎉`

    // Fetch alle actieve users die verjaardag-notifs willen
    const activeUsers = await queryAll<{ id: number }>(db, `
      SELECT u.id FROM users u
      LEFT JOIN user_notification_prefs p
        ON p.user_id = u.id AND p.notif_type = 'verjaardag'
      WHERE u.status = 'actief'
        AND u.role != 'bezoeker'
        AND COALESCE(u.is_test_account, 0) = 0
        AND (p.id IS NULL OR p.enabled = 1)
    `)

    const userIds = activeUsers.map(u => u.id)
    if (userIds.length === 0) {
      return c.json({ ok: true, jarigen: jarigenRows.length, notified: 0, started_at: startedAt })
    }

    // Dedup: voer alleen uit als er deze week nog geen verjaardag-notif is uitgestuurd
    const lastRun = await db.prepare(
      `SELECT id FROM notifications
       WHERE type = 'verjaardag'
         AND date(created_at) >= date('now', '-6 days')
       LIMIT 1`
    ).first()
    if (lastRun) {
      return c.json({
        ok: true,
        skipped: 'already-sent-this-week',
        jarigen: jarigenRows.length,
        started_at: startedAt,
      })
    }

    const r = await notifyUsers(
      db, c.env.RESEND_API_KEY,
      userIds, 'verjaardag',
      `🎂 Verjaardagen deze week (${jarigenRows.length})`,
      body,
      '/leden/smoelenboek'
    )

    return c.json({
      ok: true,
      jarigen: jarigenRows.length,
      notified_inapp: r.inApp,
      notified_email: r.email,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    })
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500)
  }
})

// =====================================================
// WEEKLY ADMIN REPORT — maandag ~07:00 Brussels
// =====================================================
// Verstuurt een uitgebreid activiteitsoverzicht van de afgelopen 7 dagen
// naar alle admins + bestuursleden die het niet hebben uitgeschakeld.
//
// Aanbevolen cron-schema (bij cron-job.org of GitHub Actions):
//   Weekly, Monday at 07:00 Europe/Brussels
// Dedup-strategie: check op audit_logs met actie='weekly_report_sent'
// op dezelfde dag — dubbele calls doen niets.

app.get('/api/cron/weekly-report', async (c) => {
  const db = c.env.DB
  const startedAt = new Date().toISOString()

  try {
    // Dedup: als er vandaag al een weekly_report_sent audit-log is, skip
    const already = await db.prepare(
      `SELECT id FROM audit_logs
       WHERE actie = 'weekly_report_sent'
         AND date(created_at) = date('now')
       LIMIT 1`
    ).first()
    if (already) {
      return c.json({ ok: true, skipped: 'already-sent-today', started_at: startedAt })
    }

    const siteUrl = await getSiteUrl(c)
    const result = await sendWeeklyReport(db, c.env.RESEND_API_KEY, siteUrl)

    // Log naar audit_logs voor dedup + traceerbaarheid
    await db.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (NULL, 'weekly_report_sent', 'system', NULL, ?)`
    ).bind(JSON.stringify({
      recipients_sent: result.sent,
      recipients_skipped: result.skipped,
      orders_last_week: result.data.ordersLastWeek,
      revenue_last_week: result.data.revenueLastWeek
    })).run()

    return c.json({
      ok: true,
      recipients_sent: result.sent,
      recipients_skipped: result.skipped,
      period_start: result.data.weekStart,
      period_end: result.data.weekEnd,
      orders: result.data.ordersLastWeek,
      revenue: result.data.revenueLastWeek,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    })
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500)
  }
})

// Handige preview voor admins zonder mails te sturen — geeft de rapport-data
// terug als JSON zodat je kan zien wat er in de mail zou komen. Ook nuttig
// voor debugging van de queries.
app.get('/api/cron/weekly-report/preview', async (c) => {
  const db = c.env.DB
  try {
    const { buildWeeklyReport } = await import('../utils/admin-notifications')
    const data = await buildWeeklyReport(db)
    return c.json({ ok: true, data })
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500)
  }
})

export default app
