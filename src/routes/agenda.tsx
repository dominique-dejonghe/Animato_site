// Agenda & Concert routes
// Kalender, filters, ICS export, concert details

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { optionalAuth } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optional auth
app.use('*', optionalAuth)

// =====================================================
// AGENDA OVERZICHT
// =====================================================

app.get('/agenda', async (c) => {
  const user = c.get('user')
  const type = c.req.query('type') || 'all'
  const maand = c.req.query('maand')

  // Build query
  let query = `
    SELECT e.id, e.type, e.titel, e.slug, e.start_at, e.end_at, e.locatie, e.adres, e.doelgroep
    FROM events e
    WHERE e.is_publiek = 1 AND e.start_at >= datetime('now')
  `

  const filters: any[] = []

  if (type !== 'all') {
    query += ` AND e.type = ?`
    filters.push(type)
  }

  if (maand) {
    query += ` AND strftime('%Y-%m', e.start_at) = ?`
    filters.push(maand)
  }

  query += ` ORDER BY e.start_at ASC LIMIT 50`

  const events = await queryAll(c.env.DB, query, filters)

  // Group events by month
  const eventsByMonth: Record<string, any[]> = {}
  events.forEach((event: any) => {
    const monthKey = new Date(event.start_at).toLocaleDateString('nl-BE', { year: 'numeric', month: 'long' })
    if (!eventsByMonth[monthKey]) {
      eventsByMonth[monthKey] = []
    }
    eventsByMonth[monthKey].push(event)
  })

  return c.html(
    <Layout title="Agenda" user={user} currentPath="/agenda">
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="text-center mb-12">
            <h1 class="text-5xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Agenda
            </h1>
            <p class="text-gray-600 text-lg">
              Alle repetities, concerten en activiteiten op een rij
            </p>
          </div>

          {/* Filters */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-8">
            <div class="flex flex-wrap gap-4 items-center">
              <div class="flex-1 min-w-[200px]">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Type activiteit
                </label>
                <select
                  onchange="window.location.href='/agenda?type=' + this.value"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="all" selected={type === 'all'}>Alle activiteiten</option>
                  <option value="repetitie" selected={type === 'repetitie'}>Repetities</option>
                  <option value="concert" selected={type === 'concert'}>Concerten</option>
                  <option value="ander" selected={type === 'ander'}>Overige</option>
                </select>
              </div>

              <div class="flex items-end space-x-2">
                <a
                  href="/api/agenda/ics"
                  class="inline-flex items-center px-4 py-2 bg-animato-primary hover:bg-animato-secondary text-white rounded-lg font-semibold transition"
                >
                  <i class="fas fa-calendar-alt mr-2"></i>
                  Exporteer naar kalender
                </a>
              </div>
            </div>
          </div>

          {/* Events grouped by month */}
          {Object.keys(eventsByMonth).length > 0 ? (
            <div class="space-y-12">
              {Object.entries(eventsByMonth).map(([month, monthEvents]) => (
                <div>
                  <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <i class="far fa-calendar-alt text-animato-primary mr-3"></i>
                    {month}
                  </h2>
                  <div class="space-y-4">
                    {monthEvents.map((event: any) => (
                      <a
                        href={event.type === 'concert' && event.slug ? `/concerten/${event.slug}` : '#'}
                        class="block bg-white rounded-lg shadow-md hover:shadow-lg transition p-6"
                      >
                        <div class="flex items-start gap-6">
                          {/* Date block */}
                          <div class="flex-shrink-0 text-center bg-animato-primary bg-opacity-10 rounded-lg p-4 w-24">
                            <div class="text-3xl font-bold text-animato-primary">
                              {new Date(event.start_at).getDate()}
                            </div>
                            <div class="text-sm text-gray-600 uppercase">
                              {new Date(event.start_at).toLocaleDateString('nl-BE', { month: 'short' })}
                            </div>
                          </div>

                          {/* Event info */}
                          <div class="flex-1">
                            <div class="flex items-start justify-between mb-2">
                              <div>
                                <span class={`inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2 ${
                                  event.type === 'concert' ? 'bg-yellow-100 text-yellow-800' :
                                  event.type === 'repetitie' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {event.type === 'concert' ? 'Concert' : 
                                   event.type === 'repetitie' ? 'Repetitie' : 
                                   'Activiteit'}
                                </span>
                                <h3 class="text-xl font-bold text-gray-900">
                                  {event.titel}
                                </h3>
                              </div>
                            </div>

                            <div class="space-y-2 text-gray-600">
                              <div class="flex items-center">
                                <i class="far fa-clock w-5 text-animato-primary mr-3"></i>
                                <span>
                                  {new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                                  {' - '}
                                  {new Date(event.end_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div class="flex items-center">
                                <i class="fas fa-map-marker-alt w-5 text-animato-primary mr-3"></i>
                                <span>{event.locatie}</span>
                              </div>
                              {event.doelgroep !== 'all' && (
                                <div class="flex items-center">
                                  <i class="fas fa-users w-5 text-animato-primary mr-3"></i>
                                  <span>
                                    Voor: {
                                      event.doelgroep === 'S' ? 'Sopraan' :
                                      event.doelgroep === 'A' ? 'Alt' :
                                      event.doelgroep === 'T' ? 'Tenor' :
                                      event.doelgroep === 'B' ? 'Bas' :
                                      event.doelgroep === 'SA' ? 'Sopraan & Alt' :
                                      event.doelgroep === 'TB' ? 'Tenor & Bas' :
                                      event.doelgroep
                                    }
                                  </span>
                                </div>
                              )}
                            </div>

                            {event.type === 'concert' && event.slug && (
                              <div class="mt-4">
                                <span class="inline-flex items-center text-animato-primary font-semibold hover:underline">
                                  Bekijk details & tickets
                                  <i class="fas fa-arrow-right ml-2"></i>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="text-center py-16">
              <i class="far fa-calendar-times text-gray-300 text-6xl mb-4"></i>
              <p class="text-xl text-gray-600">
                Geen aankomende activiteiten gevonden
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CONCERTEN OVERZICHT
// =====================================================

app.get('/concerten', async (c) => {
  const user = c.get('user')
  const view = c.req.query('view') || 'upcoming'

  // Query based on view parameter
  let query = `
    SELECT e.*, c.poster_url, c.programma, c.uitverkocht
    FROM events e
    LEFT JOIN concerts c ON c.event_id = e.id
    WHERE e.type = 'concert' AND e.is_publiek = 1
  `

  if (view === 'upcoming') {
    query += ` AND e.start_at >= datetime('now') ORDER BY e.start_at ASC`
  } else if (view === 'past') {
    query += ` AND e.start_at < datetime('now') ORDER BY e.start_at DESC`
  } else {
    // Default to upcoming
    query += ` AND e.start_at >= datetime('now') ORDER BY e.start_at ASC`
  }

  const concerten = await queryAll(c.env.DB, query)

  return c.html(
    <Layout title="Concerten" user={user} currentPath="/concerten">
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="text-center mb-8">
            <h1 class="text-5xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Concerten
            </h1>
            <p class="text-gray-600 text-lg">
              Ontdek onze aankomende optredens en bestel uw tickets
            </p>
          </div>

          {/* Toggle Buttons */}
          <div class="flex justify-center mb-12">
            <div class="inline-flex rounded-lg shadow-sm bg-white" role="group">
              <a
                href="/concerten?view=upcoming"
                class={`px-8 py-3 text-sm font-semibold rounded-l-lg border transition ${
                  view === 'upcoming'
                    ? 'bg-animato-primary text-white border-animato-primary'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <i class="fas fa-calendar-plus mr-2"></i>
                Toekomstige concerten
              </a>
              <a
                href="/concerten?view=past"
                class={`px-8 py-3 text-sm font-semibold rounded-r-lg border-t border-r border-b transition ${
                  view === 'past'
                    ? 'bg-animato-primary text-white border-animato-primary'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <i class="fas fa-history mr-2"></i>
                Afgelopen concerten
              </a>
            </div>
          </div>

          {concerten.length > 0 ? (
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {concerten.map((concert: any) => (
                <a
                  href={`/concerten/${concert.slug}`}
                  class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden"
                >
                  <div class="aspect-video bg-gray-200 overflow-hidden relative">
                    {concert.poster_url ? (
                      <img 
                        src={concert.poster_url} 
                        alt={concert.titel}
                        class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary">
                        <i class="fas fa-music text-white text-5xl opacity-50"></i>
                      </div>
                    )}
                    {concert.uitverkocht && (
                      <div class="absolute top-4 right-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        Uitverkocht
                      </div>
                    )}
                  </div>
                  <div class="p-6">
                    <h3 class="text-2xl font-bold text-gray-900 mb-3 group-hover:text-animato-primary transition">
                      {concert.titel}
                    </h3>
                    <div class="space-y-2 text-gray-600 mb-4">
                      <div class="flex items-center">
                        <i class="far fa-calendar mr-3 text-animato-primary"></i>
                        {new Date(concert.start_at).toLocaleDateString('nl-BE', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </div>
                      <div class="flex items-center">
                        <i class="far fa-clock mr-3 text-animato-primary"></i>
                        {new Date(concert.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} uur
                      </div>
                      <div class="flex items-center">
                        <i class="fas fa-map-marker-alt mr-3 text-animato-primary"></i>
                        {concert.locatie}
                      </div>
                    </div>
                    <span class="inline-flex items-center text-animato-primary font-semibold group-hover:underline">
                      {concert.uitverkocht ? 'Meer info' : 'Tickets & Info'}
                      <i class="fas fa-arrow-right ml-2"></i>
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div class="text-center py-16">
              <i class="fas fa-calendar-times text-gray-300 text-6xl mb-4"></i>
              <p class="text-xl text-gray-600">
                {view === 'past' 
                  ? 'Geen afgelopen concerten gevonden' 
                  : 'Momenteel geen aankomende concerten gepland'}
              </p>
              {view === 'upcoming' && (
                <p class="text-gray-500 mt-2">
                  Check binnenkort opnieuw voor updates!
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CONCERT DETAIL
// =====================================================

app.get('/concerten/:slug', async (c) => {
  const user = c.get('user')
  const slug = c.req.param('slug')

  const concert = await queryOne<any>(
    c.env.DB,
    `SELECT e.*, c.poster_url, c.programma, c.prijsstructuur, c.capaciteit, c.verkocht, c.uitverkocht, c.ticketing_enabled
     FROM events e
     LEFT JOIN concerts c ON c.event_id = e.id
     WHERE e.slug = ? AND e.type = 'concert'`,
    [slug]
  )

  if (!concert) {
    return c.notFound()
  }

  const prijzen = concert.prijsstructuur ? JSON.parse(concert.prijsstructuur) : []

  return c.html(
    <Layout title={concert.titel} description={concert.beschrijving} user={user}>
      <article class="py-12">
        {/* Hero image */}
        <div class="relative h-96 bg-gradient-to-br from-animato-primary to-animato-secondary mb-12">
          {concert.poster_url ? (
            <img 
              src={concert.poster_url} 
              alt={concert.titel}
              class="w-full h-full object-cover"
            />
          ) : (
            <div class="flex items-center justify-center h-full">
              <i class="fas fa-music text-white text-8xl opacity-30"></i>
            </div>
          )}
          <div class="absolute inset-0 bg-black bg-opacity-40"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="text-center text-white">
              <h1 class="text-5xl md:text-6xl font-bold mb-4" style="font-family: 'Playfair Display', serif;">
                {concert.titel}
              </h1>
              {concert.uitverkocht && (
                <div class="inline-block bg-red-500 text-white px-6 py-2 rounded-full text-lg font-semibold">
                  Uitverkocht
                </div>
              )}
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Main content */}
            <div class="lg:col-span-2">
              {/* Event info */}
              <div class="bg-white rounded-lg shadow-md p-8 mb-8">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div class="flex items-center">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                      <i class="far fa-calendar text-animato-primary text-xl"></i>
                    </div>
                    <div>
                      <div class="text-sm text-gray-500">Datum</div>
                      <div class="font-semibold">
                        {new Date(concert.start_at).toLocaleDateString('nl-BE', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                      <i class="far fa-clock text-animato-primary text-xl"></i>
                    </div>
                    <div>
                      <div class="text-sm text-gray-500">Aanvang</div>
                      <div class="font-semibold">
                        {new Date(concert.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} uur
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                      <i class="fas fa-map-marker-alt text-animato-primary text-xl"></i>
                    </div>
                    <div>
                      <div class="text-sm text-gray-500">Locatie</div>
                      <div class="font-semibold">{concert.locatie}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              {concert.beschrijving && (
                <div class="bg-white rounded-lg shadow-md p-8 mb-8">
                  <h2 class="text-2xl font-bold text-gray-900 mb-4">
                    Over dit concert
                  </h2>
                  <div class="prose prose-lg" dangerouslySetInnerHTML={{ __html: concert.beschrijving }} />
                </div>
              )}

              {/* Program */}
              {concert.programma && (
                <div class="bg-white rounded-lg shadow-md p-8">
                  <h2 class="text-2xl font-bold text-gray-900 mb-4">
                    Programma
                  </h2>
                  <div class="prose prose-lg" dangerouslySetInnerHTML={{ __html: concert.programma }} />
                </div>
              )}
            </div>

            {/* Sidebar - Ticketing */}
            <div class="lg:col-span-1">
              <div class="bg-white rounded-lg shadow-md p-8 sticky top-24">
                <h3 class="text-2xl font-bold text-gray-900 mb-6">
                  Tickets
                </h3>

                {concert.uitverkocht ? (
                  <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <i class="fas fa-exclamation-circle text-red-500 text-3xl mb-3"></i>
                    <p class="text-lg font-semibold text-red-800">
                      Uitverkocht
                    </p>
                    <p class="text-sm text-red-600 mt-2">
                      Dit concert is helaas volledig uitverkocht.
                    </p>
                  </div>
                ) : concert.ticketing_enabled ? (
                  <>
                    {/* Pricing */}
                    <div class="space-y-3 mb-6">
                      {prijzen.map((prijs: any) => (
                        <div class="flex justify-between items-center py-3 border-b border-gray-200">
                          <span class="text-gray-700">{prijs.categorie}</span>
                          <span class="text-xl font-bold text-animato-primary">
                            €{prijs.prijs}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Availability */}
                    {concert.capaciteit && (
                      <div class="mb-6">
                        <div class="flex justify-between text-sm text-gray-600 mb-2">
                          <span>Beschikbaarheid</span>
                          <span>{concert.capaciteit - concert.verkocht} / {concert.capaciteit}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            class="bg-animato-primary h-2 rounded-full"
                            style={`width: ${(concert.verkocht / concert.capaciteit * 100)}%`}
                          ></div>
                        </div>
                      </div>
                    )}

                    {/* Book button */}
                    <button
                      onclick="alert('Ticketing functie komt binnenkort beschikbaar!')"
                      class="w-full bg-animato-accent hover:bg-yellow-600 text-white py-4 rounded-lg font-bold text-lg transition shadow-lg"
                    >
                      <i class="fas fa-ticket-alt mr-2"></i>
                      Bestel Tickets
                    </button>

                    <p class="text-xs text-gray-500 text-center mt-4">
                      Veilige betaling via Stripe
                    </p>
                  </>
                ) : (
                  <div class="bg-gray-50 rounded-lg p-6 text-center">
                    <i class="fas fa-info-circle text-gray-400 text-3xl mb-3"></i>
                    <p class="text-gray-700">
                      Gratis toegang - geen tickets nodig
                    </p>
                  </div>
                )}

                {/* Add to calendar */}
                <div class="mt-6 pt-6 border-t border-gray-200">
                  <a
                    href={`/api/agenda/ics?event=${concert.id}`}
                    class="block text-center text-animato-primary hover:text-animato-secondary font-semibold transition"
                  >
                    <i class="far fa-calendar-plus mr-2"></i>
                    Toevoegen aan kalender
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Back button */}
          <div class="mt-12 text-center">
            <a 
              href="/concerten"
              class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
            >
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar concerten overzicht
            </a>
          </div>
        </div>
      </article>
    </Layout>
  )
})

export default app
