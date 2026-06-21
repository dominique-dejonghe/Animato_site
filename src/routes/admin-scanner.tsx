// ════════════════════════════════════════════════════════════════════════════
// QR Ticket Scanner — fase 1-7 uitbreiding
// ════════════════════════════════════════════════════════════════════════════
//
// Routes geboden in dit bestand:
//   GET  /admin/scanner                           Hub: concert kiezen
//   GET  /admin/scanner/:concertId                Scanner-pagina (camera + zaalplan)
//   GET  /api/admin/scanner/:concertId/state      Polling: zaalplan-state + counters
//   POST /api/admin/scanner/:concertId/check-in   Inchecken (1 of meer seats)
//   POST /api/admin/scanner/:concertId/uncheck-in Uitchecken (correctie)
//   GET  /api/admin/scanner/:concertId/search     Naam/email/order-zoek (debounced)
//   GET  /api/admin/scanner/:concertId/order/:ref Order ophalen (voor multi-seat modal)
//
// Auth: requireTicketScanner — admin, moderator, bestuurslid, OF user met
// can_scan_tickets=1. Wordt in Fase 6 gekoppeld aan het ledenfiche-vinkje.
// ════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { type SessionUser } from '../middleware/auth'
import { requireTicketScanner } from '../middleware/scanner'
import { queryAll, queryOne, execute, noCacheHeaders } from '../utils/db'

const app = new Hono()

// Alle scanner-routes vereisen scan-rechten (admin/moderator/bestuur/can_scan_tickets)
app.use('/admin/scanner', requireTicketScanner)
app.use('/admin/scanner/*', requireTicketScanner)
app.use('/api/admin/scanner/*', requireTicketScanner)

