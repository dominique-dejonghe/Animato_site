// Admin/bestuur notificaties per e-mail.
// - Ticket-aankoop: real-time bij elke geslaagde betaling
// - Wekelijks rapport: maandag 07:00 Brussels-tijd via Cron Trigger
//
// Beide respecteren de per-user opt-out kolommen `notify_ticket_sales`
// en `notify_weekly_report` (migratie 0111).

import type { D1Database } from '@cloudflare/workers-types'
import { queryAll, queryOne } from './db'
import { sendEmail } from './email'
import { formatBrusselsDate, formatBrusselsDateTime, formatBrusselsTime } from './time'

interface AdminRecipient {
  id: number
  email: string
  voornaam: string | null
  achternaam: string | null
}

/**
 * Haal alle admin + bestuur ontvangers op die een specifieke notificatie-mail willen.
 *
 * @param prefColumn 'notify_ticket_sales' | 'notify_weekly_report'
 */
async function getAdminRecipients(
  db: D1Database,
  prefColumn: 'notify_ticket_sales' | 'notify_weekly_report'
): Promise<AdminRecipient[]> {
  return await queryAll<AdminRecipient>(db,
    `SELECT u.id, u.email, p.voornaam, p.achternaam
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief'
       AND COALESCE(u.is_test_account, 0) = 0
       AND u.email IS NOT NULL AND u.email != ''
       AND (u.role = 'admin' OR u.is_bestuurslid = 1)
       AND COALESCE(u.${prefColumn}, 1) = 1
     ORDER BY u.id`
  )
}

// ==========================================================================
// TICKET-AANKOOP NOTIFICATIE
// ==========================================================================

interface TicketSaleNotifyPayload {
  orderRef: string
  koperNaam: string
  koperEmail: string
  concertTitel: string
  concertDatum: string  // reeds Brussels-geformatteerd
  concertLocatie: string | null
  seatCount: number
  ticketLineCount: number
  totaalBedrag: number
  paymentMethod?: string | null
  siteUrl: string
}

function ticketSaleEmailHtml(p: TicketSaleNotifyPayload, ontvangerNaam: string): string {
  const bedrag = p.totaalBedrag.toFixed(2).replace('.', ',')
  const stoelInfo = p.seatCount > 0
    ? `${p.seatCount} genummerde stoel${p.seatCount === 1 ? '' : 'en'}`
    : `${p.ticketLineCount} ticketregel${p.ticketLineCount === 1 ? '' : 's'}`
  const methode = p.paymentMethod ? `<tr><td style="padding:6px 0;color:#666;">Betaalmethode</td><td style="padding:6px 0;"><strong>${p.paymentMethod}</strong></td></tr>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Nieuwe kaartverkoop</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;margin:0;">
  <table role="presentation" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.05);">
    <tr><td style="background:#7c3aed;padding:24px;color:#ffffff;">
      <h1 style="margin:0;font-size:22px;">🎫 Nieuwe kaartverkoop</h1>
      <p style="margin:6px 0 0;opacity:0.9;font-size:14px;">${p.concertTitel}</p>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 16px;">Hoi ${ontvangerNaam || 'admin'},</p>
      <p style="margin:0 0 16px;">Er is zonet een kaartverkoop afgerond op de Animato website.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Order</td><td style="padding:6px 0;"><strong>${p.orderRef}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Koper</td><td style="padding:6px 0;"><strong>${p.koperNaam}</strong><br><a href="mailto:${p.koperEmail}" style="color:#7c3aed;font-size:13px;">${p.koperEmail}</a></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Concert</td><td style="padding:6px 0;"><strong>${p.concertTitel}</strong><br><span style="font-size:13px;color:#666;">${p.concertDatum}${p.concertLocatie ? ' — ' + p.concertLocatie : ''}</span></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Kaarten</td><td style="padding:6px 0;"><strong>${stoelInfo}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Bedrag</td><td style="padding:6px 0;"><strong style="color:#059669;">€ ${bedrag}</strong></td></tr>
        ${methode}
      </table>
      <div style="margin-top:24px;text-align:center;">
        <a href="${p.siteUrl}/admin/tickets/concert/orders" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">📊 Naar Kaartenverkoop-overzicht</a>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">Je kan deze notificaties uitschakelen in <a href="${p.siteUrl}/leden/profiel" style="color:#9ca3af;">je profielinstellingen</a>.</p>
    </td></tr>
  </table>
</body></html>`
}

