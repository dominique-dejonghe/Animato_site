import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { QuillLinkPicker } from '../components/QuillLinkPicker'
import { requireRole, requireBestuurslid, type SessionUser } from '../middleware/auth'
import { queryAll, queryOne, execute } from '../utils/db'
import { getMollieMode } from '../utils/mollie'
import { getMollieApiKey } from '../utils/mollie-config'
import { releaseStaleLocks } from '../utils/seat-locks'
import { sendEmail, ticketEmail } from '../utils/email'
import { generateTicketPdf, generateSeatTicketPdf, generateSeatTicketPdfs, uint8ArrayToBase64 } from '../utils/ticket-pdf'
import { zipTicketPdfs } from '../utils/ticket-zip'
import { getSiteUrl } from '../utils/site-url'
import {
  loadResendTemplate, saveResendTemplate,
  loadTicketOrderContext, renderEmail,
  buildTicketAttachments, loadTicketLogoBytes,
} from '../utils/ticket-resend'
import { uploadDataUrlToR2, isDataUrl } from '../utils/r2-storage'
import { parseBrusselsDate, formatBrusselsDate, formatBrusselsDateTime, brusselsToday } from '../utils/time'

const app = new Hono()

// Apply admin authentication to all routes
// 2026-06-13: ook /api/admin/tickets/* beschermen (was eerder open)
app.use('/admin/*', requireBestuurslid)
app.use('/api/admin/*', requireBestuurslid)

// ==========================================
// CONCERTS OVERVIEW - List all concerts with ticketing
// ==========================================
app.get('/admin/tickets', async (c) => {
  const user = c.get('user') as SessionUser

  // Filter: 'upcoming' (default), 'open', 'announced', 'soldout', 'past', 'all'
  const filter = (c.req.query('filter') || 'upcoming').toLowerCase()
  const search = (c.req.query('q') || '').trim()

  // Haal eerst alles op — filteren daarna in JS op basis van de samengestelde status
  // BUG-FIX: `c.verkocht` was een stale counter (kon afwijken van werkelijke ticketverkoop
  // door annuleringen/refunds). We berekenen het nu live uit SUM(t.aantal WHERE paid)
  // zodat 'Bezetting X/Y' altijd overeenkomt met de echte betaalde tickets.
  let baseQuery = `
    SELECT e.id as event_id, e.titel, e.slug, e.start_at, e.locatie, e.type,
           c.id as concert_id, c.programma, c.ticketing_enabled, c.uitverkocht, c.tickets_aangekondigd, c.voorverkoop_start_at,
           c.capaciteit,
           COALESCE(SUM(CASE WHEN t.status = 'paid' THEN t.aantal ELSE 0 END), 0) as verkocht,
           COUNT(t.id) as ticket_count,
           SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN t.status = 'paid' THEN t.prijs_totaal ELSE 0 END) as revenue
    FROM events e
    LEFT JOIN concerts c ON c.event_id = e.id
    LEFT JOIN tickets t ON t.concert_id = c.id
    WHERE e.type = 'concert'
  `
  const params: any[] = []
  if (search) {
    baseQuery += ` AND (e.titel LIKE ? OR e.locatie LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }
  baseQuery += ` GROUP BY e.id ORDER BY e.start_at ASC`

  const allConcerts = await queryAll<any>(c.env.DB, baseQuery, params)

  // Bereken status per concert
  const now = Date.now()
  const withStatus = allConcerts.map((row: any) => {
    const startTs = parseBrusselsDate(row.start_at)?.getTime() ?? 0
    const voorverkoopTs = parseBrusselsDate(row.voorverkoop_start_at)?.getTime() ?? 0
    const isPast = startTs > 0 && startTs < now
    const isSoldOut = row.uitverkocht == 1
    const isAnnounced = !isSoldOut && !isPast && (row.tickets_aangekondigd == 1 || (voorverkoopTs > 0 && voorverkoopTs > now))
    const isOpen = !isSoldOut && !isPast && !isAnnounced && row.ticketing_enabled == 1
    let status: 'past' | 'soldout' | 'announced' | 'open' | 'free' = 'free'
    if (isPast) status = 'past'
    else if (isSoldOut) status = 'soldout'
    else if (isAnnounced) status = 'announced'
    else if (isOpen) status = 'open'
    return { ...row, _status: status, _isPast: isPast }
  })

  // Tel per status voor de filterknoppen
  const statusCounts: Record<string, number> = {
    all: withStatus.length,
    upcoming: withStatus.filter(r => !r._isPast).length,
    open: withStatus.filter(r => r._status === 'open').length,
    announced: withStatus.filter(r => r._status === 'announced').length,
    soldout: withStatus.filter(r => r._status === 'soldout').length,
    past: withStatus.filter(r => r._status === 'past').length,
    free: withStatus.filter(r => r._status === 'free' && !r._isPast).length,
  }

  // Pas filter toe
  let concerts = withStatus
  if (filter === 'upcoming') concerts = withStatus.filter(r => !r._isPast)
  else if (filter === 'open') concerts = withStatus.filter(r => r._status === 'open')
  else if (filter === 'announced') concerts = withStatus.filter(r => r._status === 'announced')
  else if (filter === 'soldout') concerts = withStatus.filter(r => r._status === 'soldout')
  else if (filter === 'past') concerts = withStatus.filter(r => r._status === 'past').reverse() // recentste eerst
  else if (filter === 'free') concerts = withStatus.filter(r => r._status === 'free' && !r._isPast)
  // 'all' → alles ongewijzigd

  return c.html(
    <Layout title="Ticketing Beheer" user={user}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        <div class="mb-4">
          <a href="/admin" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
            <i class="fas fa-arrow-left mr-2"></i> Terug naar Admin Dashboard
          </a>
        </div>
        {/* Header */}
        <div class="flex justify-between items-center mb-8">
          <div>
            <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-ticket-alt mr-3"></i>
              Kaartenverkoop Beheer
            </h1>
            <p class="text-gray-600">
              Beheer concerten, prijzen en bekijk bestellingen
              {filter !== 'upcoming' && (
                <span class="ml-2 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                  Filter: {filter === 'open' ? 'Verkoop open' : filter === 'announced' ? 'Aangekondigd' : filter === 'soldout' ? 'Uitverkocht' : filter === 'past' ? 'Afgelopen' : filter === 'free' ? 'Geen tickets' : 'Alle'}
                </span>
              )}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a
              href="/admin/tickets/resend"
              class="bg-white border-2 border-animato-primary text-animato-primary px-4 py-3 rounded-lg hover:bg-purple-50 transition inline-flex items-center"
              title="Herstuur ticket-mails naar geselecteerde kopers"
            >
              <i class="fas fa-paper-plane mr-2"></i>
              Tickets opnieuw versturen
            </a>
            <a
              href="/admin/events/nieuw?type=concert"
              class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition inline-flex items-center"
            >
              <i class="fas fa-plus mr-2"></i>
              Nieuw Concert
            </a>
          </div>
        </div>

        {/*
          Stats Cards — met extra tile "Vrije Kaarten".
          De teller telt ENKEL concerten met capaciteit > 0 die NIET afgelopen
          en NIET uitverkocht zijn (dus effectief nog verkoopbaar).
          Voor 'Verkocht' en 'Beschikbaar' gebruiken we dezelfde subset zodat
          de sublabel ("uit N concerten") logisch klopt.
        */}
        <div class="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Totaal Concerten</p>
                <p class="text-3xl font-bold text-gray-900">{concerts.length}</p>
              </div>
              <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-music text-purple-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Tickets Verkocht</p>
                <p class="text-3xl font-bold text-gray-900">
                  {concerts.reduce((sum: number, c: any) => sum + Number(c.verkocht || 0), 0)}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  uit {concerts.reduce((sum: number, c: any) => sum + Number(c.paid_count || 0), 0)} bestellingen
                </p>
              </div>
              <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-ticket-alt text-green-600 text-xl"></i>
              </div>
            </div>
          </div>

          {/* Vrije kaarten — alleen relevante concerten (niet afgelopen, niet uitverkocht, capaciteit > 0) */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Vrije Kaarten</p>
                <p class="text-3xl font-bold text-gray-900">
                  {concerts
                    .filter((c: any) => Number(c.capaciteit || 0) > 0 && !c._isPast && !c.uitverkocht)
                    .reduce((sum: number, c: any) => sum + Math.max(0, Number(c.capaciteit || 0) - Number(c.verkocht || 0)), 0)}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  nog te koop bij {concerts.filter((c: any) => Number(c.capaciteit || 0) > 0 && !c._isPast && !c.uitverkocht).length} concert(en)
                </p>
              </div>
              <div class="w-12 h-12 bg-teal-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-chair text-teal-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Totale Omzet</p>
                <p class="text-3xl font-bold text-gray-900">
                  €{concerts.reduce((sum: number, c: any) => sum + (c.revenue || 0), 0).toFixed(2)}
                </p>
              </div>
              <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-euro-sign text-blue-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Uitverkocht</p>
                <p class="text-3xl font-bold text-gray-900">
                  {concerts.filter((c: any) => c.uitverkocht).length}
                </p>
              </div>
              <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-times-circle text-red-600 text-xl"></i>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs + Search */}
        <div class="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div class="flex flex-wrap items-center gap-2 mb-4">
            {[
              { key: 'upcoming', label: 'Aankomend', icon: 'fa-calendar-day', count: statusCounts.upcoming, color: 'bg-animato-primary text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
              { key: 'open', label: 'Verkoop open', icon: 'fa-shopping-cart', count: statusCounts.open, color: 'bg-green-600 text-white', inactive: 'bg-green-50 text-green-700 hover:bg-green-100' },
              { key: 'announced', label: 'Aangekondigd', icon: 'fa-hourglass-half', count: statusCounts.announced, color: 'bg-amber-600 text-white', inactive: 'bg-amber-50 text-amber-800 hover:bg-amber-100' },
              { key: 'soldout', label: 'Uitverkocht', icon: 'fa-ban', count: statusCounts.soldout, color: 'bg-red-600 text-white', inactive: 'bg-red-50 text-red-700 hover:bg-red-100' },
              { key: 'free', label: 'Geen tickets', icon: 'fa-info-circle', count: statusCounts.free, color: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-600 hover:bg-gray-100' },
              { key: 'past', label: 'Afgelopen', icon: 'fa-history', count: statusCounts.past, color: 'bg-gray-600 text-white', inactive: 'bg-gray-50 text-gray-600 hover:bg-gray-100' },
              { key: 'all', label: 'Alle', icon: 'fa-list', count: statusCounts.all, color: 'bg-gray-800 text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
            ].map(tab => (
              <a
                href={`/admin/tickets?filter=${tab.key}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition ${filter === tab.key ? tab.color : tab.inactive}`}
              >
                <i class={`fas ${tab.icon} text-xs`}></i>
                {tab.label}
                <span class={`text-xs font-bold ${filter === tab.key ? 'bg-white/25' : 'bg-white'} px-2 py-0.5 rounded-full`}>
                  {tab.count}
                </span>
              </a>
            ))}
          </div>
          <form method="GET" action="/admin/tickets" class="flex gap-2">
            <input type="hidden" name="filter" value={filter} />
            <input
              type="search"
              name="q"
              value={search}
              placeholder="Zoek op titel of locatie..."
              class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-animato-primary focus:ring-1 focus:ring-animato-primary"
            />
            <button type="submit" class="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-900 transition">
              <i class="fas fa-search mr-1"></i>Zoek
            </button>
            {search && (
              <a href={`/admin/tickets?filter=${filter}`} class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 inline-flex items-center">
                <i class="fas fa-times mr-1"></i>Wis
              </a>
            )}
          </form>
        </div>

        {/* Concerts List */}
        {concerts.length === 0 ? (
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-calendar-times text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">
              {filter === 'past' ? 'Geen afgelopen concerten' :
               filter === 'open' ? 'Geen concerten met open verkoop' :
               filter === 'announced' ? 'Geen aangekondigde concerten' :
               filter === 'soldout' ? 'Geen uitverkochte concerten' :
               search ? `Geen resultaten voor "${search}"` :
               'Geen concerten gevonden'}
            </h3>
            <p class="text-gray-500 mb-6">
              {filter === 'upcoming' || filter === 'all'
                ? 'Maak een nieuw concert aan om tickets te kunnen verkopen'
                : 'Probeer een ander filter of pas de ticketinstellingen per concert aan'}
            </p>
            <a
              href="/admin/events/nieuw?type=concert"
              class="inline-flex items-center bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-plus mr-2"></i>
              Nieuw Concert
            </a>
          </div>
        ) : (
          <div class="space-y-4">
            {concerts.map((concert: any) => {
              const eventDate = new Date(concert.start_at)
              const isPast = eventDate < new Date()
              const capacityPercent = concert.capaciteit > 0 
                ? Math.round((concert.verkocht / concert.capaciteit) * 100) 
                : 0

              return (
                <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition">
                  <div class="flex flex-col md:flex-row">
                    {/* Concert Info */}
                    <div class="flex-1 p-6">
                      <div class="flex items-start justify-between mb-4">
                        <div class="flex-1">
                          <div class="flex items-center gap-3 mb-2">
                            <h3 class="text-xl font-bold text-gray-900">
                              {concert.titel}
                            </h3>
                            {isPast ? (
                              <span class="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                                <i class="fas fa-history mr-1"></i>AFGELOPEN
                              </span>
                            ) : concert._status === 'soldout' ? (
                              <span class="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                                <i class="fas fa-ban mr-1"></i>UITVERKOCHT
                              </span>
                            ) : concert._status === 'announced' ? (
                              <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold" title={concert.voorverkoop_start_at ? `Voorverkoop start ${concert.voorverkoop_start_at}` : 'Tickets volgen binnenkort'}>
                                <i class="fas fa-hourglass-half mr-1"></i>
                                {concert.voorverkoop_start_at && (parseBrusselsDate(concert.voorverkoop_start_at)?.getTime() ?? 0) > Date.now()
                                  ? `VOORVERKOOP OP ${formatBrusselsDate(concert.voorverkoop_start_at, { day: 'numeric', month: 'short' })}`
                                  : 'AANGEKONDIGD'}
                              </span>
                            ) : concert._status === 'open' ? (
                              <span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                                <i class="fas fa-shopping-cart mr-1"></i>VERKOOP OPEN
                              </span>
                            ) : (
                              <span class="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                                <i class="fas fa-info-circle mr-1"></i>TICKETINFO VOLGT
                              </span>
                            )}
                          </div>
                          <div class="flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>
                              <i class="fas fa-calendar mr-2"></i>
                              {eventDate.toLocaleDateString('nl-NL', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                              })}
                            </span>
                            <span>
                              <i class="fas fa-clock mr-2"></i>
                              {eventDate.toLocaleTimeString('nl-NL', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </span>
                            <span>
                              <i class="fas fa-map-marker-alt mr-2"></i>
                              {concert.locatie}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Capacity Bar — toont ook resterende vrije plaatsen */}
                      {concert.capaciteit > 0 && (
                        <div class="mb-4">
                          <div class="flex items-center justify-between text-sm mb-1">
                            <span class="font-medium text-gray-700">
                              Bezetting: {concert.verkocht} / {concert.capaciteit}
                              {!concert._isPast && !concert.uitverkocht && (
                                <span class="ml-2 text-teal-700">
                                  — {Math.max(0, Number(concert.capaciteit) - Number(concert.verkocht || 0))} nog beschikbaar
                                </span>
                              )}
                            </span>
                            <span class="text-gray-600">{capacityPercent}%</span>
                          </div>
                          <div class="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              class={`h-2 rounded-full ${
                                capacityPercent >= 100 ? 'bg-red-500' :
                                capacityPercent >= 80 ? 'bg-yellow-500' :
                                'bg-green-500'
                              }`}
                              style={`width: ${Math.min(capacityPercent, 100)}%`}
                            ></div>
                          </div>
                        </div>
                      )}

                      {/* Stats */}
                      <div class="grid grid-cols-3 gap-4">
                        <div class="bg-gray-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-gray-900">
                            {concert.paid_count || 0}
                          </div>
                          <div class="text-xs text-gray-600">Bestellingen</div>
                        </div>
                        <div class="bg-green-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-green-700">
                            {Number(concert.verkocht || 0)}
                          </div>
                          <div class="text-xs text-gray-600">Tickets</div>
                        </div>
                        <div class="bg-blue-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-blue-700">
                            €{(concert.revenue || 0).toFixed(2)}
                          </div>
                          <div class="text-xs text-gray-600">Omzet</div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div class="bg-gray-50 p-6 flex flex-col justify-center gap-3 md:w-64">
                      {concert.concert_id ? (
                        <>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/orders`}
                            class="w-full bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 transition text-center"
                          >
                            <i class="fas fa-list mr-2"></i>
                            Bekijk Bestellingen
                          </a>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/settings`}
                            class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                          >
                            <i class="fas fa-cog mr-2"></i>
                            Instellingen
                          </a>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/scan`}
                            class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                          >
                            <i class="fas fa-qrcode mr-2"></i>
                            QR Scanner
                          </a>
                        </>
                      ) : (
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                          <i class="fas fa-exclamation-triangle text-yellow-600 mb-2"></i>
                          <p class="text-xs text-yellow-800">Ticketing nog niet ingeschakeld</p>
                        </div>
                      )}
                      <a
                        href={`/concerten/${concert.slug}`}
                        class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                      >
                        <i class="fas fa-external-link-alt mr-2"></i>
                        Publieke Pagina
                      </a>
                      <a
                        href={`/admin/events/${concert.event_id}`}
                        class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                      >
                        <i class="fas fa-edit mr-2"></i>
                        Activiteit Bewerken
                      </a>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
})

