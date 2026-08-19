// utils/ticket-resend.ts
// Gedeelde helpers voor de "tickets opnieuw versturen" flow:
//   - laadt bewaarde template uit system_settings
//   - haalt volledige order-context op (ticket rijen + concert + seats)
//   - rendert placeholders in de gebruiker-editable template
//   - genereert PDF-attachments (optioneel)
//
// Placeholder-syntax: {{koper_naam}}, {{concert_titel}}, {{concert_datum}},
// {{concert_tijd}}, {{concert_locatie}}, {{order_ref}}, {{tickets_summary}},
// {{totaal_bedrag}}, {{member_portal_url}}
//
// Placeholders die niet oplossen blijven letterlijk staan — dat maakt debuggen
// simpeler dan een lege plek.

import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'
import { queryAll, queryOne } from './db'
import { generateSeatTicketPdfs, generateTicketPdf, uint8ArrayToBase64 } from './ticket-pdf'
import { getSiteUrl } from './site-url'
import { parseBrusselsDate, formatBrusselsTime, formatBrusselsDate } from './time'

// --- constants (system_settings keys) --------------------------------------
export const RESEND_TEMPLATE_SUBJECT_KEY = 'ticket_resend_template_subject'
export const RESEND_TEMPLATE_HTML_KEY    = 'ticket_resend_template_html'

// --- fallback template (als system_settings entries ontbreken) -------------
const FALLBACK_SUBJECT = 'Je tickets voor {{concert_titel}} — {{order_ref}}'
const FALLBACK_HTML = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
  <p>Beste {{koper_naam}},</p>
  <p>Je tickets voor <strong>{{concert_titel}}</strong> op {{concert_datum}} om {{concert_tijd}} in {{concert_locatie}} zijn opnieuw bijgevoegd.</p>
  <p><strong>Bestelling:</strong> {{order_ref}}<br><strong>Tickets:</strong> {{tickets_summary}}</p>
  <p>Muzikale groeten,<br>Gemengd Koor Animato</p>
</div>`

// --- shared types ----------------------------------------------------------
export interface TicketOrderContext {
  order_ref: string
  koper_naam: string
  koper_email: string
  concert_titel: string
  concert_datum: string  // NL-formatted, e.g. "vrijdag 25 december 2026"
  concert_tijd: string   // "20:00"
  concert_doors_open: string | null
  concert_locatie: string
  concert_adres: string | null
  tickets_summary: string
  totaal_bedrag: number
  member_portal_url: string | null
  // Ruwe rijen voor PDF-generatie
  rows: any[]
  seatRows: any[]
}

export interface RenderedEmail {
  subject: string
  html: string
}

// --- template loading ------------------------------------------------------
export async function loadResendTemplate(db: D1Database): Promise<{ subject: string; html: string }> {
  const [subj, html] = await Promise.all([
    queryOne<any>(db, `SELECT value FROM system_settings WHERE key = ?`, [RESEND_TEMPLATE_SUBJECT_KEY]),
    queryOne<any>(db, `SELECT value FROM system_settings WHERE key = ?`, [RESEND_TEMPLATE_HTML_KEY]),
  ])
  return {
    subject: subj?.value || FALLBACK_SUBJECT,
    html:    html?.value || FALLBACK_HTML,
  }
}

export async function saveResendTemplate(db: D1Database, subject: string, html: string): Promise<void> {
  await db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(RESEND_TEMPLATE_SUBJECT_KEY, subject).run()

  await db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(RESEND_TEMPLATE_HTML_KEY, html).run()
}

// --- order context loader --------------------------------------------------
export async function loadTicketOrderContext(c: Context, ticketId: number): Promise<TicketOrderContext | null> {
  // Vind order_ref via ticket-id
  const ref = await queryOne<any>(c.env.DB,
    `SELECT order_ref FROM tickets WHERE id = ?`, [ticketId])
  if (!ref) return null

  // Alle rijen + concert-info
  const rows = await queryAll<any>(c.env.DB,
    `SELECT t.*, e.titel, e.start_at, e.locatie,
            TRIM(COALESCE(l.adres, '') || CASE WHEN l.postcode IS NOT NULL OR l.stad IS NOT NULL
              THEN ', ' || COALESCE(l.postcode, '') || ' ' || COALESCE(l.stad, '')
              ELSE '' END) AS adres,
            c.doors_open_at, c.concert_start_at
     FROM tickets t
     JOIN concerts c ON c.id = t.concert_id
     JOIN events e   ON e.id = c.event_id
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE t.order_ref = ?
     ORDER BY t.id ASC`, [ref.order_ref])
  if (!rows || rows.length === 0) return null

  const ticket = rows[0]

  // Seats (voor per-seat PDF's)
  let seatRows: any[] = []
  try {
    const r = await c.env.DB.prepare(
      `SELECT ts.id AS ticket_seat_id, ts.ticket_id, t.qr_code, t.categorie, t.prijs_totaal,
              s.section_name, s.row_label, s.seat_number
       FROM ticket_seats ts
       JOIN tickets t ON t.id = ts.ticket_id
       JOIN seats s ON s.id = ts.seat_id
       WHERE t.order_ref = ?
       ORDER BY s.row_label, s.seat_number`
    ).bind(ref.order_ref).all<any>()
    seatRows = r?.results || []
  } catch {}

  // Datum / tijd — altijd in Brussels-tijdzone (Cloudflare Workers = UTC runtime).
  const concertDatum = formatBrusselsDate(ticket.start_at,
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const aanvangSource = ticket.concert_start_at || ticket.start_at
  const concertTijd = formatBrusselsTime(aanvangSource)
  const concertDoorsOpen = ticket.doors_open_at
    ? formatBrusselsTime(ticket.doors_open_at)
    : null

  const totaalBedrag = rows.reduce((s: number, t: any) => s + (Number(t.prijs_totaal) || 0), 0)
  const ticketsSummary = rows.map((t: any) => `${t.aantal}× ${t.categorie}`).join(', ')

  // Member-portal link (alleen als koper een actieve user is)
  let memberPortalUrl: string | null = null
  try {
    const u = await queryOne<any>(c.env.DB,
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND status = 'actief' LIMIT 1`,
      [ticket.koper_email])
    if (u) {
      const siteUrl = await getSiteUrl(c)
      memberPortalUrl = `${siteUrl}/leden/mijn-tickets/${encodeURIComponent(ref.order_ref)}`
    }
  } catch {}

  return {
    order_ref: ref.order_ref,
    koper_naam: ticket.koper_naam || '',
    koper_email: ticket.koper_email || '',
    concert_titel: ticket.titel || '',
    concert_datum: concertDatum,
    concert_tijd: concertTijd,
    concert_doors_open: concertDoorsOpen,
    concert_locatie: ticket.locatie || '',
    concert_adres: ticket.adres || null,
    tickets_summary: ticketsSummary,
    totaal_bedrag: totaalBedrag,
    member_portal_url: memberPortalUrl,
    rows,
    seatRows,
  }
}