export async function notifyAdminsOfTicketSale(
  db: D1Database,
  resendApiKey: string | undefined,
  payload: TicketSaleNotifyPayload
): Promise<{ sent: number; skipped: number }> {
  const recipients = await getAdminRecipients(db, 'notify_ticket_sales')
  if (recipients.length === 0) return { sent: 0, skipped: 0 }
  if (!resendApiKey) {
    console.warn('[admin-notify] RESEND_API_KEY missing — cannot send ticket-sale notif to', recipients.length, 'admins')
    return { sent: 0, skipped: recipients.length }
  }

  let sent = 0
  let skipped = 0
  for (const r of recipients) {
    const naam = [r.voornaam, r.achternaam].filter(Boolean).join(' ').trim()
    const html = ticketSaleEmailHtml(payload, naam)
    const ok = await sendEmail({
      to: r.email,
      subject: `🎫 Kaartverkoop: ${payload.concertTitel} — € ${payload.totaalBedrag.toFixed(2).replace('.', ',')}`,
      html,
      category: 'admin_notification',
    }, resendApiKey, db)
    if (ok) sent++
    else skipped++
  }
  return { sent, skipped }
}

// ==========================================================================
// WEKELIJKS RAPPORT (maandag)
// ==========================================================================

export interface WeeklyReportData {
  // Periode
  weekStart: string   // ISO
  weekEnd: string     // ISO

  // Leden
  newMembers: number
  activatedMembers: number
  deactivatedMembers: number
  loginsMembers: number
  loginsKaartkopers: number
  loginsAdmins: number
  passwordResetsRequested: number

  // Kaartverkoop
  ordersLastWeek: number
  revenueLastWeek: number
  concertBreakdown: Array<{
    titel: string
    orders: number
    revenue: number
    seatsSold: number
    seatsAvailable: number | null
    occupancyPct: number | null
  }>
  hotSellingConcerts: Array<{ titel: string; ordersLastWeek: number; occupancyPct: number | null }>

  // Deze week
  upcomingEvents: Array<{ titel: string; when: string; type: string }>
  upcomingBirthdays: Array<{ naam: string; dag: number; maand: number; stemgroep: string | null }>

  // Website-activiteit
  nieuwsPosted: number
  commentsPosted: number
  aiNewsGenerated: number
  photosUploaded: number

  // Attention needed
  stuckOpenOrders: number
  membersMissingRehearsals: Array<{ naam: string; missed: number }>
}

/**
 * Bouw de wekelijkse rapport-data uit de DB. Alles voor "vorige week" =
 * de 7 dagen tot maandag 00:00 Brussels (dus zondag → maandag om 07:00).
 */