// ==========================================
// CONCERT ORDERS - View all orders for a concert
// ==========================================
app.get('/admin/tickets/concert/:concertId/orders', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))

  // Sort-parameters (server-side sortering, herkomstig uit ?sort=&dir=)
  // Toegestane kolommen: whitelist tegen SQL-injectie.
  // 'datum' sorteert op betaald_at met fallback naar created_at zodat pending
  // bestellingen niet onderaan de put belanden.
  const sortParam = String(c.req.query('sort') || 'datum').toLowerCase()
  const dirParam  = String(c.req.query('dir')  || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const SORT_MAP: Record<string, string> = {
    'datum':    `COALESCE(betaald_at, created_at)`,
    'created':  `created_at`,
    'koper':    `LOWER(koper_naam)`,
    'aantal':   `aantal`,
    'prijs':    `prijs_totaal`,
    'status':   `status`,
    'ref':      `order_ref`,
    'categorie':`categorie`,
  }
  const orderBySql = SORT_MAP[sortParam] || SORT_MAP['datum']

  // Get concert info — live verkocht-berekening i.p.v. stale counter
  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie,
           (SELECT COALESCE(SUM(t.aantal), 0) FROM tickets t
            WHERE t.concert_id = c.id AND t.status = 'paid') AS verkocht
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])

  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  // Get all tickets/orders — dynamisch gesorteerd
  const tickets = await queryAll<any>(c.env.DB, `
    SELECT *
    FROM tickets
    WHERE concert_id = ?
    ORDER BY ${orderBySql} ${dirParam}, id ${dirParam}
  `, [concertId])

  // ==========================================
  // Aggregatie voor de grafiek: aantal betaalde kaarten per dag
  // ==========================================
  // We groeperen op DATE(betaald_at) — alleen effectief betaalde tickets
  // tellen mee (status='paid'). Pending/cancelled/refunded blijven eruit
  // omdat die de "verkocht"-curve zouden vertekenen.
  //
  // De grafiek toont een venster op basis van ?chart_days= (default 30).
  // Options: 7, 30, 90, all. Voor "all" gaan we terug tot de eerste verkoop.
  const chartDaysParam = String(c.req.query('chart_days') || '30').toLowerCase()
  const chartDays = chartDaysParam === 'all' ? null
                  : chartDaysParam === '7'   ? 7
                  : chartDaysParam === '90'  ? 90
                  : 30
  const salesRows = await queryAll<{ dag: string; aantal_tickets: number; aantal_orders: number; omzet: number }>(c.env.DB, `
    SELECT DATE(COALESCE(betaald_at, created_at)) AS dag,
           SUM(aantal)       AS aantal_tickets,
           COUNT(*)          AS aantal_orders,
           SUM(prijs_totaal) AS omzet
    FROM tickets
    WHERE concert_id = ?
      AND status = 'paid'
      ${chartDays ? `AND DATE(COALESCE(betaald_at, created_at)) >= DATE('now', ?)` : ''}
    GROUP BY dag
    ORDER BY dag ASC
  `, chartDays ? [concertId, `-${chartDays} days`] : [concertId])

  // Fill-in ontbrekende dagen zodat de bar chart geen gaten heeft
  // (anders kruipt de X-as scheef en zie je "gaten in de tijd" niet)
  let chartLabels: string[] = []
  let chartTickets: number[] = []
  let chartOrders: number[] = []
  let chartOmzet: number[] = []
  if (salesRows.length > 0) {
    const salesByDay = new Map<string, { tickets: number; orders: number; omzet: number }>()
    for (const r of salesRows) {
      salesByDay.set(r.dag, {
        tickets: Number(r.aantal_tickets) || 0,
        orders: Number(r.aantal_orders) || 0,
        omzet: Number(r.omzet) || 0,
      })
    }
    // Bepaal start- en einddag
    const firstSaleDate = salesRows[0].dag
    const startDate = chartDays
      ? new Date(Date.now() - chartDays * 24 * 60 * 60 * 1000)
      : new Date(firstSaleDate + 'T00:00:00Z')
    const endDate = new Date() // vandaag
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()))
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()))
    // Cap op maximaal 365 dagen om edge-cases (verkoop 2 jaar geleden) te vermijden
    let safety = 0
    while (cursor <= end && safety < 366) {
      const key = cursor.toISOString().slice(0, 10) // YYYY-MM-DD
      chartLabels.push(key)
      const s = salesByDay.get(key)
      chartTickets.push(s?.tickets || 0)
      chartOrders.push(s?.orders || 0)
      chartOmzet.push(s?.omzet || 0)
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      safety++
    }
  }
  const chartTotals = {
    tickets: chartTickets.reduce((a, b) => a + b, 0),
    orders:  chartOrders.reduce((a, b) => a + b, 0),
    omzet:   chartOmzet.reduce((a, b) => a + b, 0),
    piekDag: (() => {
      if (chartTickets.length === 0) return null
      let maxIdx = 0
      for (let i = 1; i < chartTickets.length; i++) {
        if (chartTickets[i] > chartTickets[maxIdx]) maxIdx = i
      }
      return chartTickets[maxIdx] > 0
        ? { dag: chartLabels[maxIdx], aantal: chartTickets[maxIdx] }
        : null
    })(),
  }

  // Bereken bezetting-percentage voor de progress bar
  const capaciteit = Number(concert.capaciteit) || 0
  const verkocht = Number(concert.verkocht) || 0
  const bezettingPct = capaciteit > 0 ? Math.min(100, Math.round((verkocht / capaciteit) * 100)) : 0
  // Kleurcoderen: groen tot 70%, oranje tot 90%, rood daarboven
  const bezettingColor = bezettingPct >= 90 ? 'bg-red-500'
                       : bezettingPct >= 70 ? 'bg-orange-500'
                       : 'bg-green-500'
  const bezettingTextColor = bezettingPct >= 90 ? 'text-red-700'
                           : bezettingPct >= 70 ? 'text-orange-700'
                           : 'text-green-700'

  return c.html(
    <Layout title={`Bestellingen - ${concert.titel}`} user={user}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav class="text-sm text-gray-600 mb-4" aria-label="Breadcrumb">
          <ol class="flex items-center flex-wrap gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home mr-1"></i>Admin</a></li>
            <li class="text-gray-400">/</li>
            <li><a href="/admin/tickets" class="hover:text-animato-primary">Ticketbeheer</a></li>
            <li class="text-gray-400">/</li>
            <li><a href={`/admin/tickets/concert/${concertId}/settings`} class="hover:text-animato-primary">{concert.titel}</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium">Bestellingen</li>
          </ol>
        </nav>
        <div class="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              Bestellingen: {concert.titel}
            </h1>
            <div class="flex flex-wrap gap-4 text-gray-600">
              <span>
                <i class="fas fa-calendar mr-2"></i>
                {new Date(concert.start_at).toLocaleDateString('nl-NL', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </span>
              <span>
                <i class="fas fa-map-marker-alt mr-2"></i>
                {concert.locatie}
              </span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <a href={`/api/admin/tickets/concert/${concertId}/export`}
               class="inline-flex items-center bg-white border-2 border-green-600 text-green-700 px-4 py-2 rounded-lg hover:bg-green-50 shadow-sm"
               title="Download volledige kopers-lijst (CSV, Excel-compatibel) — voor manuele controle op concert-dag">
              <i class="fas fa-file-csv mr-2"></i> Kopers-lijst (CSV)
            </a>
            <a href={`/admin/tickets/resend?concert_id=${concertId}`}
               class="inline-flex items-center bg-white border-2 border-animato-primary text-animato-primary px-4 py-2 rounded-lg hover:bg-purple-50 shadow-sm"
               title="Herstuur ticket-mails naar geselecteerde kopers van dit concert">
              <i class="fas fa-paper-plane mr-2"></i> Tickets opnieuw versturen
            </a>
            {concert.seating_plan_id && (
              <a href={`/admin/tickets/concert/${concertId}/zaalplan`}
                 class="inline-flex items-center bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 shadow-sm"
                 title="Visueel zaalplan met live bezetting per stoel">
                <i class="fas fa-map mr-2"></i> Zaalplan-view
              </a>
            )}
          </div>
        </div>

        {/* Bezetting Bar — % van de zaalcapaciteit dat verkocht is */}
        {capaciteit > 0 && (
          <div class="bg-white rounded-lg shadow-md p-5 mb-6">
            <div class="flex items-center justify-between mb-2">
              <div>
                <span class="text-sm font-semibold text-gray-700">
                  <i class="fas fa-chair mr-2 text-animato-primary"></i>
                  Bezetting
                </span>
                <span class="text-sm text-gray-600 ml-2">
                  {verkocht} van {capaciteit} tickets verkocht
                </span>
              </div>
              <div class={`text-2xl font-bold ${bezettingTextColor}`}>
                {bezettingPct}%
              </div>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                class={`h-3 ${bezettingColor} transition-all duration-500`}
                style={`width: ${bezettingPct}%`}
                title={`${verkocht} / ${capaciteit} stoelen`}
              ></div>
            </div>
            {bezettingPct >= 90 && (
              <div class="mt-2 text-xs text-red-700 font-medium">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                Bijna uitverkocht — overweeg het concert als 'uitverkocht' te markeren in de instellingen.
              </div>
            )}
          </div>
        )}

        {/* Quick Stats */}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div class="bg-white rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Totaal Bestellingen</div>
            <div class="text-2xl font-bold text-gray-900">{tickets.length}</div>
          </div>
          <div class="bg-green-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Betaald</div>
            <div class="text-2xl font-bold text-green-700">
              {tickets.filter((t: any) => t.status === 'paid').length}
            </div>
          </div>
          <div class="bg-yellow-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Pending</div>
            <div class="text-2xl font-bold text-yellow-700">
              {tickets.filter((t: any) => t.status === 'pending').length}
            </div>
          </div>
          <div class="bg-blue-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Gescand</div>
            <div class="text-2xl font-bold text-blue-700">
              {tickets.filter((t: any) => t.gescand).length}
            </div>
          </div>
          <div class="bg-gray-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Omzet</div>
            <div class="text-2xl font-bold text-gray-900">
              €{tickets.filter((t: any) => t.status === 'paid')
                .reduce((sum: number, t: any) => sum + t.prijs_totaal, 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Sales-per-dag chart */}
        {chartLabels.length > 0 && (
          <div class="bg-white rounded-lg shadow-md p-5 mb-6">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <i class="fas fa-chart-column text-animato-primary"></i>
                  Kaarten verkocht per dag
                </h3>
                <p class="text-xs text-gray-500 mt-0.5">
                  Alleen betaalde bestellingen. Gebaseerd op betaal-datum (val-back op besteldatum).
                </p>
              </div>
              {/* Period selector */}
              <div class="flex items-center gap-1 text-xs bg-gray-100 rounded-lg p-1">
                {[
                  { key: '7',   label: '7 dagen' },
                  { key: '30',  label: '30 dagen' },
                  { key: '90',  label: '90 dagen' },
                  { key: 'all', label: 'Alle' },
                ].map(opt => {
                  const active = chartDaysParam === opt.key || (opt.key === '30' && chartDaysParam !== '7' && chartDaysParam !== '90' && chartDaysParam !== 'all')
                  const qs = new URLSearchParams()
                  qs.set('chart_days', opt.key)
                  if (sortParam !== 'datum') qs.set('sort', sortParam)
                  if (dirParam !== 'DESC') qs.set('dir', 'asc')
                  return (
                    <a href={`?${qs.toString()}#chart`}
                       class={`px-3 py-1.5 rounded-md font-medium transition ${active ? 'bg-white text-animato-primary shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                      {opt.label}
                    </a>
                  )
                })}
              </div>
            </div>

            {/* Chart totals — inline KPI's boven de grafiek */}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div class="bg-gray-50 rounded-lg px-3 py-2">
                <div class="text-[11px] uppercase text-gray-500 font-medium tracking-wide">Kaarten in periode</div>
                <div class="text-xl font-bold text-gray-900">{chartTotals.tickets}</div>
              </div>
              <div class="bg-gray-50 rounded-lg px-3 py-2">
                <div class="text-[11px] uppercase text-gray-500 font-medium tracking-wide">Bestellingen</div>
                <div class="text-xl font-bold text-gray-900">{chartTotals.orders}</div>
              </div>
              <div class="bg-gray-50 rounded-lg px-3 py-2">
                <div class="text-[11px] uppercase text-gray-500 font-medium tracking-wide">Omzet</div>
                <div class="text-xl font-bold text-gray-900">€{chartTotals.omzet.toFixed(2)}</div>
              </div>
              <div class="bg-gray-50 rounded-lg px-3 py-2">
                <div class="text-[11px] uppercase text-gray-500 font-medium tracking-wide">Beste dag</div>
                <div class="text-sm font-semibold text-gray-900">
                  {chartTotals.piekDag
                    ? <span>{new Date(chartTotals.piekDag.dag).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} <span class="text-animato-primary">({chartTotals.piekDag.aantal})</span></span>
                    : <span class="text-gray-400">—</span>}
                </div>
              </div>
            </div>

            <div id="chart" class="relative" style="height: 300px;">
              <canvas id="salesChart"></canvas>
            </div>
            <div class="mt-3 text-[11px] text-gray-500 flex flex-wrap items-center gap-3">
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded bg-animato-primary inline-block"></span> Kaarten</span>
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-animato-secondary inline-block"></span> Cumulatief</span>
              <span class="ml-auto italic">Tip: hover over een balk voor exacte cijfers.</span>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var labels    = ${JSON.stringify(chartLabels)};
                var tickets   = ${JSON.stringify(chartTickets)};
                var orders    = ${JSON.stringify(chartOrders)};
                var omzet     = ${JSON.stringify(chartOmzet)};
                // Cumulatieve tickets voor de line-overlay
                var cumulTickets = [];
                var running = 0;
                for (var i = 0; i < tickets.length; i++) { running += tickets[i]; cumulTickets.push(running); }

                function fmtDay(iso) {
                  var d = new Date(iso + 'T00:00:00');
                  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
                }
                var displayLabels = labels.map(fmtDay);

                // Als er heel veel dagen zijn, dun de X-as-labels uit zodat ze niet overlappen
                var maxTicks = 15;
                var tickCallback = function(value, index) {
                  var step = Math.max(1, Math.ceil(displayLabels.length / maxTicks));
                  return (index % step === 0) ? displayLabels[index] : '';
                };

                var ctx = document.getElementById('salesChart');
                if (!ctx || !window.Chart) return;
                new window.Chart(ctx, {
                  type: 'bar',
                  data: {
                    labels: displayLabels,
                    datasets: [
                      {
                        type: 'bar',
                        label: 'Kaarten',
                        data: tickets,
                        backgroundColor: '#00A9CE',
                        borderRadius: 4,
                        maxBarThickness: 32,
                        order: 2,
                      },
                      {
                        type: 'line',
                        label: 'Cumulatief',
                        data: cumulTickets,
                        borderColor: '#1B4D5C',
                        backgroundColor: 'rgba(27,77,92,0.08)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: false,
                        yAxisID: 'y1',
                        tension: 0.25,
                        order: 1,
                      }
                    ]
                  },
                  options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          title: function(items) {
                            if (!items || !items[0]) return '';
                            var iso = labels[items[0].dataIndex];
                            var d = new Date(iso + 'T00:00:00');
                            return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                          },
                          label: function(item) {
                            var i = item.dataIndex;
                            if (item.dataset.type === 'line') {
                              return 'Cumulatief: ' + cumulTickets[i] + ' kaarten';
                            }
                            var lines = ['Kaarten: ' + tickets[i]];
                            if (orders[i]) lines.push('Bestellingen: ' + orders[i]);
                            if (omzet[i])  lines.push('Omzet: €' + omzet[i].toFixed(2));
                            return lines;
                          }
                        }
                      }
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Kaarten per dag' },
                        ticks: { precision: 0 },
                        grid: { color: 'rgba(0,0,0,0.06)' }
                      },
                      y1: {
                        beginAtZero: true,
                        position: 'right',
                        title: { display: true, text: 'Cumulatief' },
                        ticks: { precision: 0 },
                        grid: { display: false }
                      },
                      x: {
                        ticks: { autoSkip: false, callback: tickCallback, maxRotation: 0 },
                        grid: { display: false }
                      }
                    }
                  }
                });
              })();
            ` }} />
          </div>
        )}

        {/* Tickets Table */}
        {tickets.length === 0 ? (
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">Nog geen bestellingen</h3>
            <p class="text-gray-500">
              Zodra mensen tickets bestellen, verschijnen ze hier
            </p>
          </div>
        ) : (
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Sort helper: klik op een kolomkop om te sorteren; toggle asc/desc */}
            {(() => {
              // Server-side rendered sort headers. We geven ze aan als een sub-component-achtige
              // helper om ellenlange JSX te vermijden.
              return null
            })()}
            <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  {(() => {
                    const cols: Array<{ key: string; label: string; align?: 'left'|'right' }> = [
                      { key: 'ref',       label: 'Order Ref' },
                      { key: 'koper',     label: 'Koper' },
                      { key: 'categorie', label: 'Categorie' },
                      { key: 'aantal',    label: 'Aantal' },
                      { key: 'prijs',     label: 'Prijs' },
                      { key: 'status',    label: 'Status' },
                      { key: 'datum',     label: 'Datum' },
                    ]
                    return cols.map(col => {
                      const isActive = sortParam === col.key
                      const nextDir = isActive && dirParam === 'DESC' ? 'asc' : 'desc'
                      const qs = new URLSearchParams()
                      qs.set('sort', col.key)
                      qs.set('dir', nextDir)
                      if (chartDaysParam !== '30') qs.set('chart_days', chartDaysParam)
                      const icon = !isActive ? 'fa-sort text-gray-300'
                                 : dirParam === 'DESC' ? 'fa-sort-down text-animato-primary'
                                 : 'fa-sort-up text-animato-primary'
                      return (
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <a href={`?${qs.toString()}`}
                             class="inline-flex items-center gap-1.5 hover:text-animato-primary transition"
                             title={`Sorteer op ${col.label}`}>
                            <span>{col.label}</span>
                            <i class={`fas ${icon} text-[10px]`}></i>
                          </a>
                        </th>
                      )
                    })
                  })()}
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acties</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {tickets.map((ticket: any) => {
                  const statusColors = {
                    'paid': 'bg-green-100 text-green-800',
                    'pending': 'bg-yellow-100 text-yellow-800',
                    'cancelled': 'bg-red-100 text-red-800',
                    'refunded': 'bg-gray-100 text-gray-800',
                    'used': 'bg-blue-100 text-blue-800'
                  }

                  return (
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-mono font-semibold text-gray-900">
                          {ticket.order_ref}
                        </div>
                        {ticket.gescand && (
                          <div class="text-xs text-green-600 flex items-center mt-1">
                            <i class="fas fa-check-circle mr-1"></i>
                            Gescand
                          </div>
                        )}
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm font-medium text-gray-900">{ticket.koper_naam}</div>
                        <div class="text-sm text-gray-500">{ticket.koper_email}</div>
                        {ticket.koper_telefoon && (
                          <div class="text-xs text-gray-400">{ticket.koper_telefoon}</div>
                        )}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket.categorie}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket.aantal}x
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        €{ticket.prijs_totaal.toFixed(2)}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[ticket.status]}`}>
                          {ticket.status.toUpperCase()}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm">
                        {(() => {
                          // "Verkocht op" = betaald_at als beschikbaar, anders created_at
                          const isoDate = ticket.betaald_at || ticket.created_at
                          const d = new Date(isoDate)
                          const now = new Date()
                          const diffMs = now.getTime() - d.getTime()
                          const diffMin = Math.floor(diffMs / 60000)
                          const diffH   = Math.floor(diffMs / 3600000)
                          const diffDay = Math.floor(diffMs / 86400000)
                          let relatief = ''
                          if (diffMin < 1)       relatief = 'zonet'
                          else if (diffMin < 60) relatief = `${diffMin} min geleden`
                          else if (diffH < 24)   relatief = `${diffH} uur geleden`
                          else if (diffDay < 7)  relatief = `${diffDay} dag${diffDay === 1 ? '' : 'en'} geleden`
                          else if (diffDay < 30) relatief = `${Math.floor(diffDay/7)} week${Math.floor(diffDay/7) === 1 ? '' : 'en'} geleden`
                          const fullLabel = d.toLocaleString('nl-BE', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })
                          const showBetaaldLabel = !!ticket.betaald_at && ticket.status === 'paid'
                          return (
                            <div title={ticket.betaald_at ? `Betaald: ${new Date(ticket.betaald_at).toLocaleString('nl-BE')}\nBesteld: ${new Date(ticket.created_at).toLocaleString('nl-BE')}` : `Besteld: ${new Date(ticket.created_at).toLocaleString('nl-BE')}`}>
                              <div class="text-gray-900 font-medium">{fullLabel}</div>
                              <div class="text-xs text-gray-500">
                                {showBetaaldLabel && <i class="fas fa-check-circle text-green-500 mr-1" title="Betaal-tijdstip"></i>}
                                {relatief || 'lang geleden'}
                              </div>
                            </div>
                          )
                        })()}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onclick={`showQR('${ticket.qr_code}', '${ticket.order_ref}')`}
                          class="text-blue-600 hover:text-blue-900 mr-3"
                          title="Toon QR"
                        >
                          <i class="fas fa-qrcode"></i>
                        </button>
                        {ticket.status === 'paid' && (
                          <button
                            onclick={`resendTicketEmail(${ticket.id}, '${ticket.order_ref}')`}
                            class="text-purple-600 hover:text-purple-900 mr-3"
                            title="Verstuur ticket opnieuw (PDF + QR)"
                          >
                            <i class="fas fa-paper-plane"></i>
                          </button>
                        )}
                        {ticket.status === 'paid' && (
                          <a
                            href={`/admin/tickets/order/${encodeURIComponent(ticket.order_ref)}/zip`}
                            class="text-indigo-600 hover:text-indigo-900 mr-3"
                            title="Download alle PDF-tickets (ZIP) — handig voor WhatsApp/mail doorsturen"
                            target="_blank"
                          >
                            <i class="fas fa-file-archive"></i>
                          </a>
                        )}
                        <a
                          href={`mailto:${ticket.koper_email}`}
                          class="text-green-600 hover:text-green-900 mr-3"
                          title="Open mail-client"
                        >
                          <i class="fas fa-envelope"></i>
                        </a>
                        {ticket.status === 'pending' && (
                          <button
                            onclick={`markAsPaid(${ticket.id})`}
                            class="text-green-600 hover:text-green-900 mr-3"
                            title="Markeer als betaald"
                          >
                            <i class="fas fa-check"></i>
                          </button>
                        )}
                        <button
                          onclick={`openDeleteModal('/api/admin/tickets/${ticket.id}/delete?concert_id=${concertId}', true)`}
                          class="text-red-600 hover:text-red-900"
                          title="Verwijder bestelling"
                        >
                          <i class="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-red-500">
              <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div class="sm:flex sm:items-start">
                  <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <i class="fas fa-exclamation-triangle text-red-600"></i>
                  </div>
                  <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 class="text-xl leading-6 font-bold text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                      Bevestig Verwijderen
                    </h3>
                    <div class="mt-2">
                      <p class="text-sm text-gray-500">
                        Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-lg border border-transparent shadow-md px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Verwijderen
                </button>
                <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* QR Code Modal */}
        <div id="qrModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white rounded-lg p-8 max-w-md">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold">QR Code</h3>
              <button onclick="closeQR()" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-times text-2xl"></i>
              </button>
            </div>
            <div id="qrContent" class="text-center"></div>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          let deleteUrl = null;
          let isPost = false;

          function openDeleteModal(url, usePost = false) {
            deleteUrl = url;
            isPost = usePost;
            document.getElementById('deleteModal').classList.remove('hidden');
          }

          function closeDeleteModal() {
            deleteUrl = null;
            isPost = false;
            document.getElementById('deleteModal').classList.add('hidden');
          }

          document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
            if (deleteUrl) {
              if (isPost) {
                // Create and submit a form
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = deleteUrl;
                document.body.appendChild(form);
                form.submit();
              } else {
                window.location.href = deleteUrl;
              }
            }
            closeDeleteModal();
          });

          function showQR(qrCode, orderRef) {
            document.getElementById('qrContent').innerHTML = 
              '<div class="text-2xl font-mono font-bold mb-4">' + orderRef + '</div>' +
              '<div class="text-sm text-gray-600 mb-4">QR Code: ' + qrCode + '</div>' +
              '<div class="text-xs text-gray-400">Scan deze code bij de ingang</div>';
            document.getElementById('qrModal').classList.remove('hidden');
          }

          function closeQR() {
            document.getElementById('qrModal').classList.add('hidden');
          }

          async function markAsPaid(ticketId) {
            if (!confirm('Weet je zeker dat je deze bestelling als betaald wilt markeren?')) return;
            
            try {
              const response = await fetch('/api/admin/tickets/' + ticketId + '/mark-paid', {
                method: 'POST'
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Er ging iets mis');
              }
            } catch (error) {
              alert('Fout: ' + error.message);
            }
          }

          // Verstuur een duplicaat-ticketmail (PDF + QR) naar de koper.
          // Werkt op order-niveau: alle ticket-rijen met hetzelfde order_ref gaan in één mail.
          async function resendTicketEmail(ticketId, orderRef) {
            if (!confirm('Tickets opnieuw versturen naar de koper voor order ' + orderRef + '?\\n\\nDe PDF met QR-code(s) wordt opnieuw aangemaakt en gemaild.')) return;
            const btn = event && event.currentTarget;
            const orig = btn ? btn.innerHTML : null;
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
            try {
              const response = await fetch('/api/admin/tickets/' + ticketId + '/resend', { method: 'POST' });
              const data = await response.json().catch(function() { return {}; });
              if (response.ok && data && data.success) {
                alert('✅ Mail verzonden naar ' + (data.to || 'de koper') + '.');
              } else {
                alert('❌ Verzenden mislukt: ' + ((data && data.error) || ('HTTP ' + response.status)));
              }
            } catch (error) {
              alert('Fout: ' + (error && error.message ? error.message : error));
            } finally {
              if (btn && orig !== null) { btn.disabled = false; btn.innerHTML = orig; }
            }
          }
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// MARK TICKET AS PAID API
// ==========================================
app.post('/api/admin/tickets/:id{[0-9]+}/mark-paid', async (c) => {
  const user = c.get('user') as SessionUser
  const ticketId = parseInt(c.req.param('id'))
  
  try {
    await execute(c.env.DB,
      `UPDATE tickets SET status = 'paid', betaald_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    )

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'ticket_mark_paid', 'tickets', ?, ?)
    `, [user.id, ticketId, JSON.stringify({ action: 'marked_as_paid' })])

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// RESEND TICKET EMAIL (admin "verstuur opnieuw")
// ----------------------------------------------
// Genereert opnieuw de PDF met QR-code(s) voor de hele order
// (alle ticket-rijen met hetzelfde order_ref) en mailt naar de koper.
// Werkt enkel voor betaalde orders — anders heeft het geen zin.
// ==========================================
app.post('/api/admin/tickets/:id{[0-9]+}/resend', async (c) => {
  const user = c.get('user') as SessionUser
  const ticketId = parseInt(c.req.param('id'))

  try {
    // Vind de order_ref via dit ticket
    const ref = await queryOne<any>(c.env.DB,
      `SELECT order_ref FROM tickets WHERE id = ?`,
      [ticketId]
    )
    if (!ref) {
      return c.json({ success: false, error: 'Ticket niet gevonden' }, 404)
    }

    // Haal álle ticket-rijen + concert-info voor deze order op
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
       ORDER BY t.id ASC`,
      [ref.order_ref]
    )
    if (!rows || rows.length === 0) {
      return c.json({ success: false, error: 'Order niet gevonden' }, 404)
    }

    const ticket = rows[0]
    if (ticket.status !== 'paid') {
      return c.json({
        success: false,
        error: `Ticket-status is "${ticket.status}" — duplicaten worden alleen verstuurd voor betaalde orders.`
      }, 400)
    }

    // Bouw mail + PDF identiek aan de webhook-flow (per-seat indien stoelen gekoppeld)
    const eventDate = new Date(ticket.start_at)
    const concertDatum = eventDate.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const aanvangDate = ticket.concert_start_at ? new Date(ticket.concert_start_at) : eventDate
    const concertTijd = aanvangDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    const concertDoorsOpen = ticket.doors_open_at
      ? new Date(ticket.doors_open_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      : null
    const totaalBedrag = rows.reduce((s: number, t: any) => s + (Number(t.prijs_totaal) || 0), 0)
    const ticketsSummary = rows.map((t: any) => `${t.aantal}× ${t.categorie}`).join(', ')

    // Per-seat lookup (zoals webhook)
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
    } catch (e) {
      console.warn('[resend] seat-lookup mislukt:', (e as any)?.message)
    }

    // Optionele member-portal link
    let memberPortalUrl: string | undefined = undefined
    try {
      const u = await queryOne<any>(c.env.DB,
        `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND status = 'actief' LIMIT 1`,
        [ticket.koper_email])
      if (u) {
        const siteUrl = await getSiteUrl(c)
        memberPortalUrl = `${siteUrl}/leden/mijn-tickets/${encodeURIComponent(ticket.order_ref)}`
      }
    } catch {}

    // Logo bytes (optioneel)
    const logoBytes = await loadAdminLogoBytes(c.env.DB)

    const emailHtml = ticketEmail({
      orderRef: ticket.order_ref,
      koperNaam: ticket.koper_naam,
      concertTitel: ticket.titel,
      concertDatum,
      concertTijd,
      concertLocatie: ticket.locatie,
      tickets: ticketsSummary,
      qrCode: rows.map((t: any) => t.qr_code).join(', '),
      totaalBedrag,
      memberPortalUrl,
      seatCount: seatRows.length
    })

    let attachments: any[] = []
    try {
      if (seatRows.length > 0) {
        const pdfs = await generateSeatTicketPdfs({
          order_ref: ticket.order_ref,
          koper_naam: ticket.koper_naam,
          koper_email: ticket.koper_email,
          concert_titel: ticket.titel,
          concert_datum: concertDatum,
          concert_tijd: concertTijd,
          concert_doors_open: concertDoorsOpen,
          concert_locatie: ticket.locatie || '',
          concert_adres: ticket.adres || null,
          logo_png_bytes: logoBytes,
          seats: seatRows.map((s: any) => ({
            qr_code: `${s.qr_code}-${s.ticket_seat_id}`,
            categorie: s.categorie,
            prijs: Number(s.prijs_totaal) / Math.max(1, seatRows.filter(x => x.ticket_id === s.ticket_id).length),
            seat_label: `Rij ${s.row_label} — Stoel ${s.seat_number}`,
            seat_sectie: s.section_name || null
          }))
        })
        attachments = pdfs.map(p => ({
          filename: p.filename,
          content: uint8ArrayToBase64(p.bytes),
          contentType: 'application/pdf'
        }))
      } else {
        const pdfBytes = await generateTicketPdf({
          order_ref: ticket.order_ref,
          koper_naam: ticket.koper_naam,
          koper_email: ticket.koper_email,
          concert_titel: ticket.titel,
          concert_datum: concertDatum,
          concert_tijd: concertTijd,
          concert_doors_open: concertDoorsOpen,
          concert_locatie: ticket.locatie || '',
          concert_adres: ticket.adres || null,
          totaal_bedrag: totaalBedrag,
          lines: rows.map((t: any) => ({
            qr_code: t.qr_code,
            categorie: t.categorie,
            aantal: t.aantal,
            prijs_totaal: Number(t.prijs_totaal) || 0
          }))
        })
        attachments = [{
          filename: `tickets-${ticket.order_ref}.pdf`,
          content: uint8ArrayToBase64(pdfBytes),
          contentType: 'application/pdf'
        }]
      }
    } catch (pdfErr: any) {
      console.error('[resend] PDF generation failed:', pdfErr?.message || pdfErr)
      return c.json({ success: false, error: 'PDF genereren mislukt: ' + (pdfErr?.message || 'onbekend') }, 500)
    }

    const ok = await sendEmail({
      to: ticket.koper_email,
      subject: `🎫 (Duplicaat) Je tickets voor ${ticket.titel} - ${ticket.order_ref}`,
      html: emailHtml,
      attachments
    }, c.env.RESEND_API_KEY)

    if (!ok) {
      return c.json({ success: false, error: 'Mail kon niet verzonden worden (Resend faalde — check RESEND_API_KEY).' }, 500)
    }

    // Audit-log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'ticket_email_resent', 'tickets', ?, ?)
    `, [user.id, ticketId, JSON.stringify({
      order_ref: ticket.order_ref,
      to: ticket.koper_email,
      lines: rows.length
    })])

    return c.json({ success: true, to: ticket.koper_email, lines: rows.length })
  } catch (error: any) {
    console.error('[resend] EXCEPTION:', error?.message || error, error?.stack)
    return c.json({ success: false, error: error?.message || String(error) }, 500)
  }
})

// ==========================================
// BULK TICKET RESEND — nieuwe flow (2026-08)
// - /admin/tickets/resend           → UI met concert-filter, tabel, selectie
// - /api/admin/tickets/resend/template (GET/POST) → laad/opslaan default template
// - /api/admin/tickets/resend/preview → server-side gerenderde preview
// - /api/admin/tickets/resend/bulk    → verstuurt naar N geselecteerde orders
// ==========================================

// -- GET: laad huidige template ---------------------------------------------
app.get('/api/admin/tickets/resend/template', async (c) => {
  try {
    const tpl = await loadResendTemplate(c.env.DB)
    return c.json({ success: true, ...tpl })
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Kon template niet laden' }, 500)
  }
})

// -- POST: sla nieuwe default template op -----------------------------------
app.post('/api/admin/tickets/resend/template', async (c) => {
  try {
    const body = await c.req.json<{ subject?: string; html?: string }>()
    const subject = (body.subject || '').trim()
    const html = (body.html || '').trim()
    if (!subject || !html) {
      return c.json({ success: false, error: 'subject en html zijn verplicht' }, 400)
    }
    await saveResendTemplate(c.env.DB, subject, html)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Kon template niet opslaan' }, 500)
  }
})

// -- POST: preview render voor één ticket-id -------------------------------
app.post('/api/admin/tickets/resend/preview', async (c) => {
  try {
    const body = await c.req.json<{ ticket_id: number; subject: string; html: string }>()
    const ctx = await loadTicketOrderContext(c, Number(body.ticket_id))
    if (!ctx) return c.json({ success: false, error: 'Ticket niet gevonden' }, 404)
    const rendered = renderEmail(body.subject || '', body.html || '', ctx)
    return c.json({
      success: true,
      subject: rendered.subject,
      html: rendered.html,
      // Ontvangst-info zodat de UI kan tonen "wordt verstuurd naar X (Y)"
      koper_naam: ctx.koper_naam,
      koper_email: ctx.koper_email,
      order_ref: ctx.order_ref,
    })
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Preview mislukt' }, 500)
  }
})

// -- POST: bulk resend ------------------------------------------------------
// body: { ticket_ids: number[], subject: string, html: string, include_pdf: boolean }
// return: { success, sent, failed: [{ticket_id, order_ref, email, error}], errors: [] }
app.post('/api/admin/tickets/resend/bulk', async (c) => {
  const user = c.get('user') as SessionUser
  try {
    const body = await c.req.json<{
      ticket_ids: number[]
      subject: string
      html: string
      include_pdf: boolean
    }>()
    const ids = Array.isArray(body.ticket_ids) ? body.ticket_ids.map(Number).filter(n => n > 0) : []
    if (ids.length === 0) return c.json({ success: false, error: 'Geen ticket-ids opgegeven' }, 400)
    if (!body.subject || !body.html) return c.json({ success: false, error: 'subject en html zijn verplicht' }, 400)
    if (ids.length > 500) return c.json({ success: false, error: 'Max 500 mails per bulk-actie' }, 400)

    // Logo één keer laden (best-effort)
    const logoBytes = body.include_pdf ? await loadTicketLogoBytes(c.env.DB) : null

    const sent: Array<{ ticket_id: number; order_ref: string; email: string }> = []
    const failed: Array<{ ticket_id: number; order_ref?: string; email?: string; error: string }> = []

    for (const ticketId of ids) {
      try {
        const ctx = await loadTicketOrderContext(c, ticketId)
        if (!ctx) {
          failed.push({ ticket_id: ticketId, error: 'Ticket niet gevonden' })
          continue
        }
        if (!ctx.koper_email) {
          failed.push({ ticket_id: ticketId, order_ref: ctx.order_ref, error: 'Geen email-adres bij deze order' })
          continue
        }

        const rendered = renderEmail(body.subject, body.html, ctx)
        let attachments: any[] = []
        if (body.include_pdf) {
          try {
            attachments = await buildTicketAttachments(ctx, logoBytes)
          } catch (pdfErr: any) {
            // Best-effort: mail vertrekt zonder attachment als PDF crasht.
            // Alternatief zou zijn hier failen — maar dat matcht niet het gedrag
            // van de webhook-flow, en 1 slecht seat mag niet 199 andere blokkeren.
            console.error('[resend-bulk] PDF gen mislukt voor', ctx.order_ref, pdfErr?.message)
          }
        }

        const ok = await sendEmail({
          to: ctx.koper_email,
          subject: rendered.subject,
          html: rendered.html,
          attachments,
        }, c.env.RESEND_API_KEY)

        if (ok) {
          sent.push({ ticket_id: ticketId, order_ref: ctx.order_ref, email: ctx.koper_email })
          // Audit-log per verstuurde mail
          try {
            await execute(c.env.DB, `
              INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
              VALUES (?, 'ticket_email_resent', 'tickets', ?, ?)
            `, [user.id, ticketId, JSON.stringify({
              order_ref: ctx.order_ref,
              to: ctx.koper_email,
              subject: rendered.subject,
              by_bulk: true,
              with_pdf: body.include_pdf && attachments.length > 0,
            })])
          } catch {}
        } else {
          failed.push({ ticket_id: ticketId, order_ref: ctx.order_ref, email: ctx.koper_email, error: 'Resend API weigerde de mail' })
        }
      } catch (err: any) {
        failed.push({ ticket_id: ticketId, error: err?.message || String(err) })
      }
    }

    return c.json({
      success: true,
      sent_count: sent.length,
      failed_count: failed.length,
      sent,
      failed,
    })
  } catch (err: any) {
    console.error('[resend-bulk] EXCEPTION:', err?.message, err?.stack)
    return c.json({ success: false, error: err?.message || String(err) }, 500)
  }
})

// -- GET: UI-pagina met concert-filter, tabel + selectie --------------------
app.get('/admin/tickets/resend', async (c) => {
  const user = c.get('user') as SessionUser

  // Query-parameters
  const concertIdParam = c.req.query('concert_id')
  const statusFilter = (c.req.query('status') || 'paid').toLowerCase()  // default: alleen betaalde

  // Concert-lijst voor dropdown (alle concerts met betaalde tickets)
  const concerts = await queryAll<any>(c.env.DB, `
    SELECT c.id, e.titel, e.start_at,
           (SELECT COUNT(*) FROM tickets t WHERE t.concert_id = c.id AND t.status = 'paid') AS paid_count
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE (SELECT COUNT(*) FROM tickets t WHERE t.concert_id = c.id) > 0
    ORDER BY e.start_at DESC
  `)

  // Tickets ophalen (1 rij per order = 1 mail-ontvanger; DISTINCT op order_ref)
  // We geven de "eerste" ticket-id van elke order — de resend-flow werkt namelijk
  // per order_ref (loadTicketOrderContext haalt alle rijen).
  let tickets: any[] = []
  if (concertIdParam) {
    const cid = parseInt(concertIdParam)
    tickets = await queryAll<any>(c.env.DB, `
      SELECT MIN(t.id) AS ticket_id,
             t.order_ref,
             t.koper_naam,
             t.koper_email,
             t.status,
             t.betaald_at,
             t.created_at,
             SUM(t.aantal) AS aantal_totaal,
             GROUP_CONCAT(t.aantal || '× ' || t.categorie, ', ') AS ticket_lines,
             SUM(t.prijs_totaal) AS totaal_bedrag,
             (SELECT MAX(a.created_at) FROM audit_logs a
              WHERE a.actie = 'ticket_email_resent' AND a.entity_id = MIN(t.id)) AS last_resent_at
      FROM tickets t
      WHERE t.concert_id = ?
        ${statusFilter === 'all' ? '' : `AND t.status = '${statusFilter.replace(/'/g, '')}'`}
      GROUP BY t.order_ref
      ORDER BY t.betaald_at DESC, t.created_at DESC
    `, [cid])
  }

  const selectedConcert = concertIdParam
    ? concerts.find((c: any) => c.id === parseInt(concertIdParam))
    : null

  return c.html(
    <Layout title="Tickets opnieuw versturen" user={user}>
      <div class="max-w-7xl mx-auto p-4 md:p-6">
        <div class="mb-6 flex items-center justify-between">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-gray-900">
              <i class="fas fa-paper-plane text-purple-600 mr-2"></i>
              Tickets opnieuw versturen
            </h1>
            <p class="text-sm text-gray-600 mt-1">
              Selecteer een concert, kies kopers, en pas de mail aan vóór je verstuurt.
            </p>
          </div>
          <a href="/admin/tickets" class="text-sm text-gray-600 hover:text-gray-900">
            <i class="fas fa-arrow-left mr-1"></i> Terug naar tickets
          </a>
        </div>

        {/* Filter-balk */}
        <div class="bg-white rounded-lg shadow-sm border p-4 mb-6">
          <form method="get" action="/admin/tickets/resend" class="flex flex-wrap items-end gap-4">
            <div class="flex-1 min-w-[240px]">
              <label class="block text-sm font-medium text-gray-700 mb-1">Concert</label>
              <select name="concert_id" class="w-full border rounded px-3 py-2" onchange="this.form.submit()">
                <option value="">— Kies een concert —</option>
                {concerts.map((c: any) => (
                  <option value={c.id} selected={concertIdParam === String(c.id)}>
                    {c.titel} — {new Date(c.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ({c.paid_count} betaald)
                  </option>
                ))}
              </select>
            </div>
            <div class="min-w-[160px]">
              <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select name="status" class="w-full border rounded px-3 py-2" onchange="this.form.submit()">
                <option value="paid" selected={statusFilter === 'paid'}>Alleen betaald</option>
                <option value="pending" selected={statusFilter === 'pending'}>Pending</option>
                <option value="all" selected={statusFilter === 'all'}>Alle statussen</option>
              </select>
            </div>
            <button type="button" onclick="openTemplateEditor()" class="bg-white border border-purple-600 text-purple-600 hover:bg-purple-50 rounded px-4 py-2 text-sm font-medium">
              <i class="fas fa-file-alt mr-1"></i> Template bewerken
            </button>
          </form>
        </div>

        {!concertIdParam && (
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
            <i class="fas fa-hand-pointer text-blue-500 text-3xl mb-2"></i>
            <p class="text-gray-700">Kies eerst een concert uit de dropdown hierboven.</p>
          </div>
        )}

        {concertIdParam && tickets.length === 0 && (
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <i class="fas fa-inbox text-yellow-500 text-3xl mb-2"></i>
            <p class="text-gray-700">Geen tickets gevonden voor dit concert met status "{statusFilter}".</p>
          </div>
        )}

        {concertIdParam && tickets.length > 0 && (
          <div class="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div class="p-4 border-b flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm text-gray-700">
                <strong>{tickets.length}</strong> orders voor <em>{selectedConcert?.titel}</em>
              </div>
              <div class="flex items-center gap-2">
                <span id="selection-count" class="text-sm text-gray-600">0 geselecteerd</span>
                <button type="button" onclick="selectAll()" class="text-sm text-blue-600 hover:underline">Alle</button>
                <span class="text-gray-300">|</span>
                <button type="button" onclick="selectNone()" class="text-sm text-blue-600 hover:underline">Geen</button>
                <button type="button" id="btn-open-modal" onclick="openSendModal()" disabled class="ml-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium">
                  <i class="fas fa-paper-plane mr-1"></i>
                  Herstuur geselecteerde
                </button>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 text-left">
                  <tr>
                    <th class="px-3 py-2 w-10"><input type="checkbox" onchange="toggleAll(this)" /></th>
                    <th class="px-3 py-2">Order</th>
                    <th class="px-3 py-2">Koper</th>
                    <th class="px-3 py-2">Email</th>
                    <th class="px-3 py-2">Tickets</th>
                    <th class="px-3 py-2 text-right">Bedrag</th>
                    <th class="px-3 py-2">Betaald op</th>
                    <th class="px-3 py-2">Laatst verstuurd</th>
                  </tr>
                </thead>
                <tbody id="tbody">
                  {tickets.map((t: any) => (
                    <tr class="border-t hover:bg-purple-50/30">
                      <td class="px-3 py-2">
                        <input type="checkbox" class="row-check" value={t.ticket_id} data-order-ref={t.order_ref} onchange="updateSelectionCount()" />
                      </td>
                      <td class="px-3 py-2 font-mono text-xs">{t.order_ref}</td>
                      <td class="px-3 py-2">{t.koper_naam || '—'}</td>
                      <td class="px-3 py-2 text-gray-600">{t.koper_email || '—'}</td>
                      <td class="px-3 py-2 text-gray-700 text-xs">{t.ticket_lines || `${t.aantal_totaal}× ticket`}</td>
                      <td class="px-3 py-2 text-right">€{Number(t.totaal_bedrag || 0).toFixed(2)}</td>
                      <td class="px-3 py-2 text-gray-600 text-xs">
                        {t.betaald_at ? new Date(t.betaald_at).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td class="px-3 py-2 text-gray-600 text-xs">
                        {t.last_resent_at
                          ? <span class="text-green-700"><i class="fas fa-check-circle mr-1"></i>{new Date(t.last_resent_at).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          : <span class="text-gray-400">nooit</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ============ VERSTUUR-MODAL ============ */}
      <div id="send-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div class="p-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold">
              <i class="fas fa-paper-plane text-purple-600 mr-2"></i>
              Herstuur mails — <span id="modal-count">0</span> ontvangers
            </h2>
            <button onclick="closeSendModal()" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>

          {/* Tabs */}
          <div class="border-b flex">
            <button type="button" onclick="switchTab('tab-template')" data-tab="tab-template" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-purple-600 text-purple-600">
              1. Template
            </button>
            <button type="button" onclick="switchTab('tab-preview')" data-tab="tab-preview" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700">
              2. Preview
            </button>
            <button type="button" onclick="switchTab('tab-recipients')" data-tab="tab-recipients" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700">
              3. Ontvangers &amp; verstuur
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            {/* Tab 1: Template */}
            <div id="tab-template" class="tab-content">
              <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-3 text-xs text-gray-700">
                <p class="font-semibold mb-1">Beschikbare placeholders (worden per ontvanger vervangen):</p>
                <code class="text-[11px] block">
                  &#123;&#123;koper_naam&#125;&#125; &nbsp; &#123;&#123;concert_titel&#125;&#125; &nbsp; &#123;&#123;concert_datum&#125;&#125; &nbsp; &#123;&#123;concert_tijd&#125;&#125; &nbsp; &#123;&#123;concert_locatie&#125;&#125;<br />
                  &#123;&#123;order_ref&#125;&#125; &nbsp; &#123;&#123;tickets_summary&#125;&#125; &nbsp; &#123;&#123;totaal_bedrag&#125;&#125; &nbsp; &#123;&#123;member_portal_url&#125;&#125;
                </code>
              </div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Onderwerp</label>
              <input type="text" id="tpl-subject" class="w-full border rounded px-3 py-2 mb-3 font-mono text-sm" />
              <label class="block text-sm font-medium text-gray-700 mb-1">HTML body</label>
              <textarea id="tpl-html" rows={16} class="w-full border rounded px-3 py-2 font-mono text-xs"></textarea>
              <div class="mt-2 flex items-center gap-3">
                <button type="button" onclick="saveTemplateAsDefault()" class="text-sm text-purple-600 hover:underline">
                  <i class="fas fa-save mr-1"></i> Sla op als nieuwe default
                </button>
                <button type="button" onclick="resetTemplateToSaved()" class="text-sm text-gray-500 hover:underline">
                  <i class="fas fa-undo mr-1"></i> Reset naar opgeslagen
                </button>
              </div>
            </div>

            {/* Tab 2: Preview */}
            <div id="tab-preview" class="tab-content hidden">
              <div class="mb-3 text-sm text-gray-600">
                Voorbeeld met eerste geselecteerde order: <strong id="preview-recipient"></strong>
              </div>
              <div class="border rounded overflow-hidden">
                <div class="bg-gray-100 px-3 py-2 border-b text-xs">
                  <div><strong>Van:</strong> Gemengd Koor Animato &lt;info@gemengdkooranimato.be&gt;</div>
                  <div><strong>Aan:</strong> <span id="preview-to"></span></div>
                  <div><strong>Onderwerp:</strong> <span id="preview-subject"></span></div>
                </div>
                <iframe id="preview-iframe" class="w-full" style="height: 500px; border: 0;" sandbox="allow-same-origin"></iframe>
              </div>
            </div>

            {/* Tab 3: Recipients & send */}
            <div id="tab-recipients" class="tab-content hidden">
              <div class="mb-3 flex items-center gap-3">
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" id="chk-include-pdf" checked />
                  <span>Met verse PDF-bijlagen (per ontvanger, iets trager)</span>
                </label>
              </div>
              <div class="border rounded max-h-64 overflow-y-auto mb-3">
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 sticky top-0"><tr>
                    <th class="text-left px-3 py-2">Order</th>
                    <th class="text-left px-3 py-2">Naam</th>
                    <th class="text-left px-3 py-2">Email</th>
                  </tr></thead>
                  <tbody id="recipients-list"></tbody>
                </table>
              </div>
              <div id="rate-limit-warning" class="hidden bg-yellow-50 border border-yellow-300 rounded p-3 mb-3 text-sm text-yellow-800">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                Je gaat meer dan 90 mails versturen in één actie. Resend's free-tier heeft een limiet van 100/uur. Zeker weten?
              </div>
              <div id="send-result" class="hidden mb-3"></div>
              <button type="button" id="btn-send" onclick="sendBulk()" class="w-full bg-purple-600 hover:bg-purple-700 text-white rounded px-4 py-3 text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>
                Verstuur nu naar <span id="send-btn-count">0</span> ontvangers
              </button>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        let savedTemplate = { subject: '', html: '' }
        let selectedTicketIds = []
        let selectedRows = []  // [{ticket_id, order_ref, koper_naam, koper_email}]

        function updateSelectionCount() {
          const checks = document.querySelectorAll('.row-check:checked')
          const n = checks.length
          document.getElementById('selection-count').textContent = n + ' geselecteerd'
          document.getElementById('btn-open-modal').disabled = n === 0
        }
        function toggleAll(cb) {
          document.querySelectorAll('.row-check').forEach(c => c.checked = cb.checked)
          updateSelectionCount()
        }
        function selectAll() {
          document.querySelectorAll('.row-check').forEach(c => c.checked = true)
          updateSelectionCount()
        }
        function selectNone() {
          document.querySelectorAll('.row-check').forEach(c => c.checked = false)
          updateSelectionCount()
        }

        async function loadTemplate() {
          const r = await fetch('/api/admin/tickets/resend/template')
          const j = await r.json()
          if (j.success) {
            savedTemplate = { subject: j.subject, html: j.html }
            document.getElementById('tpl-subject').value = j.subject
            document.getElementById('tpl-html').value = j.html
          }
        }

        async function openSendModal() {
          // Verzamel selectie
          selectedTicketIds = []
          selectedRows = []
          document.querySelectorAll('.row-check:checked').forEach(cb => {
            const row = cb.closest('tr')
            const cells = row.querySelectorAll('td')
            selectedTicketIds.push(parseInt(cb.value))
            selectedRows.push({
              ticket_id: parseInt(cb.value),
              order_ref: cb.getAttribute('data-order-ref'),
              koper_naam: cells[2].textContent.trim(),
              koper_email: cells[3].textContent.trim(),
            })
          })
          if (selectedTicketIds.length === 0) return

          document.getElementById('modal-count').textContent = selectedTicketIds.length
          document.getElementById('send-btn-count').textContent = selectedTicketIds.length
          document.getElementById('rate-limit-warning').style.display = selectedTicketIds.length > 90 ? 'block' : 'none'
          document.getElementById('send-result').classList.add('hidden')
          document.getElementById('btn-send').disabled = false

          // Recipients tab
          const tbody = document.getElementById('recipients-list')
          tbody.innerHTML = selectedRows.map(r => \`
            <tr class="border-t">
              <td class="px-3 py-1 font-mono text-[11px]">\${r.order_ref}</td>
              <td class="px-3 py-1">\${r.koper_naam || ''}</td>
              <td class="px-3 py-1 text-gray-600">\${r.koper_email || ''}</td>
            </tr>\`).join('')

          await loadTemplate()
          switchTab('tab-template')
          document.getElementById('send-modal').classList.remove('hidden')
        }
        function closeSendModal() {
          document.getElementById('send-modal').classList.add('hidden')
        }

        async function openTemplateEditor() {
          selectedTicketIds = []
          selectedRows = []
          document.getElementById('modal-count').textContent = '0'
          document.getElementById('send-btn-count').textContent = '0'
          document.getElementById('recipients-list').innerHTML = '<tr><td colspan="3" class="px-3 py-2 text-gray-500 text-center">Geen ontvangers geselecteerd — je kan hier alleen de default-template bewerken.</td></tr>'
          document.getElementById('btn-send').disabled = true
          await loadTemplate()
          switchTab('tab-template')
          document.getElementById('send-modal').classList.remove('hidden')
        }

        function switchTab(id) {
          document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'))
          document.getElementById(id).classList.remove('hidden')
          document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === id) {
              btn.classList.add('border-purple-600', 'text-purple-600')
              btn.classList.remove('border-transparent', 'text-gray-500')
            } else {
              btn.classList.remove('border-purple-600', 'text-purple-600')
              btn.classList.add('border-transparent', 'text-gray-500')
            }
          })
          if (id === 'tab-preview') refreshPreview()
        }

        async function refreshPreview() {
          if (selectedTicketIds.length === 0) {
            document.getElementById('preview-recipient').textContent = '(geen ontvanger — selecteer eerst orders)'
            document.getElementById('preview-to').textContent = ''
            document.getElementById('preview-subject').textContent = ''
            document.getElementById('preview-iframe').srcdoc = '<p style="padding:16px;color:#666;font-family:sans-serif;">Selecteer eerst een order in de lijst.</p>'
            return
          }
          const firstId = selectedTicketIds[0]
          const subject = document.getElementById('tpl-subject').value
          const html = document.getElementById('tpl-html').value
          const r = await fetch('/api/admin/tickets/resend/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_id: firstId, subject, html })
          })
          const j = await r.json()
          if (j.success) {
            document.getElementById('preview-recipient').textContent = j.koper_naam + ' — ' + j.order_ref
            document.getElementById('preview-to').textContent = j.koper_email
            document.getElementById('preview-subject').textContent = j.subject
            document.getElementById('preview-iframe').srcdoc = j.html
          } else {
            document.getElementById('preview-iframe').srcdoc = '<p style="color:red;padding:16px;">Preview mislukt: ' + (j.error || 'onbekend') + '</p>'
          }
        }

        async function saveTemplateAsDefault() {
          const subject = document.getElementById('tpl-subject').value
          const html = document.getElementById('tpl-html').value
          const r = await fetch('/api/admin/tickets/resend/template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, html })
          })
          const j = await r.json()
          if (j.success) {
            savedTemplate = { subject, html }
            alert('Template opgeslagen als nieuwe default')
          } else {
            alert('Opslaan mislukt: ' + (j.error || 'onbekend'))
          }
        }
        function resetTemplateToSaved() {
          document.getElementById('tpl-subject').value = savedTemplate.subject
          document.getElementById('tpl-html').value = savedTemplate.html
        }

        async function sendBulk() {
          if (selectedTicketIds.length === 0) return
          if (selectedTicketIds.length > 90) {
            if (!confirm('Je verstuurt ' + selectedTicketIds.length + ' mails — over Resend\\'s uurlimiet mogelijk. Doorgaan?')) return
          } else {
            if (!confirm('Verstuur mails naar ' + selectedTicketIds.length + ' ontvangers?')) return
          }
          const btn = document.getElementById('btn-send')
          btn.disabled = true
          btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Verzenden...'
          const subject = document.getElementById('tpl-subject').value
          const html = document.getElementById('tpl-html').value
          const include_pdf = document.getElementById('chk-include-pdf').checked

          try {
            const r = await fetch('/api/admin/tickets/resend/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ticket_ids: selectedTicketIds, subject, html, include_pdf })
            })
            const j = await r.json()
            const box = document.getElementById('send-result')
            box.classList.remove('hidden')
            if (j.success) {
              let html2 = '<div class="bg-green-50 border border-green-300 rounded p-3 text-sm">'
              html2 += '<strong>✓ ' + j.sent_count + ' mails verstuurd</strong>'
              if (j.failed_count > 0) {
                html2 += '<br><span class="text-red-700">✗ ' + j.failed_count + ' mislukt:</span><ul class="text-xs mt-1 list-disc pl-5">'
                j.failed.forEach(f => { html2 += '<li>' + (f.order_ref || f.ticket_id) + ' — ' + (f.error || '') + '</li>' })
                html2 += '</ul>'
              }
              html2 += '</div>'
              box.innerHTML = html2
              btn.innerHTML = '<i class="fas fa-check mr-2"></i> Klaar — sluit deze modal'
              btn.onclick = () => { closeSendModal(); location.reload() }
              btn.disabled = false
            } else {
              box.innerHTML = '<div class="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-700">Mislukt: ' + (j.error || 'onbekend') + '</div>'
              btn.disabled = false
              btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Opnieuw proberen'
            }
          } catch (err) {
            document.getElementById('send-result').classList.remove('hidden')
            document.getElementById('send-result').innerHTML = '<div class="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-700">Netwerk-fout: ' + err.message + '</div>'
            btn.disabled = false
            btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Opnieuw proberen'
          }
        }

        // Initial load
        loadTemplate()
      `}} />
    </Layout>
  )
})

// ==========================================
// DELETE TICKET API
// ==========================================
app.post('/api/admin/tickets/:id{[0-9]+}/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const ticketId = parseInt(c.req.param('id'))
  const concertId = c.req.query('concert_id')
  
  try {
    // Get ticket info for log
    const ticket = await queryOne(c.env.DB, 'SELECT * FROM tickets WHERE id = ?', [ticketId])
    
    await execute(c.env.DB, `DELETE FROM tickets WHERE id = ?`, [ticketId])

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'ticket_delete', 'tickets', ?, ?)
    `, [user.id, ticketId, JSON.stringify({ deleted_ticket: ticket })])

    if (concertId) {
      return c.redirect(`/admin/tickets/concert/${concertId}/orders?success=deleted`)
    }
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// KOPERS-LIJST EXPORT (CSV) — per concert
// Bedoeld voor manuele controle op concert-dag. Bevat volledige contactinfo,
// aantal + categorie zetels, totaalbedrag, aankoopdatum, betaalmoment, status.
// Analog aan /api/admin/lidgelden/export.
// ==========================================
app.get('/api/admin/tickets/concert/:concertId/export', async (c) => {
  const db = c.env.DB
  const concertId = parseInt(c.req.param('concertId'))
  if (!concertId || Number.isNaN(concertId)) return c.text('concert_id required', 400)

  const concert = await queryOne<any>(db, `
    SELECT id, titel, start_at, locatie FROM concerts WHERE id = ?
  `, [concertId])
  if (!concert) return c.text('concert not found', 404)

  // Alle tickets voor dit concert. Multi-cat orders hebben meerdere rijen met dezelfde order_ref;
  // die aggregeren we in-memory zodat één regel per koper-bestelling uitkomt (analoog aan hoe
  // de klant het in zijn mailbox ziet).
  const rows = await queryAll<any>(db, `
    SELECT
      id, order_ref, koper_naam, koper_email, koper_telefoon,
      aantal, categorie, prijs_totaal, status,
      betaalmethode, betaling_id, betaald_at, created_at,
      gescand, gescand_at,
      seat_label, seat_row, seat_number, seat_category
    FROM tickets
    WHERE concert_id = ?
    ORDER BY created_at DESC, order_ref, id
  `, [concertId])

  // Groepeer per order_ref
  type OrderAgg = {
    order_ref: string
    koper_naam: string
    koper_email: string
    koper_telefoon: string | null
    aantal: number
    categorien: string[]
    zetels: string[]
    prijs_totaal: number
    status_set: Set<string>
    betaalmethode: string | null
    betaling_id: string | null
    betaald_at: string | null
    created_at: string
    gescand: number
    gescand_total: number
  }
  const orders = new Map<string, OrderAgg>()
  for (const r of (rows as any[])) {
    let o = orders.get(r.order_ref)
    if (!o) {
      o = {
        order_ref: r.order_ref,
        koper_naam: r.koper_naam || '',
        koper_email: r.koper_email || '',
        koper_telefoon: r.koper_telefoon,
        aantal: 0,
        categorien: [],
        zetels: [],
        prijs_totaal: 0,
        status_set: new Set<string>(),
        betaalmethode: r.betaalmethode,
        betaling_id: r.betaling_id,
        betaald_at: r.betaald_at,
        created_at: r.created_at,
        gescand: 0,
        gescand_total: 0,
      }
      orders.set(r.order_ref, o)
    }
    o.aantal += (r.aantal || 1)
    o.prijs_totaal += (typeof r.prijs_totaal === 'number' ? r.prijs_totaal : parseFloat(r.prijs_totaal) || 0)
    if (r.categorie) o.categorien.push(`${r.categorie}${r.aantal > 1 ? ` ×${r.aantal}` : ''}`)
    if (r.seat_label) o.zetels.push(r.seat_label)
    else if (r.seat_row && r.seat_number) o.zetels.push(`${r.seat_row}${r.seat_number}`)
    if (r.status) o.status_set.add(r.status)
    // Neem eerste niet-lege betaal-info (multi-cat orders delen dezelfde payment)
    if (!o.betaalmethode && r.betaalmethode) o.betaalmethode = r.betaalmethode
    if (!o.betaling_id && r.betaling_id) o.betaling_id = r.betaling_id
    if (!o.betaald_at && r.betaald_at) o.betaald_at = r.betaald_at
    o.gescand_total += 1
    if (r.gescand === 1) o.gescand += 1
  }

  // CSV bouwen — Excel-compatibel met BOM voor accenten (semicolon voor NL Excel)
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return /[",;\n]/.test(s) ? `"${s}"` : s
  }
  const humanStatus = (s: Set<string>): string => {
    if (s.has('paid')) return 'Betaald'
    if (s.has('pending')) return 'Openstaand'
    if (s.has('used')) return 'Gebruikt'
    if (s.has('refunded')) return 'Terugbetaald'
    if (s.has('cancelled')) return 'Geannuleerd'
    return Array.from(s).join(', ') || '-'
  }
  const humanBetaalmethode = (m: string | null): string => {
    if (!m) return ''
    if (m === 'mollie') return 'Mollie'
    if (m === 'stripe') return 'Stripe'
    if (m === 'admin_bulk' || m === 'bulk' || m === 'admin') return 'Admin (manueel)'
    if (m === 'cash') return 'Cash'
    if (m === 'bank') return 'Overschrijving'
    return m
  }

  const headers = [
    'Bestel-ref', 'Naam', 'Email', 'Telefoon',
    'Aantal', 'Categorie(ën)', 'Zetel(s)',
    'Bedrag (€)', 'Status',
    'Betaalmethode', 'Betaling-ID',
    'Aankoopdatum', 'Betaald op',
    'Gescand (van totaal)',
  ]
  const lines = [headers.join(';')]

  // Sorteer op datum-oplopend voor de export (bovenaan de vroegste bestelling)
  const sortedOrders = Array.from(orders.values()).sort((a, b) => {
    return (a.created_at || '').localeCompare(b.created_at || '')
  })

  for (const o of sortedOrders) {
    lines.push([
      escape(o.order_ref),
      escape(o.koper_naam),
      escape(o.koper_email),
      escape(o.koper_telefoon || ''),
      escape(o.aantal),
      escape(o.categorien.join(' + ')),
      escape(o.zetels.join(', ')),
      escape(o.prijs_totaal.toFixed(2).replace('.', ',')),
      escape(humanStatus(o.status_set)),
      escape(humanBetaalmethode(o.betaalmethode)),
      escape(o.betaling_id || ''),
      escape(o.created_at ? formatBrusselsDateTime(o.created_at) : ''),
      escape(o.betaald_at ? formatBrusselsDateTime(o.betaald_at) : ''),
      escape(o.gescand_total > 0 ? `${o.gescand}/${o.gescand_total}` : ''),
    ].join(';'))
  }

  // Totalen-regel onderaan (handig bij manuele controle)
  const totaalAantal = sortedOrders.reduce((s, o) => s + o.aantal, 0)
  const totaalBedrag = sortedOrders.reduce((s, o) => s + (o.status_set.has('paid') ? o.prijs_totaal : 0), 0)
  const totaalBetaald = sortedOrders.filter(o => o.status_set.has('paid')).length
  lines.push('') // lege regel
  lines.push([
    escape('TOTAAL'),
    escape(`${sortedOrders.length} bestellingen (waarvan ${totaalBetaald} betaald)`),
    '', '',
    escape(totaalAantal),
    '', '',
    escape(totaalBedrag.toFixed(2).replace('.', ',')),
    escape('Betaald'),
    '', '', '', '', '',
  ].join(';'))

  const csv = '\uFEFF' + lines.join('\r\n')

  // Nette bestandsnaam: kopers_<concert-titel>_<yyyy-mm-dd>.csv
  const slug = (concert.titel as string || 'concert')
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
  const filename = `kopers_${slug}_${brusselsToday()}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
})

