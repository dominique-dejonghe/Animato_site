import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { queryAll, queryOne, execute } from '../utils/db'
import type { Bindings, SessionUser } from '../types'
import { optionalAuth } from '../middleware/auth'
import { formatLineBreaks } from '../utils/text'
import { sendEmail, orderConfirmationEmail } from '../utils/email'
import { createMolliePayment } from '../utils/mollie'
import { getMollieApiKey } from '../utils/mollie-config'
import { getSiteUrl } from '../utils/site-url'
import { releaseStaleLocks, lockExpiryTimestamp } from '../utils/seat-locks'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optionalAuth middleware to all routes
app.use('*', optionalAuth)

// ==========================================
// PUBLIC TICKET ORDERING PAGE
// ==========================================
app.get('/concerten/:eventId/tickets', async (c) => {
  const eventId = parseInt(c.req.param('eventId'))
  const user = c.get('user') as SessionUser | null
  
  // Get event and concert info with seating plan
  // Bug #214 — c.doors_open_at en c.concert_start_at meenemen zodat we
  // ze kunnen tonen als ze gezet zijn (fallback = e.start_at)
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.beschrijving, e.start_at, e.locatie,
           sp.name as seating_plan_name, sp.width as sp_width, sp.height as sp_height
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN seating_plans sp ON c.seating_plan_id = sp.id
    WHERE c.event_id = ? AND c.ticketing_enabled = 1
  `, [eventId])
  
  if (!concert) {
    return c.html(
      <Layout title="Tickets niet beschikbaar" user={user}>
        <div class="max-w-4xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-ticket-alt text-6xl text-gray-300 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Tickets niet beschikbaar</h1>
          <p class="text-gray-600 mb-8">
            Voor dit evenement is online ticketing niet ingeschakeld.
          </p>
          <a href="/concerten" class="text-animato-primary hover:underline">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar concerten
          </a>
        </div>
      </Layout>
    )
  }

  // Check if sold out
  const isSoldOut = concert.uitverkocht || 
    (concert.capaciteit > 0 && concert.verkocht >= concert.capaciteit)

  // Parse prijsstructuur (JSON format expected: [{"categorie": "Volwassenen", "prijs": 15}, ...])
  let prijzen: any[] = []
  try {
    if (concert.prijsstructuur) {
      prijzen = JSON.parse(concert.prijsstructuur)
    }
  } catch (e) {
    prijzen = [{ categorie: 'Standaard', prijs: 15 }]
  }

  // Seating Plan Data
  let seats: any[] = []
  if (concert.seating_plan_id) {
    // Ruim eerst stale locks op zodat afgebroken bestellingen niet eeuwig geblokkeerd blijven
    await releaseStaleLocks(c.env.DB, concert.id)
    // Fetch seats and their status for this concert
    // We check ticket_seats table to see which are sold/locked
    seats = await queryAll(c.env.DB, `
      SELECT s.*, 
             CASE WHEN ts.status IS NOT NULL THEN 'sold' ELSE s.status END as effective_status
      FROM seats s
      LEFT JOIN ticket_seats ts ON ts.seat_id = s.id AND ts.concert_id = ? AND ts.status IN ('locked', 'sold')
      WHERE s.plan_id = ?
    `, [concert.id, concert.seating_plan_id])
  }

  // Bug #214 — eigen ticket-uren met fallback op events.start_at
  const concertStartRaw = concert.concert_start_at || concert.start_at
  const doorsOpenRaw = concert.doors_open_at
  const concertStartDate = new Date(String(concertStartRaw).replace(' ', 'T'))
  const doorsOpenDate = doorsOpenRaw ? new Date(String(doorsOpenRaw).replace(' ', 'T')) : null
  // Voor "is concert al voorbij?" check: gebruik concert-start (of fallback)
  const eventDate = concertStartDate
  const isPast = eventDate < new Date()
  // Toon ook deuren+concert apart als deuren expliciet vóór concert-start liggen
  const showDoorsLine = !!doorsOpenDate && doorsOpenDate.getTime() < concertStartDate.getTime()
  const fmtTime = (d: Date) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  const fmtDate = (d: Date) => d.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Brussels' })

  return c.html(
    <Layout title={`Tickets - ${concert.titel}`} user={user}>
      <div class="py-8 bg-gray-50">
        {/* Bij zaalplan-mode breder zodat het plan écht ademruimte heeft.
            Bij quantity-mode behouden we de smallere layout. */}
        <div class={concert.seating_plan_id ? "max-w-7xl mx-auto px-4" : "max-w-6xl mx-auto px-4"}>
          {/* Header */}
          <div class="mb-6">
            <a href={`/concerten/${eventId}`} class="text-animato-primary hover:underline inline-flex items-center mb-3">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar concert details
            </a>
            <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              Tickets Bestellen
            </h1>
          </div>

          {/* Concert-info: bij zaalplan-mode bovenaan als compacte horizontale balk
              (gaf voorheen één halflege verticale kolom), bij quantity-mode klassieke sidebar. */}
          {concert.seating_plan_id && (
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5 mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
              <div class="flex items-center gap-2">
                <i class="fas fa-music text-animato-primary"></i>
                <strong class="text-gray-900">{concert.titel}</strong>
              </div>
              <div class="flex items-center gap-2 text-gray-700">
                <i class="fas fa-calendar-alt text-animato-primary"></i>
                <span><strong>{fmtDate(concertStartDate)}</strong></span>
              </div>
              {showDoorsLine ? (
                <>
                  <div class="flex items-center gap-2 text-gray-700">
                    <i class="fas fa-door-open text-animato-primary"></i>
                    <span>Deuren open: <strong>{fmtTime(doorsOpenDate!)} uur</strong></span>
                  </div>
                  <div class="flex items-center gap-2 text-gray-700">
                    <i class="fas fa-music text-animato-primary"></i>
                    <span>Concert start: <strong>{fmtTime(concertStartDate)} uur</strong></span>
                  </div>
                </>
              ) : (
                <div class="flex items-center gap-2 text-gray-700">
                  <i class="fas fa-clock text-animato-primary"></i>
                  <span><strong>{fmtTime(concertStartDate)} uur</strong></span>
                </div>
              )}
              <div class="flex items-center gap-2 text-gray-700">
                <i class="fas fa-map-marker-alt text-animato-primary"></i>
                <span>{concert.locatie}</span>
              </div>
              {concert.capaciteit > 0 && (
                <div class="flex items-center gap-2 text-gray-700">
                  <i class="fas fa-users text-animato-primary"></i>
                  <span>{concert.capaciteit - concert.verkocht} tickets beschikbaar</span>
                </div>
              )}
            </div>
          )}

          {/* Grid: bij zaalplan-mode ÉÉN volle kolom (zaalplan eet de breedte op).
              Bij quantity-mode behouden we de klassieke 1/3 — 2/3 sidebar+form. */}
          <div class={concert.seating_plan_id
            ? "grid grid-cols-1 gap-6"
            : "grid grid-cols-1 lg:grid-cols-3 gap-8"}>
            {/* Concert Info Sidebar — alleen tonen in quantity-mode (in zaalplan-mode
                staat de info bovenaan als horizontale balk) */}
            {!concert.seating_plan_id && (
              <div class="lg:col-span-1">
                <div class="bg-white rounded-lg shadow-md overflow-hidden sticky top-8">
                  {concert.poster_url && (
                    <img src={concert.poster_url} alt={concert.titel} class="w-full h-48 object-cover" />
                  )}
                  <div class="p-6">
                    <h2 class="text-xl font-bold text-gray-900 mb-4">{concert.titel}</h2>
                    <div class="space-y-3 text-sm">
                      <div class="flex items-start">
                        <i class="fas fa-calendar-alt text-animato-primary mr-3 mt-1"></i>
                        <div>
                          <div class="font-semibold">{fmtDate(concertStartDate)}</div>
                          {showDoorsLine ? (
                            <div class="text-gray-600 space-y-0.5">
                              <div><i class="fas fa-door-open text-xs mr-1 text-gray-500"></i>Deuren open: <strong>{fmtTime(doorsOpenDate!)} uur</strong></div>
                              <div><i class="fas fa-music text-xs mr-1 text-gray-500"></i>Concert start: <strong>{fmtTime(concertStartDate)} uur</strong></div>
                            </div>
                          ) : (
                            <div class="text-gray-600">{fmtTime(concertStartDate)} uur</div>
                          )}
                        </div>
                      </div>
                      <div class="flex items-start">
                        <i class="fas fa-map-marker-alt text-animato-primary mr-3 mt-1"></i>
                        <div class="text-gray-700">{concert.locatie}</div>
                      </div>
                      {concert.capaciteit > 0 && (
                        <div class="flex items-start">
                          <i class="fas fa-users text-animato-primary mr-3 mt-1"></i>
                          <div class="text-gray-700">{concert.capaciteit - concert.verkocht} tickets beschikbaar</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Order Form — bij zaalplan-mode neemt dit alle ruimte, anders 2/3 */}
            <div class={concert.seating_plan_id ? "" : "lg:col-span-2"}>
              {isSoldOut ? (
                <div class="bg-white rounded-lg shadow-md p-12 text-center">
                  <i class="fas fa-times-circle text-6xl text-red-500 mb-4"></i>
                  <h2 class="text-2xl font-bold text-gray-900 mb-2">Uitverkocht</h2>
                  <p class="text-gray-600">Helaas zijn alle tickets voor dit concert uitverkocht.</p>
                </div>
              ) : isPast ? (
                <div class="bg-white rounded-lg shadow-md p-12 text-center">
                  <i class="fas fa-clock text-6xl text-gray-400 mb-4"></i>
                  <h2 class="text-2xl font-bold text-gray-900 mb-2">Concert is afgelopen</h2>
                  <p class="text-gray-600">Je kunt geen tickets meer bestellen.</p>
                </div>
              ) : (
                <form method="POST" action="/api/tickets/order" class="bg-white rounded-lg shadow-md p-8" id="orderForm">
                  <input type="hidden" name="concert_id" value={concert.id} />
                  
                  {concert.seating_plan_id ? (
                    // --- SEAT SELECTION MODE ---
                    <div class="mb-8">
                        <div class="flex items-start justify-between gap-4 mb-5 flex-wrap">
                          <div>
                            <h2 class="text-3xl font-bold text-gray-900 mb-1">Kies je plaatsen</h2>
                            <p class="text-sm text-gray-600">Klik op een vrije stoel om te selecteren. Klik opnieuw om af te selecteren.</p>
                          </div>

                          <div class="flex items-center gap-3 flex-wrap">
                            {/* Legenda compact rechts naast titel */}
                            <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs items-center bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
                              <div class="flex items-center"><div class="w-4 h-4 bg-blue-500 rounded-t-lg mr-2"></div> Beschikbaar</div>
                              <div class="flex items-center"><div class="w-4 h-4 bg-gray-300 rounded-t-lg mr-2"></div> Bezet</div>
                              <div class="flex items-center"><div class="w-4 h-4 bg-animato-accent rounded-t-lg mr-2"></div> Geselecteerd</div>
                              <div class="flex items-center"><div class="w-4 h-4 bg-green-500 rounded-t-lg mr-2"></div> Rolstoel</div>
                            </div>

                            {/* Fullscreen-knop — opent een modal die het hele scherm vult */}
                            <button
                              type="button"
                              id="seatFullscreenOpenBtn"
                              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-animato-primary text-white text-sm font-semibold hover:bg-opacity-90 transition shadow"
                              title="Toon zaalplan op volledig scherm (ESC of klik buiten om te sluiten)"
                            >
                              <i class="fas fa-expand"></i>
                              <span class="hidden sm:inline">Toon volledig scherm</span>
                              <span class="sm:hidden">Volledig scherm</span>
                            </button>
                          </div>
                        </div>

                        {/* Frame: aspect-ratio uit DB, mag tot 85vh voor wow-effect.
                            Subtiel theater-gradient + dikkere border zodat het oog er meteen heen gaat.
                            Bij fullscreen-mode verhuist #seatMapScale tijdelijk naar de modal — daarom
                            staat het hier als kind van #seatMapFrame, en plaatsen we het terug bij sluiten. */}
                        {/* Frame is flex-centered zodat #seatMapScale altijd in het midden zit.
                            origin-top-center op de scale zorgt dat zoom-in vanuit het centrum gebeurt
                            (anders schiet het plan naar de linkerbovenhoek bij in/uitzoomen). */}
                        <div
                            id="seatMapFrame"
                            class="relative overflow-auto border-2 border-gray-200 rounded-xl bg-gradient-to-b from-gray-50 to-gray-100 p-6 shadow-inner flex items-start justify-center"
                            style={`aspect-ratio: ${concert.sp_width || 800} / ${concert.sp_height || 600}; max-height: 85vh; min-height: 500px;`}
                        >
                            <div id="seatMapScale" style="transform-origin: center center; transition: transform .15s ease;">
                                <div id="seatMap" class="relative bg-white shadow-lg mx-auto" style={`width: ${concert.sp_width}px; height: ${concert.sp_height}px;`}>
                                    <div class="absolute top-0 left-0 w-full bg-gray-800 text-white text-xs py-1.5 text-center font-bold tracking-widest">PODIUM / SCHERM</div>
                                    {/* Seats rendered via JS */}
                                </div>
                            </div>
                        </div>

                        {/* Zoom-controls voor publieke viewer (alleen zichtbaar als zaalplan groter dan beeld is) */}
                        <div id="seatZoomControls" class="hidden mt-3 flex items-center justify-center gap-2 text-xs">
                            <button type="button" id="seatZoomFit"  class="px-3 py-1.5 rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"><i class="fas fa-expand-arrows-alt mr-1"></i>Passend</button>
                            <button type="button" id="seatZoomOut"  class="w-8 h-8 rounded border border-gray-300 bg-white hover:bg-gray-50"><i class="fas fa-minus"></i></button>
                            <span id="seatZoomLabel" class="font-mono w-14 text-center">100%</span>
                            <button type="button" id="seatZoomIn"   class="w-8 h-8 rounded border border-gray-300 bg-white hover:bg-gray-50"><i class="fas fa-plus"></i></button>
                            <button type="button" id="seatZoom100"  class="px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50">1:1</button>
                        </div>
                        
                        {/* Hidden inputs for selected seats */}
                        <div id="selectedSeatsInputs"></div>

                        {/* ── Fullscreen modal ──
                            Verborgen by default. JS verplaatst #seatMapScale erin bij open,
                            en zet hem terug in #seatMapFrame bij sluit. Zo behouden we alle
                            event-listeners op de stoelen (verhuizen het DOM-element, niet kopiëren). */}
                        <div
                            id="seatFullscreenModal"
                            class="fixed inset-0 z-50 bg-black/85 hidden flex-col"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="seatFullscreenTitle"
                        >
                            {/* Topbalk: titel + sluitknop */}
                            <div class="flex items-center justify-between px-4 sm:px-6 py-3 bg-gray-900 text-white border-b border-gray-800">
                                <div class="flex items-center gap-3 min-w-0">
                                    <i class="fas fa-chair text-animato-primary text-lg"></i>
                                    <div class="min-w-0">
                                        <h3 id="seatFullscreenTitle" class="text-base sm:text-lg font-bold truncate">
                                            Kies je plaatsen — {concert.titel}
                                        </h3>
                                        <p class="text-xs text-gray-300 hidden sm:block">
                                            Klik op een stoel om te (de)selecteren · Pinch/zoom met de knoppen · ESC om te sluiten
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    id="seatFullscreenCloseBtn"
                                    class="ml-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 transition"
                                    title="Sluiten (ESC)"
                                >
                                    <i class="fas fa-times"></i>
                                    <span class="hidden sm:inline">Sluiten</span>
                                </button>
                            </div>

                            {/* Container voor het verplaatste seatMapScale — vult het hele beschikbare scherm.
                                flex-center zodat het plan netjes gecentreerd zit, ook na zoom in/uit. */}
                            <div
                                id="seatFullscreenStage"
                                class="flex-1 overflow-auto p-4 sm:p-8 bg-gradient-to-b from-gray-100 to-gray-200 flex items-start justify-center"
                            >
                                {/* #seatMapScale komt hier in zodra de modal open is */}
                            </div>

                            {/* Onderbalk: legenda + zoom-controls + tickets-teller */}
                            <div class="bg-gray-900 text-white border-t border-gray-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                                {/* Legenda (mobiel verborgen, op sm+ zichtbaar) */}
                                <div class="hidden sm:flex flex-wrap gap-x-4 gap-y-1 text-xs items-center">
                                    <div class="flex items-center"><div class="w-3.5 h-3.5 bg-blue-500 rounded-t mr-1.5"></div> Beschikbaar</div>
                                    <div class="flex items-center"><div class="w-3.5 h-3.5 bg-gray-400 rounded-t mr-1.5"></div> Bezet</div>
                                    <div class="flex items-center"><div class="w-3.5 h-3.5 bg-animato-accent rounded-t mr-1.5"></div> Geselecteerd</div>
                                    <div class="flex items-center"><div class="w-3.5 h-3.5 bg-green-500 rounded-t mr-1.5"></div> Rolstoel</div>
                                </div>

                                {/* Zoom-controls — bewust groter dan die op de pagina */}
                                <div id="seatFullscreenZoomControls" class="flex items-center gap-2 text-sm">
                                    <button type="button" id="seatFsZoomFit" class="px-3 py-1.5 rounded border border-blue-400 bg-blue-500 text-white hover:bg-blue-600 font-medium"><i class="fas fa-expand-arrows-alt mr-1"></i>Passend</button>
                                    <button type="button" id="seatFsZoomOut" class="w-9 h-9 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700"><i class="fas fa-minus"></i></button>
                                    <span id="seatFsZoomLabel" class="font-mono w-14 text-center text-gray-200">100%</span>
                                    <button type="button" id="seatFsZoomIn" class="w-9 h-9 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700"><i class="fas fa-plus"></i></button>
                                    <button type="button" id="seatFsZoom100" class="px-3 py-1.5 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700">1:1</button>
                                </div>

                                {/* Tickets-teller spiegelt #total-tickets / #total-price van de hoofdpagina */}
                                <div class="text-sm flex items-center gap-3">
                                    <span class="text-gray-300">
                                        <i class="fas fa-ticket-alt mr-1"></i>
                                        <span id="seatFsTicketCount">0</span> stoelen
                                    </span>
                                    <span class="font-bold text-animato-accent">
                                        <span id="seatFsTicketTotal">€0.00</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                  ) : (
                    // --- QUANTITY MODE ---
                    <div class="space-y-4 mb-8">
                      <h2 class="text-2xl font-bold text-gray-900 mb-6">Selecteer tickets</h2>
                      {prijzen.map((prijs: any, index: number) => (
                        <div class="border border-gray-200 rounded-lg p-4 hover:border-animato-primary transition">
                          <div class="flex items-center justify-between mb-3">
                            <div>
                              <div class="font-semibold text-gray-900 text-lg">{prijs.categorie}</div>
                              <div class="text-2xl font-bold text-animato-primary">€{prijs.prijs.toFixed(2)}</div>
                              {prijs.beschrijving && <div class="text-sm text-gray-600 mt-1">{prijs.beschrijving}</div>}
                            </div>
                            <div class="flex items-center space-x-3">
                              <button type="button" onclick={`decrementTicket(${index})`} class="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition"><i class="fas fa-minus text-gray-600"></i></button>
                              <input type="number" name={`tickets[${index}][aantal]`} id={`ticket-${index}`} value="0" min="0" max="10" class="w-16 text-center border border-gray-300 rounded-lg py-2 text-lg font-semibold" onchange="updateTotal()" readonly />
                              <input type="hidden" name={`tickets[${index}][categorie]`} value={prijs.categorie} />
                              <input type="hidden" name={`tickets[${index}][prijs]`} value={prijs.prijs} />
                              <button type="button" onclick={`incrementTicket(${index})`} class="w-10 h-10 bg-animato-primary hover:bg-opacity-90 text-white rounded-lg flex items-center justify-center transition"><i class="fas fa-plus"></i></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  <div class="bg-gray-50 rounded-lg p-6 mb-8">
                    <div class="flex items-center justify-between text-lg">
                      <span class="font-semibold text-gray-900">Totaal aantal tickets:</span>
                      <span id="total-tickets" class="font-bold text-gray-900">0</span>
                    </div>
                    
                    {/* Only show category selection for seating plan mode if multiple prices exist */}
                    {concert.seating_plan_id && prijzen.length > 1 && (
                        <div id="seatCategorySelector" class="mt-4 hidden">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Kies tarief voor geselecteerde plaatsen:</label>
                            <select id="globalCategory" class="w-full border rounded p-2" onchange="updateSeatPrices()">
                                {prijzen.map((p: any) => (
                                    <option value={p.prijs} data-cat={p.categorie}>{p.categorie} (€{p.prijs})</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div class="flex items-center justify-between text-2xl mt-4 pt-4 border-t border-gray-200">
                      <span class="font-bold text-gray-900">Totaal bedrag:</span>
                      <span id="total-price" class="font-bold text-animato-primary">€0.00</span>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div class="space-y-4 mb-8">
                    <div class="flex items-center justify-between mb-4">
                      <h3 class="text-xl font-bold text-gray-900">Je gegevens</h3>
                      {user && (
                        <span class="inline-flex items-center text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full">
                          <i class="fas fa-check-circle mr-2"></i> Ingelogd als lid
                        </span>
                      )}
                    </div>

                    {!user && (
                      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                        <div class="flex items-start gap-3">
                          <i class="fas fa-info-circle text-blue-600 text-xl mt-0.5"></i>
                          <div class="flex-1">
                            <p class="text-sm text-gray-700 mb-3"><strong>Ben je al lid?</strong> Log in om sneller te bestellen.</p>
                            <div class="flex gap-3">
                              <a href={`/login?redirect=/concerten/${eventId}/tickets`} class="inline-flex items-center bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 transition text-sm font-semibold">Inloggen</a>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-2">Naam *</label>
                          <input type="text" name="koper_naam" required value={user ? `${user.voornaam} ${user.achternaam}` : ''} readonly={!!user} class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`} placeholder="Volledige naam" />
                        </div>
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                          <input type="email" name="koper_email" required value={user?.email || ''} readonly={!!user} class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`} placeholder="je@email.com" />
                        </div>
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-2">Telefoon {user ? '(optioneel)' : '*'}</label>
                          <input type="tel" name="koper_telefoon" value={user?.telefoon || ''} readonly={!!user} required={!user} class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`} placeholder="06-12345678" />
                        </div>
                    </div>
                  </div>

                  {/* Terms */}
                  <div class="mb-6">
                    <label class="flex items-start">
                      <input type="checkbox" name="accept_terms" required class="mt-1 mr-3" />
                      <span class="text-sm text-gray-600">Ik ga akkoord met de <a href="/algemene-voorwaarden" class="text-animato-primary hover:underline">algemene voorwaarden</a> en het <a href="/privacybeleid" class="text-animato-primary hover:underline">privacybeleid</a></span>
                    </label>
                  </div>

                  <button type="submit" id="submit-btn" disabled class="w-full bg-animato-primary text-white py-4 rounded-lg font-semibold text-lg hover:bg-opacity-90 transition disabled:bg-gray-300 disabled:cursor-not-allowed">
                    <i class="fas fa-shopping-cart mr-2"></i> Bestelling Plaatsen
                  </button>
                </form>
              )}
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            const prijzen = ${JSON.stringify(prijzen)};
            const hasSeatingPlan = ${!!concert.seating_plan_id};
            const seats = ${JSON.stringify(seats)};
            let selectedSeats = [];

            // --- SEATING PLAN LOGIC ---
            if (hasSeatingPlan) {
                const map = document.getElementById('seatMap');

                // ── Rij-labels berekenen ──
                // Strategie: groepeer per UNIEKE y-positie (i.p.v. row_label uit DB), want
                // dan krijgen we sowieso ALLE rijen een label — ook als één stoel in een rij
                // een ontbrekend row_label heeft. We sorteren de unieke y's en geven A, B, C...
                // De DB-waarde (seat.row_label) gebruiken we als die bestaat, anders Excel-style
                // letters op basis van de y-volgorde. Zo komt nooit een rij zonder label binnen
                // het zaalplan terecht.
                function toExcelLetter(idx) {
                    // 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB
                    let s = '';
                    let n = idx;
                    while (n >= 0) {
                        s = String.fromCharCode(65 + (n % 26)) + s;
                        n = Math.floor(n / 26) - 1;
                    }
                    return s;
                }
                // 1) verzamel per y-positie: meest-linkse x + bewaar liefst de DB-label
                const yMap = {}; // y -> { minX, lbl }
                seats.forEach(seat => {
                    const k = seat.y;
                    if (!yMap[k]) yMap[k] = { minX: seat.x, lbl: seat.row_label || '' };
                    if (seat.x < yMap[k].minX) yMap[k].minX = seat.x;
                    // Bewaar de eerst-gevonden niet-lege row_label voor deze y
                    if (!yMap[k].lbl && seat.row_label) yMap[k].lbl = seat.row_label;
                });
                // 2) sorteer y-waarden van boven naar onder en plaats labels
                const sortedYs = Object.keys(yMap).map(Number).sort((a, b) => a - b);
                sortedYs.forEach((y, idx) => {
                    const g = yMap[y];
                    const lbl = g.lbl || toExcelLetter(idx); // fallback: A, B, C... gebaseerd op y-volgorde
                    const tag = document.createElement('div');
                    tag.className = 'absolute text-xs font-bold text-gray-600 pointer-events-none';
                    // Stoelen zijn 32px hoog → label verticaal centreren op de rij
                    tag.style.cssText = 'left:' + Math.max(0, g.minX - 36) + 'px;top:' + (y + 4) + 'px;'
                        + 'background:rgba(255,255,255,.95);padding:2px 6px;border-radius:4px;'
                        + 'border:1px solid #cbd5e1;letter-spacing:.05em;z-index:5;'
                        + 'min-width:22px;text-align:center;line-height:1;';
                    tag.innerText = lbl;
                    map.appendChild(tag);
                });

                seats.forEach(seat => {
                    const el = document.createElement('div');
                    el.className = 'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-[10px] text-white font-bold shadow-sm transition-transform';
                    el.style.left = seat.x + 'px';
                    el.style.top = seat.y + 'px';
                    el.innerText = seat.seat_number;
                    el.title = \`\${seat.row_label || ''} - Stoel \${seat.seat_number}\`;

                    if (seat.effective_status === 'available' || seat.effective_status === 'reserved') { // 'reserved' by admin implies available for sale maybe? Assuming 'blocked' or 'sold' is unavailable. Let's assume 'reserved' is blocked for now unless logic changes.
                         // Actually standard logic: available = buyable. blocked/sold/reserved = unavailable.
                    }

                    if (seat.effective_status !== 'available') {
                        el.style.backgroundColor = '#D1D5DB'; // Gray
                        el.style.cursor = 'not-allowed';
                        el.title += ' (Niet beschikbaar)';
                    } else {
                        el.style.cursor = 'pointer';
                        el.classList.add('hover:scale-110');
                        
                        if (seat.type === 'wheelchair') {
                            el.style.backgroundColor = '#10B981'; // Green
                            el.innerHTML = '<i class="fas fa-wheelchair"></i>';
                        } else {
                            el.style.backgroundColor = '#3B82F6'; // Blue
                        }

                        el.onclick = () => toggleSeat(seat, el);
                    }
                    map.appendChild(el);
                });

                // ── Auto-fit & zoom-controls voor het zaalplan ──
                // "Passend" = vul het kader volledig (mag voorbij 100% gaan).
                // Cap op 3x zodat heel kleine zaalplannen niet pixelig opblazen.
                const inlineFrame = document.getElementById('seatMapFrame');
                const scale = document.getElementById('seatMapScale');
                const zoomLabel = document.getElementById('seatZoomLabel');
                const zoomControls = document.getElementById('seatZoomControls');
                const fsLabel = document.getElementById('seatFsZoomLabel');
                let seatZoom = 1.0;
                const planW = ${concert.sp_width || 800};
                const planH = ${concert.sp_height || 600};

                // ── Bereken de werkelijke bounding box van de stoelen ──
                // Sommige zaalplannen hebben veel lege ruimte rechts/onder (bv. plan 1 heeft
                // width=2000 maar stoelen lopen slechts tot x=1020). We meten waar de stoelen
                // écht staan, zodat 'Passend' op die bbox optimaliseert en het plan
                // visueel gecentreerd voelt — geen lelijke witte stroken meer naast het plan.
                const SEAT_SIZE = 32;          // w-8 h-8 = 32px
                const LABEL_GUTTER = 40;       // ruimte links voor de rij-labels (A, B, C...)
                let bbox = { minX: 0, minY: 0, maxX: planW, maxY: planH };
                if (seats.length > 0) {
                    bbox = seats.reduce((acc, s) => ({
                        minX: Math.min(acc.minX, s.x),
                        minY: Math.min(acc.minY, s.y),
                        maxX: Math.max(acc.maxX, s.x + SEAT_SIZE),
                        maxY: Math.max(acc.maxY, s.y + SEAT_SIZE),
                    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
                    // Houd ruimte links voor de rij-labels
                    bbox.minX = Math.max(0, bbox.minX - LABEL_GUTTER);
                }
                const contentW = Math.max(50, bbox.maxX - bbox.minX);
                const contentH = Math.max(50, bbox.maxY - bbox.minY);
                /** Huidige zichtbare container van #seatMapScale.
                 *  Wordt naar de modal-stage gewisseld bij fullscreen. */
                function currentSeatFrame() {
                    if (!scale) return inlineFrame;
                    // Loop omhoog tot we het ouder-element vinden dat als 'kader' fungeert
                    if (scale.parentElement && scale.parentElement.id === 'seatFullscreenStage') {
                        return scale.parentElement;
                    }
                    return inlineFrame;
                }
                function applySeatZoom() {
                    if (!scale) return;
                    // We combineren scale + translate: eerst translaten zodat het CENTRUM van
                    // de bbox samenvalt met het centrum van #seatMapScale (= centrum van planW/planH),
                    // dán schalen. transform-origin = center center zodat de schaling
                    // het reeds gecentreerde plan niet meer wegduwt.
                    const cxBbox = (bbox.minX + bbox.maxX) / 2;
                    const cyBbox = (bbox.minY + bbox.maxY) / 2;
                    const cxPlan = planW / 2;
                    const cyPlan = planH / 2;
                    const tx = cxPlan - cxBbox; // hoeveel naar rechts om bbox-centrum naar plan-centrum te brengen
                    const ty = cyPlan - cyBbox;
                    scale.style.transformOrigin = 'center center';
                    scale.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + seatZoom + ')';
                    const label = Math.round(seatZoom * 100) + '%';
                    if (zoomLabel) zoomLabel.innerText = label;
                    if (fsLabel)   fsLabel.innerText   = label;
                }
                function fitSeatPlan() {
                    const frame = currentSeatFrame();
                    if (!frame || !scale) return;
                    // Padding hangt af van welke container actief is. inlineFrame heeft p-6 (24px),
                    // fullscreen-stage heeft p-4 of p-8 — we gebruiken 32px als veilige marge.
                    const pad = 32;
                    const availW = Math.max(50, frame.clientWidth  - pad);
                    const availH = Math.max(50, frame.clientHeight - pad);
                    // Schaal op basis van werkelijke bbox-grootte i.p.v. volledige planW/planH —
                    // zo verdwijnt de witte ruimte rechts/links wanneer het plan niet de hele
                    // canvas gebruikt.
                    const sx = availW / contentW;
                    const sy = availH / contentH;
                    seatZoom = Math.min(sx, sy, 3.0);
                    if (seatZoom < 0.1) seatZoom = 0.1;
                    applySeatZoom();
                }
                if (zoomControls) zoomControls.classList.remove('hidden');
                // Pagina-knoppen
                document.getElementById('seatZoomFit')?.addEventListener('click', fitSeatPlan);
                document.getElementById('seatZoom100')?.addEventListener('click', () => { seatZoom = 1.0; applySeatZoom(); });
                document.getElementById('seatZoomIn')?.addEventListener('click',  () => { seatZoom = Math.min(3.0, seatZoom + 0.1); applySeatZoom(); });
                document.getElementById('seatZoomOut')?.addEventListener('click', () => { seatZoom = Math.max(0.1, seatZoom - 0.1); applySeatZoom(); });
                // Modal-knoppen — zelfde acties, andere ID's
                document.getElementById('seatFsZoomFit')?.addEventListener('click', fitSeatPlan);
                document.getElementById('seatFsZoom100')?.addEventListener('click', () => { seatZoom = 1.0; applySeatZoom(); });
                document.getElementById('seatFsZoomIn')?.addEventListener('click',  () => { seatZoom = Math.min(3.0, seatZoom + 0.1); applySeatZoom(); });
                document.getElementById('seatFsZoomOut')?.addEventListener('click', () => { seatZoom = Math.max(0.1, seatZoom - 0.1); applySeatZoom(); });
                window.addEventListener('resize', fitSeatPlan);
                // Initieel fitten zodat het zaalplan altijd binnen het kader past
                // Twee passes: één direct (ruwe meting) en één na render-flush
                setTimeout(fitSeatPlan, 50);
                setTimeout(fitSeatPlan, 250);

                // ── Fullscreen modal: verhuis #seatMapScale heen-en-weer ──
                // Alle event-listeners op de stoel-divs blijven intact omdat we
                // het bestaande DOM-element verplaatsen i.p.v. te klonen.
                const fsModal   = document.getElementById('seatFullscreenModal');
                const fsStage   = document.getElementById('seatFullscreenStage');
                const fsOpenBtn = document.getElementById('seatFullscreenOpenBtn');
                const fsCloseBtn= document.getElementById('seatFullscreenCloseBtn');
                function openSeatFullscreen() {
                    if (!fsModal || !fsStage || !scale || !inlineFrame) return;
                    fsStage.appendChild(scale);              // verhuis scale naar modal-stage
                    fsModal.classList.remove('hidden');
                    fsModal.classList.add('flex');           // flex-col (zie className op modal)
                    document.body.style.overflow = 'hidden'; // body niet meer scrollen
                    // Re-fit op het nieuwe kader na een tick zodat dimensies kloppen
                    setTimeout(fitSeatPlan, 30);
                    setTimeout(fitSeatPlan, 250);
                }
                function closeSeatFullscreen() {
                    if (!fsModal || !inlineFrame || !scale) return;
                    inlineFrame.appendChild(scale);          // zet scale terug in zijn originele kader
                    fsModal.classList.add('hidden');
                    fsModal.classList.remove('flex');
                    document.body.style.overflow = '';
                    setTimeout(fitSeatPlan, 30);
                    setTimeout(fitSeatPlan, 250);
                }
                fsOpenBtn?.addEventListener('click', openSeatFullscreen);
                fsCloseBtn?.addEventListener('click', closeSeatFullscreen);
                // ESC = sluiten
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && fsModal && !fsModal.classList.contains('hidden')) {
                        closeSeatFullscreen();
                    }
                });
                // Klik op de donkere achtergrond (maar niet op stoelen of UI) = sluiten
                fsModal?.addEventListener('click', (e) => {
                    if (e.target === fsModal) closeSeatFullscreen();
                });
            }

            function toggleSeat(seat, el) {
                const idx = selectedSeats.findIndex(s => s.id === seat.id);
                
                if (idx > -1) {
                    // Deselect
                    selectedSeats.splice(idx, 1);
                    el.style.backgroundColor = seat.type === 'wheelchair' ? '#10B981' : '#3B82F6';
                    el.style.zIndex = '0';
                    el.classList.remove('ring-2', 'ring-offset-1', 'ring-animato-accent');
                } else {
                    // Select
                    selectedSeats.push(seat);
                    el.style.backgroundColor = '#F59E0B'; // Accent color
                    el.style.zIndex = '10';
                    el.classList.add('ring-2', 'ring-offset-1', 'ring-animato-accent');
                }
                
                updateTotal();
            }

            function updateSeatPrices() {
                // If multiple categories exist, user selected one from dropdown
                updateTotal();
            }

            // --- QUANTITY LOGIC ---
            function incrementTicket(index) {
              const input = document.getElementById('ticket-' + index);
              const max = parseInt(input.getAttribute('max'));
              const current = parseInt(input.value);
              if (current < max) {
                input.value = current + 1;
                updateTotal();
              }
            }

            function decrementTicket(index) {
              const input = document.getElementById('ticket-' + index);
              const current = parseInt(input.value);
              if (current > 0) {
                input.value = current - 1;
                updateTotal();
              }
            }

            // --- TOTAL CALCULATION ---
            function updateTotal() {
              let totalTickets = 0;
              let totalPrice = 0;

              if (hasSeatingPlan) {
                  totalTickets = selectedSeats.length;
                  
                  // Determine price per seat
                  let pricePerSeat = prijzen[0].prijs; // Default to first
                  let categoryName = prijzen[0].categorie;

                  if (prijzen.length > 1) {
                      const selector = document.getElementById('globalCategory');
                      if (selector) {
                          pricePerSeat = parseFloat(selector.value);
                          categoryName = selector.options[selector.selectedIndex].getAttribute('data-cat');
                          document.getElementById('seatCategorySelector').classList.remove('hidden');
                      }
                  }

                  totalPrice = totalTickets * pricePerSeat;

                  // Render hidden inputs for form submission
                  const container = document.getElementById('selectedSeatsInputs');
                  container.innerHTML = '';
                  selectedSeats.forEach((seat, i) => {
                      // We send as ticket items
                      const inputId = document.createElement('input'); inputId.type = 'hidden'; inputId.name = \`seats[\${i}][id]\`; inputId.value = seat.id;
                      const inputCat = document.createElement('input'); inputCat.type = 'hidden'; inputCat.name = \`seats[\${i}][category]\`; inputCat.value = categoryName;
                      const inputPrice = document.createElement('input'); inputPrice.type = 'hidden'; inputPrice.name = \`seats[\${i}][price]\`; inputPrice.value = pricePerSeat;
                      container.appendChild(inputId);
                      container.appendChild(inputCat);
                      container.appendChild(inputPrice);
                  });

              } else {
                  prijzen.forEach((prijs, index) => {
                    const aantal = parseInt(document.getElementById('ticket-' + index).value) || 0;
                    totalTickets += aantal;
                    totalPrice += aantal * prijs.prijs;
                  });
              }

              document.getElementById('total-tickets').textContent = totalTickets;
              document.getElementById('total-price').textContent = '€' + totalPrice.toFixed(2);
              // Spiegel naar de fullscreen-modal footer (alleen aanwezig in seating-plan mode)
              const fsCount = document.getElementById('seatFsTicketCount');
              const fsTotal = document.getElementById('seatFsTicketTotal');
              if (fsCount) fsCount.textContent = totalTickets;
              if (fsTotal) fsTotal.textContent = '€' + totalPrice.toFixed(2);

              const submitBtn = document.getElementById('submit-btn');
              if (totalTickets > 0) submitBtn.disabled = false;
              else submitBtn.disabled = true;
            }
          ` }} />
        </div>
      </div>
    </Layout>
  )
})