// ══════════════════════════════════════════════════════════════════════
// HUB — concert kiezen
// ══════════════════════════════════════════════════════════════════════
app.get('/admin/scanner', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Komende concerten met verkochte tickets (laatste 24u + volgende 90 dagen)
  // Inclusief totaal-betaald + ingecheckte counts voor live progress-bar
  const concerts = await queryAll<any>(c.env.DB, `
    SELECT
      c.id AS concert_id,
      e.id AS event_id,
      e.titel,
      e.start_at,
      e.locatie,
      (SELECT COUNT(*) FROM ticket_seats ts
        JOIN tickets t ON t.id = ts.ticket_id
        WHERE ts.concert_id = c.id AND t.status = 'paid'
          AND ts.status IN ('reserved','paid','confirmed','sold')) AS total_tickets,
      (SELECT COUNT(*) FROM ticket_seats ts
        JOIN tickets t ON t.id = ts.ticket_id
        WHERE ts.concert_id = c.id AND t.status = 'paid'
          AND ts.status IN ('reserved','paid','confirmed','sold')
          AND ts.checked_in_at IS NOT NULL) AS checked_in_count
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE datetime(e.start_at) >= datetime('now', '-1 day')
      AND datetime(e.start_at) < datetime('now', '+90 days')
    ORDER BY e.start_at ASC
  `, [])

  const concertsWithTickets = concerts.filter((c: any) => c.total_tickets > 0)

  return c.html(
    <Layout title="QR-scanner — concert kiezen" user={user}>
      <div class="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav class="text-sm text-gray-600 mb-4" aria-label="Breadcrumb">
          <ol class="flex items-center flex-wrap gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home mr-1"></i>Admin</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium">QR-scanner</li>
          </ol>
        </nav>

        <div class="mb-8">
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-camera-retro mr-3 text-teal-600"></i>
            QR-scanner — concert kiezen
          </h1>
          <p class="text-gray-600">
            Selecteer voor welk concert je tickets gaat scannen. Camera + zaalplan + zoeken op naam — alles in één scherm.
          </p>
        </div>

        {concertsWithTickets.length === 0 ? (
          <div class="bg-amber-50 border-l-4 border-amber-400 rounded-lg p-6">
            <h2 class="text-lg font-bold text-amber-900 mb-2">
              <i class="fas fa-info-circle mr-2"></i>Geen concerten klaar om te scannen
            </h2>
            <p class="text-amber-800">
              Er zijn momenteel geen komende concerten met betaalde tickets.
              Concerten met enkel onbetaalde of geblokkeerde reservaties worden hier niet getoond.
            </p>
            <a href="/admin/tickets" class="mt-3 inline-flex items-center gap-2 text-sm text-amber-900 hover:underline font-medium">
              <i class="fas fa-arrow-right"></i>Naar ticketbeheer
            </a>
          </div>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {concertsWithTickets.map((concert: any) => {
              const dt = new Date(concert.start_at.includes('T') ? concert.start_at : concert.start_at.replace(' ', 'T') + 'Z')
              const dateStr = dt.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              const timeStr = dt.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
              const pct = concert.total_tickets > 0
                ? Math.round((concert.checked_in_count / concert.total_tickets) * 100)
                : 0
              const isToday = dt.toDateString() === new Date().toDateString()
              const isPast = dt < new Date(Date.now() - 1000 * 60 * 60 * 6) // 6u geleden
              return (
                <a
                  href={`/admin/scanner/${concert.concert_id}`}
                  class={`bg-white rounded-lg shadow-md border-l-4 ${isToday ? 'border-teal-500' : isPast ? 'border-gray-300' : 'border-animato-primary'} hover:shadow-lg transition p-5 group`}
                >
                  <div class="flex items-start justify-between mb-3">
                    <div class="flex-1 min-w-0">
                      <h3 class="text-lg font-bold text-gray-900 truncate group-hover:text-animato-primary transition">
                        {concert.titel}
                      </h3>
                      <p class="text-sm text-gray-600 mt-1">
                        <i class="fas fa-calendar mr-1"></i>
                        {dateStr} <span class="text-gray-400">·</span> {timeStr}
                      </p>
                      {concert.locatie && (
                        <p class="text-xs text-gray-500 mt-0.5">
                          <i class="fas fa-map-marker-alt mr-1"></i>{concert.locatie}
                        </p>
                      )}
                    </div>
                    {isToday && (
                      <span class="ml-2 inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-800 text-xs font-bold rounded-full">
                        <i class="fas fa-circle text-[6px] animate-pulse"></i>VANDAAG
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div class="mt-3">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-gray-600">
                        <strong class="text-gray-900">{concert.checked_in_count}</strong>
                        <span class="text-gray-400"> / {concert.total_tickets}</span> binnen
                      </span>
                      <span class={`font-bold ${pct >= 90 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-gray-500'}`}>{pct}%</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        class={`h-2 rounded-full transition-all ${pct >= 90 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-teal-500'}`}
                        style={`width:${pct}%`}
                      ></div>
                    </div>
                  </div>

                  <div class="mt-3 flex items-center justify-between text-sm">
                    <span class="text-teal-600 font-medium group-hover:underline">
                      <i class="fas fa-camera-retro mr-1"></i>Start scanner
                    </span>
                    <i class="fas fa-arrow-right text-gray-400 group-hover:text-teal-600 transition"></i>
                  </div>
                </a>
              )
            })}
          </div>
        )}

        {/* Help / instructies */}
        <div class="mt-8 bg-gray-50 rounded-lg p-5 border border-gray-200">
          <h3 class="text-sm font-bold text-gray-900 mb-2">
            <i class="fas fa-circle-question mr-1 text-gray-500"></i>Hoe werkt de scanner?
          </h3>
          <ul class="text-sm text-gray-700 space-y-1 list-disc list-inside ml-2">
            <li>Klik op een concert om de scanner te starten</li>
            <li>Camera scant automatisch, of typ/plak een QR-code manueel</li>
            <li>Zaalplan toont groen = aanwezig, blauw = nog niet binnen</li>
            <li>Klik op een stoel om manueel in te checken of een fout te corrigeren</li>
            <li>Zoek op naam of order-nummer als iemand z'n QR vergeten is</li>
          </ul>
        </div>
      </div>
    </Layout>
  )
})

// ══════════════════════════════════════════════════════════════════════
// SCANNER PAGE — 2-koloms layout met camera + zaalplan
// ══════════════════════════════════════════════════════════════════════
app.get('/admin/scanner/:concertId', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  noCacheHeaders(c)

  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.id, c.seating_plan_id, e.id AS event_id, e.titel, e.start_at, e.locatie, sp.name AS plan_naam
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN seating_plans sp ON sp.id = c.seating_plan_id
    WHERE c.id = ?
  `, [concertId])

  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  const hasSeatingPlan = !!concert.seating_plan_id

  return c.html(
    <Layout title={`Scanner — ${concert.titel}`} user={user}>
      <div class="max-w-[1600px] mx-auto px-3 py-4">
        {/* Compacte breadcrumbs */}
        <nav class="text-xs text-gray-600 mb-2" aria-label="Breadcrumb">
          <ol class="flex items-center gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home"></i></a></li>
            <li class="text-gray-400">/</li>
            <li><a href="/admin/scanner" class="hover:text-animato-primary">QR-scanner</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium truncate max-w-[200px]">{concert.titel}</li>
          </ol>
        </nav>

        {/* Compacte header met live counters */}
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 mb-3 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <i class="fas fa-camera-retro text-teal-600 text-2xl"></i>
            <div>
              <h1 class="text-lg font-bold text-gray-900 leading-tight">{concert.titel}</h1>
              <p class="text-xs text-gray-500">
                {new Date(concert.start_at.includes('T') ? concert.start_at : concert.start_at.replace(' ', 'T') + 'Z').toLocaleString('nl-BE', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                })} · {concert.locatie || '—'}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-4 text-sm">
            <div class="text-center">
              <div class="text-2xl font-bold text-green-600" id="counter-checked">0</div>
              <div class="text-[10px] uppercase tracking-wide text-gray-500">binnen</div>
            </div>
            <div class="text-gray-300">/</div>
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-700" id="counter-total">0</div>
              <div class="text-[10px] uppercase tracking-wide text-gray-500">totaal</div>
            </div>
            <div class="text-center px-3 border-l border-gray-200">
              <div class="text-2xl font-bold text-teal-600" id="counter-pct">0%</div>
              <div class="text-[10px] uppercase tracking-wide text-gray-500">voltooid</div>
            </div>
            <button onclick="togglePendingList()" class="ml-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium">
              <i class="fas fa-list mr-1"></i>
              <span id="counter-remaining">0</span> nog niet binnen
            </button>
          </div>
        </div>

        {/* 2-KOLOMS LAYOUT */}
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
          {/* LINKER KOLOM — camera, zoeken, recent gescand */}
          <div class="xl:col-span-5 space-y-3">

            {/* Camera scanner */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div class="flex items-center justify-between mb-2">
                <h2 class="text-sm font-bold text-gray-900">
                  <i class="fas fa-camera mr-1 text-teal-600"></i>Camera
                </h2>
                <div class="flex items-center gap-1">
                  <button id="cam-start-btn" onclick="startCamera()" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium">
                    <i class="fas fa-play mr-1"></i>Start
                  </button>
                  <button id="cam-stop-btn" onclick="stopCamera()" class="hidden px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium">
                    <i class="fas fa-stop mr-1"></i>Stop
                  </button>
                  <button id="cam-flip-btn" onclick="flipCamera()" class="hidden px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs" title="Camera wisselen">
                    <i class="fas fa-sync-alt"></i>
                  </button>
                  <button id="cam-torch-btn" onclick="toggleTorch()" class="hidden px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs" title="Flits">
                    <i class="fas fa-bolt"></i>
                  </button>
                </div>
              </div>
              <div id="cam-reader-wrap" class="hidden">
                <div id="cam-reader" class="rounded overflow-hidden bg-black mx-auto" style="max-width: 360px;"></div>
                <p id="cam-status" class="text-xs text-gray-600 mt-1 text-center"></p>
              </div>
              <div id="cam-error" class="hidden bg-amber-50 border-l-4 border-amber-400 p-2 mt-2 text-xs">
                <i class="fas fa-exclamation-triangle text-amber-600 mr-1"></i>
                <span id="cam-error-msg">Camera kon niet worden geopend.</span>
              </div>
            </div>

            {/* Manuele input + zoeken */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 class="text-sm font-bold text-gray-900 mb-2">
                <i class="fas fa-keyboard mr-1 text-gray-500"></i>Manueel / zoeken
              </h2>
              <div class="flex gap-2 mb-3">
                <input
                  type="text"
                  id="qr-input"
                  placeholder="QR-code plakken of typen..."
                  class="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <button onclick="validateQR()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm font-medium">
                  <i class="fas fa-check"></i>
                </button>
              </div>
              <input
                type="text"
                id="search-input"
                placeholder="Of zoek op naam, e-mail, order-nummer..."
                class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
              <div id="search-results" class="hidden mt-2 border border-gray-200 rounded max-h-80 overflow-y-auto"></div>
            </div>

            {/* Recent gescand */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 class="text-sm font-bold text-gray-900 mb-2">
                <i class="fas fa-clock-rotate-left mr-1 text-gray-500"></i>Recent gescand
              </h2>
              <div id="recent-list" class="space-y-1 text-xs">
                <p class="text-gray-400 italic">Nog niets gescand…</p>
              </div>
            </div>

            {/* Pending lijst (collapsed by default) */}
            <div id="pending-section" class="hidden bg-white rounded-lg shadow-sm border border-amber-200 p-4">
              <div class="flex items-center justify-between mb-2">
                <h2 class="text-sm font-bold text-amber-900">
                  <i class="fas fa-hourglass-half mr-1"></i>Nog niet binnen
                </h2>
                <button onclick="togglePendingList()" class="text-xs text-gray-500 hover:text-gray-700">
                  <i class="fas fa-times"></i>
                </button>
              </div>
              <div id="pending-list" class="space-y-1 text-xs max-h-96 overflow-y-auto"></div>
            </div>
          </div>

          {/* RECHTER KOLOM — Live zaalplan */}
          <div class="xl:col-span-7">
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 class="text-sm font-bold text-gray-900">
                  <i class="fas fa-chair mr-1 text-teal-600"></i>
                  Live zaalplan
                  <span class="ml-2 text-xs text-gray-500 font-normal">
                    <i class="fas fa-circle text-[6px] text-green-500 animate-pulse mr-1"></i>
                    ververst elke 3s
                  </span>
                </h2>
                {/* Legenda */}
                <div class="flex items-center gap-3 text-xs">
                  <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-500 inline-block"></span>Binnen</span>
                  <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span>Verwacht</span>
                  <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-gray-300 inline-block"></span>Vrij</span>
                </div>
              </div>

              {!hasSeatingPlan ? (
                <div class="bg-amber-50 border-l-4 border-amber-400 p-4 rounded">
                  <p class="text-sm text-amber-800">
                    <i class="fas fa-info-circle mr-1"></i>
                    Dit concert gebruikt geen zaalplan (vrije zit/staan). Scan-functionaliteit werkt wel — gebruik de camera/manuele input links.
                  </p>
                </div>
              ) : (
                <div id="seatMapFrame" class="relative bg-gradient-to-b from-gray-50 to-white rounded border border-gray-200 overflow-auto" style="min-height: 600px; max-height: 75vh;">
                  <div id="seatMapScale" class="relative origin-top-left" style="width: 1200px; height: 800px;">
                    {/* Podium boven (statisch) */}
                    <div data-static="true" class="absolute bg-gradient-to-b from-gray-700 to-gray-800 text-white text-center text-xs font-bold uppercase tracking-widest py-2 rounded-b" style="top:0;left:50%;transform:translateX(-50%);width:400px;">
                      <i class="fas fa-music mr-2"></i>Podium
                    </div>
                    <div id="seatMap" class="relative" style="width: 1200px; height: 800px;"></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MULTI-SEAT MODAL — toont alle stoelen van een order, vink af wie binnen is */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div id="order-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Modal header — gekleurd op basis van status */}
          <div id="modal-header" class="px-6 py-4 border-b border-gray-200 flex items-center gap-4">
            <div id="modal-photo-wrap" class="hidden w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-md flex-shrink-0 bg-gray-200">
              <img id="modal-photo" src="" alt="" class="w-full h-full object-cover" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 id="modal-title" class="text-xl font-bold text-gray-900 truncate">—</h3>
              <p id="modal-subtitle" class="text-sm text-gray-600 truncate">—</p>
            </div>
            <button onclick="closeOrderModal()" class="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>

          {/* Modal body — stoel-lijst met checkboxen */}
          <div class="flex-1 overflow-y-auto p-6">
            <p class="text-sm text-gray-600 mb-3">
              <i class="fas fa-info-circle mr-1"></i>
              Vink aan wie effectief binnenkomt. Reeds ingecheckte stoelen worden grijs getoond.
            </p>
            <div id="modal-seats" class="space-y-2"></div>
          </div>

          {/* Modal footer — actions */}
          <div class="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
            <button onclick="closeOrderModal()" class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded text-sm">
              Annuleren
            </button>
            <button id="modal-confirm-btn" onclick="confirmCheckIn()" class="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm font-medium">
              <i class="fas fa-check mr-1"></i>Inchecken (<span id="modal-confirm-count">0</span>)
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* TOAST CONTAINER — overlay rechtsboven */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div id="toast-container" class="fixed top-4 right-4 z-40 space-y-2 pointer-events-none"></div>

      {/* html5-qrcode CDN */}
      <script src="https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>

      {/* All client-side scripting — extracted to static file to keep SSR bundle small */}
      <script
        src={`/static/js/admin-scanner.js?v=${Date.now()}`}
        data-concert-id={String(concertId)}
        data-has-seating-plan={concert.seating_plan_id ? '1' : '0'}
      ></script>
    </Layout>
  )
})

// ══════════════════════════════════════════════════════════════════════
// API — state polling
// ══════════════════════════════════════════════════════════════════════
// Geeft alle data terug die de scanner-pagina nodig heeft om het zaalplan
// te kleuren + counters bij te werken. Gepolled elke 3s door de client.
//
// We sturen lichte payload — geen koper-info per seat (privacy + bandbreedte),
// alleen status. Detail-info komt apart via /order/:ref endpoint wanneer
// admin op een stoel klikt.
app.get('/api/admin/scanner/:concertId/state', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  if (!concertId) return c.json({ error: 'concertId ontbreekt' }, 400)

  // Per-seat status — wat heeft elke stoel nodig?
  //   - id, x, y, row_label, seat_number, type → render
  //   - booking_status (sold/locked) → kleur
  //   - checked_in_at IS NOT NULL → groen
  //   - ticket_seat_id → identifier voor manual-checkin call
  //   - ticket_id, order_ref → voor klik-info-popup
  const seats = await queryAll<any>(c.env.DB, `
    SELECT
      s.id, s.row_label, s.seat_number, s.x, s.y, s.type,
      s.status AS base_status,
      ts.id AS ticket_seat_id,
      ts.status AS booking_status,
      ts.checked_in_at,
      t.id AS ticket_id,
      t.order_ref,
      t.koper_naam,
      t.status AS ticket_status
    FROM seats s
    LEFT JOIN ticket_seats ts ON ts.seat_id = s.id
      AND ts.concert_id = ?
      AND ts.status IN ('locked','sold','reserved','paid','confirmed')
    LEFT JOIN tickets t ON t.id = ts.ticket_id
    WHERE s.plan_id = (SELECT seating_plan_id FROM concerts WHERE id = ?)
    ORDER BY s.row_label, CAST(s.seat_number AS INTEGER)
  `, [concertId, concertId])

  // Counters: alleen betaalde tickets meetellen
  let totalPaid = 0
  let checkedIn = 0
  for (const s of seats) {
    if (s.ticket_status === 'paid' && s.booking_status && s.booking_status !== 'locked') {
      totalPaid++
      if (s.checked_in_at) checkedIn++
    }
  }

  return c.json({
    seats,
    counters: {
      total_paid: totalPaid,
      checked_in: checkedIn,
      remaining: totalPaid - checkedIn,
      pct: totalPaid > 0 ? Math.round((checkedIn / totalPaid) * 100) : 0
    },
    server_time: new Date().toISOString()
  })
})

// ══════════════════════════════════════════════════════════════════════
// API — order ophalen (multi-seat modal)
// ══════════════════════════════════════════════════════════════════════
// Wordt aangeroepen na een scan, of wanneer admin op een verkochte stoel klikt.
// Geeft alle stoelen van die order terug zodat we de "vink af wie binnen is"-
// modal kunnen tonen (jouw keuze Optie 3).
app.get('/api/admin/scanner/:concertId/order/:orderRef', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const orderRef = c.req.param('orderRef')
  if (!concertId || !orderRef) return c.json({ error: 'parameters ontbreken' }, 400)

  const ticket = await queryOne<any>(c.env.DB, `
    SELECT t.id, t.order_ref, t.koper_naam, t.koper_email, t.aantal,
           t.categorie, t.status, t.qr_code
    FROM tickets t
    WHERE t.order_ref = ? AND t.concert_id = ?
  `, [orderRef, concertId])

  if (!ticket) return c.json({ error: 'Order niet gevonden' }, 404)

  // Stoel-detail per ticket_seat
  const seats = await queryAll<any>(c.env.DB, `
    SELECT ts.id AS ticket_seat_id, ts.checked_in_at, ts.status AS booking_status,
           ts.checked_in_by,
           s.id AS seat_id, s.row_label, s.seat_number, s.section_name,
           COALESCE(p.voornaam || ' ' || p.achternaam, u.email) AS checked_in_by_naam
    FROM ticket_seats ts
    LEFT JOIN seats s ON s.id = ts.seat_id
    LEFT JOIN users u ON u.id = ts.checked_in_by
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE ts.ticket_id = ? AND ts.concert_id = ?
      AND ts.status IN ('locked','sold','reserved','paid','confirmed')
    ORDER BY s.row_label, CAST(s.seat_number AS INTEGER)
  `, [ticket.id, concertId])

  // Probeer foto van koper (via email match met user-profiel)
  let buyer_photo_url: string | null = null
  if (ticket.koper_email) {
    const userMatch = await queryOne<any>(c.env.DB, `
      SELECT p.foto_url
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.email = ? COLLATE NOCASE
      LIMIT 1
    `, [ticket.koper_email])
    if (userMatch?.foto_url) buyer_photo_url = userMatch.foto_url
  }

  return c.json({
    ticket,
    seats,
    buyer_photo_url
  })
})

// ══════════════════════════════════════════════════════════════════════
// API — check-in (single of multi-seat)
// ══════════════════════════════════════════════════════════════════════
// Body: { ticket_seat_ids: number[] }
// Idempotent: stoelen die al ingecheckt zijn worden overgeslagen.
// Retourneert per stoel het resultaat.
app.post('/api/admin/scanner/:concertId/check-in', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const body = await c.req.json().catch(() => ({} as any))
  const ids: number[] = Array.isArray(body.ticket_seat_ids)
    ? body.ticket_seat_ids.map((x: any) => parseInt(String(x), 10)).filter((x: number) => !isNaN(x))
    : []

  if (!concertId || ids.length === 0) {
    return c.json({ error: 'ticket_seat_ids ontbreekt' }, 400)
  }

  const results: Array<{ ticket_seat_id: number; status: 'checked_in' | 'already' | 'invalid' }> = []

  for (const id of ids) {
    // Haal huidige status op — alleen check-in als nog niet ingecheckt
    const row = await queryOne<any>(c.env.DB, `
      SELECT ts.id, ts.checked_in_at, t.status AS ticket_status
      FROM ticket_seats ts
      JOIN tickets t ON t.id = ts.ticket_id
      WHERE ts.id = ? AND ts.concert_id = ?
    `, [id, concertId])

    if (!row || row.ticket_status !== 'paid') {
      results.push({ ticket_seat_id: id, status: 'invalid' })
      continue
    }
    if (row.checked_in_at) {
      results.push({ ticket_seat_id: id, status: 'already' })
      continue
    }

    await execute(c.env.DB, `
      UPDATE ticket_seats
      SET checked_in_at = CURRENT_TIMESTAMP, checked_in_by = ?
      WHERE id = ? AND checked_in_at IS NULL
    `, [user.id, id])
    results.push({ ticket_seat_id: id, status: 'checked_in' })
  }

  const checkedInCount = results.filter(r => r.status === 'checked_in').length
  const alreadyCount = results.filter(r => r.status === 'already').length
  const invalidCount = results.filter(r => r.status === 'invalid').length

  return c.json({
    success: true,
    results,
    summary: { checked_in: checkedInCount, already: alreadyCount, invalid: invalidCount }
  })
})

// ══════════════════════════════════════════════════════════════════════
// API — uncheck-in (correctie)
// ══════════════════════════════════════════════════════════════════════
// Body: { ticket_seat_id: number }
app.post('/api/admin/scanner/:concertId/uncheck-in', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const body = await c.req.json().catch(() => ({} as any))
  const id = parseInt(String(body.ticket_seat_id || '0'), 10)
  if (!concertId || !id) return c.json({ error: 'ticket_seat_id ontbreekt' }, 400)

  await execute(c.env.DB, `
    UPDATE ticket_seats
    SET checked_in_at = NULL, checked_in_by = NULL
    WHERE id = ? AND concert_id = ?
  `, [id, concertId])

  return c.json({ success: true })
})

// ══════════════════════════════════════════════════════════════════════
// API — zoeken (naam / email / order_ref)
// ══════════════════════════════════════════════════════════════════════
// GET /api/admin/scanner/:concertId/search?q=janss
// Max 10 resultaten, fuzzy LIKE-match. Geeft order-niveau resultaten terug
// (één rij per order, met aantal stoelen + hoeveel al binnen).
app.get('/api/admin/scanner/:concertId/search', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const q = (c.req.query('q') || '').trim()
  if (!concertId || q.length < 2) return c.json({ results: [] })

  const pattern = `%${q}%`
  const rows = await queryAll<any>(c.env.DB, `
    SELECT
      t.id AS ticket_id,
      t.order_ref,
      t.koper_naam,
      t.koper_email,
      t.aantal,
      t.categorie,
      t.status,
      (SELECT COUNT(*) FROM ticket_seats ts WHERE ts.ticket_id = t.id
        AND ts.concert_id = t.concert_id
        AND ts.status IN ('locked','sold','reserved','paid','confirmed')) AS total_seats,
      (SELECT COUNT(*) FROM ticket_seats ts WHERE ts.ticket_id = t.id
        AND ts.concert_id = t.concert_id
        AND ts.status IN ('locked','sold','reserved','paid','confirmed')
        AND ts.checked_in_at IS NOT NULL) AS checked_in_seats
    FROM tickets t
    WHERE t.concert_id = ?
      AND t.status = 'paid'
      AND (
        t.koper_naam LIKE ? COLLATE NOCASE
        OR t.koper_email LIKE ? COLLATE NOCASE
        OR t.order_ref LIKE ? COLLATE NOCASE
      )
    ORDER BY t.koper_naam ASC
    LIMIT 10
  `, [concertId, pattern, pattern, pattern])

  return c.json({ results: rows })
})


export default app