// ==========================================
// CONCERT TICKETING SETTINGS
// ==========================================
app.get('/admin/tickets/concert/:concertId/settings', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const justSaved = c.req.query('saved') === '1'
  
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.id as event_id, e.slug, e.titel, e.start_at, e.locatie, e.image_url as afbeelding
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.html(<Layout title="Concert niet gevonden" user={user}><div>Concert niet gevonden</div></Layout>)
  }

  // Parse prijsstructuur
  let prijzen = []
  try {
    prijzen = concert.prijsstructuur ? JSON.parse(concert.prijsstructuur) : []
  } catch (e) {
    prijzen = []
  }

  // Bepaal actieve Mollie-modus (voor status-banner)
  const mollieMode = getMollieMode(await getMollieApiKey(c.env))

  // Phase 5 — Beschikbare zaalplannen voor concert↔zaalplan koppeling
  const seatingPlans = await queryAll<any>(c.env.DB, `
    SELECT sp.id, sp.name, sp.description,
           (SELECT COUNT(*) FROM seats WHERE plan_id = sp.id) as seat_count
    FROM seating_plans sp
    ORDER BY sp.name ASC
  `)

  return c.html(
    <Layout title={`Instellingen - ${concert.titel}`} user={user}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav class="text-sm text-gray-600 mb-4" aria-label="Breadcrumb">
          <ol class="flex items-center flex-wrap gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home mr-1"></i>Admin</a></li>
            <li class="text-gray-400">/</li>
            <li><a href="/admin/tickets" class="hover:text-animato-primary">Ticketbeheer</a></li>
            <li class="text-gray-400">/</li>
            <li><a href={`/admin/events/${concert.event_id}`} class="hover:text-animato-primary">{concert.titel}</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium">Instellingen</li>
          </ol>
        </nav>

        {/* Header */}
        <div class="mb-8">
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-cog mr-3"></i>
            Ticketing Instellingen
          </h1>
          <p class="text-gray-600">{concert.titel}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <a href={`/admin/tickets/concert/${concertId}/orders`} class="inline-flex items-center gap-2 text-sm bg-animato-primary hover:bg-animato-secondary text-white px-3 py-1.5 rounded-lg">
              <i class="fas fa-receipt"></i>Bestellingen
            </a>
            <a href={`/admin/tickets/concert/${concertId}/scan`} class="inline-flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
              <i class="fas fa-qrcode"></i>QR-scanner
            </a>
            <a href={`/admin/tickets/concert/${concertId}/checkin-status`} class="inline-flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg">
              <i class="fas fa-clipboard-check"></i>Check-in status
            </a>
            <a href={`/concerten/${concert.slug}`} target="_blank" class="inline-flex items-center gap-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded-lg">
              <i class="fas fa-external-link-alt"></i>Publieke pagina
            </a>
          </div>
        </div>

        {/* Mollie status banner */}
        {mollieMode !== 'live' && (
          <div class={`mb-6 border-2 rounded-lg p-4 flex items-start gap-3 ${
            mollieMode === 'test' ? 'bg-amber-50 border-amber-300 text-amber-900' :
            mollieMode === 'mock' ? 'bg-gray-50 border-gray-300 text-gray-800' :
            'bg-red-50 border-red-300 text-red-900'
          }`}>
            <i class={`fas text-xl mt-0.5 ${
              mollieMode === 'test' ? 'fa-vial text-amber-600' :
              mollieMode === 'mock' ? 'fa-flask text-gray-500' :
              'fa-triangle-exclamation text-red-600'
            }`}></i>
            <div class="flex-1 text-sm">
              <strong class="block mb-0.5">
                {mollieMode === 'test' ? 'Mollie in TEST-modus' :
                 mollieMode === 'mock' ? 'Geen Mollie-betalingen actief (MOCK-modus)' :
                 'Mollie-configuratie ongeldig'}
              </strong>
              <p class="opacity-90">
                {mollieMode === 'test' && 'Er worden geen echte betalingen verwerkt. Gebruik Mollie-testkaarten om de flow te testen.'}
                {mollieMode === 'mock' && 'Ticketbestellingen worden opgeslagen maar er gaat géén geld doorheen. Stel een Mollie API-key in om live te gaan.'}
                {mollieMode === 'invalid' && 'De Mollie API-key is niet herkend. Controleer de instellingen.'}
              </p>
            </div>
            <a href="/admin/settings#mollie_api_key" class="flex-shrink-0 text-xs font-semibold bg-white/70 hover:bg-white px-3 py-1.5 rounded border border-current/20 transition">
              <i class="fas fa-cog mr-1"></i>Mollie instellen
            </a>
          </div>
        )}

        {/* Saved-banner: verschijnt na een geslaagde opslag */}
        {justSaved && (
          <div class="mb-6 bg-green-50 border-2 border-green-300 rounded-lg p-4 flex items-center gap-3 animate-pulse">
            <i class="fas fa-check-circle text-2xl text-green-600"></i>
            <div class="flex-1">
              <strong class="text-green-900">Instellingen bewaard.</strong>
              <p class="text-sm text-green-800">De wijzigingen zijn opgeslagen in de database.</p>
            </div>
          </div>
        )}

        <form method="POST" action={`/api/admin/tickets/concert/${concertId}/settings`} class="space-y-8">
          
          {/* Basic Settings */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Basis Instellingen</h2>
            
            <div class="space-y-4">
              {/* Ticket-status: één keuze uit vier mogelijkheden */}
              <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">
                  <i class="fas fa-toggle-on mr-2 text-animato-primary"></i>
                  Ticketstatus voor dit concert
                </h3>
                <p class="text-xs text-gray-600 mb-4">
                  Kies wat bezoekers op de publieke concert-pagina te zien krijgen. Deze keuzes stapelen:
                  "uitverkocht" heeft voorrang op "aangekondigd", dat heeft voorrang op de verkoop.
                </p>

                <div class="space-y-3">
                  <label class="flex items-start gap-3 p-3 border border-gray-200 bg-white rounded-lg cursor-pointer hover:border-animato-primary transition">
                    <input
                      type="checkbox"
                      name="ticketing_enabled"
                      id="ticketing_enabled"
                      checked={concert.ticketing_enabled === 1}
                      class="mt-0.5 w-5 h-5"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-gray-900">
                        <i class="fas fa-shopping-cart text-green-600 mr-1.5"></i>
                        Online ticketverkoop inschakelen
                      </div>
                      <div class="text-xs text-gray-600 mt-1">
                        Toont het bestelformulier met prijzen op de publieke pagina.
                      </div>
                    </div>
                  </label>

                  <label class="flex items-start gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg cursor-pointer hover:border-amber-400 transition">
                    <input
                      type="checkbox"
                      name="tickets_aangekondigd"
                      id="tickets_aangekondigd"
                      checked={concert.tickets_aangekondigd === 1}
                      class="mt-0.5 w-5 h-5"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-amber-900">
                        <i class="fas fa-hourglass-half text-amber-600 mr-1.5"></i>
                        Nog geen tickets beschikbaar (aankondiging)
                      </div>
                      <div class="text-xs text-amber-800 mt-1">
                        Toont "Tickets volgen binnenkort" op de publieke pagina. Combineer met een
                        startdatum hieronder voor een automatische aftelteller.
                        <strong class="block mt-1">Tip:</strong> als de datum verstrijkt én ticketverkoop aan staat, schakelt de
                        pagina automatisch om naar het bestelformulier.
                      </div>
                    </div>
                  </label>

                  <label class="flex items-start gap-3 p-3 border border-red-200 bg-red-50 rounded-lg cursor-pointer hover:border-red-400 transition">
                    <input
                      type="checkbox"
                      name="uitverkocht"
                      id="uitverkocht"
                      checked={concert.uitverkocht === 1}
                      class="mt-0.5 w-5 h-5"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-red-900">
                        <i class="fas fa-ban text-red-600 mr-1.5"></i>
                        Markeer als uitverkocht
                      </div>
                      <div class="text-xs text-red-800 mt-1">
                        Verbergt bestelformulier en toont "Uitverkocht" in plaats daarvan.
                      </div>
                    </div>
                  </label>

                  <label class="flex items-start gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg cursor-pointer hover:border-amber-400 transition">
                    <input
                      type="checkbox"
                      name="waitlist_enabled"
                      id="waitlist_enabled"
                      checked={(concert as any).waitlist_enabled === 1}
                      class="mt-0.5 w-5 h-5"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-amber-900">
                        <i class="fas fa-hourglass-half text-amber-600 mr-1.5"></i>
                        Wachtlijst inschakelen
                      </div>
                      <div class="text-xs text-amber-800 mt-1">
                        Wanneer het concert uitverkocht is, ziet de bezoeker een klein
                        inschrijfformulier (naam, email, telefoon) om op de wachtlijst
                        te komen. Zo weet je hoeveel extra vraag er is voor toekomstige
                        zaalkeuze of een extra concert-datum.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Voorverkoop start-datum
                  Logica: wanneer "Online ticketverkoop inschakelen" reeds aan staat,
                  heeft een toekomstige start-datum geen zin meer → veld disabled. */}
              <div
                id="voorverkoop_start_wrapper"
                class={`border-l-4 rounded-r-lg p-4 transition-all ${
                  concert.ticketing_enabled === 1
                    ? 'border-gray-300 bg-gray-100 opacity-60'
                    : 'border-amber-400 bg-amber-50'
                }`}
              >
                <label class="block text-sm font-semibold text-amber-900 mb-2">
                  <i class="fas fa-clock mr-2"></i>
                  Voorverkoop start op (optioneel)
                </label>
                <input
                  type="datetime-local"
                  name="voorverkoop_start_at"
                  id="voorverkoop_start_at"
                  value={concert.voorverkoop_start_at ? String(concert.voorverkoop_start_at).replace(' ', 'T').substring(0, 16) : ''}
                  disabled={concert.ticketing_enabled === 1}
                  class="w-full border border-amber-300 rounded-lg px-4 py-2 bg-white disabled:bg-gray-200 disabled:cursor-not-allowed disabled:text-gray-500"
                />
                <p
                  id="voorverkoop_start_hint_disabled"
                  class="text-xs text-red-700 mt-2 leading-relaxed font-medium"
                  style={concert.ticketing_enabled === 1 ? '' : 'display:none'}
                >
                  <i class="fas fa-lock mr-1"></i>
                  Online ticketverkoop staat al aan — een toekomstige start-datum heeft geen zin.
                  Schakel de verkoop hierboven uit als je toch een aftelteller wil tonen.
                </p>
                <p
                  id="voorverkoop_start_hint_default"
                  class="text-xs text-amber-800 mt-2 leading-relaxed"
                  style={concert.ticketing_enabled === 1 ? 'display:none' : ''}
                >
                  <i class="fas fa-info-circle mr-1"></i>
                  Datum in de toekomst? Dan toont de publieke pagina een <strong>live aftelteller</strong> tot
                  die datum. Laat leeg als je enkel "Tickets volgen binnenkort" wil tonen zonder specifieke datum,
                  of voor directe verkoop (datum in verleden = verkoop is open).
                </p>
              </div>

              {/* Client-side koppeling: ticketing_enabled ↔ voorverkoop_start_at */}
              <script dangerouslySetInnerHTML={{ __html: `
                (function() {
                  var cb = document.getElementById('ticketing_enabled');
                  var input = document.getElementById('voorverkoop_start_at');
                  var wrap = document.getElementById('voorverkoop_start_wrapper');
                  var hintOff = document.getElementById('voorverkoop_start_hint_disabled');
                  var hintOn = document.getElementById('voorverkoop_start_hint_default');
                  if (!cb || !input || !wrap) return;
                  function sync() {
                    if (cb.checked) {
                      input.disabled = true;
                      wrap.classList.remove('border-amber-400','bg-amber-50');
                      wrap.classList.add('border-gray-300','bg-gray-100','opacity-60');
                      if (hintOff) hintOff.style.display = '';
                      if (hintOn) hintOn.style.display = 'none';
                    } else {
                      input.disabled = false;
                      wrap.classList.add('border-amber-400','bg-amber-50');
                      wrap.classList.remove('border-gray-300','bg-gray-100','opacity-60');
                      if (hintOff) hintOff.style.display = 'none';
                      if (hintOn) hintOn.style.display = '';
                    }
                  }
                  cb.addEventListener('change', sync);
                  // initial sync (mocht JSX en runtime uit sync raken)
                  sync();
                })();
              ` }} />

              {/* Bug #214 — Concert-aanvangsuur & deuren-open
                  Los van events.start_at. Als ze leeg blijven, valt de
                  publieke pagina + ticket-mails terug op events.start_at
                  (oud gedrag, niets verandert). */}
              <div class="border-l-4 border-indigo-400 bg-indigo-50 rounded-r-lg p-4">
                <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <h3 class="text-sm font-semibold text-indigo-900">
                      <i class="fas fa-door-open mr-2"></i>
                      Concerturen (optioneel)
                    </h3>
                    <p class="text-xs text-indigo-800 mt-1">
                      Standaard nemen we het uur over van de agenda-afspraak
                      (<strong>{concert.start_at ? formatBrusselsDateTime(concert.start_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</strong>).
                      Hieronder kan je deuren-open en aanvang apart instellen — handig
                      voor concertposters of bestellingsmails.
                    </p>
                  </div>
                  <button
                    type="button"
                    id="syncConcertTimes"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 rounded-lg transition whitespace-nowrap"
                    title="Vul concert-aanvang in met agenda-uur en zet deuren 1 uur eerder"
                    data-event-start={concert.start_at ? String(concert.start_at).replace(' ', 'T').substring(0, 16) : ''}
                  >
                    <i class="fas fa-sync-alt"></i>
                    Synchroniseer met agenda
                  </button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-indigo-900 mb-1">
                      <i class="fas fa-door-open mr-1"></i> Deuren open om
                    </label>
                    <input
                      type="datetime-local"
                      name="doors_open_at"
                      id="doors_open_at"
                      value={concert.doors_open_at ? String(concert.doors_open_at).replace(' ', 'T').substring(0, 16) : ''}
                      class="w-full border border-indigo-300 rounded-lg px-3 py-2 bg-white text-sm"
                    />
                    <p class="text-[11px] text-indigo-700 mt-1">Wanneer publiek de zaal in mag (typisch 30-60 min vóór aanvang).</p>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-indigo-900 mb-1">
                      <i class="fas fa-music mr-1"></i> Concert start om
                    </label>
                    <input
                      type="datetime-local"
                      name="concert_start_at"
                      id="concert_start_at"
                      value={concert.concert_start_at ? String(concert.concert_start_at).replace(' ', 'T').substring(0, 16) : ''}
                      class="w-full border border-indigo-300 rounded-lg px-3 py-2 bg-white text-sm"
                    />
                    <p class="text-[11px] text-indigo-700 mt-1">Officieel aanvangsuur van de muziek. Laat leeg om agenda-uur te gebruiken.</p>
                  </div>
                </div>

                <script dangerouslySetInnerHTML={{ __html: `
                  (function(){
                    var btn = document.getElementById('syncConcertTimes');
                    if (!btn) return;
                    btn.addEventListener('click', function(){
                      var eventStart = btn.getAttribute('data-event-start');
                      if (!eventStart) {
                        alert('Geen agenda-uur gevonden voor dit concert.');
                        return;
                      }
                      var startInput = document.getElementById('concert_start_at');
                      var doorsInput = document.getElementById('doors_open_at');
                      // Concert-start = exact event-uur
                      startInput.value = eventStart;
                      // Deuren = 1u eerder
                      var d = new Date(eventStart);
                      d.setHours(d.getHours() - 1);
                      var pad = function(n){ return String(n).padStart(2, '0'); };
                      var doorsStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
                                     'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                      doorsInput.value = doorsStr;
                    });
                  })();
                ` }} />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Maximale capaciteit
                </label>
                <input
                  type="number"
                  name="capaciteit"
                  value={concert.capaciteit || 0}
                  min="0"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Bijvoorbeeld: 500"
                />
                <p class="text-sm text-gray-500 mt-1">
                  Stel in op 0 voor onbeperkte capaciteit
                </p>
              </div>
            </div>
          </div>

          {/* Phase 5 — Zaalplan koppeling */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-2">
              <i class="fas fa-chair text-animato-primary mr-2"></i>
              Zaalplan & Stoelreservatie
            </h2>
            <p class="text-sm text-gray-600 mb-5">
              Koppel een zaalplan om bezoekers hun stoel te laten kiezen. Zonder zaalplan werkt het concert
              met <strong>vrije zit</strong> (klant kiest aantal per prijscategorie, zoals nu).
            </p>

            <div class="border-l-4 border-animato-primary bg-blue-50 rounded-r-lg p-4">
              <label class="block text-sm font-semibold text-animato-secondary mb-2">
                <i class="fas fa-map mr-2"></i>
                Welk zaalplan gebruiken?
              </label>
              <select
                name="seating_plan_id"
                class="w-full border border-blue-300 rounded-lg px-4 py-2 bg-white text-sm"
              >
                <option value="" selected={!concert.seating_plan_id}>
                  — Geen zaalplan / vrije zit —
                </option>
                {seatingPlans.map((sp: any) => (
                  <option value={sp.id} selected={concert.seating_plan_id === sp.id}>
                    {sp.name} ({sp.seat_count} stoelen)
                  </option>
                ))}
              </select>

              <div class="mt-3 text-xs text-gray-700 space-y-1.5">
                <p>
                  <i class="fas fa-info-circle mr-1 text-blue-600"></i>
                  <strong>Vrije zit</strong> — klant kiest hoeveel tickets per categorie. Geen vaste stoel.
                </p>
                <p>
                  <i class="fas fa-chair mr-1 text-blue-600"></i>
                  <strong>Met zaalplan</strong> — klant klikt zelf zijn stoel op het plan. Als er meerdere
                  prijscategorieën zijn kiest de klant ook welk tarief van toepassing is.
                </p>
                {seatingPlans.length === 0 && (
                  <p class="text-amber-700 mt-2">
                    <i class="fas fa-exclamation-triangle mr-1"></i>
                    Er zijn nog geen zaalplannen aangemaakt.
                    <a href="/admin/seating" class="underline ml-1 font-semibold">Beheer zaalplannen →</a>
                  </p>
                )}
                {seatingPlans.length > 0 && (
                  <p class="mt-2">
                    <a href="/admin/seating" class="text-animato-primary hover:underline text-xs">
                      <i class="fas fa-cog mr-1"></i>Zaalplannen beheren →
                    </a>
                    {concert.seating_plan_id && (
                      <a href={`/admin/tickets/concert/${concertId}/zaalplan`} class="text-animato-primary hover:underline text-xs ml-3">
                        <i class="fas fa-eye mr-1"></i>Live bezetting bekijken →
                      </a>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Prijsstructuur */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Prijscategorieën</h2>
            
            <div id="prijzen-container" class="space-y-4">
              {prijzen.length === 0 ? (
                <p class="text-gray-500">Nog geen prijscategorieën ingesteld</p>
              ) : (
                prijzen.map((prijs: any, index: number) => (
                  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50 relative" data-price-index={index}>
                    <button
                      type="button"
                      onclick={`removePriceCategory(${index})`}
                      class="absolute top-2 right-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition"
                      title="Verwijder prijscategorie"
                    >
                      <i class="fas fa-trash-alt"></i>
                    </button>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Categorie
                        </label>
                        <input
                          type="text"
                          name={`prijzen[${index}][categorie]`}
                          value={prijs.categorie}
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="Volwassenen"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Prijs (€)
                        </label>
                        <input
                          type="number"
                          name={`prijzen[${index}][prijs]`}
                          value={prijs.prijs}
                          step="0.01"
                          min="0"
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="15.00"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Beschrijving (optioneel)
                        </label>
                        <input
                          type="text"
                          name={`prijzen[${index}][beschrijving]`}
                          value={prijs.beschrijving || ''}
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="Vanaf 18 jaar"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onclick="addPriceCategory()"
              class="mt-4 text-animato-primary hover:underline inline-flex items-center"
            >
              <i class="fas fa-plus mr-2"></i>
              Prijscategorie toevoegen
            </button>
          </div>

          {/* Concert Afbeelding — geunificeerde widget */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">
              <i class="fas fa-image text-animato-primary mr-2"></i>
              Concert Afbeelding
            </h2>

            <div class="space-y-4">
              {/* DE WAARDE — één en de enige input die naar de server gaat */}
              <input type="hidden" id="afbeelding-value" name="afbeelding" value={concert.afbeelding || ''} />

              {/* Preview (zichtbaar als er een afbeelding is) */}
              <div id="preview-section" class={concert.afbeelding ? 'block' : 'hidden'}>
                <div class="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50 max-w-md mx-auto">
                  <img
                    id="preview-image"
                    src={concert.afbeelding || ''}
                    alt="Concert preview"
                    class="w-full h-auto block"
                    onerror="document.getElementById('preview-error').classList.remove('hidden'); this.classList.add('opacity-30');"
                    onload="document.getElementById('preview-error').classList.add('hidden'); this.classList.remove('opacity-30');"
                  />
                  <div id="preview-error" class="hidden absolute inset-0 flex items-center justify-center bg-red-50/90">
                    <div class="text-center text-red-600 p-4">
                      <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
                      <p class="font-semibold text-sm">Afbeelding kan niet geladen worden</p>
                      <p class="text-xs text-red-500 mt-1">Controleer de URL of upload een nieuw bestand</p>
                    </div>
                  </div>
                </div>
                <div class="flex items-center justify-center gap-3 mt-3">
                  <button
                    type="button"
                    onclick="document.getElementById('file-input').click()"
                    class="text-sm text-animato-primary hover:text-animato-secondary font-medium"
                  >
                    <i class="fas fa-sync-alt mr-1"></i> Vervang afbeelding
                  </button>
                  <span class="text-gray-300">·</span>
                  <button
                    type="button"
                    onclick="removeImage()"
                    class="text-sm text-red-600 hover:text-red-800 font-medium"
                  >
                    <i class="fas fa-trash mr-1"></i> Verwijder
                  </button>
                </div>
              </div>

              {/* Drop-zone (zichtbaar als er GEEN afbeelding is) */}
              <div id="drop-zone-wrapper" class={concert.afbeelding ? 'hidden' : 'block'}>
                <div
                  id="drop-zone"
                  class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-animato-primary hover:bg-blue-50/30 transition cursor-pointer"
                  ondragover="event.preventDefault(); this.classList.add('border-animato-primary','bg-blue-50');"
                  ondragleave="this.classList.remove('border-animato-primary','bg-blue-50');"
                  ondrop="handleFileDrop(event)"
                  onclick="document.getElementById('file-input').click()"
                >
                  <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-3"></i>
                  <p class="text-gray-700 font-medium mb-1">
                    Klik of sleep een bestand hierheen
                  </p>
                  <p class="text-xs text-gray-500">
                    PNG, JPG, GIF, WebP — max 5MB
                  </p>
                </div>
              </div>

              <input
                type="file"
                id="file-input"
                accept="image/*"
                class="hidden"
                onchange="handleFileSelect(event)"
              />

              {/* Geavanceerd: URL handmatig invoeren (uitklapbaar) */}
              <details class="group">
                <summary class="cursor-pointer text-sm text-gray-600 hover:text-animato-primary list-none flex items-center gap-2 select-none">
                  <i class="fas fa-chevron-right text-xs group-open:rotate-90 transition-transform"></i>
                  <i class="fas fa-link text-xs"></i>
                  Geavanceerd: URL handmatig invoeren of bewerken
                </summary>
                <div class="mt-3 pl-4 border-l-2 border-gray-100">
                  <input
                    type="text"
                    id="afbeelding-url-input"
                    value={concert.afbeelding || ''}
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                    placeholder="/r2/covers/events/... of https://example.com/foto.jpg"
                    oninput="syncFromUrlInput(this.value)"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    <i class="fas fa-info-circle mr-1"></i>
                    Voor R2-paden gebruik <code class="bg-gray-100 px-1 rounded">/r2/...</code>, of plak een externe https-URL.
                  </p>
                </div>
              </details>
            </div>
          </div>

          {/* Programma */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Programma</h2>
            
            <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet" />
            <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
               <div id="editor-programma" class="h-64"></div>
            </div>
            
            <textarea name="programma" id="programma-input" class="hidden">{concert.programma || ''}</textarea>
            
            <p class="text-sm text-gray-500 mt-1">
              Dit wordt getoond op de ticketpagina
            </p>
          </div>

          {/* Praktische Informatie */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">
              <i class="fas fa-info-circle text-animato-primary mr-2"></i>
              Praktische Informatie
            </h2>
            
            <div class="space-y-6">
              {/* Parking */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-parking mr-2 text-gray-600"></i>
                  Parking
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-parking" class="h-32"></div>
                </div>
                <textarea name="parking" id="parking-input" class="hidden">{concert.parking || ''}</textarea>
              </div>

              {/* Toegankelijkheid */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-wheelchair mr-2 text-gray-600"></i>
                  Toegankelijkheid
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-toegankelijkheid" class="h-32"></div>
                </div>
                <textarea name="toegankelijkheid" id="toegankelijkheid-input" class="hidden">{concert.toegankelijkheid || ''}</textarea>
              </div>

              {/* Duur & Pauze */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-clock mr-2 text-gray-600"></i>
                  Duur & Pauze
                </label>
                <input
                  type="text"
                  name="duur_info"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Bijv. Het concert duurt ongeveer 2 uur inclusief een pauze van 20 minuten."
                  value={concert.duur_info || ''}
                />
              </div>

              {/* Sfeer & Dresscode */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-tshirt mr-2 text-gray-600"></i>
                  Sfeer & Dresscode
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-sfeer" class="h-32"></div>
                </div>
                <textarea name="sfeer_dresscode" id="sfeer-input" class="hidden">{concert.sfeer_dresscode || ''}</textarea>
              </div>

              {/* Extra Info */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-star mr-2 text-gray-600"></i>
                  Extra Informatie
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-extra" class="h-32"></div>
                </div>
                <textarea name="extra_info" id="extra-input" class="hidden">{concert.extra_info || ''}</textarea>
              </div>
            </div>

            <p class="text-sm text-gray-500 mt-4">
              <i class="fas fa-lightbulb mr-1"></i>
              Deze informatie wordt getoond in de "Praktische Informatie" sectie op de concert detailpagina
            </p>
          </div>

          {/* Submit */}
          <div class="flex items-center justify-end space-x-4">
            <a
              href="/admin/tickets"
              class="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuleren
            </a>
            <button
              type="submit"
              class="px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-save mr-2"></i>
              Instellingen Opslaan
            </button>
          </div>
        </form>


        {/* Delete Confirmation Modal */}
        <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-red-500">
              <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div class="sm:flex sm:items-start">
                  <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <i class="fas fa-exclamation-triangle text-red-600"></i>
                  </div>
                  <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 class="text-xl leading-6 font-bold text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                      Bevestig Verwijderen
                    </h3>
                    <div class="mt-2">
                      <p class="text-sm text-gray-500">
                        Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-lg border border-transparent shadow-md px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Verwijderen
                </button>
                <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Internal Page Link Picker (#120) */}
        <QuillLinkPicker />

        {/* JavaScript */}
        <script src="https://cdn.quilljs.com/1.3.6/quill.min.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          // Initialize Quill editors
          function initEditor(containerId, inputId) {
            if (document.getElementById(containerId)) {
              var quill = new Quill('#' + containerId, {
                theme: 'snow',
                modules: {
                  toolbar: {
                    container: [
                      [{ 'header': [3, 4, false] }],
                      ['bold', 'italic', 'underline'],
                      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                      ['link'],
                      ['clean']
                    ],
                    handlers: {
                      link: function(value) {
                        if (value && typeof window.__quillLinkHandler === 'function') {
                          return window.__quillLinkHandler.call(this, value);
                        }
                        // Fallback: standaard prompt
                        if (value) {
                          var url = prompt('Link URL:');
                          if (url) this.quill.format('link', url);
                        } else {
                          this.quill.format('link', false);
                        }
                      }
                    }
                  }
                }
              });

              // Load initial content
              var initialContent = document.getElementById(inputId).value;
              if (initialContent) {
                 quill.clipboard.dangerouslyPasteHTML(initialContent);
              }

              // Sync content on change
              quill.on('text-change', function() {
                document.getElementById(inputId).value = quill.root.innerHTML;
              });

              // Hang ook de link-picker aan deze instance (extra zekerheid)
              if (window.__attachQuillLinkPicker) window.__attachQuillLinkPicker(quill);
            }
          }

          // Initialize all editors
          initEditor('editor-programma', 'programma-input');
          initEditor('editor-parking', 'parking-input');
          initEditor('editor-toegankelijkheid', 'toegankelijkheid-input');
          initEditor('editor-sfeer', 'sfeer-input');
          initEditor('editor-extra', 'extra-input');

          let priceIndex = ${prijzen.length};
          let deleteCallback = null;

          function openDeleteModal(callback) {
            deleteCallback = callback;
            document.getElementById('deleteModal').classList.remove('hidden');
          }

          function closeDeleteModal() {
            deleteCallback = null;
            document.getElementById('deleteModal').classList.add('hidden');
          }

          document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
            if (deleteCallback) {
              deleteCallback();
            }
            closeDeleteModal();
          });
          
          function addPriceCategory() {
            const container = document.getElementById('prijzen-container');
            const div = document.createElement('div');
            div.className = 'border border-gray-200 rounded-lg p-4 bg-gray-50 relative';
            div.setAttribute('data-price-index', priceIndex);
            div.innerHTML = \`
              <button type="button" onclick="removePriceCategory(\${priceIndex})" class="absolute top-2 right-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition" title="Verwijder prijscategorie">
                <i class="fas fa-trash-alt"></i>
              </button>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Categorie</label>
                  <input type="text" name="prijzen[\${priceIndex}][categorie]" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="Volwassenen" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Prijs (€)</label>
                  <input type="number" name="prijzen[\${priceIndex}][prijs]" step="0.01" min="0" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="15.00" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Beschrijving (optioneel)</label>
                  <input type="text" name="prijzen[\${priceIndex}][beschrijving]" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="Vanaf 18 jaar" />
                </div>
              </div>
            \`;
            container.appendChild(div);
            priceIndex++;
          }
          
          function removePriceCategory(index) {
            openDeleteModal(function() {
              // Find the div with data-price-index matching the index
              const container = document.getElementById('prijzen-container');
              const divToRemove = container.querySelector('[data-price-index="' + index + '"]');
              
              if (divToRemove) {
                divToRemove.remove();
              }
            });
          }

          // Image Upload Functions — geunificeerde widget
          // Eén enkele bron-van-waarheid: #afbeelding-value
          // De drop-zone, file-input, URL-input en preview synchroniseren allemaal
          // naar dit hidden field via setImageValue().

          function setImageValue(value, opts) {
            opts = opts || {};
            var hidden = document.getElementById('afbeelding-value');
            var urlInput = document.getElementById('afbeelding-url-input');
            var preview = document.getElementById('preview-image');
            var previewSection = document.getElementById('preview-section');
            var dropZoneWrapper = document.getElementById('drop-zone-wrapper');
            var previewError = document.getElementById('preview-error');

            hidden.value = value || '';
            // Sync URL-input alleen als het verzoek NIET vanuit URL-input kwam
            if (!opts.fromUrlInput) {
              urlInput.value = value || '';
            }

            if (value) {
              preview.src = value;
              previewSection.classList.remove('hidden');
              previewSection.classList.add('block');
              dropZoneWrapper.classList.add('hidden');
              dropZoneWrapper.classList.remove('block');
              previewError.classList.add('hidden');
            } else {
              previewSection.classList.add('hidden');
              previewSection.classList.remove('block');
              dropZoneWrapper.classList.remove('hidden');
              dropZoneWrapper.classList.add('block');
              preview.src = '';
            }
          }

          function syncFromUrlInput(val) {
            // Trim en sta zowel /r2/... als https://... toe
            var v = (val || '').trim();
            setImageValue(v, { fromUrlInput: true });
          }

          function handleFileSelect(event) {
            var file = event.target.files[0];
            if (file) processFile(file);
          }

          function handleFileDrop(event) {
            event.preventDefault();
            var dropZone = document.getElementById('drop-zone');
            if (dropZone) dropZone.classList.remove('border-animato-primary','bg-blue-50');
            var file = event.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
              processFile(file);
            } else {
              alert('Selecteer een geldig afbeeldingsbestand');
            }
          }

          function processFile(file) {
            if (file.size > 5 * 1024 * 1024) {
              alert('Bestand is te groot. Maximum 5MB toegestaan.');
              return;
            }
            var reader = new FileReader();
            reader.onload = function(e) {
              // Data-URL → server zal die uploaden naar R2 en de /r2/... URL teruggeven
              setImageValue(e.target.result);
            };
            reader.readAsDataURL(file);
          }

          function removeImage() {
            if (typeof openDeleteModal === 'function') {
              openDeleteModal(function() {
                document.getElementById('file-input').value = '';
                setImageValue('');
              });
            } else {
              if (confirm('Afbeelding verwijderen?')) {
                document.getElementById('file-input').value = '';
                setImageValue('');
              }
            }
          }
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// UPDATE CONCERT SETTINGS API
// ==========================================
app.post('/api/admin/tickets/concert/:concertId/settings', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const body = await c.req.parseBody()
  
  // DEBUG: log alles wat binnenkomt zodat we kunnen zien of de form data klopt
  console.log('[settings-POST] concertId =', concertId, 'user =', user?.email)
  console.log('[settings-POST] body keys =', Object.keys(body))
  console.log('[settings-POST] body =', JSON.stringify(body).slice(0, 1000))

  try {
    // Parse prijsstructuur from form
    const prijzen: any[] = []
    for (const [key, value] of Object.entries(body)) {
      const match = key.match(/prijzen\[(\d+)\]\[categorie\]/)
      if (match) {
        const index = parseInt(match[1])
        const categorie = String(value)
        const prijs = parseFloat(String(body[`prijzen[${index}][prijs]`]))
        const beschrijving = String(body[`prijzen[${index}][beschrijving]`] || '')
        
        if (categorie && prijs >= 0) {
          prijzen.push({ categorie, prijs, beschrijving })
        }
      }
    }

    // Get event_id for this concert
    const concert = await queryOne(c.env.DB, `SELECT event_id FROM concerts WHERE id = ?`, [concertId])
    
    if (!concert) {
      console.error('[settings-POST] Concert niet gevonden:', concertId)
      return c.json({ error: 'Concert niet gevonden' }, 404)
    }

    // Normaliseer datetime-local input: leeg → NULL, 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DD HH:MM:00'
    // Helper omdat we 'm voor 3 velden nodig hebben (voorverkoop, deuren, concert-start)
    const normalizeDateTime = (raw: any): string | null => {
      const s = String(raw || '').trim()
      if (!s) return null
      return s.replace('T', ' ') + (s.length === 16 ? ':00' : '')
    }

    // Server-side safeguard: als ticketverkoop al aan staat, heeft een
    // "voorverkoop start op"-datum geen zin meer (de verkoop is immers open).
    // We forceren hem dan op NULL, ongeacht wat de form stuurt — dekt zowel
    // browsers zonder JS als stale data uit een eerdere config.
    const ticketingEnabled = body.ticketing_enabled ? 1 : 0
    const voorverkoopStart = ticketingEnabled === 1 ? null : normalizeDateTime(body.voorverkoop_start_at)
    // Bug #214 — eigen ticket-uren, los van events.start_at
    const doorsOpenAt = normalizeDateTime(body.doors_open_at)
    const concertStartAt = normalizeDateTime(body.concert_start_at)

    // Phase 5 — Zaalplan koppeling: leeg = NULL (vrije zit), anders FK naar seating_plans.id
    const rawSeatingPlanId = String(body.seating_plan_id || '').trim()
    const seatingPlanId: number | null = rawSeatingPlanId === '' ? null : (parseInt(rawSeatingPlanId) || null)

    // Update concert settings
    console.log('[settings-POST] About to UPDATE concert', concertId, 'with capaciteit=', parseInt(String(body.capaciteit)) || 0)
    const updateResult: any = await execute(c.env.DB, `
      UPDATE concerts SET
        ticketing_enabled = ?,
        uitverkocht = ?,
        waitlist_enabled = ?,
        tickets_aangekondigd = ?,
        voorverkoop_start_at = ?,
        doors_open_at = ?,
        concert_start_at = ?,
        capaciteit = ?,
        prijsstructuur = ?,
        seating_plan_id = ?,
        programma = ?,
        parking = ?,
        toegankelijkheid = ?,
        duur_info = ?,
        sfeer_dresscode = ?,
        extra_info = ?
      WHERE id = ?
    `, [
      ticketingEnabled,
      body.uitverkocht ? 1 : 0,
      body.waitlist_enabled ? 1 : 0,
      body.tickets_aangekondigd ? 1 : 0,
      voorverkoopStart,
      doorsOpenAt,
      concertStartAt,
      parseInt(String(body.capaciteit)) || 0,
      JSON.stringify(prijzen),
      seatingPlanId,
      String(body.programma || ''),
      String(body.parking || ''),
      String(body.toegankelijkheid || ''),
      String(body.duur_info || ''),
      String(body.sfeer_dresscode || ''),
      String(body.extra_info || ''),
      concertId
    ])
    console.log('[settings-POST] UPDATE result:', JSON.stringify(updateResult).slice(0, 300))

    // Update event image (stored in events.image_url)
    // Drie scenarios:
    //   1. data:image/... → upload naar R2, sla de /r2/... URL op
    //   2. /r2/... of https://... → sla rechtstreeks op
    //   3. lege string → wis de image_url
    if (body.afbeelding !== undefined) {
      let finalImageUrl: string = String(body.afbeelding || '').trim()

      if (isDataUrl(finalImageUrl) && c.env.R2) {
        try {
          const uploaded = await uploadDataUrlToR2(c.env.R2, `covers/events/${concert.event_id}`, finalImageUrl)
          if (uploaded?.url) {
            finalImageUrl = uploaded.url
            console.log('[settings-POST] Data-URL geüpload naar R2:', uploaded.url)
          } else {
            console.warn('[settings-POST] R2 upload returned no url — image niet opgeslagen')
            finalImageUrl = '' // niet de hele data-URL in DB stoppen
          }
        } catch (e: any) {
          console.error('[settings-POST] R2 upload mislukt:', e?.message)
          // Hard fout — vertel admin dat upload faalde
          return c.json({ error: 'Afbeelding kon niet worden opgeslagen: ' + (e?.message || 'onbekende fout') }, 500)
        }
      }

      await execute(c.env.DB, `
        UPDATE events SET
          image_url = ?
        WHERE id = ?
      `, [
        finalImageUrl,
        concert.event_id
      ])
    }

    console.log('[settings-POST] Done — redirecting back to settings page for visual feedback')
    return c.redirect(`/admin/tickets/concert/${concertId}/settings?saved=1`)
  } catch (error) {
    console.error('[settings-POST] EXCEPTION:', (error as Error).message, (error as Error).stack)
    return c.json({ error: (error as Error).message, stack: (error as Error).stack }, 500)
  }
})

// ==========================================
// QR CODE SCANNER PAGE
// ==========================================
app.get('/admin/tickets/concert/:concertId/scan', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.html(<Layout title="Concert niet gevonden" user={user}><div>Concert niet gevonden</div></Layout>)
  }

  return c.html(
    <Layout title={`QR Scanner - ${concert.titel}`} user={user}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav class="text-sm text-gray-600 mb-4" aria-label="Breadcrumb">
          <ol class="flex items-center flex-wrap gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home mr-1"></i>Admin</a></li>
            <li class="text-gray-400">/</li>
            <li><a href="/admin/tickets" class="hover:text-animato-primary">Ticketbeheer</a></li>
            <li class="text-gray-400">/</li>
            <li><a href={`/admin/tickets/concert/${concertId}/settings`} class="hover:text-animato-primary">{concert.titel}</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium">QR-scanner</li>
          </ol>
        </nav>
        {/* Header */}
        <div class="mb-8">
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-qrcode mr-3"></i>
            QR Code Scanner
          </h1>
          <p class="text-gray-600">{concert.titel}</p>
          <p class="text-sm text-gray-500">
            {new Date(concert.start_at).toLocaleDateString('nl-NL', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>

        {/* Scanner Interface */}
        <div class="bg-white rounded-lg shadow-md p-6">

          {/* Camera scanner — html5-qrcode via CDN */}
          <div class="mb-6">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xl font-bold text-gray-900">
                <i class="fas fa-camera mr-2 text-animato-primary"></i>
                Camera scanner
              </h2>
              <div class="flex items-center gap-2">
                <button
                  id="cam-start-btn"
                  onclick="startCamera()"
                  class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-play mr-1"></i>Start camera
                </button>
                <button
                  id="cam-stop-btn"
                  onclick="stopCamera()"
                  class="hidden px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-stop mr-1"></i>Stop
                </button>
                <button
                  id="cam-flip-btn"
                  onclick="flipCamera()"
                  class="hidden px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-medium"
                  title="Wissel tussen voor- en achtercamera"
                >
                  <i class="fas fa-sync-alt"></i>
                </button>
                <button
                  id="cam-torch-btn"
                  onclick="toggleTorch()"
                  class="hidden px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-medium"
                  title="Zaklamp aan/uit"
                >
                  <i class="fas fa-bolt"></i>
                </button>
              </div>
            </div>

            {/* Live video container */}
            <div id="cam-reader-wrap" class="hidden">
              <div id="cam-reader" class="rounded-lg overflow-hidden bg-black mx-auto" style="max-width: 480px;"></div>
              <p id="cam-status" class="text-sm text-gray-600 mt-2 text-center">
                <i class="fas fa-circle-notch fa-spin mr-1"></i>
                Camera starten...
              </p>
            </div>

            {/* Permission / error hint (initially hidden, only shown after attempt) */}
            <div id="cam-error" class="hidden bg-amber-50 border-l-4 border-amber-400 p-4 mt-2">
              <p class="text-sm text-amber-800">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                <span id="cam-error-msg">Camera kon niet worden geopend.</span>
              </p>
              <p class="text-xs text-amber-700 mt-1">
                Tip: HTTPS is vereist en je moet camera-toegang toestaan in de browser-prompt.
                Werkt niet? Gebruik dan een externe QR-scanner of typ de code hieronder in.
              </p>
            </div>
          </div>

          {/* Manual QR Code Input — fallback */}
          <div class="mb-8 pt-6 border-t border-gray-200">
            <h2 class="text-lg font-semibold text-gray-800 mb-3">
              <i class="fas fa-keyboard mr-2 text-gray-500"></i>
              Of handmatig invoeren / externe scanner
            </h2>
            <div class="flex gap-4">
              <input
                type="text"
                id="qr-input"
                placeholder="Scan of typ QR-code..."
                class="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-lg"
                autofocus
              />
              <button
                onclick="validateTicket()"
                class="px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition"
              >
                <i class="fas fa-check mr-2"></i>
                Valideer
              </button>
            </div>
            <p class="text-sm text-gray-500 mt-2">
              <i class="fas fa-info-circle mr-1"></i>
              Bluetooth/USB QR-scanner werkt als toetsenbord — typ in het veld of laat de scanner het invullen
            </p>
          </div>

          {/* Result Display — 3 states: success (groen), warning (amber=re-scan), error (rood) */}
          <div id="result-container" class="hidden">
            <div id="result-success" class="hidden bg-green-50 border-2 border-green-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-check-circle text-green-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-green-900">Welkom!</h3>
                  <p class="text-green-700">Ingecheckt — toegang verleend</p>
                </div>
              </div>
              <div id="ticket-details" class="text-sm text-gray-700 space-y-1"></div>
            </div>

            <div id="result-warning" class="hidden bg-amber-50 border-2 border-amber-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-exclamation-triangle text-amber-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-amber-900">Reeds ingecheckt</h3>
                  <p id="warning-message" class="text-amber-700"></p>
                </div>
              </div>
              <div id="warning-details" class="text-sm text-gray-700 space-y-1"></div>
            </div>

            <div id="result-error" class="hidden bg-red-50 border-2 border-red-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-times-circle text-red-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-red-900">Ticket Ongeldig</h3>
                  <p id="error-message" class="text-red-700"></p>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div class="mt-8 pt-8 border-t border-gray-200">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold text-gray-900">Live Statistieken</h3>
              <a href={`/admin/tickets/concert/${concertId}/checkin-status`}
                 class="text-sm text-animato-primary hover:underline">
                <i class="fas fa-list-check mr-1"></i>
                Volledige check-in lijst
              </a>
            </div>
            <div class="grid grid-cols-4 gap-4">
              <div class="text-center">
                <div class="text-3xl font-bold text-gray-900" id="scanned-count">0</div>
                <div class="text-sm text-gray-600">Gescand</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-green-600" id="valid-count">0</div>
                <div class="text-sm text-gray-600">Ingecheckt</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-amber-600" id="rescan-count">0</div>
                <div class="text-sm text-gray-600">Reeds gescand</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-red-600" id="invalid-count">0</div>
                <div class="text-sm text-gray-600">Ongeldig</div>
              </div>
            </div>
          </div>
        </div>

        {/* html5-qrcode library voor camera-scan (MIT, ~70KB gzipped) */}
        <script src="https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>

        {/* JavaScript */}
        <script dangerouslySetInnerHTML={{ __html: `
          let scanned = 0;
          let valid = 0;
          let rescanned = 0;
          let invalid = 0;

          // ─── Camera scanner state ───────────────────────────────────────
          let html5QrCode = null;          // Html5Qrcode instance
          let availableCameras = [];        // [{id, label}, ...]
          let currentCameraIdx = 0;         // welke camera nu actief
          let cameraRunning = false;
          let torchOn = false;
          let lastScannedCode = '';
          let lastScannedAt = 0;
          const DEBOUNCE_MS = 2500;         // dezelfde QR niet < 2.5s opnieuw verwerken

          function showCamError(msg) {
            const err = document.getElementById('cam-error');
            const txt = document.getElementById('cam-error-msg');
            txt.textContent = msg;
            err.classList.remove('hidden');
          }
          function hideCamError() {
            document.getElementById('cam-error').classList.add('hidden');
          }

          async function startCamera() {
            hideCamError();
            if (!window.Html5Qrcode) {
              showCamError('Camera-library kon niet geladen worden — check internet of HTTPS.');
              return;
            }
            try {
              // Cameras enumereren (vraagt direct permissie)
              if (availableCameras.length === 0) {
                availableCameras = await Html5Qrcode.getCameras();
              }
              if (!availableCameras || availableCameras.length === 0) {
                showCamError('Geen camera gedetecteerd op dit toestel.');
                return;
              }

              // Voorkeur: achtercamera (label bevat 'back' of 'rear' of 'environment')
              if (currentCameraIdx === 0 && availableCameras.length > 1) {
                const rearIdx = availableCameras.findIndex(c =>
                  /back|rear|environment|achter/i.test(c.label || ''));
                if (rearIdx >= 0) currentCameraIdx = rearIdx;
              }

              document.getElementById('cam-reader-wrap').classList.remove('hidden');
              document.getElementById('cam-status').innerHTML =
                '<i class="fas fa-circle-notch fa-spin mr-1"></i>Camera starten...';

              html5QrCode = new Html5Qrcode('cam-reader', { verbose: false });
              const camId = availableCameras[currentCameraIdx].id;

              await html5QrCode.start(
                camId,
                {
                  fps: 10,
                  qrbox: (vw, vh) => {
                    // Vierkant scan-frame: 70% van kortste zijde
                    const min = Math.min(vw, vh);
                    const size = Math.floor(min * 0.7);
                    return { width: size, height: size };
                  },
                  aspectRatio: 1.333,
                  // Voorkeur formaat: QR_CODE only (sneller, minder false-positives)
                  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
                },
                onCamScanSuccess,
                onCamScanError
              );

              cameraRunning = true;
              document.getElementById('cam-start-btn').classList.add('hidden');
              document.getElementById('cam-stop-btn').classList.remove('hidden');
              if (availableCameras.length > 1) {
                document.getElementById('cam-flip-btn').classList.remove('hidden');
              }
              // Torch alleen tonen als de camera hem ondersteunt
              checkTorchSupport();
              document.getElementById('cam-status').innerHTML =
                '<i class="fas fa-circle text-green-500 mr-1"></i>Live — richt de camera op een QR-code';
            } catch (e) {
              console.error('startCamera failed:', e);
              const m = (e && e.message) || String(e);
              if (/permission|denied|notallowed/i.test(m)) {
                showCamError('Camera-toegang geweigerd. Klik op het slot-icoon in de adresbalk om opnieuw toestemming te geven.');
              } else if (/secure|https/i.test(m)) {
                showCamError('Camera werkt alleen op HTTPS. Gebruik animato-live.pages.dev (zonder http://).');
              } else {
                showCamError('Camera kon niet starten: ' + m);
              }
            }
          }

          async function stopCamera() {
            if (!html5QrCode || !cameraRunning) return;
            try {
              await html5QrCode.stop();
              await html5QrCode.clear();
            } catch (e) { /* niet kritiek */ }
            html5QrCode = null;
            cameraRunning = false;
            torchOn = false;
            document.getElementById('cam-reader-wrap').classList.add('hidden');
            document.getElementById('cam-start-btn').classList.remove('hidden');
            document.getElementById('cam-stop-btn').classList.add('hidden');
            document.getElementById('cam-flip-btn').classList.add('hidden');
            document.getElementById('cam-torch-btn').classList.add('hidden');
          }

          async function flipCamera() {
            if (availableCameras.length < 2) return;
            currentCameraIdx = (currentCameraIdx + 1) % availableCameras.length;
            await stopCamera();
            await startCamera();
          }

          async function checkTorchSupport() {
            try {
              const trackSettings = html5QrCode.getRunningTrackCameraCapabilities &&
                html5QrCode.getRunningTrackCameraCapabilities();
              const torchSupported = trackSettings && trackSettings.torchFeature &&
                trackSettings.torchFeature().isSupported && trackSettings.torchFeature().isSupported();
              if (torchSupported) {
                document.getElementById('cam-torch-btn').classList.remove('hidden');
              }
            } catch (e) { /* feature detection — best-effort */ }
          }

          async function toggleTorch() {
            if (!html5QrCode) return;
            try {
              const caps = html5QrCode.getRunningTrackCameraCapabilities();
              const torch = caps.torchFeature();
              torchOn = !torchOn;
              await torch.apply(torchOn);
              const btn = document.getElementById('cam-torch-btn');
              btn.classList.toggle('bg-yellow-300', torchOn);
              btn.classList.toggle('bg-gray-200', !torchOn);
            } catch (e) {
              console.warn('Torch toggle failed:', e);
            }
          }

          function onCamScanSuccess(decodedText, decodedResult) {
            const now = Date.now();
            // Debounce: zelfde QR niet < DEBOUNCE_MS opnieuw verwerken
            if (decodedText === lastScannedCode && (now - lastScannedAt) < DEBOUNCE_MS) {
              return;
            }
            lastScannedCode = decodedText;
            lastScannedAt = now;

            // Korte visuele bevestiging op de video — tijdens validatie blijft camera draaien
            const status = document.getElementById('cam-status');
            const oldHtml = status.innerHTML;
            status.innerHTML = '<i class="fas fa-bolt text-amber-500 mr-1"></i>QR herkend — valideren...';

            // Vul ook het manual-input veld (zodat de gebruiker ziet wat er gescand werd)
            document.getElementById('qr-input').value = decodedText;
            validateTicket().finally(() => {
              setTimeout(() => { status.innerHTML = oldHtml; }, 1500);
            });
          }

          function onCamScanError(errMsg) {
            // html5-qrcode roept dit elke frame zonder QR aan — bewust stil
          }

          // Stop camera als de pagina dichtgaat (release lens)
          window.addEventListener('beforeunload', () => {
            if (cameraRunning) stopCamera();
          });
          // ────────────────────────────────────────────────────────────────


          // Tonen van WebAudio beep — geen base64-blob (zou anders in HTML opzwellen)
          function beep(freq, duration) {
            try {
              const ctx = new (window.AudioContext || window.webkitAudioContext)();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = freq;
              osc.type = 'sine';
              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
              osc.start();
              osc.stop(ctx.currentTime + duration);
            } catch (e) { /* niet kritiek */ }
          }

          function fmtSeat(t) {
            const parts = [];
            if (t.seat_row && t.seat_number) parts.push('Rij ' + t.seat_row + ' · plaats ' + t.seat_number);
            if (t.categorie) parts.push(t.categorie);
            return parts.join(' — ');
          }

          function hideAllResults() {
            ['result-success','result-warning','result-error'].forEach(id => {
              document.getElementById(id).classList.add('hidden');
            });
          }

          async function validateTicket() {
            const input = document.getElementById('qr-input');
            const qrCode = input.value.trim();
            if (!qrCode) return;

            scanned++;
            document.getElementById('scanned-count').textContent = scanned;

            try {
              const response = await fetch('/api/admin/tickets/validate-qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_code: qrCode, concert_id: ${concertId} })
              });
              const data = await response.json();

              document.getElementById('result-container').classList.remove('hidden');
              hideAllResults();

              if (data.valid && data.status === 'checked_in') {
                valid++;
                document.getElementById('valid-count').textContent = valid;
                document.getElementById('result-success').classList.remove('hidden');
                const seatLine = fmtSeat(data.ticket);
                document.getElementById('ticket-details').innerHTML =
                  '<p><strong>Naam:</strong> ' + (data.ticket.koper_naam || '—') + '</p>' +
                  (seatLine ? '<p><strong>Plaats:</strong> ' + seatLine + '</p>' : '') +
                  '<p class="text-xs text-gray-500">Order ' + data.ticket.order_ref + '</p>';
                beep(880, 0.15);  // hoge ping
              } else if (data.valid && data.status === 'already_checked_in') {
                rescanned++;
                document.getElementById('rescan-count').textContent = rescanned;
                document.getElementById('result-warning').classList.remove('hidden');
                document.getElementById('warning-message').textContent = data.message;
                const seatLine = fmtSeat(data.ticket);
                document.getElementById('warning-details').innerHTML =
                  '<p><strong>Naam:</strong> ' + (data.ticket.koper_naam || '—') + '</p>' +
                  (seatLine ? '<p><strong>Plaats:</strong> ' + seatLine + '</p>' : '') +
                  '<p class="text-xs text-gray-500">Order ' + data.ticket.order_ref + '</p>';
                beep(440, 0.3);  // lage waarschuwingstoon
              } else {
                invalid++;
                document.getElementById('invalid-count').textContent = invalid;
                document.getElementById('result-error').classList.remove('hidden');
                document.getElementById('error-message').textContent = data.message || 'Onbekende fout';
                beep(220, 0.4);  // brom-toon
              }

              setTimeout(() => {
                input.value = '';
                input.focus();
                document.getElementById('result-container').classList.add('hidden');
              }, 3500);
            } catch (error) {
              alert('Fout bij validatie: ' + error.message);
            }
          }

          // Enter key handler
          document.getElementById('qr-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') validateTicket();
          });
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// QR CODE CHECK-IN API
// ==========================================
// Endpoint blijft /api/admin/tickets/validate-qr (compat met bestaande scan-UI)
// maar doet nu OOK de check-in: zet ticket_seats.checked_in_at op eerste scan,
// retourneert "al ingecheckt" op her-scan, error op ongeldig/onbetaald.
//
// QR-payload formaat (zie ticket-pdf.ts): "<tickets.qr_code>-<ticket_seats.id>"
// waar tickets.qr_code een UUID is (bevat zelf streepjes), dus we splitsen op
// de LAATSTE streepje. Voorbeeld: "5c4eadba-4748-4a28-9693-8aac7d7938ef-42"
//                                  └── qr_code (UUID) ──────────────────┘ └seat_id
app.post('/api/admin/tickets/validate-qr', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.json()
  const rawQr = String(body.qr_code || '').trim()
  const concertId = parseInt(String(body.concert_id || '0'), 10)

  if (!rawQr || !concertId) {
    return c.json({ valid: false, status: 'invalid', message: 'QR-code of concert ontbreekt' }, 400)
  }

  // Parse "<qr_code>-<ticket_seat_id>"
  const m = rawQr.match(/^(.+)-(\d+)$/)
  let qrCode: string
  let ticketSeatId: number | null = null
  if (m) {
    qrCode = m[1]
    ticketSeatId = parseInt(m[2], 10)
  } else {
    // Backwards-compat: oude QR zonder seat-suffix (per-order ticket)
    qrCode = rawQr
  }

  try {
    // Zoek ticket (controleer concert + status)
    const ticket = await queryOne<any>(c.env.DB, `
      SELECT t.id, t.order_ref, t.koper_naam, t.koper_email, t.aantal,
             t.categorie, t.status, t.concert_id
      FROM tickets t
      WHERE t.qr_code = ? AND t.concert_id = ?
    `, [qrCode, concertId])

    if (!ticket) {
      return c.json({
        valid: false,
        status: 'not_found',
        message: 'QR-code niet gevonden voor dit concert'
      })
    }

    if (ticket.status !== 'paid') {
      return c.json({
        valid: false,
        status: 'unpaid',
        message: `Ticket niet betaald (status: ${ticket.status})`,
        ticket: {
          order_ref: ticket.order_ref,
          koper_naam: ticket.koper_naam,
          categorie: ticket.categorie
        }
      })
    }

    // Vind de juiste ticket_seat-rij + seat-info
    let seatRow: any = null
    if (ticketSeatId !== null) {
      seatRow = await queryOne<any>(c.env.DB, `
        SELECT ts.id AS ticket_seat_id, ts.checked_in_at, ts.checked_in_by,
               s.section_name, s.row_label, s.seat_number
        FROM ticket_seats ts
        LEFT JOIN seats s ON s.id = ts.seat_id
        WHERE ts.id = ? AND ts.ticket_id = ? AND ts.concert_id = ?
      `, [ticketSeatId, ticket.id, concertId])

      if (!seatRow) {
        return c.json({
          valid: false,
          status: 'seat_mismatch',
          message: 'Zitplaats hoort niet bij dit ticket'
        })
      }
    }

    // RE-SCAN: al ingecheckt eerder?
    if (seatRow?.checked_in_at) {
      const when = seatRow.checked_in_at
      // Format als HH:MM:SS van de tijd
      const dt = new Date(when.includes('T') ? when : when.replace(' ', 'T') + 'Z')
      const hhmm = dt.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false })
      return c.json({
        valid: true,
        status: 'already_checked_in',
        message: `Al ingecheckt om ${hhmm}`,
        ticket: {
          order_ref: ticket.order_ref,
          koper_naam: ticket.koper_naam,
          categorie: ticket.categorie,
          seat_row: seatRow.row_label,
          seat_number: seatRow.seat_number,
          checked_in_at: when
        }
      })
    }

    // FIRST SCAN: zet check-in
    if (seatRow) {
      await execute(c.env.DB, `
        UPDATE ticket_seats
        SET checked_in_at = CURRENT_TIMESTAMP, checked_in_by = ?
        WHERE id = ?
      `, [user.id, seatRow.ticket_seat_id])
    } else {
      // Backwards-compat: oude QR zonder seat — markeer hele ticket
      await execute(c.env.DB, `
        UPDATE tickets SET gescand = 1, gescand_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [ticket.id])
    }

    return c.json({
      valid: true,
      status: 'checked_in',
      message: 'Welkom!',
      ticket: {
        order_ref: ticket.order_ref,
        koper_naam: ticket.koper_naam,
        koper_email: ticket.koper_email,
        aantal: ticket.aantal,
        categorie: ticket.categorie,
        seat_row: seatRow?.row_label || null,
        seat_number: seatRow?.seat_number || null
      }
    })
  } catch (error: any) {
    console.error('check-in error:', error)
    return c.json({ valid: false, status: 'error', message: error?.message || 'Server fout' }, 500)
  }
})

// ==========================================
// MANUAL CHECK-IN TOGGLE API
// ==========================================
// Voor papieren-ticket-randgevallen of als een scan misging.
// Body: { ticket_seat_id, checked_in: boolean }
app.post('/api/admin/tickets/manual-checkin', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.json()
  const ticketSeatId = parseInt(String(body.ticket_seat_id || '0'), 10)
  const checkedIn = !!body.checked_in

  if (!ticketSeatId) {
    return c.json({ success: false, error: 'ticket_seat_id ontbreekt' }, 400)
  }

  try {
    if (checkedIn) {
      await execute(c.env.DB, `
        UPDATE ticket_seats
        SET checked_in_at = CURRENT_TIMESTAMP, checked_in_by = ?
        WHERE id = ? AND checked_in_at IS NULL
      `, [user.id, ticketSeatId])
    } else {
      await execute(c.env.DB, `
        UPDATE ticket_seats
        SET checked_in_at = NULL, checked_in_by = NULL
        WHERE id = ?
      `, [ticketSeatId])
    }
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ success: false, error: error?.message }, 500)
  }
})

// ==========================================
// CHECK-IN STATUS — live aanwezigheidsoverzicht
// ==========================================
// Toont alle ticket_seats voor een concert: ingecheckt of niet, met stoel + koper.
// Bedoeld voor het bestuur aan de balie of de zaalverantwoordelijke.
app.get('/admin/tickets/concert/:concertId/checkin-status', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const filter = String(c.req.query('filter') || 'all') // all | checked | unchecked

  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.id, c.event_id, e.titel, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])

  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  // Eén query die alle betaalde ticket_seats geeft + koper + stoel + check-in tijd
  // Filter op concert_id én status='paid' (ticket-niveau) — pending/cancelled niet tonen.
  const rows = await queryAll<any>(c.env.DB, `
    SELECT
      ts.id AS ticket_seat_id,
      ts.checked_in_at,
      ts.checked_in_by,
      t.id AS ticket_id,
      t.order_ref,
      t.koper_naam,
      t.koper_email,
      t.categorie AS ticket_categorie,
      s.section_name,
      s.row_label,
      s.seat_number,
      COALESCE(substr(u.email, 1, instr(u.email, '@') - 1), u.email) AS checked_in_by_naam
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    LEFT JOIN seats s ON s.id = ts.seat_id
    LEFT JOIN users u ON u.id = ts.checked_in_by
    WHERE ts.concert_id = ?
      AND t.status = 'paid'
      AND ts.status IN ('reserved','paid','confirmed','sold')
    ORDER BY
      s.row_label ASC,
      CAST(s.seat_number AS INTEGER) ASC,
      t.koper_naam ASC
  `, [concertId])

  const total = rows.length
  const checkedIn = rows.filter((r: any) => r.checked_in_at).length
  const remaining = total - checkedIn
  const pct = total > 0 ? Math.round((checkedIn / total) * 100) : 0

  const filteredRows = filter === 'checked'
    ? rows.filter((r: any) => r.checked_in_at)
    : filter === 'unchecked'
    ? rows.filter((r: any) => !r.checked_in_at)
    : rows

  // Format checked_in_at als HH:MM
  function fmtCheckinTime(iso: string | null): string {
    if (!iso) return '—'
    const dt = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    return dt.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
  }

  return c.html(
    <Layout title={`Check-in status — ${concert.titel}`} user={user}>
      <div class="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav class="text-sm text-gray-600 mb-4" aria-label="Breadcrumb">
          <ol class="flex items-center flex-wrap gap-1">
            <li><a href="/admin" class="hover:text-animato-primary"><i class="fas fa-home mr-1"></i>Admin</a></li>
            <li class="text-gray-400">/</li>
            <li><a href="/admin/tickets" class="hover:text-animato-primary">Ticketbeheer</a></li>
            <li class="text-gray-400">/</li>
            <li><a href={`/admin/tickets/concert/${concertId}/settings`} class="hover:text-animato-primary">{concert.titel}</a></li>
            <li class="text-gray-400">/</li>
            <li class="text-gray-900 font-medium">Check-in status</li>
          </ol>
        </nav>

        {/* Header */}
        <div class="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 class="text-3xl font-bold text-animato-secondary mb-1" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-clipboard-check mr-3"></i>Check-in status
            </h1>
            <p class="text-gray-600">{concert.titel}</p>
            <p class="text-sm text-gray-500">
              {new Date(concert.start_at).toLocaleDateString('nl-NL', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })}
            </p>
          </div>
          <a href={`/admin/tickets/concert/${concertId}/scan`}
             class="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
            <i class="fas fa-qrcode"></i>
            QR-scanner openen
          </a>
        </div>

        {/* Stats hero */}
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div class="text-center">
              <div class="text-4xl font-bold text-gray-900">{total}</div>
              <div class="text-sm text-gray-600">Totaal verkocht</div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-green-600">{checkedIn}</div>
              <div class="text-sm text-gray-600">Ingecheckt</div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-amber-600">{remaining}</div>
              <div class="text-sm text-gray-600">Nog niet ingecheckt</div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-animato-primary">{pct}%</div>
              <div class="text-sm text-gray-600">Aanwezigheid</div>
            </div>
          </div>
          {/* Progress bar */}
          <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div class="bg-green-500 h-3 transition-all" style={`width: ${pct}%`}></div>
          </div>
        </div>

        {/* Filter tabs + auto-refresh hint */}
        <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div class="inline-flex rounded-lg overflow-hidden border border-gray-300">
            <a href={`/admin/tickets/concert/${concertId}/checkin-status?filter=all`}
               class={`px-4 py-2 text-sm ${filter === 'all' ? 'bg-animato-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              Alles ({total})
            </a>
            <a href={`/admin/tickets/concert/${concertId}/checkin-status?filter=unchecked`}
               class={`px-4 py-2 text-sm border-l border-gray-300 ${filter === 'unchecked' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              Nog niet ({remaining})
            </a>
            <a href={`/admin/tickets/concert/${concertId}/checkin-status?filter=checked`}
               class={`px-4 py-2 text-sm border-l border-gray-300 ${filter === 'checked' ? 'bg-green-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              Ingecheckt ({checkedIn})
            </a>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm text-gray-600 flex items-center gap-2">
              <input type="checkbox" id="auto-refresh" checked />
              Auto-refresh (10s)
            </label>
            <button onclick="location.reload()" class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded">
              <i class="fas fa-sync mr-1"></i>Nu verversen
            </button>
          </div>
        </div>

        {/* Search box */}
        <div class="mb-4">
          <input type="text" id="search-input" placeholder="Zoek op naam, order-ref of stoel..."
                 class="w-full border border-gray-300 rounded-lg px-4 py-2"
                 oninput="filterRows(this.value)" />
        </div>

        {/* Lijst */}
        {filteredRows.length === 0 ? (
          <div class="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            <i class="fas fa-inbox text-4xl mb-3 text-gray-300"></i>
            <p>Geen rijen om te tonen.</p>
          </div>
        ) : (
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stoel</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categorie</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Koper</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actie</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200" id="checkin-tbody">
                {filteredRows.map((r: any) => {
                  const seatText = r.row_label && r.seat_number
                    ? `Rij ${r.row_label} · ${r.seat_number}`
                    : '—'
                  const isCheckedIn = !!r.checked_in_at
                  const searchBlob = `${r.koper_naam || ''} ${r.koper_email || ''} ${r.order_ref || ''} ${seatText}`.toLowerCase()
                  return (
                    <tr class={`checkin-row ${isCheckedIn ? 'bg-green-50' : ''}`} data-search={searchBlob}>
                      <td class="px-4 py-3 text-sm font-medium text-gray-900">{seatText}</td>
                      <td class="px-4 py-3 text-sm text-gray-700">{r.ticket_categorie || '—'}</td>
                      <td class="px-4 py-3 text-sm">
                        <div class="text-gray-900">{r.koper_naam || '—'}</div>
                        <div class="text-xs text-gray-500">{r.koper_email || ''}</div>
                      </td>
                      <td class="px-4 py-3 text-sm font-mono text-xs text-gray-600">{r.order_ref}</td>
                      <td class="px-4 py-3 text-sm">
                        {isCheckedIn ? (
                          <span class="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">
                            <i class="fas fa-check"></i>
                            {fmtCheckinTime(r.checked_in_at)}
                            {r.checked_in_by_naam && <span class="text-green-600">· {r.checked_in_by_naam}</span>}
                          </span>
                        ) : (
                          <span class="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">
                            <i class="far fa-clock"></i>
                            Wacht
                          </span>
                        )}
                      </td>
                      <td class="px-4 py-3 text-right text-sm">
                        {isCheckedIn ? (
                          <button onclick={`toggleCheckin(${r.ticket_seat_id}, false, this)`}
                                  class="text-xs text-amber-700 hover:text-amber-900 hover:underline">
                            <i class="fas fa-undo mr-1"></i>Ongedaan
                          </button>
                        ) : (
                          <button onclick={`toggleCheckin(${r.ticket_seat_id}, true, this)`}
                                  class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded">
                            <i class="fas fa-check mr-1"></i>Inchecken
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <script dangerouslySetInnerHTML={{ __html: `
          // Live search filter (client-side, geen extra request)
          function filterRows(query) {
            const q = (query || '').toLowerCase().trim();
            document.querySelectorAll('.checkin-row').forEach(row => {
              const blob = row.getAttribute('data-search') || '';
              row.style.display = (!q || blob.indexOf(q) !== -1) ? '' : 'none';
            });
          }

          // Manual check-in toggle
          async function toggleCheckin(ticketSeatId, checkedIn, btn) {
            btn.disabled = true;
            const oldHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
              const r = await fetch('/api/admin/tickets/manual-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticket_seat_id: ticketSeatId, checked_in: checkedIn })
              });
              const data = await r.json();
              if (!data.success) {
                alert('Fout: ' + (data.error || 'onbekend'));
                btn.innerHTML = oldHtml;
                btn.disabled = false;
                return;
              }
              // Refresh pagina om stats + sortering te updaten
              location.reload();
            } catch (e) {
              alert('Netwerkfout: ' + e.message);
              btn.innerHTML = oldHtml;
              btn.disabled = false;
            }
          }

          // Auto-refresh elke 10s, behalve als de gebruiker aan het zoeken is
          let autoRefreshTimer = null;
          function startAutoRefresh() {
            stopAutoRefresh();
            autoRefreshTimer = setInterval(() => {
              const search = document.getElementById('search-input').value.trim();
              if (search === '') location.reload();
            }, 10000);
          }
          function stopAutoRefresh() {
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
          }
          document.getElementById('auto-refresh').addEventListener('change', (e) => {
            if (e.target.checked) startAutoRefresh(); else stopAutoRefresh();
          });
          startAutoRefresh();
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// PHASE 4: MOLLIE TICKET-FLOW TEST-CHECKLIST
// ==========================================
// Statische pagina met stappenplan + diagnostiek-links zodat een bestuurder
// snel een live test-aankoop kan doen en de gezondheid van de flow kan checken.
app.get('/admin/tickets/test-checklist', async (c) => {
  const user = c.get('user') as SessionUser
  const db = c.env.DB

  // Verzamel diagnostiek-info live
  const mollieMode = getMollieMode(await getMollieApiKey(c.env))
  const webhookCalls24h = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM mollie_webhook_log WHERE created_at >= datetime('now', '-1 day')`)
  const errors24h = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM mollie_webhook_log
     WHERE created_at >= datetime('now', '-1 day') AND (http_status >= 400 OR error_message IS NOT NULL)`)
  const pendingTickets = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM tickets WHERE status = 'pending' AND created_at >= datetime('now', '-1 day')`)
  const staleLocks = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM ticket_seats WHERE status = 'locked' AND lock_expires_at < CURRENT_TIMESTAMP`)
  const upcomingConcerts = await queryAll<any>(db,
    `SELECT c.id, e.titel, e.start_at, c.ticketing_enabled
     FROM concerts c JOIN events e ON e.id = c.event_id
     WHERE e.start_at >= datetime('now') AND c.ticketing_enabled = 1
     ORDER BY e.start_at ASC LIMIT 5`)

  const checks = [
    {
      ok: mollieMode === 'live',
      label: 'Mollie staat in LIVE-mode',
      detail: mollieMode === 'live'
        ? 'Live-key actief — echte betalingen mogelijk'
        : `Mode is "${mollieMode}" — Mollie test-mode geeft géén echt geld`,
      action: { label: 'Beheer Mollie keys', href: '/admin/settings#mollie' }
    },
    {
      ok: (webhookCalls24h?.n || 0) > 0,
      label: 'Mollie webhook-calls ontvangen in de laatste 24u',
      detail: `${webhookCalls24h?.n || 0} calls vandaag, ${errors24h?.n || 0} errors`,
      action: { label: 'Bekijk webhook-log', href: '/admin/mollie-webhook-log' }
    },
    {
      ok: (errors24h?.n || 0) === 0,
      label: 'Geen webhook-errors',
      detail: (errors24h?.n || 0) === 0 ? 'Alle calls 2xx' : `${errors24h?.n} errors — actie nodig`,
      action: { label: 'Bekijk errors', href: '/admin/mollie-webhook-log' }
    },
    {
      ok: (pendingTickets?.n || 0) < 5,
      label: 'Weinig pending tickets',
      detail: `${pendingTickets?.n || 0} pending in laatste 24u`,
      action: { label: 'Bekijk tickets', href: '/admin/tickets' }
    },
    {
      ok: (staleLocks?.n || 0) === 0,
      label: 'Geen verlopen seat-locks (worden auto opgeruimd)',
      detail: `${staleLocks?.n || 0} stale locks — worden automatisch opgeruimd bij volgende seat-listing`,
      action: null
    },
    {
      ok: upcomingConcerts && upcomingConcerts.length > 0,
      label: 'Minstens één concert heeft ticketverkoop open',
      detail: upcomingConcerts && upcomingConcerts.length > 0
        ? `${upcomingConcerts.length} concert(en) actief`
        : 'Geen concerten met open ticketverkoop',
      action: { label: 'Beheer concerten', href: '/admin/tickets' }
    }
  ]
  const allGreen = checks.every(c => c.ok)

  return c.html(
    <Layout title="Ticket-flow test-checklist" user={user}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <nav class="text-sm text-gray-600 mb-4">
          <a href="/admin" class="hover:underline"><i class="fas fa-home mr-1"></i>Admin</a>
          <span class="mx-2">/</span>
          <a href="/admin/tickets" class="hover:underline">Ticketbeheer</a>
          <span class="mx-2">/</span>
          <span class="text-gray-900 font-medium">Test-checklist</span>
        </nav>

        <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
          <i class="fas fa-vial mr-2"></i>Ticket-flow test-checklist
        </h1>
        <p class="text-gray-600 mb-6">Lopen voor je een echte testbetaling met je eigen kaart doet.</p>

        <div class={`p-4 mb-6 rounded-lg border-2 ${allGreen ? 'bg-green-50 border-green-400' : 'bg-yellow-50 border-yellow-400'}`}>
          <p class="font-semibold">
            {allGreen ? (
              <><i class="fas fa-check-circle text-green-600 mr-2"></i>Alle checks groen — je kan veilig testen</>
            ) : (
              <><i class="fas fa-exclamation-triangle text-yellow-700 mr-2"></i>Niet alles groen — los eerst onderstaande items op</>
            )}
          </p>
        </div>

        <div class="bg-white rounded-lg shadow-md overflow-hidden mb-8">
          <h2 class="bg-gray-50 px-4 py-3 font-semibold text-gray-800 border-b">Diagnostiek (live)</h2>
          <ul class="divide-y divide-gray-100">
            {checks.map((chk: any) => (
              <li class="px-4 py-3 flex items-center justify-between gap-4">
                <div class="flex items-start gap-3 flex-1">
                  <i class={`fas mt-1 ${chk.ok ? 'fa-check-circle text-green-600' : 'fa-times-circle text-red-600'}`}></i>
                  <div>
                    <div class="font-medium text-gray-900">{chk.label}</div>
                    <div class="text-sm text-gray-600">{chk.detail}</div>
                  </div>
                </div>
                {chk.action && (
                  <a href={chk.action.href} class="text-sm text-animato-primary hover:underline whitespace-nowrap">{chk.action.label} →</a>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div class="bg-white rounded-lg shadow-md overflow-hidden mb-8">
          <h2 class="bg-gray-50 px-4 py-3 font-semibold text-gray-800 border-b">Test-scenario (~5 min)</h2>
          <ol class="px-6 py-4 space-y-3 list-decimal list-inside text-gray-800">
            <li><strong>Open een privé venster</strong> (anders ben je nog ingelogd als admin)</li>
            <li>Ga naar <code class="bg-gray-100 px-1 rounded">/concerten</code> en kies een concert met ticketverkoop open</li>
            <li>Klik op een stoel (of kies aantal bij vrije zit) en klik <em>Bestellen</em></li>
            <li>Vul je gegevens in en betaal met een <strong>echte kaart</strong> (Mollie test-betalingen lopen anders)</li>
            <li>Na betaling: kom terug op <code class="bg-gray-100 px-1 rounded">/tickets/bevestiging/...</code></li>
            <li>Wacht ~10 sec en herlaad — status moet "Betaald" tonen, e-mail moet binnenkomen</li>
            <li>Check <a href="/admin/mollie-webhook-log" class="text-animato-primary hover:underline">webhook log</a> — je payment-ID moet er staan met <code class="bg-green-100 px-1 rounded">200 paid</code></li>
            <li>Open <a href="/admin/tickets" class="text-animato-primary hover:underline">/admin/tickets</a> → concert → <em>Zaalplan-view</em>: je stoel staat rood (verkocht)</li>
          </ol>
        </div>

        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 class="font-semibold text-blue-900 mb-2"><i class="fas fa-info-circle mr-2"></i>Als iets faalt</h3>
          <ul class="text-sm text-blue-900 list-disc list-inside space-y-1">
            <li><strong>Bevestigingspagina blijft "Pending":</strong> kijk in webhook-log of de payment-ID daar staat. Zo niet → Mollie bereikt ons niet (DNS/firewall/wrong URL).</li>
            <li><strong>Wel paid maar stoel blijft locked:</strong> bug in webhook handler (Phase 4 fix moet dit oplossen — als het toch gebeurt, check audit_logs).</li>
            <li><strong>Geen bevestigingsmail:</strong> check RESEND_API_KEY in admin-instellingen.</li>
            <li><strong>Stoel toont nog "locked" 15 min later:</strong> auto-cleanup verwijdert ze bij volgende seat-listing. Of forceer via "Zaalplan-view" → vrijgeven.</li>
          </ul>
        </div>
      </div>
    </Layout>
  )
})

// ==========================================
// PHASE 4: ZAALPLAN PER CONCERT - "WIE ZIT WAAR"
// ==========================================
// Toont per concert het volledige zaalplan met live bezetting:
// - Beschikbare stoelen (groen/blauw)
// - Gelockte stoelen (oranje, met aftellen)
// - Verkochte stoelen (rood, met koper-info bij hover/klik)
// Admin kan stoelen handmatig blokkeren (vb. papieren reservatie) of vrijgeven.
app.get('/admin/tickets/concert/:concertId/zaalplan', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))

  // Ruim stale locks op vooraleer we de view tonen
  await releaseStaleLocks(c.env.DB, concertId)

  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie, sp.name as plan_naam
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN seating_plans sp ON sp.id = c.seating_plan_id
    WHERE c.id = ?
  `, [concertId])

  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  if (!concert.seating_plan_id) {
    return c.html(
      <Layout title={`Zaalplan - ${concert.titel}`} user={user}>
        <div class="max-w-4xl mx-auto px-4 py-8">
          <nav class="text-sm text-gray-600 mb-4">
            <a href="/admin/tickets" class="hover:underline">Ticketbeheer</a>
            <span class="mx-2">/</span>
            <a href={`/admin/tickets/concert/${concertId}/settings`} class="hover:underline">{concert.titel}</a>
            <span class="mx-2">/</span>
            <span class="text-gray-900">Zaalplan</span>
          </nav>
          <div class="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded">
            <h2 class="text-xl font-bold text-yellow-800 mb-2">
              <i class="fas fa-exclamation-triangle mr-2"></i>
              Geen zaalplan gekoppeld
            </h2>
            <p class="text-gray-700 mb-4">Dit concert gebruikt geen genummerde stoelen (vrije zit of staanplaatsen).</p>
            <a href={`/admin/tickets/concert/${concertId}/settings`} class="inline-block bg-animato-primary text-white px-4 py-2 rounded hover:bg-opacity-90">
              <i class="fas fa-cog mr-1"></i> Koppel een zaalplan in instellingen
            </a>
          </div>
        </div>
      </Layout>
    )
  }

  // Alle stoelen + huidige status voor dit concert + koper-info
  // ts.id (ticket_seat_id) wordt gebruikt voor per-stoel PDF-download.
  const seats = await queryAll<any>(c.env.DB, `
    SELECT
      s.id, s.row_label, s.seat_number, s.x, s.y, s.type, s.status as base_status,
      ts.id as ticket_seat_id,
      ts.status as booking_status,
      ts.lock_expires_at,
      ts.note as admin_note,
      ts.created_by_user_id,
      t.id as ticket_id,
      t.order_ref,
      t.koper_naam,
      t.koper_email,
      t.status as ticket_status,
      t.categorie
    FROM seats s
    LEFT JOIN ticket_seats ts ON ts.seat_id = s.id AND ts.concert_id = ? AND ts.status IN ('locked', 'sold')
    LEFT JOIN tickets t ON t.id = ts.ticket_id
    WHERE s.plan_id = ?
    ORDER BY s.row_label, s.seat_number
  `, [concertId, concert.seating_plan_id])

  // Tellingen
  const total = seats.length
  const sold = seats.filter(s => s.booking_status === 'sold').length
  const locked = seats.filter(s => s.booking_status === 'locked').length
  const blocked = seats.filter(s => s.base_status === 'blocked' && !s.booking_status).length
  const available = total - sold - locked - blocked
  // Bezettingspercentage (optie B per keuze: % van ALLE stoelen op het plan, sold-only)
  // Reserved telt apart eronder.
  const bezettingPct = total > 0 ? Math.round((sold / total) * 100) : 0
  const reservedPct = total > 0 ? Math.round((locked / total) * 100) : 0

  return c.html(
    <Layout title={`Zaalplan - ${concert.titel}`} user={user}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        <nav class="text-sm text-gray-600 mb-4">
          <a href="/admin" class="hover:underline"><i class="fas fa-home mr-1"></i>Admin</a>
          <span class="mx-2">/</span>
          <a href="/admin/tickets" class="hover:underline">Ticketbeheer</a>
          <span class="mx-2">/</span>
          <a href={`/admin/tickets/concert/${concertId}/settings`} class="hover:underline">{concert.titel}</a>
          <span class="mx-2">/</span>
          <span class="text-gray-900 font-medium">Zaalplan</span>
        </nav>

        <div class="mb-6">
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            Zaalplan: {concert.titel}
          </h1>
          <div class="flex flex-wrap gap-4 text-gray-600 text-sm">
            <span><i class="fas fa-calendar mr-2"></i>{new Date(concert.start_at).toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span><i class="fas fa-map-marker-alt mr-2"></i>{concert.locatie}</span>
            <span><i class="fas fa-chair mr-2"></i>{concert.plan_naam}</span>
          </div>
        </div>

        {/* Bezettings-progressbar — prominent bovenaan */}
        <div class="bg-white rounded-lg shadow p-4 mb-4">
          <div class="flex items-center justify-between mb-2">
            <div>
              <span class="text-sm font-semibold text-gray-700">Bezetting van de zaal</span>
              <span class="text-xs text-gray-500 ml-2">({sold} van {total} stoelen verkocht)</span>
            </div>
            <div class="text-right">
              <span class={`text-3xl font-bold ${bezettingPct >= 90 ? 'text-red-600' : bezettingPct >= 70 ? 'text-orange-600' : bezettingPct >= 40 ? 'text-amber-600' : 'text-green-600'}`}>
                {bezettingPct}%
              </span>
              {locked > 0 && (
                <span class="text-xs text-orange-600 ml-2">
                  +{reservedPct}% gereserveerd
                </span>
              )}
            </div>
          </div>
          {/* Stacked progress bar: verkocht (rood) + gereserveerd (oranje, gestreept) op een grijze achtergrond */}
          <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden relative">
            <div
              class="h-3 bg-red-500 absolute left-0 top-0 transition-all"
              style={`width: ${bezettingPct}%`}
              title={`Verkocht: ${sold}`}
            ></div>
            <div
              class="h-3 bg-orange-400 absolute top-0 transition-all"
              style={`left: ${bezettingPct}%; width: ${reservedPct}%; background-image: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,.3) 4px, rgba(255,255,255,.3) 8px);`}
              title={`Gereserveerd: ${locked}`}
            ></div>
          </div>
          {bezettingPct >= 90 && (
            <div class="mt-2 text-xs text-red-700 font-semibold">
              <i class="fas fa-fire mr-1"></i> Zaal bijna vol — denk eraan om "Uitverkocht" te markeren in de instellingen.
            </div>
          )}
        </div>

        {/* Telling-cards */}
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-gray-600">Totaal</div><div class="text-2xl font-bold text-gray-900">{total}</div></div>
          <div class="bg-green-50 rounded-lg shadow p-3"><div class="text-xs text-gray-700">Beschikbaar</div><div class="text-2xl font-bold text-green-700">{available}</div></div>
          <div class="bg-red-50 rounded-lg shadow p-3"><div class="text-xs text-gray-700">Verkocht</div><div class="text-2xl font-bold text-red-700">{sold}</div></div>
          <div class="bg-orange-50 rounded-lg shadow p-3"><div class="text-xs text-gray-700">Gereserveerd</div><div class="text-2xl font-bold text-orange-700">{locked}</div></div>
          <div class="bg-gray-100 rounded-lg shadow p-3"><div class="text-xs text-gray-700">Geblokkeerd</div><div class="text-2xl font-bold text-gray-700">{blocked}</div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Zaalplan visualisatie */}
          <div class="lg:col-span-3">
            <div class="bg-white rounded-lg shadow-md p-4">
              <div class="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h2 class="font-semibold text-gray-900"><i class="fas fa-map mr-2 text-gray-500"></i>Klik op een stoel voor details</h2>
                <div class="flex gap-3 text-xs items-center flex-wrap">
                  <span class="flex items-center" title="Deze stoel is beschikbaar voor verkoop.">
                    <span class="inline-block w-3 h-3 bg-blue-500 rounded-sm mr-1"></span>Beschikbaar
                  </span>
                  <span class="flex items-center" title="Een klant heeft deze stoel tijdelijk in zijn bestelling zitten (nog niet betaald). Vervalt automatisch als de bestelling niet wordt afgerond.">
                    <span class="inline-block w-3 h-3 bg-orange-500 rounded-sm mr-1"></span>Gereserveerd
                  </span>
                  <span class="flex items-center" title="Deze stoel is verkocht en betaald.">
                    <span class="inline-block w-3 h-3 bg-red-600 rounded-sm mr-1"></span>Verkocht
                  </span>
                  <span class="flex items-center" title="Admin heeft deze stoel permanent uitgezet (bv. defect, kolom in de weg, gereserveerd voor gasten). Klik op de stoel om te (de)blokkeren.">
                    <span class="inline-block w-3 h-3 bg-gray-400 rounded-sm mr-1"></span>Geblokkeerd
                  </span>
                  <button
                    id="bulkModeBtn"
                    type="button"
                    onclick="toggleBulkMode()"
                    class="ml-2 px-3 py-1 text-xs font-semibold rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    title="Schakelt bulk-modus aan: elke klik op een vrije stoel selecteert hem voor een fysieke verkoop."
                  >
                    <i class="fas fa-hand-pointer mr-1"></i>Bulk-modus
                  </button>
                </div>
              </div>
              <div class="text-xs text-gray-500 mb-2">
                <i class="fas fa-info-circle mr-1 text-gray-400"></i>
                Voor <strong>fysieke verkoop</strong>: hou <kbd class="px-1 border rounded bg-gray-100">Shift</kbd>/<kbd class="px-1 border rounded bg-gray-100">Ctrl</kbd>/<kbd class="px-1 border rounded bg-gray-100">⌘</kbd> ingedrukt en klik meerdere vrije stoelen aan — of activeer Bulk-modus hierboven.
              </div>
              {/* Frame: flex-centered, geen scrollbars meer. JS schaalt automatisch
                  zodat het hele zaalplan past binnen de beschikbare breedte. */}
              <div
                id="seatMapFrame"
                class="border border-gray-200 rounded bg-gradient-to-b from-gray-50 to-gray-100 overflow-hidden flex items-center justify-center p-4"
                style="min-height: 500px;"
              >
                <div id="seatMapScale" style="transform-origin: center center; transition: transform .15s ease;">
                  <div id="seatMap" class="relative bg-white shadow-inner" style="width: 1200px; height: 800px;">
                    {/* PODIUM-element: prominente balk bovenaan zoals een echt podium in een zaal.
                        data-static markeert dit element zodat render() het niet weggooit bij re-render.
                        Z-index 10 zodat hij boven andere elementen blijft, maar onder geselecteerde stoel (z-20). */}
                    <div
                      data-static="true"
                      class="absolute top-0 left-0 w-full text-white text-center font-bold tracking-[0.3em] uppercase text-sm shadow-lg"
                      style="background: linear-gradient(180deg, #1F2937 0%, #374151 50%, #1F2937 100%); padding: 10px 0; border-bottom: 3px solid #F59E0B; z-index: 10;"
                    >
                      <i class="fas fa-music mr-2 text-amber-400"></i>
                      PODIUM / SCHERM
                      <i class="fas fa-music ml-2 text-amber-400"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Detail-panel */}
          <div class="lg:col-span-1">
            <div id="seat-detail" class="bg-white rounded-lg shadow-md p-4 sticky top-4">
              <div class="text-sm text-gray-500 text-center py-8">
                <i class="fas fa-hand-pointer text-3xl mb-2 block"></i>
                Selecteer een stoel
              </div>
            </div>
          </div>
        </div>

        {/* Floating bulk-action bar — verschijnt zodra ≥1 stoel geselecteerd is via Shift/Ctrl/⌘+klik of Bulk-modus.
            Bedoeld voor fysieke kaartverkoop: admin/bestuur reserveert meerdere stoelen tegelijk voor 1 koper. */}
        <div
          id="bulkActionBar"
          class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white rounded-xl shadow-2xl hidden z-50"
          style="min-width: 340px;"
        >
          <div class="flex items-center gap-3 px-5 py-3 flex-wrap">
            <div class="flex items-center">
              <i class="fas fa-shopping-cart text-xl mr-2 text-blue-200"></i>
              <div>
                <div class="text-xs uppercase tracking-wider text-blue-200">Fysieke verkoop</div>
                <div class="font-bold text-lg leading-tight">
                  <span id="bulkCount">0</span>
                  <span id="bulkCountLabel">stoel</span> geselecteerd
                </div>
              </div>
            </div>
            <div class="flex gap-2 ml-2">
              <button
                type="button"
                onclick="bulkReserve()"
                class="bg-white text-blue-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-50 shadow"
              >
                <i class="fas fa-check-circle mr-1"></i>Reserveer voor 1 koper
              </button>
              <button
                type="button"
                onclick="clearBulk()"
                class="bg-blue-700 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-800 border border-blue-500"
                title="Wis selectie"
              >
                <i class="fas fa-times mr-1"></i>Wis
              </button>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        const seats = ${JSON.stringify(seats)};
        const concertId = ${concertId};
        const SEATING_PLAN_ID = ${concert.seating_plan_id || 'null'};
        const map = document.getElementById('seatMap');
        const detail = document.getElementById('seat-detail');
        let selected = null;
        // Bulk-selectie voor fysieke-kaartverkoop: meerdere vrije stoelen aanvinken
        // voor 1 koper. Activeer via Shift/Ctrl/⌘+klik, of klik in "bulk-mode" (toggle-knop)
        const bulkSelection = new Set();
        let bulkMode = false;

        function colorFor(s) {
          if (s.booking_status === 'sold') return { bg: '#DC2626', fg: 'white' };
          if (s.booking_status === 'locked') return { bg: '#F97316', fg: 'white' };
          if (s.base_status === 'blocked') return { bg: '#9CA3AF', fg: 'white' };
          if (s.type === 'wheelchair') return { bg: '#10B981', fg: 'white' };
          return { bg: '#3B82F6', fg: 'white' };
        }

        function toExcelLetter(idx) {
          let s = '';
          let n = idx;
          while (n >= 0) {
            s = String.fromCharCode(65 + (n % 26)) + s;
            n = Math.floor(n / 26) - 1;
          }
          return s;
        }

        function render() {
          // Verwijder enkel onze dynamische elementen, niet het podium (heeft data-static)
          // Markeer alle bestaande children zonder data-static om opgeruimd te worden
          Array.from(map.children).forEach(child => {
            if (!child.hasAttribute('data-static')) child.remove();
          });
          // Eerst rij-labels berekenen (gebaseerd op unieke y-posities, sorted)
          map.style.overflow = 'visible';
          const yMap = {};
          seats.forEach(seat => {
            const k = seat.y;
            if (!yMap[k]) yMap[k] = { minX: seat.x, maxX: seat.x, lbl: seat.row_label || '' };
            if (seat.x < yMap[k].minX) yMap[k].minX = seat.x;
            if (seat.x > yMap[k].maxX) yMap[k].maxX = seat.x;
            if (!yMap[k].lbl && seat.row_label) yMap[k].lbl = seat.row_label;
          });
          const sortedYs = Object.keys(yMap).map(Number).sort((a, b) => a - b);
          sortedYs.forEach((y, idx) => {
            const g = yMap[y];
            const lbl = g.lbl || toExcelLetter(idx);
            const sharedStyle = 'top:' + (y + 4) + 'px;'
              + 'background:rgba(255,255,255,.95);padding:2px 6px;border-radius:4px;'
              + 'border:1px solid #cbd5e1;letter-spacing:.05em;z-index:5;'
              + 'min-width:24px;text-align:center;line-height:1.1;font-size:11px;';
            // Links
            const leftTag = document.createElement('div');
            leftTag.className = 'absolute font-bold text-gray-700 pointer-events-none';
            leftTag.style.cssText = 'left:' + (g.minX - 38) + 'px;' + sharedStyle;
            leftTag.innerText = lbl;
            map.appendChild(leftTag);
            // Rechts
            const rightTag = document.createElement('div');
            rightTag.className = 'absolute font-bold text-gray-700 pointer-events-none';
            rightTag.style.cssText = 'left:' + (g.maxX + 32 + 6) + 'px;' + sharedStyle;
            rightTag.innerText = lbl;
            map.appendChild(rightTag);
          });

          // ── Gang tussen rij B en C — enkel voor cc Binder (plan_id = 1) ──
          if (SEATING_PLAN_ID === 1) {
            const yBEntry = Object.entries(yMap).find(function(e) { return e[1].lbl === 'B'; });
            const yCEntry = Object.entries(yMap).find(function(e) { return e[1].lbl === 'C'; });
            if (yBEntry && yCEntry) {
              const yBn = Number(yBEntry[0]);
              const yCn = Number(yCEntry[0]);
              const yMid = yBn + (yCn - yBn) / 2 + 16;
              let minX = Infinity, maxX = -Infinity;
              Object.values(yMap).forEach(function(g) {
                if (g.minX < minX) minX = g.minX;
                if (g.maxX > maxX) maxX = g.maxX;
              });
              const aisleW = (maxX + 32) - minX;
              const aisle = document.createElement('div');
              aisle.className = 'absolute pointer-events-none';
              aisle.setAttribute('data-static', 'true');
              aisle.style.cssText = 'left:' + minX + 'px;top:' + (yMid - 10) + 'px;'
                + 'width:' + aisleW + 'px;height:20px;z-index:3;'
                + 'border-top:2px dashed #94a3b8;border-bottom:2px dashed #94a3b8;'
                + 'background:repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 6px,#e2e8f0 6px,#e2e8f0 12px);'
                + 'display:flex;align-items:center;justify-content:center;';
              const lblG = document.createElement('span');
              lblG.innerHTML = '<i class="fas fa-walking" style="margin-right:6px"></i>GANG';
              lblG.style.cssText = 'background:#fff;padding:1px 10px;border:1px solid #94a3b8;'
                + 'border-radius:10px;font-size:10px;font-weight:bold;color:#475569;'
                + 'letter-spacing:.1em;';
              aisle.appendChild(lblG);
              map.appendChild(aisle);
            }
          }

          // Stoelen renderen
          seats.forEach(seat => {
            const el = document.createElement('div');
            el.className = 'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-[10px] font-bold shadow-sm cursor-pointer hover:scale-110 transition-transform';
            el.style.left = seat.x + 'px';
            el.style.top = seat.y + 'px';
            el.innerText = seat.seat_number;
            const c = colorFor(seat);
            el.style.backgroundColor = c.bg;
            el.style.color = c.fg;
            el.title = (seat.row_label || '') + '-' + seat.seat_number + (seat.koper_naam ? ' — ' + seat.koper_naam : '');
            const isBulkPicked = bulkSelection.has(seat.id);
            if (isBulkPicked) {
              el.style.outline = '3px solid #2563EB';
              el.style.outlineOffset = '1px';
              el.style.zIndex = '15';
              // Checkmark overlay
              const check = document.createElement('div');
              check.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#2563EB;color:white;width:14px;height:14px;border-radius:50%;font-size:9px;display:flex;align-items:center;justify-content:center;font-weight:bold;box-shadow:0 0 0 2px white;';
              check.innerHTML = '<i class="fas fa-check" style="font-size:7px"></i>';
              el.appendChild(check);
            } else if (selected && selected.id === seat.id) {
              el.style.outline = '3px solid #F59E0B';
              el.style.outlineOffset = '1px';
              el.style.zIndex = '20';
            }
            el.onclick = (ev) => {
              // Bulk-toggle: Shift/Ctrl/⌘+klik OF bulk-mode aan, en enkel voor vrije stoelen
              const isFree = !seat.booking_status && seat.base_status !== 'blocked';
              const wantsBulk = ev.shiftKey || ev.ctrlKey || ev.metaKey || bulkMode;
              if (wantsBulk && isFree) {
                if (bulkSelection.has(seat.id)) bulkSelection.delete(seat.id);
                else bulkSelection.add(seat.id);
                render();
                updateBulkBar();
                return;
              }
              selected = seat;
              render();
              showDetail(seat);
            };
            map.appendChild(el);
          });
          updateBulkBar();
        }

        // ── Auto-fit zaalplan binnen het frame, vergelijkbaar met publieke ticketpagina ──
        const frame = document.getElementById('seatMapFrame');
        const scale = document.getElementById('seatMapScale');
        const PLAN_W = 1200, PLAN_H = 800;
        // Bereken bounding box van werkelijke stoelen + label-marge
        function computeBbox() {
          if (!seats || seats.length === 0) return { minX: 0, minY: 0, maxX: PLAN_W, maxY: PLAN_H };
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          seats.forEach(s => {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x + 32 > maxX) maxX = s.x + 32;
            if (s.y + 32 > maxY) maxY = s.y + 32;
          });
          // Ruimte voor rij-labels links/rechts + podium-balk bovenaan
          return { minX: minX - 44, minY: 0, maxX: maxX + 44, maxY: maxY };
        }
        const bbox = computeBbox();
        const contentW = Math.max(50, bbox.maxX - bbox.minX);
        const contentH = Math.max(50, bbox.maxY - bbox.minY);
        function fitSeatMap() {
          if (!frame || !scale) return;
          const pad = 32;
          const availW = Math.max(50, frame.clientWidth - pad);
          const maxFrameH = Math.max(500, Math.round(window.innerHeight * 0.75));
          let s = availW / contentW;
          if (contentH * s + pad > maxFrameH) s = (maxFrameH - pad) / contentH;
          s = Math.max(0.15, Math.min(s, 1.5));
          // Translate zodat bbox-centrum samenvalt met plan-centrum
          const cxBbox = (bbox.minX + bbox.maxX) / 2;
          const cyBbox = (bbox.minY + bbox.maxY) / 2;
          const tx = (PLAN_W / 2) - cxBbox;
          const ty = (PLAN_H / 2) - cyBbox;
          scale.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
          const neededH = Math.max(500, Math.ceil(contentH * s) + pad);
          frame.style.height = Math.min(neededH, maxFrameH) + 'px';
        }
        window.addEventListener('resize', fitSeatMap);
        setTimeout(fitSeatMap, 50);
        setTimeout(fitSeatMap, 250);

        function showDetail(s) {
          const status = s.booking_status === 'sold' ? 'Verkocht'
                       : s.booking_status === 'locked' ? 'Gereserveerd (klant bezig met bestellen)'
                       : s.base_status === 'blocked' ? 'Geblokkeerd door admin'
                       : 'Beschikbaar';
          let html = '<div class="border-b pb-3 mb-3"><div class="text-xs text-gray-500 uppercase">Stoel</div><div class="text-2xl font-bold">' + (s.row_label || '?') + '-' + s.seat_number + '</div><div class="text-sm text-gray-600 mt-1">Type: ' + (s.type || 'standard') + '</div></div>';
          html += '<div class="mb-3"><div class="text-xs text-gray-500 uppercase mb-1">Status</div><div class="font-semibold">' + status + '</div>';
          if (s.booking_status === 'locked' && s.lock_expires_at) {
            html += '<div class="text-xs text-orange-700 mt-1">Vervalt: ' + new Date(s.lock_expires_at.replace(' ', 'T') + 'Z').toLocaleTimeString('nl-NL') + '</div>';
          }
          html += '</div>';
          if (s.koper_naam) {
            html += '<div class="mb-3 bg-gray-50 rounded p-2"><div class="text-xs text-gray-500 uppercase mb-1">Koper</div><div class="font-medium text-sm">' + escapeHtml(s.koper_naam) + '</div><div class="text-xs text-gray-600">' + escapeHtml(s.koper_email || '') + '</div>';
            if (s.order_ref) html += '<div class="text-xs text-gray-500 mt-1 font-mono">' + s.order_ref + '</div>';
            if (s.categorie) html += '<div class="text-xs text-gray-600">' + escapeHtml(s.categorie) + '</div>';
            html += '</div>';
          }
          if (s.admin_note) {
            html += '<div class="mb-3 bg-yellow-50 border border-yellow-200 rounded p-2"><div class="text-xs text-gray-600 uppercase mb-1">Notitie</div><div class="text-sm">' + escapeHtml(s.admin_note) + '</div></div>';
          }
          // Actie-knoppen
          html += '<div class="space-y-2 pt-2 border-t">';
          if (!s.booking_status && s.base_status !== 'blocked') {
            html += '<button onclick="manualReserve(' + s.id + ')" class="w-full bg-orange-500 text-white text-sm px-3 py-2 rounded hover:bg-orange-600"><i class="fas fa-bookmark mr-1"></i>Handmatig reserveren</button>';
          }
          // PDF-download knop voor verkochte EN gereserveerde stoelen met ticket_seat_id
          // (admin kan dan rechtstreeks via WhatsApp/mail doorsturen)
          if (s.ticket_seat_id && (s.booking_status === 'sold' || s.booking_status === 'locked')) {
            html += '<a href="/admin/tickets/concert/' + concertId + '/seat-pdf/' + s.ticket_seat_id
                  + '" target="_blank" class="block w-full text-center bg-purple-600 text-white text-sm px-3 py-2 rounded hover:bg-purple-700">'
                  + '<i class="fas fa-file-pdf mr-1"></i>Download PDF-ticket</a>';
          }
          if (s.booking_status === 'locked' || s.booking_status === 'sold') {
            html += '<button onclick="releaseSeat(' + s.id + ')" class="w-full bg-gray-200 text-gray-800 text-sm px-3 py-2 rounded hover:bg-gray-300"><i class="fas fa-unlock mr-1"></i>Vrijgeven</button>';
          }
          // Blokkeer / Deblokkeer knop — alleen voor stoelen die NIET in een lopende
          // bestelling zitten (booking_status leeg). Anders eerst vrijgeven.
          if (!s.booking_status) {
            if (s.base_status === 'blocked') {
              html += '<button onclick="toggleBlockSeat(' + s.id + ', false)" class="w-full bg-emerald-600 text-white text-sm px-3 py-2 rounded hover:bg-emerald-700" title="Zet deze stoel terug op beschikbaar voor verkoop."><i class="fas fa-check-circle mr-1"></i>Deblokkeer stoel</button>';
            } else {
              html += '<button onclick="toggleBlockSeat(' + s.id + ', true)" class="w-full bg-gray-600 text-white text-sm px-3 py-2 rounded hover:bg-gray-700" title="Zet deze stoel permanent uit (bv. defect, kolom in de weg, of gereserveerd voor gasten)."><i class="fas fa-ban mr-1"></i>Blokkeer stoel</button>';
            }
          }
          if (s.ticket_id) {
            html += '<a href="/admin/tickets/concert/' + concertId + '/orders" class="block w-full text-center bg-blue-50 text-blue-700 text-sm px-3 py-2 rounded hover:bg-blue-100"><i class="fas fa-receipt mr-1"></i>Bekijk bestelling</a>';
          }
          html += '</div>';
          detail.innerHTML = html;
        }

        function escapeHtml(s) {
          return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        }

        // ── Bulk-selectie helpers voor fysieke kaartverkoop ──
        function updateBulkBar() {
          const bar = document.getElementById('bulkActionBar');
          if (!bar) return;
          const count = bulkSelection.size;
          const cEl = document.getElementById('bulkCount');
          const lblEl = document.getElementById('bulkCountLabel');
          if (cEl) cEl.textContent = String(count);
          if (lblEl) lblEl.textContent = count === 1 ? 'stoel' : 'stoelen';
          bar.classList.toggle('hidden', count === 0);
        }

        function toggleBulkMode() {
          bulkMode = !bulkMode;
          const btn = document.getElementById('bulkModeBtn');
          if (btn) {
            if (bulkMode) {
              btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
              btn.classList.add('bg-blue-600', 'text-white', 'border-blue-700');
              btn.innerHTML = '<i class="fas fa-check-square mr-1"></i>Bulk-modus AAN';
            } else {
              btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
              btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-700');
              btn.innerHTML = '<i class="fas fa-hand-pointer mr-1"></i>Bulk-modus';
            }
          }
        }
        window.toggleBulkMode = toggleBulkMode;

        window.clearBulk = function() {
          bulkSelection.clear();
          render();
        };

        window.bulkReserve = async function() {
          const count = bulkSelection.size;
          if (count === 0) return;
          const naam = prompt('Naam van de koper (verschijnt op alle ' + count + ' stoelen):');
          if (!naam || !naam.trim()) return;
          const note = prompt('Notitie (optioneel, bv. "betaald cash aan Jan"):') || '';
          if (!confirm('Bevestig: ' + count + ' stoel' + (count === 1 ? '' : 'en') + ' reserveren voor "' + naam.trim() + '"?')) return;
          const ids = Array.from(bulkSelection);
          try {
            const res = await fetch('/api/admin/tickets/concert/' + concertId + '/manual-reserve-bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ naam: naam.trim(), note: note.trim() || null, seatIds: ids })
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Onbekende fout' }));
              alert('Fout bij reserveren: ' + (err.error || res.statusText));
              return;
            }
            const data = await res.json();
            alert('✓ ' + (data.aantal || count) + ' stoel' + (count === 1 ? '' : 'en') + ' gereserveerd voor ' + naam.trim() + ' (orderref: ' + data.order_ref + ')');
            location.reload();
          } catch (e) {
            alert('Netwerkfout: ' + (e && e.message ? e.message : e));
          }
        };

        window.manualReserve = async function(seatId) {
          const naam = prompt('Naam van de gast (verschijnt in zaalplan):');
          if (!naam) return;
          const note = prompt('Notitie (optioneel, bv. "papieren reservatie via mail"):') || '';
          try {
            const res = await fetch('/api/admin/tickets/concert/' + concertId + '/seats/' + seatId + '/manual-reserve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ naam: naam, note: note })
            });
            if (!res.ok) throw new Error(await res.text());
            location.reload();
          } catch (e) {
            alert('Fout: ' + e.message);
          }
        };

        window.releaseSeat = async function(seatId) {
          if (!confirm('Stoel echt vrijgeven? Dit verwijdert de reservatie/verkoop.')) return;
          try {
            const res = await fetch('/api/admin/tickets/concert/' + concertId + '/seats/' + seatId + '/release', {
              method: 'POST'
            });
            if (!res.ok) throw new Error(await res.text());
            location.reload();
          } catch (e) {
            alert('Fout: ' + e.message);
          }
        };

        // Blokkeer / deblokkeer een stoel (base_status='blocked' <-> 'available').
        // Werkt op de seats-tabel, niet op ticket_seats. Structureel dus, niet per concert.
        window.toggleBlockSeat = async function(seatId, block) {
          const msg = block
            ? 'Deze stoel permanent blokkeren voor verkoop? Kan later teruggedraaid worden.'
            : 'Deze stoel weer beschikbaar maken voor verkoop?';
          if (!confirm(msg)) return;
          try {
            const res = await fetch('/api/admin/seats/' + seatId + '/block', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ block: !!block })
            });
            if (!res.ok) throw new Error(await res.text());
            location.reload();
          } catch (e) {
            alert('Fout: ' + e.message);
          }
        };

        render();
      `}} />
    </Layout>
  )
})

// ==========================================
// ADMIN: PDF DOWNLOAD per stoel + ZIP per bestelling
// ==========================================
// Wordt gebruikt:
//  - vanuit de seating-overview (per-stoel knop) → 1 PDF
//  - vanuit de orders-pagina (resend-knop ZIP) → bundle voor doorsturen

/**
 * Helper: laad optionele logo bytes uit settings.
 */
async function loadAdminLogoBytes(db: D1Database): Promise<Uint8Array | null> {
  try {
    const row = await queryOne<any>(db,
      `SELECT value FROM system_settings
       WHERE key IN ('ticket_logo_url','site_logo_url')
       ORDER BY CASE key WHEN 'ticket_logo_url' THEN 0 ELSE 1 END
       LIMIT 1`,
      [])
    if (!row?.value || !/^https?:\/\//.test(row.value)) return null
    const resp = await fetch(row.value)
    if (!resp.ok) return null
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('png')) return null
    return new Uint8Array(await resp.arrayBuffer())
  } catch {
    return null
  }
}

// 1 PDF voor 1 stoel
app.get('/admin/tickets/concert/:concertId/seat-pdf/:ticketSeatId', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const ticketSeatId = parseInt(c.req.param('ticketSeatId'))
  if (!Number.isFinite(concertId) || !Number.isFinite(ticketSeatId)) {
    return c.text('Invalid id', 400)
  }

  // Haal seat + ticket + concert info op
  const row = await queryOne<any>(c.env.DB, `
    SELECT ts.id AS ticket_seat_id, ts.ticket_id,
           t.order_ref, t.koper_naam, t.koper_email, t.qr_code, t.categorie, t.prijs_totaal, t.aantal,
           s.section_name, s.row_label, s.seat_number,
           e.titel AS concert_titel, e.start_at, e.locatie,
           TRIM(COALESCE(l.adres, '') || CASE WHEN l.postcode IS NOT NULL OR l.stad IS NOT NULL
             THEN ', ' || COALESCE(l.postcode, '') || ' ' || COALESCE(l.stad, '')
             ELSE '' END) AS adres,
           c.doors_open_at, c.concert_start_at
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    JOIN seats s ON s.id = ts.seat_id
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    LEFT JOIN locations l ON l.id = e.location_id
    WHERE ts.id = ? AND t.concert_id = ?
  `, [ticketSeatId, concertId])

  if (!row) return c.text('Stoel niet gevonden', 404)

  const aanvangDate = row.concert_start_at ? new Date(row.concert_start_at) : new Date(row.start_at)
  const concertDatum = new Date(row.start_at).toLocaleDateString('nl-NL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const concertTijd = aanvangDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const doorsOpen = row.doors_open_at
    ? new Date(row.doors_open_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null

  // Tel hoeveel stoelen er in deze bestelling zijn voor index/total
  const allSeats = await queryAll<any>(c.env.DB, `
    SELECT ts.id, s.row_label, s.seat_number
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    JOIN seats s ON s.id = ts.seat_id
    WHERE t.order_ref = ?
    ORDER BY s.row_label, s.seat_number
  `, [row.order_ref])
  const idxInOrder = allSeats.findIndex((x: any) => x.id === ticketSeatId) + 1
  const total = allSeats.length

  const logoBytes = await loadAdminLogoBytes(c.env.DB)

  const pdfBytes = await generateSeatTicketPdf({
    order_ref: row.order_ref,
    koper_naam: row.koper_naam || 'Onbekend',
    koper_email: row.koper_email || '',
    concert_titel: row.concert_titel,
    concert_datum: concertDatum,
    concert_tijd: concertTijd,
    concert_doors_open: doorsOpen,
    concert_locatie: row.locatie || '',
    concert_adres: row.adres || null,
    categorie: row.categorie || 'Volwassene',
    prijs: Number(row.prijs_totaal) / Math.max(1, total),
    qr_code: `${row.qr_code}-${row.ticket_seat_id}`,
    seat_label: `Rij ${row.row_label} — Stoel ${row.seat_number}`,
    seat_sectie: row.section_name || null,
    ticket_index: idxInOrder || 1,
    ticket_total: total || 1,
    logo_png_bytes: logoBytes
  })

  const safeLabel = `rij-${row.row_label}-stoel-${row.seat_number}`
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${row.order_ref}-${safeLabel}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  })
})

// ZIP voor een hele bestelling (alle PDF's per stoel + LEES-MIJ.txt)
app.get('/admin/tickets/order/:orderRef/zip', async (c) => {
  const orderRef = c.req.param('orderRef')

  // Order-header
  const order = await queryOne<any>(c.env.DB, `
    SELECT t.order_ref, t.koper_naam, t.koper_email,
           SUM(t.prijs_totaal) AS totaal_bedrag, SUM(t.aantal) AS totaal_kaarten,
           e.titel AS concert_titel, e.start_at, e.locatie,
           TRIM(COALESCE(l.adres, '') || CASE WHEN l.postcode IS NOT NULL OR l.stad IS NOT NULL
             THEN ', ' || COALESCE(l.postcode, '') || ' ' || COALESCE(l.stad, '')
             ELSE '' END) AS adres,
           c.doors_open_at, c.concert_start_at
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    LEFT JOIN locations l ON l.id = e.location_id
    WHERE t.order_ref = ?
    GROUP BY t.order_ref
  `, [orderRef])
  if (!order) return c.text('Bestelling niet gevonden', 404)

  // Stoelen
  const seats = await queryAll<any>(c.env.DB, `
    SELECT ts.id AS ticket_seat_id, ts.ticket_id, t.qr_code, t.categorie, t.prijs_totaal AS line_total,
           s.section_name, s.row_label, s.seat_number
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    JOIN seats s ON s.id = ts.seat_id
    WHERE t.order_ref = ?
    ORDER BY s.row_label, s.seat_number
  `, [orderRef])

  const logoBytes = await loadAdminLogoBytes(c.env.DB)
  const aanvangDate = order.concert_start_at ? new Date(order.concert_start_at) : new Date(order.start_at)
  const concertDatum = new Date(order.start_at).toLocaleDateString('nl-NL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const concertTijd = aanvangDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const doorsOpen = order.doors_open_at
    ? new Date(order.doors_open_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null

  // Per-stoel PDFs (met seats) of fallback legacy PDF
  if (seats.length > 0) {
    const pdfs = await generateSeatTicketPdfs({
      order_ref: orderRef,
      koper_naam: order.koper_naam || '',
      koper_email: order.koper_email || '',
      concert_titel: order.concert_titel,
      concert_datum: concertDatum,
      concert_tijd: concertTijd,
      concert_doors_open: doorsOpen,
      concert_locatie: order.locatie || '',
      concert_adres: order.adres || null,
      logo_png_bytes: logoBytes,
      seats: seats.map((s: any) => ({
        qr_code: `${s.qr_code}-${s.ticket_seat_id}`,
        categorie: s.categorie,
        prijs: Number(s.line_total) / Math.max(1, seats.filter((x: any) => x.ticket_id === s.ticket_id).length),
        seat_label: `Rij ${s.row_label} — Stoel ${s.seat_number}`,
        seat_sectie: s.section_name || null
      }))
    })
    const readme = `Tickets — ${order.concert_titel}
Bestelling: ${orderRef}
Koper: ${order.koper_naam} (${order.koper_email})
Datum: ${concertDatum}
Locatie: ${order.locatie}
Aantal stoelen: ${seats.length}

Elk PDF-bestand bevat één ticket voor één stoel. Verspreid de juiste PDF
aan de juiste persoon (per WhatsApp / email).
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

  // Fallback: geen seats → legacy multi-pagina PDF
  const lines = await queryAll<any>(c.env.DB, `
    SELECT qr_code, categorie, aantal, prijs_totaal FROM tickets WHERE order_ref = ?
  `, [orderRef])
  const pdfBytes = await generateTicketPdf({
    order_ref: orderRef,
    koper_naam: order.koper_naam || '',
    koper_email: order.koper_email || '',
    concert_titel: order.concert_titel,
    concert_datum: concertDatum,
    concert_tijd: concertTijd,
    concert_doors_open: doorsOpen,
    concert_locatie: order.locatie || '',
    concert_adres: order.adres || null,
    totaal_bedrag: Number(order.totaal_bedrag) || 0,
    lines: lines.map((l: any) => ({
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

// ==========================================
// PHASE 4: HANDMATIGE STOEL-RESERVATIE
// ==========================================
// Bulk-versie: reserveer meerdere stoelen tegelijk onder ÉÉN koper.
// Body: { naam, note?, seatIds: number[] }
// Maakt één ticket met aantal=N en N ticket_seats rijen.
// Bedoeld voor admins die fysieke kaarten verkopen aan iemand die bv. 5 stoelen wil.
app.post('/api/admin/tickets/concert/:concertId/manual-reserve-bulk', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))

  try {
    const { naam, note, seatIds } = await c.req.json().catch(() => ({} as any))
    if (!naam || typeof naam !== 'string') return c.json({ error: 'Naam is verplicht' }, 400)
    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      return c.json({ error: 'Geen stoelen geselecteerd' }, 400)
    }
    const ids = seatIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
    if (ids.length === 0) return c.json({ error: 'Ongeldige stoel-IDs' }, 400)

    // Check of er één al bezet is (atomair: één placeholder per ID)
    const placeholders = ids.map(() => '?').join(',')
    const bezet = await queryAll<any>(c.env.DB,
      `SELECT seat_id FROM ticket_seats
       WHERE concert_id = ? AND status IN ('locked','sold') AND seat_id IN (${placeholders})`,
      [concertId, ...ids])
    if (bezet.length > 0) {
      return c.json({ error: 'Een of meer stoelen zijn al bezet', bezet_ids: bezet.map((b: any) => b.seat_id) }, 409)
    }

    // Concert + stoelen ophalen
    const concert = await queryOne<any>(c.env.DB, `SELECT id FROM concerts WHERE id = ?`, [concertId])
    if (!concert) return c.json({ error: 'Concert niet gevonden' }, 404)
    const seats = await queryAll<any>(c.env.DB,
      `SELECT id, row_label, seat_number FROM seats WHERE id IN (${placeholders})`,
      ids)
    if (seats.length !== ids.length) {
      return c.json({ error: 'Niet alle stoelen gevonden in de database' }, 404)
    }

    const orderRef = 'ADM-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    const qrCode = 'QR-' + Math.random().toString(36).slice(2, 12).toUpperCase()
    const aantal = ids.length

    // 1 ticket aanmaken met aantal=N
    const ticketRes: any = await execute(c.env.DB, `
      INSERT INTO tickets (
        concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
        aantal, categorie, prijs_totaal, status, qr_code, betaling_id, betaald_at
      ) VALUES (?, ?, ?, ?, '', ?, ?, 0, 'paid', ?, NULL, CURRENT_TIMESTAMP)
    `, [
      concertId, orderRef, `admin-${user.id}@animato.local`, naam,
      aantal, 'Handmatige bulk-reservatie', qrCode
    ])
    const ticketId = ticketRes?.meta?.last_row_id
    if (!ticketId) throw new Error('Ticket kon niet aangemaakt worden')

    // N ticket_seats rijen
    for (const sid of ids) {
      await execute(c.env.DB, `
        INSERT INTO ticket_seats (ticket_id, seat_id, concert_id, status, lock_expires_at, created_by_user_id, note)
        VALUES (?, ?, ?, 'sold', NULL, ?, ?)
      `, [ticketId, sid, concertId, user.id, note || null])
    }

    // Capaciteit-teller bijwerken
    await execute(c.env.DB, `UPDATE concerts SET verkocht = verkocht + ? WHERE id = ?`, [aantal, concertId])

    // Audit
    const seatLabels = seats.map((s: any) => `${s.row_label}-${s.seat_number}`).join(',')
    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'manual_bulk_reserve', 'tickets', ?, ?)`,
      [user.id, ticketId, JSON.stringify({ concert_id: concertId, aantal, seats: seatLabels, naam, note })]
    )

    return c.json({ ok: true, ticket_id: ticketId, order_ref: orderRef, aantal })
  } catch (e: any) {
    console.error('manual-reserve-bulk faalde:', e)
    return c.json({ error: e.message || 'Onbekende fout' }, 500)
  }
})

// Voor papieren/telefoon-reservaties: admin reserveert handmatig een stoel.
// Maakt een 'ticket' aan met status='paid' (geen Mollie-flow) en een ticket_seats
// rij met status='sold'. De stoel telt onmiddellijk mee in de telling.
app.post('/api/admin/tickets/concert/:concertId/seats/:seatId/manual-reserve', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const seatId = parseInt(c.req.param('seatId'))

  try {
    const { naam, note } = await c.req.json().catch(() => ({} as any))
    if (!naam || typeof naam !== 'string') {
      return c.json({ error: 'Naam is verplicht' }, 400)
    }

    // Check of de stoel echt vrij is
    const existing = await queryOne<any>(c.env.DB,
      `SELECT id FROM ticket_seats WHERE seat_id = ? AND concert_id = ? AND status IN ('locked', 'sold')`,
      [seatId, concertId])
    if (existing) {
      return c.json({ error: 'Stoel is al bezet' }, 409)
    }

    // Concert + stoel info ophalen
    const concert = await queryOne<any>(c.env.DB, `SELECT id, prijsstructuur FROM concerts WHERE id = ?`, [concertId])
    if (!concert) return c.json({ error: 'Concert niet gevonden' }, 404)
    const seat = await queryOne<any>(c.env.DB, `SELECT id, row_label, seat_number FROM seats WHERE id = ?`, [seatId])
    if (!seat) return c.json({ error: 'Stoel niet gevonden' }, 404)

    // Genereer order_ref
    const orderRef = 'ADM-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    const qrCode = 'QR-' + Math.random().toString(36).slice(2, 12).toUpperCase()

    // Maak ticket (status=paid, geen Mollie)
    const ticketRes: any = await execute(c.env.DB, `
      INSERT INTO tickets (
        concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
        aantal, categorie, prijs_totaal, status, qr_code, betaling_id, betaald_at
      ) VALUES (?, ?, ?, ?, '', 1, ?, 0, 'paid', ?, NULL, CURRENT_TIMESTAMP)
    `, [
      concertId, orderRef, `admin-${user.id}@animato.local`, naam,
      'Handmatige reservatie', qrCode
    ])
    const ticketId = ticketRes?.meta?.last_row_id
    if (!ticketId) throw new Error('Ticket kon niet aangemaakt worden')

    // Koppel stoel — status='sold', lock_expires_at NULL
    await execute(c.env.DB, `
      INSERT INTO ticket_seats (ticket_id, seat_id, concert_id, status, lock_expires_at, created_by_user_id, note)
      VALUES (?, ?, ?, 'sold', NULL, ?, ?)
    `, [ticketId, seatId, concertId, user.id, note || null])

    // Capaciteit-teller bijwerken
    await execute(c.env.DB, `UPDATE concerts SET verkocht = verkocht + 1 WHERE id = ?`, [concertId])

    // Audit log
    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'manual_seat_reserve', 'tickets', ?, ?)`,
      [user.id, ticketId, JSON.stringify({ concert_id: concertId, seat: `${seat.row_label}-${seat.seat_number}`, naam, note })]
    )

    return c.json({ ok: true, ticket_id: ticketId, order_ref: orderRef })
  } catch (e: any) {
    console.error('manual-reserve faalde:', e)
    return c.json({ error: e.message || 'Onbekende fout' }, 500)
  }
})

// ==========================================
// PHASE 4: STOEL VRIJGEVEN (admin)
// ==========================================
// Verwijdert de ticket_seats-rij en als het de enige stoel was van het ticket,
// markeert het ticket als 'cancelled'. Verlaagt de verkocht-teller.
app.post('/api/admin/tickets/concert/:concertId/seats/:seatId/release', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const seatId = parseInt(c.req.param('seatId'))

  try {
    const link = await queryOne<any>(c.env.DB, `
      SELECT ts.id, ts.ticket_id, ts.status, t.aantal, t.status as ticket_status
      FROM ticket_seats ts
      JOIN tickets t ON t.id = ts.ticket_id
      WHERE ts.seat_id = ? AND ts.concert_id = ? AND ts.status IN ('locked', 'sold')
    `, [seatId, concertId])
    if (!link) return c.json({ error: 'Geen actieve reservatie op deze stoel' }, 404)

    // Tel hoeveel stoelen er nog gekoppeld zijn aan dit ticket
    const otherSeats = await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as n FROM ticket_seats WHERE ticket_id = ? AND id != ?`,
      [link.ticket_id, link.id])
    const wasSold = link.status === 'sold'

    // Verwijder de seat-link (UNIQUE-constraint vraagt DELETE ipv UPDATE)
    await execute(c.env.DB, `DELETE FROM ticket_seats WHERE id = ?`, [link.id])

    // Als dit de enige stoel was, ticket op cancelled zetten
    if ((otherSeats?.n ?? 0) === 0) {
      await execute(c.env.DB, `UPDATE tickets SET status = 'cancelled' WHERE id = ?`, [link.ticket_id])
    } else {
      // Verlaag aantal op het ticket
      await execute(c.env.DB, `UPDATE tickets SET aantal = MAX(0, aantal - 1) WHERE id = ?`, [link.ticket_id])
    }

    // Verlaag verkocht-teller als de stoel ook effectief verkocht was
    if (wasSold) {
      await execute(c.env.DB, `UPDATE concerts SET verkocht = MAX(0, verkocht - 1) WHERE id = ?`, [concertId])
    }

    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'manual_seat_release', 'tickets', ?, ?)`,
      [user.id, link.ticket_id, JSON.stringify({ concert_id: concertId, seat_id: seatId, was_status: link.status })]
    )

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('release-seat faalde:', e)
    return c.json({ error: e.message || 'Onbekende fout' }, 500)
  }
})

// ==========================================
// STOEL (DE)BLOKKEREN — structureel, niet per concert
// ==========================================
// Werkt op seats.status (base_status). 'blocked' betekent: nooit verkoopbaar
// tot admin het weer aanzet. Verschil met ticket_seats.status='locked':
// dat is een tijdelijke lock tijdens een lopende bestelling.
//
// Refuse als er nog een actieve booking (locked/sold) op de stoel staat —
// die moet eerst vrijgegeven worden om ambiguïteit te vermijden.
app.post('/api/admin/seats/:seatId/block', async (c) => {
  const user = c.get('user') as SessionUser
  const seatId = parseInt(c.req.param('seatId'))
  if (!seatId) return c.json({ error: 'Ongeldig ID' }, 400)

  const body = await c.req.json().catch(() => ({}))
  const block = !!body.block

  // Bestaat de stoel?
  const seat = await queryOne<any>(c.env.DB,
    `SELECT id, plan_id, row_label, seat_number, status FROM seats WHERE id = ?`,
    [seatId])
  if (!seat) return c.json({ error: 'Stoel niet gevonden' }, 404)

  // Als er een actieve booking op staat, weiger: eerst vrijgeven.
  if (block) {
    const active = await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as n FROM ticket_seats WHERE seat_id = ? AND status IN ('locked','sold')`,
      [seatId])
    if ((active?.n ?? 0) > 0) {
      return c.json({ error: 'Stoel heeft nog een actieve reservatie/verkoop. Geef eerst vrij.' }, 409)
    }
  }

  const newStatus = block ? 'blocked' : 'available'
  await execute(c.env.DB, `UPDATE seats SET status = ? WHERE id = ?`, [newStatus, seatId])

  await execute(c.env.DB,
    `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, ?, 'seats', ?, ?)`,
    [user.id, block ? 'seat_block' : 'seat_unblock', seatId,
     JSON.stringify({ plan_id: seat.plan_id, seat: `${seat.row_label}-${seat.seat_number}`, from: seat.status, to: newStatus })]
  )

  return c.json({ ok: true, status: newStatus })
})

export default app