// --- template rendering ----------------------------------------------------
export function renderTemplate(template: string, ctx: TicketOrderContext): string {
  // Simpele string-replace op {{placeholder}}. Placeholders die niet in de
  // map staan, blijven letterlijk staan — dat maakt fouten zichtbaar.
  const map: Record<string, string> = {
    koper_naam:        ctx.koper_naam,
    koper_email:       ctx.koper_email,
    concert_titel:     ctx.concert_titel,
    concert_datum:     ctx.concert_datum,
    concert_tijd:      ctx.concert_tijd,
    concert_locatie:   ctx.concert_locatie,
    concert_adres:     ctx.concert_adres || '',
    order_ref:         ctx.order_ref,
    tickets_summary:   ctx.tickets_summary,
    totaal_bedrag:     ctx.totaal_bedrag.toFixed(2),
    member_portal_url: ctx.member_portal_url || '',
  }
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, key) => {
    return key in map ? map[key] : m
  })
}

export function renderEmail(subject: string, html: string, ctx: TicketOrderContext): RenderedEmail {
  return {
    subject: renderTemplate(subject, ctx),
    html:    renderTemplate(html, ctx),
  }
}

// --- PDF attachments (identiek aan webhook-flow) --------------------------
export async function buildTicketAttachments(
  ctx: TicketOrderContext,
  logoBytes: Uint8Array | null | undefined
): Promise<Array<{ filename: string; content: string; contentType: string }>> {
  if (ctx.seatRows.length > 0) {
    const pdfs = await generateSeatTicketPdfs({
      order_ref:          ctx.order_ref,
      koper_naam:         ctx.koper_naam,
      koper_email:        ctx.koper_email,
      concert_titel:      ctx.concert_titel,
      concert_datum:      ctx.concert_datum,
      concert_tijd:       ctx.concert_tijd,
      concert_doors_open: ctx.concert_doors_open,
      concert_locatie:    ctx.concert_locatie,
      concert_adres:      ctx.concert_adres,
      logo_png_bytes:     logoBytes || undefined,
      seats: ctx.seatRows.map((s: any) => ({
        qr_code:     `${s.qr_code}-${s.ticket_seat_id}`,
        categorie:   s.categorie,
        prijs:       Number(s.prijs_totaal) / Math.max(1, ctx.seatRows.filter(x => x.ticket_id === s.ticket_id).length),
        seat_label:  `Rij ${s.row_label} — Stoel ${s.seat_number}`,
        seat_sectie: s.section_name || null,
      })),
    })
    return pdfs.map(p => ({
      filename:    p.filename,
      content:     uint8ArrayToBase64(p.bytes),
      contentType: 'application/pdf',
    }))
  }
  // Fallback: één multi-page order PDF
  const pdfBytes = await generateTicketPdf({
    order_ref:          ctx.order_ref,
    koper_naam:         ctx.koper_naam,
    koper_email:        ctx.koper_email,
    concert_titel:      ctx.concert_titel,
    concert_datum:      ctx.concert_datum,
    concert_tijd:       ctx.concert_tijd,
    concert_doors_open: ctx.concert_doors_open,
    concert_locatie:    ctx.concert_locatie,
    concert_adres:      ctx.concert_adres,
    totaal_bedrag:      ctx.totaal_bedrag,
    lines: ctx.rows.map((t: any) => ({
      qr_code:      t.qr_code,
      categorie:    t.categorie,
      aantal:       t.aantal,
      prijs_totaal: Number(t.prijs_totaal) || 0,
    })),
  })
  return [{
    filename:    `tickets-${ctx.order_ref}.pdf`,
    content:     uint8ArrayToBase64(pdfBytes),
    contentType: 'application/pdf',
  }]
}

// --- logo bytes (best-effort) ---------------------------------------------
export async function loadTicketLogoBytes(db: D1Database): Promise<Uint8Array | null> {
  try {
    const logoSetting = await queryOne<any>(db,
      `SELECT value FROM system_settings WHERE key = 'ticket_logo_url' OR key = 'site_logo_url' ORDER BY key DESC LIMIT 1`,
      [])
    if (logoSetting?.value && /^https?:\/\//.test(logoSetting.value)) {
      const resp = await fetch(logoSetting.value)
      if (resp.ok) {
        const ct = resp.headers.get('content-type') || ''
        if (ct.includes('png')) {
          return new Uint8Array(await resp.arrayBuffer())
        }
      }
    }
  } catch {}
  return null
}