// ==========================================
// ORDER PROCESSING API
// ==========================================
app.post('/api/tickets/order', async (c) => {
  const body = await c.req.parseBody()
  
  try {
    const concertId = parseInt(String(body.concert_id))
    const koperNaam = String(body.koper_naam)
    const koperEmail = String(body.koper_email)
    const koperTelefoon = String(body.koper_telefoon || '')

    // Parse tickets from form data
    const tickets: any[] = []
    let totalAmount = 0
    let totalTickets = 0
    
    // Check if seat-based
    const seatKeys = Object.keys(body).filter(k => k.startsWith('seats['));
    
    if (seatKeys.length > 0) {
        // Seat logic
        // Group by category to simplify
        const seatsMap = new Map(); // seatIndex -> object
        
        for (const [key, value] of Object.entries(body)) {
            const match = key.match(/seats\[(\d+)\]\[(\w+)\]/);
            if (match) {
                const idx = match[1];
                const field = match[2];
                if (!seatsMap.has(idx)) seatsMap.set(idx, {});
                seatsMap.get(idx)[field] = value;
            }
        }

        for (const seatData of seatsMap.values()) {
            const price = parseFloat(seatData.price);
            tickets.push({ 
                categorie: seatData.category, 
                aantal: 1, 
                prijs: price,
                seat_id: parseInt(seatData.id) // Specific seat
            });
            totalTickets++;
            totalAmount += price;
        }

    } else {
        // Quantity logic (Legacy)
        for (const [key, value] of Object.entries(body)) {
          const match = key.match(/tickets\[(\d+)\]\[aantal\]/)
          if (match) {
            const index = parseInt(match[1])
            const aantal = parseInt(String(value))
            
            if (aantal > 0) {
              const categorie = String(body[`tickets[${index}][categorie]`])
              const prijs = parseFloat(String(body[`tickets[${index}][prijs]`]))
              
              tickets.push({ categorie, aantal, prijs })
              totalTickets += aantal
              totalAmount += aantal * prijs
            }
          }
        }
    }

    if (tickets.length === 0) throw new Error('Geen tickets geselecteerd')

    // Get concert info
    const concert = await queryOne(c.env.DB, `SELECT * FROM concerts WHERE id = ?`, [concertId])
    if (!concert) throw new Error('Concert niet gevonden')

    // Double check seat availability if seat-based
    if (seatKeys.length > 0) {
        // Ruim stale locks op vóór de check, anders blokkeren afgebroken bestellingen nieuwe orders
        await releaseStaleLocks(c.env.DB, concertId)
        for (const ticket of tickets) {
            if (ticket.seat_id) {
                const isSold = await queryOne(c.env.DB, `SELECT id FROM ticket_seats WHERE seat_id = ? AND concert_id = ? AND status IN ('sold', 'locked')`, [ticket.seat_id, concertId]);
                if (isSold) throw new Error('Een van de gekozen stoelen is helaas net bezet. Probeer het opnieuw.');
            }
        }
    } else {
        if (concert.capaciteit > 0 && (concert.verkocht + totalTickets) > concert.capaciteit) {
            throw new Error('Niet genoeg tickets beschikbaar')
        }
    }

    // Generate order reference (gedeeld over alle line-items binnen één order)
    const orderRef = 'TIX-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 7).toUpperCase()

    // Get event details
    const event = await queryOne(c.env.DB, `SELECT e.titel, e.start_at, e.locatie FROM events e JOIN concerts c ON c.event_id = e.id WHERE c.id = ?`, [concertId])

    // Create Mollie payment
    // getSiteUrl(): system_settings.site_url → env.SITE_URL → request-origin → fallback animato-live.pages.dev
    // (Was eerder: hardcoded 'https://animato.be' als fallback → resolveerde niet, dus geen redirect terug en geen webhook)
    const siteUrl = await getSiteUrl(c)
    const mollieKey = await getMollieApiKey(c.env)
    // Mock-modus: geen echte key OF expliciet de sample-key
    const isDevelopment = !mollieKey || mollieKey === 'mock' || mollieKey.includes('test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM')
    let molliePayment: any

    if (isDevelopment) {
      console.log('[Tickets] Mock-modus: simuleer betaling')
      molliePayment = {
        id: 'mock_' + crypto.randomUUID(),
        status: 'open',
        _links: { checkout: { href: `${siteUrl}/tickets/bevestiging/${orderRef}?mock=true` } }
      }
    } else {
      molliePayment = await createMolliePayment(mollieKey, {
        amount: totalAmount,
        description: `Tickets ${event.titel} - ${orderRef}`,
        redirectUrl: `${siteUrl}/tickets/bevestiging/${orderRef}`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: { type: 'ticket', order_ref: orderRef, concert_id: concertId }
      })
      if (!molliePayment) throw new Error('Kon geen betaling aanmaken')
    }

    // Insert ticket order (Master Record)
    // IMPORTANT: If seated, we still create ONE ticket record per seat for simplicity in checking/scanning?
    // OR one order ticket record?
    // Current schema: One row in `tickets` table per 'order'. 
    // Wait, the schema says: `aantal INTEGER NOT NULL DEFAULT 1`. 
    // So one row per category group.
    
    // Let's create one master ticket record per line item.
    // If seated, we should probably create one ticket per seat to allow individual scanning?
    // The current `tickets` table has `aantal`.
    // Let's group by category if not seated. If seated, split?
    // For seating, we need to link `ticket_seats`.
    
    // Strategy: Create one ticket record per category group (like before), but link seats to them.
    // If 2 standard seats selected -> 1 ticket record with aantal=2. Link 2 entries in ticket_seats.
    
    // Group tickets by category
    const groupedTickets = tickets.reduce((acc: any, t: any) => {
        const key = t.categorie;
        if (!acc[key]) acc[key] = { ...t, seat_ids: [] };
        else {
            acc[key].aantal += t.aantal;
            // acc[key].prijs is same
        }
        if (t.seat_id) acc[key].seat_ids.push(t.seat_id);
        return acc;
    }, {});

    for (const cat of Object.values(groupedTickets) as any) {
        // BUG-FIX (#240): elke ticket-rij krijgt een eigen QR-code. Vroeger werd één qr_code
        // hergebruikt voor alle categorieën in dezelfde order → UNIQUE constraint failed bij multi-cat
        const qrCode = crypto.randomUUID()
        const res = await execute(c.env.DB, `
          INSERT INTO tickets (
            concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
            aantal, categorie, prijs_totaal, status, qr_code, betaling_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `, [
          concertId, orderRef, koperEmail, koperNaam, koperTelefoon,
          cat.aantal, cat.categorie, cat.aantal * cat.prijs, qrCode, molliePayment.id
        ])

        const ticketId = res.meta.last_row_id;

        // Link seats if any — lock voor 15 minuten zodat stale locks opgeruimd kunnen worden
        if (cat.seat_ids && cat.seat_ids.length > 0) {
            const expiresAt = lockExpiryTimestamp()
            const stmt = c.env.DB.prepare(`INSERT INTO ticket_seats (ticket_id, seat_id, concert_id, status, lock_expires_at) VALUES (?, ?, ?, 'locked', ?)`);
            const batch = cat.seat_ids.map((sid: number) => stmt.bind(ticketId, sid, concertId, expiresAt));
            await c.env.DB.batch(batch);
        }
    }

    // Update capacity count (still useful for quick stats)
    await execute(c.env.DB, `UPDATE concerts SET verkocht = verkocht + ? WHERE id = ?`, [totalTickets, concertId])

    // Send email
    const eventDate = new Date(event.start_at)
    await sendEmail({
      to: koperEmail,
      subject: `Bestelbevestiging ${orderRef} - ${event.titel}`,
      html: orderConfirmationEmail({
        orderRef, koperNaam, concertTitel: event.titel,
        concertDatum: eventDate.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        concertLocatie: event.locatie,
        tickets: Object.values(groupedTickets).map((t: any) => `${t.aantal}x ${t.categorie} (€${t.prijs.toFixed(2)})`).join(', '),
        totaalBedrag: totalAmount,
        betaalUrl: molliePayment._links.checkout.href
      })
    }, c.env.RESEND_API_KEY)

    return c.redirect(molliePayment._links.checkout.href)
    
  } catch (error) {
    console.error('Order processing error:', error)
    return c.html(
      <Layout title="Fout bij bestelling">
        <div class="max-w-2xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-exclamation-triangle text-6xl text-red-500 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-4">Er ging iets mis</h1>
          <p class="text-gray-600 mb-8">{(error as Error).message}</p>
          <a href="/" class="text-animato-primary hover:underline">Terug naar homepage</a>
        </div>
      </Layout>
    )
  }
})

