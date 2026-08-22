// Leden-portaal: Mijn Tickets
// ---------------------------
// Toont alle ticket-bestellingen die match'en met de email van de ingelogde gebruiker.
// Routes:
//   GET  /leden/mijn-tickets               → overzicht van alle bestellingen
//   GET  /leden/mijn-tickets/:order_ref    → detail van één bestelling + per-stoel downloads
//   GET  /leden/mijn-tickets/:order_ref/zip → download alle PDF's als ZIP
//   GET  /leden/mijn-tickets/:order_ref/seat/:ticket_seat_id → download 1 PDF
//
// Strikte email-match: WHERE LOWER(t.koper_email) = LOWER(user.email)
// (volgens MVP-keuze van Dominique)

import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'
import { generateSeatTicketPdf, generateSeatTicketPdfs, generateTicketPdf } from '../utils/ticket-pdf'
import { zipTicketPdfs } from '../utils/ticket-zip'
import { parseBrusselsDate, formatBrusselsTime, formatBrusselsDate } from '../utils/time'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', requireAuth)

// ─────────────────────────────────────────────────────────────────────
// HELPER: fetch all paid orders for a user (matched by email)
// ─────────────────────────────────────────────────────────────────────
async function fetchUserOrders(db: D1Database, email: string) {
  // Groepeer per order_ref (één bestelling kan meerdere categorie-rijen hebben)
  const rows = await queryAll<any>(db, `
    SELECT
      t.order_ref,
      t.status,
      t.koper_naam,
      t.koper_email,
      t.created_at,
      t.betaald_at,
      e.id AS event_id,
      e.titel AS concert_titel,
      e.start_at,
      e.locatie,
      TRIM(COALESCE(l.adres, '') || CASE WHEN l.postcode IS NOT NULL OR l.stad IS NOT NULL
        THEN ', ' || COALESCE(l.postcode, '') || ' ' || COALESCE(l.stad, '')
        ELSE '' END) AS adres,
      c.id AS concert_id,
      c.doors_open_at,
      c.concert_start_at,
      SUM(t.prijs_totaal) AS totaal_bedrag,
      SUM(t.aantal) AS totaal_kaarten,
      GROUP_CONCAT(t.categorie || ' (' || t.aantal || '×)', ', ') AS categorie_samenvatting,
      (SELECT COUNT(*) FROM ticket_seats ts2
       JOIN tickets t2 ON t2.id = ts2.ticket_id
       WHERE t2.order_ref = t.order_ref) AS seat_count
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    LEFT JOIN locations l ON l.id = e.location_id
    WHERE LOWER(t.koper_email) = LOWER(?)
      AND t.status = 'paid'
    GROUP BY t.order_ref
    ORDER BY datetime(e.start_at) DESC
  `, [email])
  return rows
}

/**
 * Haal alle seat-rows voor een specifieke order op (full detail).
 * Includeert concert/event metadata + per-stoel ticket_seat_id (uniek scan-token).
 */
async function fetchOrderDetail(db: D1Database, orderRef: string, email: string) {
  const order = await queryOne<any>(db, `
    SELECT t.order_ref, t.koper_naam, t.koper_email, t.created_at, t.betaald_at,
           e.id AS event_id, e.titel AS concert_titel, e.start_at, e.locatie,
           TRIM(COALESCE(l.adres, '') || CASE WHEN l.postcode IS NOT NULL OR l.stad IS NOT NULL
             THEN ', ' || COALESCE(l.postcode, '') || ' ' || COALESCE(l.stad, '')
             ELSE '' END) AS adres,
           c.id AS concert_id, c.doors_open_at, c.concert_start_at,
           SUM(t.prijs_totaal) AS totaal_bedrag,
           SUM(t.aantal) AS totaal_kaarten
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    LEFT JOIN locations l ON l.id = e.location_id
    WHERE t.order_ref = ?
      AND LOWER(t.koper_email) = LOWER(?)
      AND t.status = 'paid'
    GROUP BY t.order_ref
  `, [orderRef, email])

  if (!order) return null

  // Stoelen + categorie info per stoel
  const seats = await queryAll<any>(db, `
    SELECT ts.id AS ticket_seat_id, ts.status AS seat_status,
           t.id AS ticket_id, t.qr_code, t.categorie, t.prijs_totaal AS line_total,
           t.aantal AS line_aantal,
           s.section_name, s.row_label, s.seat_number
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    JOIN seats s ON s.id = ts.seat_id
    WHERE t.order_ref = ?
    ORDER BY s.row_label, s.seat_number
  `, [orderRef])

  // Ticket-lines (voor fallback indien geen seats)
  const lines = await queryAll<any>(db, `
    SELECT id, qr_code, categorie, aantal, prijs_totaal
    FROM tickets
    WHERE order_ref = ?
    ORDER BY id ASC
  `, [orderRef])

  return { order, seats, lines }
}

