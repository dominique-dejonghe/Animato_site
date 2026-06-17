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
  let baseQuery = `
    SELECT e.id as event_id, e.titel, e.slug, e.start_at, e.locatie, e.type,
           c.id as concert_id, c.programma, c.ticketing_enabled, c.uitverkocht, c.tickets_aangekondigd, c.voorverkoop_start_at,
           c.capaciteit, c.verkocht,
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
    const startTs = row.start_at ? new Date(String(row.start_at).replace(' ', 'T')).getTime() : 0
    const voorverkoopTs = row.voorverkoop_start_at ? new Date(String(row.voorverkoop_start_at).replace(' ', 'T')).getTime() : 0
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
              href="/admin/tickets/test-checklist"
              class="bg-white border border-gray-300 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-50 transition inline-flex items-center"
              title="Diagnostiek + stappenplan voor live Mollie-test"
            >
              <i class="fas fa-vial mr-2"></i>Test-checklist
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

        {/* Stats Cards */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
                  {concerts.reduce((sum: number, c: any) => sum + (c.paid_count || 0), 0)}
                </p>
              </div>
              <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-ticket-alt text-green-600 text-xl"></i>
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
                                {concert.voorverkoop_start_at && new Date(String(concert.voorverkoop_start_at).replace(' ', 'T')).getTime() > Date.now()
                                  ? `VOORVERKOOP OP ${new Date(String(concert.voorverkoop_start_at).replace(' ', 'T')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}`
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

                      {/* Capacity Bar */}
                      {concert.capaciteit > 0 && (
                        <div class="mb-4">
                          <div class="flex items-center justify-between text-sm mb-1">
                            <span class="font-medium text-gray-700">
                              Bezetting: {concert.verkocht} / {concert.capaciteit}
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
                            {concert.ticket_count || 0}
                          </div>
                          <div class="text-xs text-gray-600">Bestellingen</div>
                        </div>
                        <div class="bg-green-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-green-700">
                            {concert.paid_count || 0}
                          </div>
                          <div class="text-xs text-gray-600">Betaald</div>
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
  
  // Get concert info
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  // Get all tickets/orders
  const tickets = await queryAll(c.env.DB, `
    SELECT *
    FROM tickets
    WHERE concert_id = ?
    ORDER BY created_at DESC
  `, [concertId])

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
          {concert.seating_plan_id && (
            <a href={`/admin/tickets/concert/${concertId}/zaalplan`}
               class="inline-flex items-center bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 shadow-sm"
               title="Visueel zaalplan met live bezetting per stoel">
              <i class="fas fa-map mr-2"></i> Zaalplan-view
            </a>
          )}
        </div>

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
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order Ref</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Koper</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categorie</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aantal</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prijs</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
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
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(ticket.created_at).toLocaleDateString('nl-NL')}
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
app.post('/api/admin/tickets/:id/mark-paid', async (c) => {
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
app.post('/api/admin/tickets/:id/resend', async (c) => {
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
      `SELECT t.*, e.titel, e.start_at, e.locatie, e.adres,
              c.doors_open_at, c.concert_start_at
       FROM tickets t
       JOIN concerts c ON c.id = t.concert_id
       JOIN events e   ON e.id = c.event_id
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
// DELETE TICKET API
// ==========================================
app.post('/api/admin/tickets/:id/delete', async (c) => {
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
                      (<strong>{concert.start_at ? new Date(String(concert.start_at).replace(' ', 'T')).toLocaleString('nl-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '—'}</strong>).
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

          {/* Concert Afbeelding */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">
              <i class="fas fa-image text-animato-primary mr-2"></i>
              Concert Afbeelding
            </h2>
            
            <div class="space-y-6">
              {/* Tab Buttons */}
              <div class="flex gap-2 border-b border-gray-200">
                <button
                  type="button"
                  onclick="switchImageTab('upload')"
                  id="upload-tab"
                  class="px-4 py-2 border-b-2 border-transparent hover:border-animato-primary transition font-medium text-gray-600 hover:text-gray-900"
                >
                  <i class="fas fa-upload mr-2"></i>
                  Bestand Uploaden
                </button>
                <button
                  type="button"
                  onclick="switchImageTab('url')"
                  id="url-tab"
                  class="px-4 py-2 border-b-2 border-animato-primary font-medium text-gray-900"
                >
                  <i class="fas fa-link mr-2"></i>
                  URL Invoeren
                </button>
              </div>

              {/* Upload Tab */}
              <div id="upload-section" class="hidden">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Upload Afbeelding
                </label>
                
                {/* Drag & Drop Area */}
                <div 
                  id="drop-zone"
                  class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-animato-primary transition cursor-pointer"
                  ondragover="event.preventDefault(); this.classList.add('border-animato-primary', 'bg-blue-50');"
                  ondragleave="this.classList.remove('border-animato-primary', 'bg-blue-50');"
                  ondrop="handleFileDrop(event)"
                  onclick="document.getElementById('file-input').click()"
                >
                  <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-4"></i>
                  <p class="text-gray-700 font-medium mb-2">
                    Klik om een bestand te selecteren of sleep het hierheen
                  </p>
                  <p class="text-sm text-gray-500">
                    PNG, JPG, GIF tot 5MB
                  </p>
                  <input
                    type="file"
                    id="file-input"
                    accept="image/*"
                    class="hidden"
                    onchange="handleFileSelect(event)"
                  />
                </div>

                <input type="hidden" id="afbeelding-upload" name="afbeelding" value={concert.afbeelding || ''} />
              </div>

              {/* URL Tab */}
              <div id="url-section">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Afbeelding URL
                </label>
                <input
                  type="url"
                  id="afbeelding-url"
                  name="afbeelding"
                  value={concert.afbeelding || ''}
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="https://example.com/concert-image.jpg"
                  oninput="updatePreview(this.value)"
                />
                <p class="text-sm text-gray-500 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Plak een URL van een online afbeelding (bijv. van je website of cloudopslag)
                </p>
              </div>

              {/* Preview */}
              <div id="preview-section" class={concert.afbeelding ? '' : 'hidden'}>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Preview
                </label>
                <div class="border border-gray-200 rounded-lg overflow-hidden max-w-md">
                  <img 
                    id="preview-image"
                    src={concert.afbeelding || ''} 
                    alt="Concert preview"
                    class="w-full h-auto"
                    onerror="this.parentElement.innerHTML='<div class=\\'p-8 text-center text-gray-500\\'>❌ Afbeelding kan niet geladen worden</div>'"
                  />
                </div>
                <button
                  type="button"
                  onclick="removeImage()"
                  class="mt-2 text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  <i class="fas fa-trash mr-1"></i>
                  Verwijder afbeelding
                </button>
              </div>
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

          // Image Upload Functions
          function switchImageTab(tab) {
            const uploadTab = document.getElementById('upload-tab');
            const urlTab = document.getElementById('url-tab');
            const uploadSection = document.getElementById('upload-section');
            const urlSection = document.getElementById('url-section');
            
            if (tab === 'upload') {
              uploadTab.classList.add('border-animato-primary', 'text-gray-900');
              uploadTab.classList.remove('border-transparent', 'text-gray-600');
              urlTab.classList.remove('border-animato-primary', 'text-gray-900');
              urlTab.classList.add('border-transparent', 'text-gray-600');
              
              uploadSection.classList.remove('hidden');
              urlSection.classList.add('hidden');
              
              // Switch name attribute
              document.getElementById('afbeelding-upload').name = 'afbeelding';
              document.getElementById('afbeelding-url').name = '';
            } else {
              urlTab.classList.add('border-animato-primary', 'text-gray-900');
              urlTab.classList.remove('border-transparent', 'text-gray-600');
              uploadTab.classList.remove('border-animato-primary', 'text-gray-900');
              uploadTab.classList.add('border-transparent', 'text-gray-600');
              
              urlSection.classList.remove('hidden');
              uploadSection.classList.add('hidden');
              
              // Switch name attribute
              document.getElementById('afbeelding-url').name = 'afbeelding';
              document.getElementById('afbeelding-upload').name = '';
            }
          }

          function handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) {
              processFile(file);
            }
          }

          function handleFileDrop(event) {
            event.preventDefault();
            const dropZone = document.getElementById('drop-zone');
            dropZone.classList.remove('border-animato-primary', 'bg-blue-50');
            
            const file = event.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
              processFile(file);
            } else {
              alert('Selecteer een geldig afbeeldingsbestand');
            }
          }

          function processFile(file) {
            // Check file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
              alert('Bestand is te groot. Maximum 5MB toegestaan.');
              return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
              const dataUrl = e.target.result;
              
              // Update hidden input and preview
              document.getElementById('afbeelding-upload').value = dataUrl;
              updatePreview(dataUrl);
            };
            reader.readAsDataURL(file);
          }

          function updatePreview(imageUrl) {
            const previewSection = document.getElementById('preview-section');
            const previewImage = document.getElementById('preview-image');
            
            if (imageUrl) {
              previewSection.classList.remove('hidden');
              previewImage.src = imageUrl;
            } else {
              previewSection.classList.add('hidden');
            }
          }

          function removeImage() {
            openDeleteModal(function() {
              document.getElementById('afbeelding-url').value = '';
              document.getElementById('afbeelding-upload').value = '';
              document.getElementById('file-input').value = '';
              document.getElementById('preview-section').classList.add('hidden');
            });
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
    if (body.afbeelding !== undefined) {
      await execute(c.env.DB, `
        UPDATE events SET
          image_url = ?
        WHERE id = ?
      `, [
        String(body.afbeelding || ''),
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
          
          {/* Manual QR Code Input */}
          <div class="mb-8">
            <h2 class="text-xl font-bold text-gray-900 mb-4">Scan Ticket</h2>
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
              Gebruik een QR-scanner of typ de code handmatig in
            </p>
          </div>

          {/* Result Display */}
          <div id="result-container" class="hidden">
            <div id="result-success" class="hidden bg-green-50 border-2 border-green-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-check-circle text-green-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-green-900">Ticket Geldig!</h3>
                  <p class="text-green-700">Toegang verleend</p>
                </div>
              </div>
              <div id="ticket-details" class="text-sm text-gray-700 space-y-2"></div>
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
            <h3 class="text-lg font-bold text-gray-900 mb-4">Live Statistieken</h3>
            <div class="grid grid-cols-3 gap-4">
              <div class="text-center">
                <div class="text-3xl font-bold text-gray-900" id="scanned-count">0</div>
                <div class="text-sm text-gray-600">Gescand</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-green-600" id="valid-count">0</div>
                <div class="text-sm text-gray-600">Geldig</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-red-600" id="invalid-count">0</div>
                <div class="text-sm text-gray-600">Ongeldig</div>
              </div>
            </div>
          </div>
        </div>

        {/* JavaScript */}
        <script dangerouslySetInnerHTML={{ __html: `
          let scanned = 0;
          let valid = 0;
          let invalid = 0;
          
          async function validateTicket() {
            const input = document.getElementById('qr-input');
            const qrCode = input.value.trim();
            
            if (!qrCode) {
              alert('Voer een QR-code in');
              return;
            }
            
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
              
              if (data.valid) {
                valid++;
                document.getElementById('valid-count').textContent = valid;
                
                document.getElementById('result-success').classList.remove('hidden');
                document.getElementById('result-error').classList.add('hidden');
                
                document.getElementById('ticket-details').innerHTML = \`
                  <p><strong>Order:</strong> \${data.ticket.order_ref}</p>
                  <p><strong>Naam:</strong> \${data.ticket.koper_naam}</p>
                  <p><strong>Email:</strong> \${data.ticket.koper_email}</p>
                  <p><strong>Tickets:</strong> \${data.ticket.aantal}x \${data.ticket.categorie}</p>
                \`;
                
                // Play success sound
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRAE=' );
                audio.play();
                
                setTimeout(() => {
                  input.value = '';
                  input.focus();
                  document.getElementById('result-container').classList.add('hidden');
                }, 3000);
              } else {
                invalid++;
                document.getElementById('invalid-count').textContent = invalid;
                
                document.getElementById('result-success').classList.add('hidden');
                document.getElementById('result-error').classList.remove('hidden');
                document.getElementById('error-message').textContent = data.message;
                
                setTimeout(() => {
                  input.value = '';
                  input.focus();
                  document.getElementById('result-container').classList.add('hidden');
                }, 3000);
              }
            } catch (error) {
              alert('Fout bij validatie: ' + error.message);
            }
          }
          
          // Enter key handler
          document.getElementById('qr-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              validateTicket();
            }
          });
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// QR CODE VALIDATION API
// ==========================================
app.post('/api/admin/tickets/validate-qr', async (c) => {
  const body = await c.req.json()
  const qrCode = body.qr_code
  const concertId = body.concert_id
  
  try {
    const ticket = await queryOne(c.env.DB, `
      SELECT t.*, c.id as concert_id
      FROM tickets t
      JOIN concerts c ON c.id = t.concert_id
      WHERE t.qr_code = ? AND c.id = ?
    `, [qrCode, concertId])
    
    if (!ticket) {
      return c.json({
        valid: false,
        message: 'QR-code niet gevonden voor dit concert'
      })
    }
    
    if (ticket.status !== 'paid') {
      return c.json({
        valid: false,
        message: 'Ticket niet betaald'
      })
    }
    
    return c.json({
      valid: true,
      ticket: {
        order_ref: ticket.order_ref,
        koper_naam: ticket.koper_naam,
        koper_email: ticket.koper_email,
        aantal: ticket.aantal,
        categorie: ticket.categorie
      }
    })
  } catch (error) {
    return c.json({ valid: false, message: (error as Error).message }, 500)
  }
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
  const mollieMode = await getMollieMode(c.env)
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
              <div class="flex justify-between items-center mb-3">
                <h2 class="font-semibold text-gray-900"><i class="fas fa-map mr-2 text-gray-500"></i>Klik op een stoel voor details</h2>
                <div class="flex gap-3 text-xs">
                  <span class="flex items-center"><span class="inline-block w-3 h-3 bg-blue-500 rounded-sm mr-1"></span>Beschikbaar</span>
                  <span class="flex items-center"><span class="inline-block w-3 h-3 bg-orange-500 rounded-sm mr-1"></span>Locked</span>
                  <span class="flex items-center"><span class="inline-block w-3 h-3 bg-red-600 rounded-sm mr-1"></span>Verkocht</span>
                  <span class="flex items-center"><span class="inline-block w-3 h-3 bg-gray-400 rounded-sm mr-1"></span>Geblokkeerd</span>
                </div>
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
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        const seats = ${JSON.stringify(seats)};
        const concertId = ${concertId};
        const map = document.getElementById('seatMap');
        const detail = document.getElementById('seat-detail');
        let selected = null;

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
            if (selected && selected.id === seat.id) {
              el.style.outline = '3px solid #F59E0B';
              el.style.outlineOffset = '1px';
              el.style.zIndex = '20';
            }
            el.onclick = () => { selected = seat; render(); showDetail(seat); };
            map.appendChild(el);
          });
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
                       : s.booking_status === 'locked' ? 'Gereserveerd (locked)'
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
          if (s.ticket_id) {
            html += '<a href="/admin/tickets/concert/' + concertId + '/orders" class="block w-full text-center bg-blue-50 text-blue-700 text-sm px-3 py-2 rounded hover:bg-blue-100"><i class="fas fa-receipt mr-1"></i>Bekijk bestelling</a>';
          }
          html += '</div>';
          detail.innerHTML = html;
        }

        function escapeHtml(s) {
          return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        }

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
           e.titel AS concert_titel, e.start_at, e.locatie, e.adres,
           c.doors_open_at, c.concert_start_at
    FROM ticket_seats ts
    JOIN tickets t ON t.id = ts.ticket_id
    JOIN seats s ON s.id = ts.seat_id
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
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
           e.titel AS concert_titel, e.start_at, e.locatie, e.adres,
           c.doors_open_at, c.concert_start_at
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
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

export default app