export async function buildWeeklyReport(db: D1Database): Promise<WeeklyReportData> {
  const now = new Date()
  const weekEnd = new Date(now.getTime())
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startIso = weekStart.toISOString()
  const endIso = weekEnd.toISOString()

  // ---- Leden ----
  const newMembers = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM users
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
       AND role NOT IN ('kaartkoper', 'bezoeker')
       AND COALESCE(is_test_account, 0) = 0`,
    [startIso, endIso])

  const activated = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM users u WHERE u.status = 'actief'
       AND datetime(u.updated_at) >= datetime(?)
       AND datetime(u.created_at) < datetime(?)
       AND role NOT IN ('kaartkoper','bezoeker')`,
    [startIso, startIso])

  const deactivated = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM users
     WHERE status = 'inactief'
       AND datetime(updated_at) >= datetime(?) AND datetime(updated_at) < datetime(?)`,
    [startIso, endIso])

  // Logins per rol-bucket
  const loginsByRole = await queryAll<any>(db,
    `SELECT
       SUM(CASE WHEN u.role IN ('lid','stemleider','dirigent','pianist','moderator') THEN 1 ELSE 0 END) as leden,
       SUM(CASE WHEN u.role = 'kaartkoper' THEN 1 ELSE 0 END) as kaartkopers,
       SUM(CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) as admins
     FROM audit_logs a
     JOIN users u ON u.id = a.user_id
     WHERE a.actie IN ('login','login_success')
       AND datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`,
    [startIso, endIso])
  const loginStats = (loginsByRole && loginsByRole[0]) || { leden: 0, kaartkopers: 0, admins: 0 }

  const pwResets = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM password_resets
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    [startIso, endIso])

  // ---- Kaartverkoop ----
  const orders = await queryOne<any>(db,
    `SELECT COUNT(*) as n, COALESCE(SUM(prijs_totaal), 0) as revenue FROM tickets
     WHERE status = 'paid'
       AND datetime(betaald_op) >= datetime(?) AND datetime(betaald_op) < datetime(?)`,
    [startIso, endIso])

  // Per-concert breakdown (komende concerten die actief in verkoop zijn)
  const concertRows = await queryAll<any>(db,
    `SELECT c.id, c.titel, c.capaciteit,
       (SELECT COUNT(*) FROM tickets t WHERE t.concert_id = c.id AND t.status = 'paid'
         AND datetime(t.betaald_op) >= datetime(?) AND datetime(t.betaald_op) < datetime(?)) as orders_lw,
       (SELECT COALESCE(SUM(prijs_totaal), 0) FROM tickets t WHERE t.concert_id = c.id AND t.status = 'paid'
         AND datetime(t.betaald_op) >= datetime(?) AND datetime(t.betaald_op) < datetime(?)) as revenue_lw,
       (SELECT COUNT(*) FROM ticket_seats ts
          JOIN tickets t ON t.id = ts.ticket_id
          WHERE t.concert_id = c.id AND t.status = 'paid') as seats_sold_total,
       (SELECT COUNT(*) FROM tickets t WHERE t.concert_id = c.id AND t.status = 'paid') as orders_total
     FROM concerten c
     WHERE datetime(c.start_at) >= datetime('now')
     ORDER BY c.start_at ASC
     LIMIT 6`,
    [startIso, endIso, startIso, endIso])

  const concertBreakdown = concertRows.map((c: any) => {
    const seats = c.seats_sold_total || c.orders_total || 0
    const cap = c.capaciteit || null
    const pct = cap ? Math.round((seats / cap) * 100) : null
    return {
      titel: c.titel,
      orders: Number(c.orders_lw) || 0,
      revenue: Number(c.revenue_lw) || 0,
      seatsSold: seats,
      seatsAvailable: cap ? Math.max(0, cap - seats) : null,
      occupancyPct: pct
    }
  })

  const hotSelling = concertBreakdown
    .filter(c => c.orders >= 5)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3)
    .map(c => ({ titel: c.titel, ordersLastWeek: c.orders, occupancyPct: c.occupancyPct }))

  // ---- Deze week op de agenda ----
  const nextWeekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const upcomingEvents = await queryAll<any>(db,
    `SELECT titel, start_at, type FROM events
     WHERE datetime(start_at) >= datetime('now')
       AND datetime(start_at) < datetime(?)
     ORDER BY start_at ASC LIMIT 15`,
    [nextWeekEnd])
  const upcomingEventsList = upcomingEvents.map((e: any) => ({
    titel: e.titel,
    when: formatBrusselsDateTime(e.start_at),
    type: e.type
  }))

  // Verjaardagen komende 7 dagen
  const bdayRows = await queryAll<any>(db,
    `SELECT p.voornaam, p.achternaam, p.geboortedatum, u.stemgroep,
       CAST(strftime('%d', p.geboortedatum) AS INTEGER) AS gebdag,
       CAST(strftime('%m', p.geboortedatum) AS INTEGER) AS gebmaand
     FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief' AND u.role NOT IN ('bezoeker','kaartkoper')
       AND COALESCE(u.is_test_account,0) = 0 AND p.geboortedatum IS NOT NULL`)
  const nowD = new Date(now.getTime())
  const upcomingBdays: any[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(nowD.getTime() + i * 24 * 60 * 60 * 1000)
    const dag = d.getUTCDate()
    const maand = d.getUTCMonth() + 1
    for (const b of bdayRows) {
      if (b.gebdag === dag && b.gebmaand === maand) {
        upcomingBdays.push({
          naam: `${b.voornaam || ''} ${b.achternaam || ''}`.trim(),
          dag: b.gebdag,
          maand: b.gebmaand,
          stemgroep: b.stemgroep
        })
      }
    }
  }

  // ---- Website-activiteit ----
  const nieuwsCount = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM nieuws
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    [startIso, endIso])
  const commentsCount = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM nieuws_comments
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    [startIso, endIso]).catch(() => ({ n: 0 }))
  const aiCount = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM nieuws
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
       AND (ai_generated = 1 OR is_ai_generated = 1)`,
    [startIso, endIso]).catch(() => ({ n: 0 }))
  const photosCount = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM fotoboek_photos
     WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    [startIso, endIso]).catch(() => ({ n: 0 }))

  // ---- Attention needed ----
  const stuckOpen = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM tickets
     WHERE status = 'pending'
       AND datetime(created_at) < datetime('now', '-24 hours')
       AND datetime(created_at) > datetime('now', '-30 days')`)

  // Leden die laatste 4 repetities gemist hebben
  const missing = await queryAll<any>(db, `
    WITH last_reps AS (
      SELECT id FROM events
      WHERE type = 'repetitie' AND datetime(start_at) < datetime('now')
      ORDER BY start_at DESC LIMIT 4
    ),
    active_zangers AS (
      SELECT u.id, p.voornaam, p.achternaam FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief' AND u.role NOT IN ('bezoeker','kaartkoper','dirigent','pianist')
        AND COALESCE(u.is_test_account,0) = 0
    )
    SELECT az.voornaam, az.achternaam,
      (SELECT COUNT(*) FROM last_reps lr
       WHERE NOT EXISTS (
         SELECT 1 FROM qr_checkins qc WHERE qc.user_id = az.id AND qc.event_id = lr.id
       )) as missed
    FROM active_zangers az
    HAVING missed >= 4
    ORDER BY az.achternaam, az.voornaam
    LIMIT 10
  `).catch(() => [])
  const membersMissing = missing.map((m: any) => ({
    naam: `${m.voornaam || ''} ${m.achternaam || ''}`.trim(),
    missed: m.missed
  }))

  return {
    weekStart: startIso,
    weekEnd: endIso,
    newMembers: newMembers?.n || 0,
    activatedMembers: activated?.n || 0,
    deactivatedMembers: deactivated?.n || 0,
    loginsMembers: Number(loginStats.leden) || 0,
    loginsKaartkopers: Number(loginStats.kaartkopers) || 0,
    loginsAdmins: Number(loginStats.admins) || 0,
    passwordResetsRequested: pwResets?.n || 0,
    ordersLastWeek: orders?.n || 0,
    revenueLastWeek: Number(orders?.revenue) || 0,
    concertBreakdown,
    hotSellingConcerts: hotSelling,
    upcomingEvents: upcomingEventsList,
    upcomingBirthdays: upcomingBdays,
    nieuwsPosted: nieuwsCount?.n || 0,
    commentsPosted: commentsCount?.n || 0,
    aiNewsGenerated: aiCount?.n || 0,
    photosUploaded: photosCount?.n || 0,
    stuckOpenOrders: stuckOpen?.n || 0,
    membersMissingRehearsals: membersMissing
  }
}

function weeklyReportHtml(data: WeeklyReportData, siteUrl: string, ontvangerNaam: string): string {
  const startFmt = formatBrusselsDate(data.weekStart, { weekday: 'short', day: 'numeric', month: 'short' })
  const endFmt = formatBrusselsDate(data.weekEnd, { weekday: 'short', day: 'numeric', month: 'short' })
  const revenue = data.revenueLastWeek.toFixed(2).replace('.', ',')

  const concertRows = data.concertBreakdown.length > 0
    ? data.concertBreakdown.map(c => {
        const pct = c.occupancyPct !== null ? `${c.occupancyPct}%` : '—'
        const revText = c.revenue.toFixed(2).replace('.', ',')
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${c.titel}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${c.orders}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">€ ${revText}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${c.seatsSold}${c.seatsAvailable !== null ? ` / ${c.seatsSold + c.seatsAvailable}` : ''}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${pct}</td>
        </tr>`
      }).join('')
    : '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;">Geen komende concerten</td></tr>'

  const hotList = data.hotSellingConcerts.length > 0
    ? '<ul style="margin:0;padding-left:20px;">' + data.hotSellingConcerts.map(h =>
        `<li><strong>${h.titel}</strong> — ${h.ordersLastWeek} orders${h.occupancyPct !== null ? ` (${h.occupancyPct}% vol)` : ''}</li>`
      ).join('') + '</ul>'
    : '<p style="margin:0;color:#666;font-style:italic;">Geen concerten met noemenswaardige verkoop deze week.</p>'

  const eventsList = data.upcomingEvents.length > 0
    ? '<ul style="margin:0;padding-left:20px;">' + data.upcomingEvents.slice(0, 10).map(e =>
        `<li><strong>${e.when}</strong> — ${e.titel} <span style="color:#999;font-size:12px;">(${e.type})</span></li>`
      ).join('') + '</ul>'
    : '<p style="margin:0;color:#666;font-style:italic;">Geen events gepland deze week.</p>'

  const bdayList = data.upcomingBirthdays.length > 0
    ? '<ul style="margin:0;padding-left:20px;">' + data.upcomingBirthdays.map(b =>
        `<li>${b.naam} — ${b.dag}/${b.maand}${b.stemgroep ? ' (' + b.stemgroep + ')' : ''}</li>`
      ).join('') + '</ul>'
    : '<p style="margin:0;color:#666;font-style:italic;">Geen verjaardagen deze week.</p>'

  const missingList = data.membersMissingRehearsals.length > 0
    ? '<ul style="margin:0;padding-left:20px;color:#b45309;">' + data.membersMissingRehearsals.map(m =>
        `<li>${m.naam} — ${m.missed} repetities op rij gemist</li>`
      ).join('') + '</ul>'
    : '<p style="margin:0;color:#059669;">Alle koorleden waren regelmatig aanwezig. 🎉</p>'

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Wekelijks rapport</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;margin:0;color:#111;">
  <table role="presentation" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.05);">
    <tr><td style="background:#7c3aed;padding:24px;color:#ffffff;">
      <h1 style="margin:0;font-size:22px;">📊 Weekrapport Animato</h1>
      <p style="margin:6px 0 0;opacity:0.9;font-size:14px;">${startFmt} → ${endFmt}</p>
    </td></tr>

    <tr><td style="padding:24px 24px 8px;">
      <p style="margin:0 0 8px;">Hoi ${ontvangerNaam || 'admin'},</p>
      <p style="margin:0 0 16px;">Hier is je maandag-overzicht van wat er vorige week op de Animato website gebeurde.</p>
    </td></tr>

    <!-- Leden -->
    <tr><td style="padding:8px 24px;">
      <h2 style="margin:16px 0 8px;font-size:16px;color:#7c3aed;border-bottom:2px solid #ede9fe;padding-bottom:4px;">👥 Leden</h2>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;">
        <tr>
          <td style="padding:4px 8px;background:#f9fafb;border-radius:4px;">Nieuwe leden: <strong>${data.newMembers}</strong></td>
          <td style="padding:4px 8px;background:#f9fafb;border-radius:4px;">Gedeactiveerd: <strong>${data.deactivatedMembers}</strong></td>
        </tr>
        <tr>
          <td colspan="2" style="padding-top:8px;">
            Logins: <strong>${data.loginsMembers}</strong> leden · <strong>${data.loginsKaartkopers}</strong> kaartkopers · <strong>${data.loginsAdmins}</strong> admins
          </td>
        </tr>
        ${data.passwordResetsRequested > 0 ? `<tr><td colspan="2" style="padding-top:4px;color:#666;">${data.passwordResetsRequested} wachtwoord-reset(s) aangevraagd</td></tr>` : ''}
      </table>
    </td></tr>

    <!-- Kaartverkoop -->
    <tr><td style="padding:8px 24px;">
      <h2 style="margin:16px 0 8px;font-size:16px;color:#7c3aed;border-bottom:2px solid #ede9fe;padding-bottom:4px;">🎫 Kaartverkoop</h2>
      <p style="margin:0 0 12px;font-size:14px;">
        <strong>${data.ordersLastWeek}</strong> orders vorige week — <strong style="color:#059669;">€ ${revenue}</strong> omzet
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:13px;border:1px solid #eee;border-radius:4px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <th style="padding:8px;text-align:left;">Concert</th>
          <th style="padding:8px;text-align:center;">Orders (vw)</th>
          <th style="padding:8px;text-align:right;">Omzet (vw)</th>
          <th style="padding:8px;text-align:center;">Verkocht</th>
          <th style="padding:8px;text-align:center;">Bezetting</th>
        </tr>
        ${concertRows}
      </table>
      <h3 style="margin:16px 0 4px;font-size:14px;">🔥 Warm verkopend deze week</h3>
      ${hotList}
    </td></tr>

    <!-- Deze week -->
    <tr><td style="padding:8px 24px;">
      <h2 style="margin:16px 0 8px;font-size:16px;color:#7c3aed;border-bottom:2px solid #ede9fe;padding-bottom:4px;">📅 Deze week op de agenda</h2>
      ${eventsList}
      <h3 style="margin:16px 0 4px;font-size:14px;">🎂 Verjaardagen komende 7 dagen</h3>
      ${bdayList}
    </td></tr>

    <!-- Website-activiteit -->
    <tr><td style="padding:8px 24px;">
      <h2 style="margin:16px 0 8px;font-size:16px;color:#7c3aed;border-bottom:2px solid #ede9fe;padding-bottom:4px;">💬 Website-activiteit</h2>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;">
        <tr>
          <td style="padding:4px 8px;">Nieuws-berichten: <strong>${data.nieuwsPosted}</strong></td>
          <td style="padding:4px 8px;">Reacties: <strong>${data.commentsPosted}</strong></td>
        </tr>
        <tr>
          <td style="padding:4px 8px;">AI-nieuws gegenereerd: <strong>${data.aiNewsGenerated}</strong></td>
          <td style="padding:4px 8px;">Foto's geüpload: <strong>${data.photosUploaded}</strong></td>
        </tr>
      </table>
    </td></tr>

    <!-- Attention needed -->
    <tr><td style="padding:8px 24px 24px;">
      <h2 style="margin:16px 0 8px;font-size:16px;color:#b45309;border-bottom:2px solid #fed7aa;padding-bottom:4px;">⚠️ Aandachtspunten</h2>
      ${data.stuckOpenOrders > 0
        ? `<p style="margin:0 0 8px;"><strong style="color:#b45309;">${data.stuckOpenOrders}</strong> openstaande order(s) langer dan 24u — waarschijnlijk verlaten winkelmandjes.</p>`
        : '<p style="margin:0 0 8px;color:#059669;">Geen vastzittende orders. ✅</p>'}
      <h3 style="margin:12px 0 4px;font-size:14px;">Leden die vaak afwezig zijn</h3>
      ${missingList}
    </td></tr>

    <tr><td style="padding:0 24px 24px;text-align:center;">
      <a href="${siteUrl}/admin" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">📊 Naar het Admin Dashboard</a>
    </td></tr>

    <tr><td style="padding:16px 24px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af;">
      Je ontvangt dit rapport omdat je admin of bestuurslid bent van Gemengd Koor Animato.<br>
      Wil je dit uitschakelen? Zet <em>"Wekelijks rapport"</em> uit in <a href="${siteUrl}/leden/profiel" style="color:#7c3aed;">je profielinstellingen</a>.
    </td></tr>
  </table>