/**
 * Geformatteerde datum/tijd voor PDF.
 */
function formatConcertDatum(startAt: string): string {
  return formatBrusselsDate(startAt, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}
function formatConcertTijd(t: string): string {
  return formatBrusselsTime(t)
}

/**
 * Probeer Animato-logo te laden uit settings (best-effort).
 */
async function loadLogoBytes(db: D1Database, fetch_: typeof fetch): Promise<Uint8Array | null> {
  try {
    const row = await queryOne<any>(db,
      `SELECT value FROM system_settings
       WHERE key IN ('ticket_logo_url','site_logo_url')
       ORDER BY CASE key WHEN 'ticket_logo_url' THEN 0 ELSE 1 END
       LIMIT 1`,
      [])
    if (!row?.value || !/^https?:\/\//.test(row.value)) return null
    const resp = await fetch_(row.value)
    if (!resp.ok) return null
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('png')) return null
    return new Uint8Array(await resp.arrayBuffer())
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────
// LIST PAGE: /leden/mijn-tickets
// ─────────────────────────────────────────────────────────────────────
app.get('/leden/mijn-tickets', async (c) => {
  const user = c.get('user') as SessionUser
  const orders = await fetchUserOrders(c.env.DB, user.email)

  // Split toekomstig/verleden
  const now = new Date()
  const upcoming = orders.filter((o: any) => (parseBrusselsDate(o.start_at)?.getTime() ?? 0) >= now.getTime())
  const past = orders.filter((o: any) => (parseBrusselsDate(o.start_at)?.getTime() ?? 0) < now.getTime())

  return c.html(
    <Layout title="Mijn Tickets" user={user}>
      <div class="py-10 bg-gray-50 min-h-screen">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                🎫 Mijn Tickets
              </h1>
              <p class="text-gray-600">
                Overzicht van al je tickets voor Animato-concerten. Download per stoel of als bundel.
              </p>
            </div>
            <a href="/leden" class="text-animato-primary hover:underline whitespace-nowrap">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar dashboard
            </a>
          </div>

          {orders.length === 0 && (
            <div class="bg-white rounded-xl shadow p-8 text-center">
              <i class="fas fa-ticket-alt text-5xl text-gray-300 mb-4"></i>
              <h2 class="text-xl font-bold text-gray-700 mb-2">Geen tickets gevonden</h2>
              <p class="text-gray-500 mb-4">
                We vinden geen tickets onder <strong>{user.email}</strong>.
                Heb je gekocht met een ander emailadres? Neem contact op via{' '}
                <a href="mailto:info@gemengdkooranimato.be" class="text-animato-primary hover:underline">info@gemengdkooranimato.be</a>.
              </p>
              <a href="/concerten" class="inline-block mt-2 px-5 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition">
                Bekijk concerten
              </a>
            </div>
          )}

          {upcoming.length > 0 && (
            <section class="mb-10">
              <h2 class="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2">
                <i class="fas fa-calendar-alt text-animato-primary"></i>
                Aankomende concerten
                <span class="text-sm font-normal text-gray-500">({upcoming.length})</span>
              </h2>
              <div class="space-y-4">
                {upcoming.map((o: any) => <OrderCard order={o} isPast={false} />)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 class="text-xl font-bold text-gray-500 mb-4 flex items-center gap-2">
                <i class="fas fa-history text-gray-400"></i>
                Vroegere concerten
                <span class="text-sm font-normal text-gray-400">({past.length})</span>
              </h2>
              <div class="space-y-4 opacity-75">
                {past.map((o: any) => <OrderCard order={o} isPast={true} />)}
              </div>
            </section>
          )}

        </div>
      </div>
    </Layout>
  )
})

// ─────────────────────────────────────────────────────────────────────
// REUSABLE: Order-card component
// ─────────────────────────────────────────────────────────────────────
function OrderCard({ order, isPast }: { order: any; isPast: boolean }) {
  const datum = formatBrusselsDate(order.start_at, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  const tijd = formatBrusselsTime(order.start_at)

  return (
    <div class={`bg-white rounded-xl shadow-md overflow-hidden border-l-4 ${isPast ? 'border-gray-300' : 'border-animato-primary'} hover:shadow-lg transition-shadow`}>
      <div class="p-6">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div class="flex-1">
            <h3 class="text-xl font-bold text-gray-800 mb-1" style="font-family: 'Playfair Display', serif;">
              {order.concert_titel}
            </h3>
            <div class="text-sm text-gray-600 space-y-1">
              <div><i class="fas fa-calendar w-5 text-animato-primary"></i> {datum} om {tijd} uur</div>
              <div><i class="fas fa-map-marker-alt w-5 text-animato-primary"></i> {order.locatie}{order.adres ? `, ${order.adres}` : ''}</div>
              <div><i class="fas fa-ticket-alt w-5 text-animato-primary"></i> {order.totaal_kaarten} ticket(s) — {order.categorie_samenvatting}</div>
              <div class="text-xs text-gray-500 pt-1">Bestelling: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{order.order_ref}</code></div>
            </div>
          </div>
          <div class="flex flex-col gap-2 md:items-end md:min-w-[200px]">
            <a
              href={`/leden/mijn-tickets/${encodeURIComponent(order.order_ref)}`}
              class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition whitespace-nowrap"
            >
              <i class="fas fa-eye"></i> Bekijk tickets
            </a>
            {Number(order.seat_count) > 0 && !isPast && (
              <a
                href={`/leden/mijn-tickets/${encodeURIComponent(order.order_ref)}/zip`}
                class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-animato-primary text-animato-primary rounded-lg hover:bg-blue-50 transition whitespace-nowrap text-sm"
              >
                <i class="fas fa-file-archive"></i> Download alle PDF's (ZIP)
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// DETAIL PAGE: /leden/mijn-tickets/:order_ref
// ─────────────────────────────────────────────────────────────────────
app.get('/leden/mijn-tickets/:order_ref', async (c) => {
  const user = c.get('user') as SessionUser
  const orderRef = c.req.param('order_ref')
  const detail = await fetchOrderDetail(c.env.DB, orderRef, user.email)

  if (!detail) {
    return c.html(
      <Layout title="Bestelling niet gevonden" user={user}>
        <div class="py-16 bg-gray-50 min-h-screen">
          <div class="max-w-2xl mx-auto px-4 text-center">
            <i class="fas fa-exclamation-triangle text-5xl text-amber-400 mb-4"></i>
            <h1 class="text-2xl font-bold text-gray-800 mb-2">Bestelling niet gevonden</h1>
            <p class="text-gray-600 mb-6">
              We vonden geen betaalde bestelling met referentie <code class="bg-gray-100 px-2 py-1 rounded">{orderRef}</code> onder jouw emailadres <strong>{user.email}</strong>.
            </p>
            <a href="/leden/mijn-tickets" class="inline-block px-5 py-2 bg-animato-primary text-white rounded-lg">
              ← Terug naar overzicht
            </a>
          </div>
        </div>
      </Layout>,
      404
    )
  }

  const { order, seats, lines } = detail
  const datum = formatBrusselsDate(order.start_at, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  const tijd = formatBrusselsTime(order.start_at)
  const doorsOpen = order.doors_open_at ? formatBrusselsTime(order.doors_open_at) : null

  return c.html(
    <Layout title={`Tickets — ${order.concert_titel}`} user={user}>
      <div class="py-10 bg-gray-50 min-h-screen">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

          <div class="mb-6">
            <a href="/leden/mijn-tickets" class="text-animato-primary hover:underline text-sm">
              <i class="fas fa-arrow-left mr-1"></i> Terug naar alle bestellingen
            </a>
          </div>

          {/* Concert-header card */}
          <div class="bg-gradient-to-br from-animato-primary to-animato-secondary text-white rounded-xl shadow-lg p-8 mb-6">
            <h1 class="text-3xl font-bold mb-2" style="font-family: 'Playfair Display', serif;">
              {order.concert_titel}
            </h1>
            <div class="space-y-1 text-blue-50">
              <div><i class="fas fa-calendar w-5"></i> {datum}</div>
              <div><i class="fas fa-clock w-5"></i> Aanvang {tijd} uur{doorsOpen ? ` (deuren open om ${doorsOpen})` : ''}</div>
              <div><i class="fas fa-map-marker-alt w-5"></i> {order.locatie}{order.adres ? `, ${order.adres}` : ''}</div>
              <div class="pt-2 text-sm opacity-90">
                Bestelling <code class="bg-white/20 px-1.5 py-0.5 rounded">{order.order_ref}</code> · {order.totaal_kaarten} kaart(en) · €{Number(order.totaal_bedrag).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Bulk download */}
          {seats.length > 0 && (
            <div class="bg-white rounded-xl shadow p-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div class="font-semibold text-gray-800">📦 Alle PDF's tegelijk</div>
                <div class="text-sm text-gray-500">{seats.length} PDF{seats.length > 1 ? "'s" : ''} in één ZIP-bestand</div>
              </div>
              <a
                href={`/leden/mijn-tickets/${encodeURIComponent(orderRef)}/zip`}
                class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
              >
                <i class="fas fa-file-archive"></i> Download ZIP
              </a>
            </div>
          )}

          {/* Per-stoel lijst */}
          {seats.length > 0 ? (
            <div class="bg-white rounded-xl shadow overflow-hidden">
              <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 class="font-bold text-gray-800">Jouw stoelen ({seats.length})</h2>
                <p class="text-sm text-gray-500">Klik op een rij voor de individuele PDF — handig om door te sturen via WhatsApp of mail.</p>
              </div>
              <ul class="divide-y divide-gray-200">
                {seats.map((s: any, i: number) => (
                  <li class="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50">
                    <div class="flex items-center gap-4">
                      <div class="w-12 h-12 rounded-full bg-animato-primary/10 flex items-center justify-center text-animato-primary font-bold">
                        {i + 1}
                      </div>
                      <div>
                        <div class="font-semibold text-gray-800">
                          {s.section_name ? `${s.section_name} — ` : ''}Rij {s.row_label} · Stoel {s.seat_number}
                        </div>
                        <div class="text-xs text-gray-500">{s.categorie}</div>
                      </div>
                    </div>
                    <a
                      href={`/leden/mijn-tickets/${encodeURIComponent(orderRef)}/seat/${s.ticket_seat_id}`}
                      class="inline-flex items-center gap-2 px-3 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm whitespace-nowrap"
                    >
                      <i class="fas fa-file-pdf"></i> Download PDF
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            // Fallback: geen toegewezen stoelen → toon ticket-lines
            <div class="bg-white rounded-xl shadow overflow-hidden">
              <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 class="font-bold text-gray-800">Tickets</h2>
                <p class="text-sm text-gray-500">Dit concert heeft geen vaste plaatsen.</p>
              </div>
              <ul class="divide-y divide-gray-200">
                {lines.map((l: any) => (
                  <li class="px-6 py-4 flex items-center justify-between">
                    <div>
                      <div class="font-semibold text-gray-800">{l.aantal}× {l.categorie}</div>
                      <div class="text-xs text-gray-500">€{Number(l.prijs_totaal).toFixed(2)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div class="px-6 py-4 border-t border-gray-200 bg-gray-50 text-right">
                <a
                  href={`/leden/mijn-tickets/${encodeURIComponent(orderRef)}/zip`}
                  class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-file-pdf"></i> Download tickets (PDF)
                </a>
              </div>
            </div>
          )}

          <div class="mt-6 text-xs text-gray-500 text-center">
            Tickets zijn persoonlijk. Bij verlies: mail naar <a href="mailto:info@gemengdkooranimato.be" class="text-animato-primary">info@gemengdkooranimato.be</a> met je ordernummer.
          </div>

        </div>
      </div>
    </Layout>
  )
})

// ─────────────────────────────────────────────────────────────────────
// DOWNLOAD: één stoel als PDF
// ─────────────────────────────────────────────────────────────────────
app.get('/leden/mijn-tickets/:order_ref/seat/:ticket_seat_id', async (c) => {
  const user = c.get('user') as SessionUser
  const orderRef = c.req.param('order_ref')
  const ticketSeatId = parseInt(c.req.param('ticket_seat_id'))

  if (!Number.isFinite(ticketSeatId)) return c.text('Invalid seat id', 400)

  const detail = await fetchOrderDetail(c.env.DB, orderRef, user.email)
  if (!detail) return c.text('Bestelling niet gevonden of geen toegang', 404)

  const seat = detail.seats.find((s: any) => s.ticket_seat_id === ticketSeatId)
  if (!seat) return c.text('Stoel niet in deze bestelling', 404)

  const idxInOrder = detail.seats.findIndex((s: any) => s.ticket_seat_id === ticketSeatId) + 1
  const total = detail.seats.length

  const logoBytes = await loadLogoBytes(c.env.DB, fetch)

  const aanvangSource = detail.order.concert_start_at ?? detail.order.start_at

  const pdfBytes = await generateSeatTicketPdf({
    order_ref: orderRef,
    koper_naam: detail.order.koper_naam,
    koper_email: detail.order.koper_email,
    concert_titel: detail.order.concert_titel,
    concert_datum: formatConcertDatum(detail.order.start_at),
    concert_tijd: formatBrusselsTime(aanvangSource),
    concert_doors_open: detail.order.doors_open_at ? formatBrusselsTime(detail.order.doors_open_at) : null,
    concert_locatie: detail.order.locatie || '',
    concert_adres: detail.order.adres || null,
    categorie: seat.categorie,
    prijs: Number(seat.line_total) / Math.max(1, detail.seats.filter((x: any) => x.ticket_id === seat.ticket_id).length),
    qr_code: `${seat.qr_code}-${seat.ticket_seat_id}`,
    seat_label: `Rij ${seat.row_label} — Stoel ${seat.seat_number}`,
    seat_sectie: seat.section_name || null,
    ticket_index: idxInOrder,
    ticket_total: total,
    logo_png_bytes: logoBytes
  })

  const safeLabel = `rij-${seat.row_label}-stoel-${seat.seat_number}`
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${orderRef}-${safeLabel}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// DOWNLOAD: hele bestelling als ZIP (of fallback PDF zonder seats)
// ─────────────────────────────────────────────────────────────────────
app.get('/leden/mijn-tickets/:order_ref/zip', async (c) => {
  const user = c.get('user') as SessionUser
  const orderRef = c.req.param('order_ref')

  const detail = await fetchOrderDetail(c.env.DB, orderRef, user.email)
  if (!detail) return c.text('Bestelling niet gevonden of geen toegang', 404)

  const logoBytes = await loadLogoBytes(c.env.DB, fetch)
  const aanvangSource = detail.order.concert_start_at ?? detail.order.start_at
  const concertDatum = formatConcertDatum(detail.order.start_at)
  const concertTijd = formatBrusselsTime(aanvangSource)
  const concertDoorsOpen = detail.order.doors_open_at ? formatBrusselsTime(detail.order.doors_open_at) : null

  // Met seats → ZIP met per-stoel PDF's
  if (detail.seats.length > 0) {
    const seatList = detail.seats.map((s: any) => ({
      qr_code: `${s.qr_code}-${s.ticket_seat_id}`,
      categorie: s.categorie,
      prijs: Number(s.line_total) / Math.max(1, detail.seats.filter((x: any) => x.ticket_id === s.ticket_id).length),
      seat_label: `Rij ${s.row_label} — Stoel ${s.seat_number}`,
      seat_sectie: s.section_name || null
    }))
    const pdfs = await generateSeatTicketPdfs({
      order_ref: orderRef,
      koper_naam: detail.order.koper_naam,
      koper_email: detail.order.koper_email,
      concert_titel: detail.order.concert_titel,
      concert_datum: concertDatum,
      concert_tijd: concertTijd,
      concert_doors_open: concertDoorsOpen,
      concert_locatie: detail.order.locatie || '',
      concert_adres: detail.order.adres || null,
      logo_png_bytes: logoBytes,
      seats: seatList
    })

    const readme = `Tickets voor: ${detail.order.concert_titel}
Datum: ${concertDatum}
Locatie: ${detail.order.locatie}
Aantal stoelen: ${detail.seats.length}
Bestelling: ${orderRef}

Elk PDF-bestand bevat één ticket voor één stoel, met een unieke QR-code.
Verspreid de juiste PDF aan de juiste persoon (per WhatsApp / email).
`

    const zipBytes = zipTicketPdfs(pdfs, readme)
    return new Response(zipBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="tickets-${orderRef}.zip"`,
        'Cache-Control': 'private, no-store'
      }
    })
  }

  // Zonder seats → fallback: legacy multi-pagina PDF (1 download)
  const pdfBytes = await generateTicketPdf({
    order_ref: orderRef,
    koper_naam: detail.order.koper_naam,
    koper_email: detail.order.koper_email,
    concert_titel: detail.order.concert_titel,
    concert_datum: concertDatum,
    concert_tijd: concertTijd,
    concert_doors_open: concertDoorsOpen,
    concert_locatie: detail.order.locatie || '',
    concert_adres: detail.order.adres || null,
    totaal_bedrag: Number(detail.order.totaal_bedrag) || 0,
    lines: detail.lines.map((l: any) => ({
      qr_code: l.qr_code,
      categorie: l.categorie,
      aantal: l.aantal,
      prijs_totaal: Number(l.prijs_totaal) || 0
    }))
  })
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tickets-${orderRef}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  })
})

export default app