// ==========================================
// ORDER CONFIRMATION PAGE
// ==========================================
app.get('/tickets/bevestiging/:orderRef', async (c) => {
  const orderRef = c.req.param('orderRef')
  const user = c.get('user') as SessionUser | null
  const isMockPayment = c.req.query('mock') === 'true'

  // BUG-FIX (#240): multi-cat orders hebben meerdere ticket-rijen onder hetzelfde order_ref
  const ticketLines = await queryAll<any>(c.env.DB, `
    SELECT t.*, c.programma, e.titel, e.start_at, e.locatie
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    WHERE t.order_ref = ?
    ORDER BY t.id ASC
  `, [orderRef])

  if (!ticketLines || ticketLines.length === 0) {
    return c.html(
      <Layout title="Bestelling niet gevonden" user={user}>
        <div class="max-w-2xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-search text-6xl text-gray-300 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Bestelling niet gevonden</h1>
          <p class="text-gray-600">We konden geen bestelling vinden met deze referentie.</p>
        </div>
      </Layout>
    )
  }

  const ticket = ticketLines[0]  // Voor de header-info (concert, naam, etc.)

  // Auto-mark mock payments — werkt sowieso al via order_ref op alle rijen
  if (isMockPayment && ticket.status === 'pending') {
    await execute(c.env.DB, `UPDATE tickets SET status = 'paid', betaald_at = CURRENT_TIMESTAMP WHERE order_ref = ?`, [orderRef])
    await execute(c.env.DB, `
        UPDATE ticket_seats SET status = 'sold', lock_expires_at = NULL
        WHERE ticket_id IN (SELECT id FROM tickets WHERE order_ref = ?)
    `, [orderRef])
    ticket.status = 'paid'
    ticketLines.forEach((t: any) => t.status = 'paid')
  }

  const eventDate = new Date(ticket.start_at)
  const totaalAantal = ticketLines.reduce((sum: number, t: any) => sum + (t.aantal || 0), 0)
  const totaalBedrag = ticketLines.reduce((sum: number, t: any) => sum + (t.prijs_totaal || 0), 0)
  const isPending = ticketLines.some((t: any) => t.status === 'pending')

  return c.html(
    <Layout title="Bestelbevestiging" user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-3xl mx-auto px-4">
          <div class={`${isPending ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'} border rounded-lg p-8 mb-8 text-center`}>
            <i class={`fas ${isPending ? 'fa-clock text-yellow-500' : 'fa-check-circle text-green-500'} text-6xl mb-4`}></i>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              {isPending ? 'Bestelling in verwerking…' : 'Bestelling Bevestigd!'}
            </h1>
            <p class="text-gray-700 text-lg mb-4">
              {isPending
                ? 'Zodra de betaling bevestigd is, ontvang je per mail je tickets.'
                : 'Je tickets zijn per mail verzonden.'}
            </p>
            {isMockPayment && <div class="inline-block bg-yellow-100 border border-yellow-300 rounded-lg px-4 py-2 mb-4 text-sm text-yellow-800">Mock Payment</div>}
            <div class="inline-block bg-white rounded-lg px-6 py-3 shadow-md">
              <div class="text-sm text-gray-600 mb-1">Bestel referentie</div>
              <div class="text-2xl font-mono font-bold text-gray-900">{ticket.order_ref}</div>
            </div>
          </div>

          {/* Order details */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4 text-lg"><i class="fas fa-music mr-2 text-animato-primary"></i>{ticket.titel}</h2>
            <div class="text-sm text-gray-600 mb-4">
              <div><i class="fas fa-calendar mr-2 w-4"></i>{eventDate.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div><i class="fas fa-map-marker-alt mr-2 w-4"></i>{ticket.locatie}</div>
              <div><i class="fas fa-user mr-2 w-4"></i>{ticket.koper_naam} ({ticket.koper_email})</div>
            </div>

            <h3 class="font-semibold text-gray-800 mb-2 text-sm uppercase tracking-wide">Tickets</h3>
            <table class="w-full text-sm border-t border-gray-200">
              <tbody>
                {ticketLines.map((line: any) => (
                  <tr class="border-b border-gray-100">
                    <td class="py-2 text-gray-700">{line.aantal}× {line.categorie}</td>
                    <td class="py-2 text-right font-mono">€ {Number(line.prijs_totaal).toFixed(2)}</td>
                  </tr>
                ))}
                <tr class="font-bold border-t-2 border-gray-300">
                  <td class="py-2">Totaal ({totaalAantal} ticket{totaalAantal !== 1 ? 's' : ''})</td>
                  <td class="py-2 text-right font-mono text-lg">€ {totaalBedrag.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="text-center">
            <a href="/concerten" class="inline-flex items-center bg-gray-100 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-200 transition mr-4">
              <i class="fas fa-calendar mr-2"></i> Bekijk meer concerten
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