</body></html>`
}

export async function sendWeeklyReport(
  db: D1Database,
  resendApiKey: string | undefined,
  siteUrl: string
): Promise<{ sent: number; skipped: number; data: WeeklyReportData }> {
  const recipients = await getAdminRecipients(db, 'notify_weekly_report')
  const data = await buildWeeklyReport(db)

  if (recipients.length === 0) return { sent: 0, skipped: 0, data }
  if (!resendApiKey) {
    console.warn('[weekly-report] RESEND_API_KEY missing — skipping', recipients.length, 'recipients')
    return { sent: 0, skipped: recipients.length, data }
  }

  const weekEndFmt = formatBrusselsDate(data.weekEnd, { day: 'numeric', month: 'short' })
  let sent = 0
  let skipped = 0
  for (const r of recipients) {
    const naam = [r.voornaam, r.achternaam].filter(Boolean).join(' ').trim()
    const html = weeklyReportHtml(data, siteUrl, naam)
    const ok = await sendEmail({
      to: r.email,
      subject: `📊 Animato weekrapport — ${data.ordersLastWeek} orders, € ${data.revenueLastWeek.toFixed(2).replace('.', ',')} (tot ${weekEndFmt})`,
      html,
      category: 'weekly_report',
    }, resendApiKey, db)
    if (ok) sent++
    else skipped++
  }
  return { sent, skipped, data }
}

