// Agenda & Concert routes
// Kalender, filters, ICS export, concert details

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
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

// Toggle birthday visibility via cookie
app.get('/agenda/toggle-verjaardagen', (c) => {
  const current = getCookie(c, 'show_birthdays')
  const newVal = current === '0' ? '1' : '0'
  setCookie(c, 'show_birthdays', newVal, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60, // 1 year
    httpOnly: false,
    sameSite: 'Lax'
  })
  const referer = c.req.header('referer') || '/agenda'
  return c.redirect(referer)
})

app.get('/agenda', async (c) => {
  const user = c.get('user')
  const type = c.req.query('type') || 'all'
  const maand = c.req.query('maand')
  const view = c.req.query('view') || 'list' // 'list' or 'calendar'
  const dateParam = c.req.query('date') || new Date().toISOString().split('T')[0]
  const isAdmin = (user as any)?.role === 'admin'

  // Birthday toggle — default ON for logged-in users
  const birthdayCookie = getCookie(c, 'show_birthdays')
  const showBirthdays = user ? (birthdayCookie !== '0') : false

  // Parse date for calendar view
  const currentDate = new Date(dateParam)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Calculate month range for calendar view
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  // Build query
  let query = `
    SELECT e.id, e.type, e.titel, e.slug, e.start_at, e.end_at, e.locatie, e.doelgroep, e.location_id,
           e.is_recurring, e.parent_event_id
    FROM events e
    WHERE (e.is_publiek = 1 OR (e.is_publiek = 0 AND ? IS NOT NULL))
  `

  const filters: any[] = [user ? user.id : null]

  if (view === 'list') {
    // List view: only show upcoming events
    query += ` AND e.start_at >= datetime('now')`
  } else {
    // Calendar view: show events in current month
    query += ` AND DATE(e.start_at) >= DATE(?) AND DATE(e.start_at) <= DATE(?)`
    filters.push(monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0])
  }

  if (type !== 'all') {
    query += ` AND e.type = ?`
    filters.push(type)
  }

  if (maand) {
    query += ` AND strftime('%Y-%m', e.start_at) = ?`
    filters.push(maand)
  }

  query += ` ORDER BY e.start_at ASC LIMIT 50`

  const rawEvents = await queryAll(c.env.DB, query, filters)

  // Fetch birthdays if enabled
  let birthdaysByDate: Record<string, any[]> = {}
  let birthdaysByMonth: Record<string, any[]> = {}
  if (showBirthdays && user) {
    let birthdayQuery = ''
    let birthdayFilters: any[] = []
    
    if (view === 'calendar') {
      // Get birthdays for this month
      const monthStr = String(month + 1).padStart(2, '0')
      birthdayQuery = `
        SELECT p.voornaam, p.achternaam, p.foto_url, p.geboortedatum, u.id as user_id, u.stemgroep
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        WHERE u.status = 'actief'
          AND p.geboortedatum IS NOT NULL
          AND strftime('%m', p.geboortedatum) = ?
        ORDER BY strftime('%d', p.geboortedatum) ASC
      `
      birthdayFilters = [monthStr]
    } else {
      // Get birthdays for the next 3 months from today
      const today = new Date()
      const mmddStart = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const future = new Date(today)
      future.setMonth(future.getMonth() + 3)
      const mmddEnd = `${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`
      
      // Handle year wrap (e.g. Nov -> Feb)
      if (mmddEnd < mmddStart) {
        birthdayQuery = `
          SELECT p.voornaam, p.achternaam, p.foto_url, p.geboortedatum, u.id as user_id, u.stemgroep
          FROM profiles p
          JOIN users u ON u.id = p.user_id
          WHERE u.status = 'actief'
            AND p.geboortedatum IS NOT NULL
            AND (strftime('%m-%d', p.geboortedatum) >= ? OR strftime('%m-%d', p.geboortedatum) <= ?)
          ORDER BY CASE
            WHEN strftime('%m-%d', p.geboortedatum) >= ? THEN 0 ELSE 1
          END, strftime('%m-%d', p.geboortedatum) ASC
        `
        birthdayFilters = [mmddStart, mmddEnd, mmddStart]
      } else {
        birthdayQuery = `
          SELECT p.voornaam, p.achternaam, p.foto_url, p.geboortedatum, u.id as user_id, u.stemgroep
          FROM profiles p
          JOIN users u ON u.id = p.user_id
          WHERE u.status = 'actief'
            AND p.geboortedatum IS NOT NULL
            AND strftime('%m-%d', p.geboortedatum) BETWEEN ? AND ?
          ORDER BY strftime('%m-%d', p.geboortedatum) ASC
        `
        birthdayFilters = [mmddStart, mmddEnd]
      }
    }
    
    const birthdayMembers = await queryAll<any>(c.env.DB, birthdayQuery, birthdayFilters)
    
    // Group by date (using current year for display)
    const currentYear = new Date().getFullYear()
    for (const bm of birthdayMembers as any[]) {
      if (!bm.geboortedatum) continue
      const mmdd = bm.geboortedatum.substring(5) // "MM-DD"
      const displayDate = `${currentYear}-${mmdd}`
      
      if (!birthdaysByDate[displayDate]) birthdaysByDate[displayDate] = []
      birthdaysByDate[displayDate].push(bm)
      
      // Also group by month label for list view
      const bdDate = new Date(displayDate)
      const monthLabel = bdDate.toLocaleDateString('nl-BE', { year: 'numeric', month: 'long' })
      if (!birthdaysByMonth[monthLabel]) birthdaysByMonth[monthLabel] = []
      birthdaysByMonth[monthLabel].push({ ...bm, displayDate })
    }
  }

  // Group recurring events (#41): in list view, collapse same-title weekly recurring events
  let events = rawEvents
  if (view === 'list') {
    const seen = new Map<string, any>()
    const collapsed: any[] = []
    for (const event of rawEvents as any[]) {
      if (event.is_recurring || event.parent_event_id) {
        const key = event.titel + '|' + event.type
        if (seen.has(key)) {
          // Increment count
          seen.get(key)._recurring_count = (seen.get(key)._recurring_count || 1) + 1
          seen.get(key)._recurring_last = event.start_at
        } else {
          event._recurring_count = 1
          event._recurring_grouped = true
          seen.set(key, event)
          collapsed.push(event)
        }
      } else {
        collapsed.push(event)
      }
    }
    events = collapsed
  }

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

      {/* ── ADMIN TOOLBAR ── */}
      {isAdmin && (
        <div class="bg-amber-50 border-b-2 border-amber-300 sticky top-0 z-40 shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2 text-amber-800 text-sm font-semibold">
              <i class="fas fa-tools text-amber-600"></i>
              <span>Beheerdersmodus</span>
              <span class="text-amber-500 font-normal">— beweeg over een event voor bewerkopties</span>
            </div>
            <div class="flex items-center gap-2">
              <a href="/admin/events/nieuw" class="inline-flex items-center gap-2 bg-animato-primary hover:bg-animato-secondary text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm">
                <i class="fas fa-plus"></i>Nieuw event
              </a>
              <a href="/admin/events/nieuw?type=concert" class="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm">
                <i class="fas fa-music"></i>Nieuw concert
              </a>
              <a href="/admin/events" class="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm">
                <i class="fas fa-cog"></i>Alle events beheren
              </a>
            </div>
          </div>
        </div>
      )}

      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="text-center mb-8">
            <h1 class="text-5xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Agenda
            </h1>
            <p class="text-gray-600 text-lg">
              Alle repetities, concerten en activiteiten op een rij
            </p>
          </div>

          {/* View Toggle */}
          <div class="flex justify-center mb-8">
            <div class="inline-flex rounded-lg shadow-sm bg-white" role="group">
              <a
                href={`/agenda?view=list&type=${type}`}
                class={`px-8 py-3 text-sm font-semibold rounded-l-lg border transition ${
                  view === 'list'
                    ? 'bg-animato-primary text-white border-animato-primary'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <i class="fas fa-list mr-2"></i>
                Lijst
              </a>
              <a
                href={`/agenda?view=calendar&type=${type}&date=${dateParam}`}
                class={`px-8 py-3 text-sm font-semibold rounded-r-lg border-t border-r border-b transition ${
                  view === 'calendar'
                    ? 'bg-animato-primary text-white border-animato-primary'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <i class="fas fa-calendar mr-2"></i>
                Kalender
              </a>
            </div>
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
                {/* Birthday toggle — only for logged-in users */}
                {user && (
                  <a
                    href="/agenda/toggle-verjaardagen"
                    class={`inline-flex items-center px-4 py-2 rounded-lg font-semibold transition border-2 ${
                      showBirthdays
                        ? 'bg-pink-50 border-pink-300 text-pink-700 hover:bg-pink-100'
                        : 'bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100'
                    }`}
                    title={showBirthdays ? 'Verjaardagen verbergen' : 'Verjaardagen tonen'}
                  >
                    <i class={`fas fa-birthday-cake mr-2 ${showBirthdays ? 'text-pink-500' : 'text-gray-400'}`}></i>
                    Verjaardagen
                    {showBirthdays
                      ? <span class="ml-2 text-xs bg-pink-200 text-pink-800 px-2 py-0.5 rounded-full">AAN</span>
                      : <span class="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">UIT</span>
                    }
                  </a>
                )}
                <a
                  href="/api/agenda/ics/all"
                  class="inline-flex items-center px-4 py-2 bg-animato-primary hover:bg-animato-secondary text-white rounded-lg font-semibold transition"
                  download="animato-agenda.ics"
                >
                  <i class="fas fa-calendar-alt mr-2"></i>
                  Exporteer naar kalender
                </a>
              </div>
            </div>
          </div>

          {/* LIST VIEW */}
          {view === 'list' && (Object.keys(eventsByMonth).length > 0 || Object.keys(birthdaysByMonth).length > 0) ? (
            <div class="space-y-12">
              {/* Merge event months and birthday months */}
              {(() => {
                const allMonths = new Set([...Object.keys(eventsByMonth), ...Object.keys(birthdaysByMonth)])
                // Sort months chronologically
                const sortedMonths = Array.from(allMonths).sort((a, b) => {
                  const parseMonth = (s: string) => {
                    const months: Record<string,number> = { januari:0, februari:1, maart:2, april:3, mei:4, juni:5, juli:6, augustus:7, september:8, oktober:9, november:10, december:11 }
                    const parts = s.split(' ')
                    return new Date(parseInt(parts[1] || '2026'), months[parts[0].toLowerCase()] || 0, 1).getTime()
                  }
                  return parseMonth(a) - parseMonth(b)
                })
                return sortedMonths.map((monthKey) => {
                  const monthEvents = eventsByMonth[monthKey] || []
                  const monthBirthdays = birthdaysByMonth[monthKey] || []
                  return (
                <div>
                  <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <i class="far fa-calendar-alt text-animato-primary mr-3"></i>
                    {monthKey}
                  </h2>
                  {/* Birthday cards for this month */}
                  {monthBirthdays.length > 0 && (
                    <div class="mb-4">
                      {/* Group birthdays by date */}
                      {(() => {
                        const byDate: Record<string, any[]> = {}
                        for (const bd of monthBirthdays) {
                          if (!byDate[bd.displayDate]) byDate[bd.displayDate] = []
                          byDate[bd.displayDate].push(bd)
                        }
                        return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, members]) => (
                          <div class="bg-gradient-to-r from-pink-50 to-amber-50 rounded-lg shadow-md border-l-4 border-pink-400 p-4 mb-3 flex items-center gap-4">
                            {/* Date block */}
                            <div class="flex-shrink-0 text-center bg-pink-100 rounded-lg p-3 w-20">
                              <div class="text-2xl">🎂</div>
                              <div class="text-lg font-bold text-pink-600">
                                {new Date(date).getDate()}
                              </div>
                              <div class="text-xs text-pink-500 uppercase">
                                {new Date(date).toLocaleDateString('nl-BE', { month: 'short' })}
                              </div>
                            </div>
                            {/* Members */}
                            <div class="flex-1">
                              <div class="flex items-center gap-2 mb-1">
                                <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-pink-100 text-pink-700">
                                  <i class="fas fa-birthday-cake mr-1"></i> Verjaardag
                                </span>
                              </div>
                              <div class="flex flex-wrap gap-3">
                                {members.map((m: any) => {
                                  const age = m.geboortedatum ? new Date(date).getFullYear() - new Date(m.geboortedatum).getFullYear() : null
                                  return (
                                  <div class="flex items-center gap-2">
                                    {m.foto_url
                                      ? <img src={m.foto_url} alt="" class="w-8 h-8 rounded-full object-cover border-2 border-pink-300" />
                                      : <div class="w-8 h-8 rounded-full bg-pink-200 flex items-center justify-center text-pink-600 text-xs font-bold border-2 border-pink-300">{(m.voornaam || '?')[0]}</div>
                                    }
                                    <span class="text-gray-800 font-semibold text-sm">
                                      {m.voornaam} {m.achternaam}
                                      {age && <span class="text-pink-500 text-xs ml-1">({age} jaar)</span>}
                                    </span>
                                  </div>
                                )})}
                              </div>
                            </div>
                            <div class="flex-shrink-0 text-3xl" title="Proficiat!">
                              🎉
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                  <div class="space-y-4">
                    {monthEvents.map((event: any) => {
                      const eventHref = event.type === 'concert' && event.slug
                        ? `/concerten/${event.slug}`
                        : event.slug
                          ? `/agenda/${event.slug}`
                          : null
                      return (
                      <div class="group relative bg-white rounded-lg shadow-md hover:shadow-lg transition">
                        <div
                          class={`block p-6 ${eventHref ? 'cursor-pointer' : 'cursor-default'}`}
                          onclick={eventHref ? `window.location.href='${eventHref}'` : 'showEventDetailFromEl(this)'}
                          data-event-id={String(event.id)}
                          data-event-type={event.type}
                          data-event-titel={event.titel}
                          data-event-start={event.start_at}
                          data-event-end={event.end_at || ''}
                          data-event-locatie={event.locatie || ''}
                          data-event-slug={event.slug || ''}
                          data-event-beschrijving={event.beschrijving || ''}
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
                                     event.type === 'activiteit' ? 'Activiteit' :
                                     'Overige'}
                                  </span>
                                  <h3 class="text-xl font-bold text-gray-900">
                                    {event.titel}
                                    {event._recurring_grouped && event._recurring_count > 1 && (
                                      <span class="ml-2 text-xs font-normal bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                                        <i class="fas fa-redo mr-1"></i>
                                        Wekelijks · volgende {event._recurring_count} weken
                                      </span>
                                    )}
                                  </h3>
                                </div>
                              </div>

                              <div class="space-y-2 text-gray-600">
                                <div class="flex items-center">
                                  <i class="far fa-clock w-5 text-animato-primary mr-3"></i>
                                  <span>
                                    {new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                                    {' - '}
                                    {event.end_at ? new Date(event.end_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '?'}
                                  </span>
                                </div>
                                <div class="flex items-center">
                                  <i class="fas fa-map-marker-alt w-5 text-animato-primary mr-3"></i>
                                  <span>{event.locatie}</span>
                                </div>
                                {event.doelgroep && event.doelgroep !== 'all' && (
                                  <div class="flex items-center">
                                    <i class="fas fa-users w-5 text-animato-primary mr-3"></i>
                                    <span>Voor: {{
                                      'S': 'Sopraan', 'A': 'Alt', 'T': 'Tenor', 'B': 'Bas',
                                      'SA': 'Sopraan & Alt', 'TB': 'Tenor & Bas'
                                    }[event.doelgroep] || event.doelgroep}</span>
                                  </div>
                                )}
                              </div>

                              <div class="mt-4">
                                <span class="inline-flex items-center text-animato-primary font-semibold hover:underline text-sm">
                                  {event.type === 'concert' ? 'Bekijk details & tickets' : 'Bekijk details'}
                                  <i class="fas fa-arrow-right ml-2"></i>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Admin edit button — appears on hover */}
                        {isAdmin && (
                          <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                            <a
                              href={`/admin/events/${event.id}`}
                              title="Bewerk event"
                              class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 transition"
                              onclick="event.preventDefault(); event.stopPropagation(); window.location.href=this.href;"
                            >
                              <i class="fas fa-edit"></i> Bewerk
                            </a>
                            <a
                              href={event.type === 'concert' && event.slug ? `/concerten/${event.slug}` : `#`}
                              title="Bekijk publieke pagina"
                              class={`${event.type === 'concert' && event.slug ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-400 cursor-not-allowed'} text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 transition`}
                              target="_blank"
                            >
                              <i class="fas fa-external-link-alt"></i> Publiek
                            </a>
                          </div>
                        )}
                      </div>
                    )})}
                  </div>
                </div>
                  )
                })
              })()}
            </div>
          ) : view === 'list' ? (
            <div class="text-center py-16">
              <i class="far fa-calendar-times text-gray-300 text-6xl mb-4"></i>
              <p class="text-xl text-gray-600">
                Geen aankomende activiteiten gevonden
              </p>
            </div>
          ) : null}

          {/* CALENDAR VIEW */}
          {view === 'calendar' && (
            <div>
              {/* Calendar Navigation */}
              <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                <div class="flex items-center justify-between">
                  <a
                    href={`/agenda?view=calendar&type=${type}&date=${new Date(year, month - 1, 1).toISOString().split('T')[0]}`}
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  >
                    <i class="fas fa-chevron-left mr-2"></i>
                    Vorige maand
                  </a>
                  <h2 class="text-2xl font-bold text-gray-900">
                    {new Date(year, month).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })}
                  </h2>
                  <a
                    href={`/agenda?view=calendar&type=${type}&date=${new Date(year, month + 1, 1).toISOString().split('T')[0]}`}
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  >
                    Volgende maand
                    <i class="fas fa-chevron-right ml-2"></i>
                  </a>
                </div>
              </div>

              {/* Calendar Grid */}
              <div class="bg-white rounded-lg shadow-md overflow-hidden">
                {renderCalendarGrid(events, year, month, birthdaysByDate)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event Detail Modal */}
      <div id="event-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black bg-opacity-60 p-4" onclick="if(event.target===this)closeEventModal()">
        <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
          <div id="event-modal-header" class="h-3 bg-animato-primary"></div>
          <div class="p-6">
            <div class="flex items-start justify-between mb-4">
              <div>
                <span id="event-modal-badge" class="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2 bg-blue-100 text-blue-800"></span>
                <h2 id="event-modal-title" class="text-2xl font-bold text-gray-900"></h2>
              </div>
              <button onclick="closeEventModal()" class="text-gray-400 hover:text-gray-600 ml-4 mt-1 text-xl flex-shrink-0">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="space-y-3 text-gray-600 mb-5">
              <div class="flex items-center gap-3">
                <i class="far fa-calendar text-animato-primary w-5 text-center"></i>
                <span id="event-modal-date"></span>
              </div>
              <div class="flex items-center gap-3">
                <i class="far fa-clock text-animato-primary w-5 text-center"></i>
                <span id="event-modal-time"></span>
              </div>
              <div class="flex items-center gap-3">
                <i class="fas fa-map-marker-alt text-animato-primary w-5 text-center"></i>
                <span id="event-modal-location"></span>
              </div>
              <div id="event-modal-desc-row" class="flex items-start gap-3 hidden">
                <i class="fas fa-info-circle text-animato-primary w-5 text-center mt-0.5"></i>
                <span id="event-modal-description" class="text-sm leading-relaxed"></span>
              </div>
            </div>
            <div class="flex gap-3">
              <a id="event-modal-ics" href="#" class="flex-1 text-center px-4 py-2 border border-animato-primary text-animato-primary rounded-lg text-sm font-semibold hover:bg-animato-primary hover:text-white transition" download>
                <i class="fas fa-calendar-plus mr-2"></i>Toevoegen aan kalender
              </a>
              <a id="event-modal-link" href="#" class="flex-1 text-center px-4 py-2 bg-animato-primary text-white rounded-lg text-sm font-semibold hover:bg-animato-secondary transition hidden">
                <i class="fas fa-external-link-alt mr-2"></i>Bekijk details
              </a>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{__html: `
        function showEventDetailFromEl(el) {
          var evt = {
            id: el.dataset.eventId,
            type: el.dataset.eventType,
            titel: el.dataset.eventTitel,
            start_at: el.dataset.eventStart,
            end_at: el.dataset.eventEnd,
            locatie: el.dataset.eventLocatie,
            slug: el.dataset.eventSlug,
            beschrijving: el.dataset.eventBeschrijving
          };
          showEventModal(evt);
        }
        function showEventModal(evt) {
          const modal = document.getElementById('event-modal');
          const typeColors = {
            concert: 'bg-yellow-100 text-yellow-800',
            repetitie: 'bg-blue-100 text-blue-800',
            activiteit: 'bg-green-100 text-green-800',
            ander: 'bg-gray-100 text-gray-800'
          };
          const typeLabels = {
            concert: 'Concert', repetitie: 'Repetitie',
            activiteit: 'Activiteit', ander: 'Overige'
          };
          const headerColors = {
            concert: '#f59e0b', repetitie: '#3b82f6',
            activiteit: '#10b981', ander: '#6b7280'
          };

          document.getElementById('event-modal-title').textContent = evt.titel || '';
          document.getElementById('event-modal-badge').className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2 ' + (typeColors[evt.type] || 'bg-gray-100 text-gray-800');
          document.getElementById('event-modal-badge').textContent = typeLabels[evt.type] || evt.type;
          document.getElementById('event-modal-header').style.backgroundColor = headerColors[evt.type] || '#6b7280';

          const start = new Date(evt.start_at);
          const end = evt.end_at ? new Date(evt.end_at) : null;
          document.getElementById('event-modal-date').textContent = start.toLocaleDateString('nl-BE', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
          document.getElementById('event-modal-time').textContent = start.toLocaleTimeString('nl-BE', {hour:'2-digit', minute:'2-digit'}) + (end ? ' – ' + end.toLocaleTimeString('nl-BE', {hour:'2-digit', minute:'2-digit'}) : '');
          document.getElementById('event-modal-location').textContent = evt.locatie || 'Locatie onbekend';

          const descRow = document.getElementById('event-modal-desc-row');
          if (evt.beschrijving) {
            document.getElementById('event-modal-description').textContent = evt.beschrijving;
            descRow.classList.remove('hidden');
          } else {
            descRow.classList.add('hidden');
          }

          document.getElementById('event-modal-ics').href = '/api/agenda/ics?event=' + evt.id;

          const linkBtn = document.getElementById('event-modal-link');
          if (evt.type === 'concert' && evt.slug) {
            linkBtn.href = '/concerten/' + evt.slug;
            linkBtn.classList.remove('hidden');
          } else if (evt.slug) {
            linkBtn.href = '/agenda/' + evt.slug;
            linkBtn.classList.remove('hidden');
          } else {
            linkBtn.classList.add('hidden');
          }

          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
        function closeEventModal() {
          const modal = document.getElementById('event-modal');
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEventModal(); });
      `}} />
    </Layout>
  )
})

// =====================================================
// CONCERTEN OVERZICHT
// =====================================================

app.get('/concerten', async (c) => {
  const user = c.get('user')
  const view = c.req.query('view') || 'upcoming'
  const isAdmin = (user as any)?.role === 'admin'

  // Query based on view parameter — admins also see non-public concerts
  let query = `
    SELECT e.*, c.poster_url, c.programma, c.uitverkocht,
           COALESCE(c.poster_url, e.image_url) as display_image
    FROM events e
    LEFT JOIN concerts c ON c.event_id = e.id
    WHERE e.type = 'concert'${isAdmin ? '' : ' AND e.is_publiek = 1'}
  `

  if (view === 'upcoming') {
    query += ` AND e.start_at >= datetime('now') ORDER BY e.start_at ASC`
  } else if (view === 'past') {
    query += ` AND e.start_at < datetime('now') ORDER BY e.start_at DESC`
  } else {
    query += ` AND e.start_at >= datetime('now') ORDER BY e.start_at ASC`
  }

  const concerten = await queryAll(c.env.DB, query)

  return c.html(
    <Layout title="Concerten" user={user} currentPath="/concerten">
      {/* ── ADMIN TOOLBAR ── */}
      {isAdmin && (
        <div class="bg-amber-50 border-b-2 border-amber-300 sticky top-0 z-40 shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2 text-amber-800 text-sm font-semibold">
              <i class="fas fa-tools text-amber-600"></i>
              <span>Beheerdersmodus</span>
              <span class="text-amber-500 font-normal">— {concerten.length} concert(en) geladen (incl. niet-publiek)</span>
            </div>
            <div class="flex items-center gap-2">
              <a
                href="/admin/events/nieuw?type=concert"
                class="inline-flex items-center gap-2 bg-animato-primary hover:bg-animato-secondary text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm"
              >
                <i class="fas fa-plus"></i>
                Nieuw concert
              </a>
              <a
                href="/admin/events?type=concert"
                class="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm"
              >
                <i class="fas fa-cog"></i>
                Beheer alle events
              </a>
            </div>
          </div>
        </div>
      )}

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
                <div class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden relative">
                  {/* Admin: niet-publiek badge */}
                  {isAdmin && !concert.is_publiek && (
                    <div class="absolute top-2 left-2 z-10 bg-gray-800 text-white text-xs font-bold px-2 py-1 rounded-full opacity-90">
                      <i class="fas fa-eye-slash mr-1"></i>Niet publiek
                    </div>
                  )}
                  <a href={`/concerten/${concert.slug}`} class="block">
                    <div class="aspect-video bg-gray-200 overflow-hidden relative">
                      {(concert.display_image || concert.poster_url) ? (
                        <img 
                          src={concert.display_image || concert.poster_url} 
                          alt={concert.titel}
                          class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      ) : (
                        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary">
                          <i class="fas fa-music text-white text-5xl opacity-50"></i>
                        </div>
                      )}
                      {concert.uitverkocht == 1 && (
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
                      {view !== 'past' && (
                        <span class="inline-flex items-center text-animato-primary font-semibold group-hover:underline">
                          {concert.uitverkocht == 1 ? 'Meer info' : 'Meer info & Tickets'}
                          <i class="fas fa-arrow-right ml-2"></i>
                        </span>
                      )}
                    </div>
                  </a>
                  {/* Admin action bar per card */}
                  {isAdmin && (
                    <div class="px-6 pb-4 border-t border-amber-100 bg-amber-50">
                      <div class="flex items-center justify-between flex-wrap gap-2 mt-3">
                        <a
                          href={`/admin/events/${concert.id}`}
                          class="inline-flex items-center gap-2 text-amber-700 hover:text-amber-900 text-sm font-semibold transition"
                        >
                          <i class="fas fa-edit"></i>
                          Bewerken
                        </a>
                        <div class="flex items-center gap-3">
                          <button
                            onclick={`togglePubliek(${concert.id}, ${concert.is_publiek ? 0 : 1})`}
                            class={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded transition ${
                              concert.is_publiek
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            title={concert.is_publiek ? 'Klik om te verbergen' : 'Klik om publiek te maken'}
                          >
                            <i class={`fas ${concert.is_publiek ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                            {concert.is_publiek ? 'Publiek' : 'Verborgen'}
                          </button>
                          <button
                            onclick={`if(confirm('Weet je zeker dat je dit concert wilt verwijderen?')) deleteConcert(${concert.id})`}
                            class="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-700 transition"
                            title="Verwijder concert"
                          >
                            <i class="fas fa-trash-alt"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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
                <>
                  <p class="text-gray-500 mt-2">Check binnenkort opnieuw voor updates!</p>
                  {isAdmin && (
                    <a
                      href="/admin/events/nieuw?type=concert"
                      class="inline-flex items-center gap-2 mt-6 bg-animato-primary hover:bg-animato-secondary text-white font-semibold px-6 py-3 rounded-lg transition shadow-sm"
                    >
                      <i class="fas fa-plus"></i>
                      Voeg eerste concert toe
                    </a>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Admin CRUD scripts */}
      {isAdmin && (
        <script dangerouslySetInnerHTML={{__html: `
          async function togglePubliek(eventId, newValue) {
            try {
              const res = await fetch('/admin/events/' + eventId + '/toggle-publiek', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_publiek: newValue })
              });
              const data = await res.json();
              if (data.success) {
                window.location.reload();
              } else {
                alert('Fout bij wijzigen zichtbaarheid: ' + (data.error || 'Onbekende fout'));
              }
            } catch (e) {
              alert('Netwerkfout: ' + e.message);
            }
          }

          async function deleteConcert(eventId) {
            try {
              const res = await fetch('/admin/events/' + eventId + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });
              const data = await res.json();
              if (data.success) {
                window.location.reload();
              } else {
                alert('Fout bij verwijderen: ' + (data.error || 'Onbekende fout'));
              }
            } catch (e) {
              alert('Netwerkfout: ' + e.message);
            }
          }
        `}} />
      )}
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

  const isAdmin = (user as any)?.role === 'admin'

  return c.html(
    <Layout title={concert.titel} description={concert.beschrijving} user={user}>
      <article class="py-12">

        {/* ── ADMIN TOOLBAR ── only visible for admins ── */}
        {isAdmin && (
          <div class="bg-amber-50 border-b-2 border-amber-300 sticky top-0 z-40 shadow-sm">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2 text-amber-800 text-sm font-semibold">
                <i class="fas fa-tools text-amber-600"></i>
                <span>Beheerdersmodus</span>
                <span class="text-amber-500 font-normal">— je bekijkt de publieke pagina</span>
              </div>
              <div class="flex items-center gap-2">
                <a
                  href={`/admin/events/${concert.id}`}
                  class="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm"
                >
                  <i class="fas fa-edit"></i>
                  Bewerk dit concert
                </a>
                <a
                  href="/admin/events/nieuw?type=concert"
                  class="inline-flex items-center gap-2 bg-animato-primary hover:bg-animato-secondary text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm"
                >
                  <i class="fas fa-plus"></i>
                  Nieuw concert
                </a>
                <a
                  href="/admin/events"
                  class="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-sm font-semibold px-4 py-2 rounded-lg transition shadow-sm"
                >
                  <i class="fas fa-list"></i>
                  Alle events
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Hero image */}
        <div class="relative h-96 bg-gradient-to-br from-animato-primary to-animato-secondary mb-12">
          {(concert.poster_url || concert.image_url) ? (
            <img 
              src={concert.poster_url || concert.image_url} 
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
              {concert.uitverkocht == 1 && (
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

                {concert.uitverkocht == 1 ? (
                  <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <i class="fas fa-exclamation-circle text-red-500 text-3xl mb-3"></i>
                    <p class="text-lg font-semibold text-red-800">
                      Uitverkocht
                    </p>
                    <p class="text-sm text-red-600 mt-2">
                      Dit concert is helaas volledig uitverkocht.
                    </p>
                  </div>
                ) : concert.ticketing_enabled == 1 ? (
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
                    {concert.capaciteit > 0 && (
                      <div class="mb-6">
                        <div class="flex justify-between text-sm text-gray-600 mb-2">
                          <span>Beschikbaarheid</span>
                          <span>{concert.capaciteit - (concert.verkocht || 0)} / {concert.capaciteit}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            class="bg-animato-primary h-2 rounded-full"
                            style={`width: ${Math.min(((concert.verkocht || 0) / concert.capaciteit * 100), 100)}%`}
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

// =====================================================
// GENERIEKE EVENT DETAIL PAGINA
// =====================================================

app.get('/agenda/:slug', async (c) => {
  const user = c.get('user')
  const slug = c.req.param('slug')

  const event = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM events WHERE slug = ?`,
    [slug]
  )

  if (!event) {
    return c.notFound()
  }

  // Als het een concert is, redirect naar /concerten/:slug
  if (event.type === 'concert') {
    return c.redirect(`/concerten/${slug}`)
  }

  return c.html(
    <Layout title={event.titel} description={event.beschrijving} user={user}>
      <article class="py-12 bg-gray-50">
        {/* Hero section */}
        <div class="relative h-64 bg-gradient-to-br from-animato-primary to-animato-secondary mb-12">
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="text-center text-white">
              <h1 class="text-4xl md:text-5xl font-bold mb-2" style="font-family: 'Playfair Display', serif;">
                {event.titel}
              </h1>
              <div class="text-lg opacity-90">
                {event.type === 'repetitie' && '🎵 Repetitie'}
                {event.type === 'activiteit' && '🎉 Activiteit'}
                {event.type === 'workshop' && '📚 Workshop'}
                {event.type === 'vergadering' && '📋 Vergadering'}
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Event info card */}
          <div class="bg-white rounded-lg shadow-md p-8 mb-8">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="flex items-center">
                <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <i class="far fa-calendar text-animato-primary text-xl"></i>
                </div>
                <div>
                  <div class="text-sm text-gray-500">Datum</div>
                  <div class="font-semibold">
                    {new Date(event.start_at).toLocaleDateString('nl-BE', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
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
                  <div class="text-sm text-gray-500">Tijd</div>
                  <div class="font-semibold">
                    {new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                    {event.end_at && ` - ${new Date(event.end_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
              </div>

              <div class="flex items-center">
                <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <i class="fas fa-map-marker-alt text-animato-primary text-xl"></i>
                </div>
                <div>
                  <div class="text-sm text-gray-500">Locatie</div>
                  <div class="font-semibold">{event.locatie || 'Geen locatie opgegeven'}</div>
                </div>
              </div>
            </div>

            {/* Doelgroep badge */}
            {event.doelgroep && event.doelgroep !== 'all' && (
              <div class="mt-6 pt-6 border-t border-gray-200">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800">
                  <i class="fas fa-users mr-2"></i>
                  {event.doelgroep === 'S' && 'Sopraan'}
                  {event.doelgroep === 'A' && 'Alt'}
                  {event.doelgroep === 'T' && 'Tenor'}
                  {event.doelgroep === 'B' && 'Bas'}
                  {event.doelgroep === 'SATB' && 'Alle stemmen'}
                  {event.doelgroep.includes(',') && 'Meerdere stemgroepen'}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          {event.beschrijving && (
            <div class="bg-white rounded-lg shadow-md p-8 mb-8">
              <h2 class="text-2xl font-bold text-gray-900 mb-4">
                Details
              </h2>
              <div class="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: event.beschrijving }} />
            </div>
          )}

          {/* Back button */}
          <div class="text-center">
            <a 
              href="/agenda"
              class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
            >
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar agenda
            </a>
          </div>
        </div>
      </article>
    </Layout>
  )
})

// =====================================================
// HELPER: RENDER CALENDAR GRID
// =====================================================

function renderCalendarGrid(events: any[], year: number, month: number, birthdaysByDate: Record<string, any[]> = {}) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1 // Monday = 0

  // Build calendar grid
  const weeks: any[][] = []
  let currentWeek: any[] = []

  // Fill empty cells before month starts
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push(null)
  }

  // Fill days of month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dayEvents = events.filter((e: any) => e.start_at.startsWith(dateStr))
    const dayBirthdays = birthdaysByDate[dateStr] || []
    
    currentWeek.push({ day, date: dateStr, events: dayEvents, birthdays: dayBirthdays })

    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  // Fill remaining cells
  while (currentWeek.length > 0 && currentWeek.length < 7) {
    currentWeek.push(null)
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek)
  }

  const dayNames = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

  return (
    <div class="p-4">
      {/* Day headers */}
      <div class="grid grid-cols-7 gap-2 mb-2">
        {dayNames.map(name => (
          <div class="text-center font-semibold text-gray-600 py-2">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      {weeks.map((week) => (
        <div class="grid grid-cols-7 gap-2 mb-2">
          {week.map((cell: any) => (
            <div class={`min-h-[120px] p-2 rounded-lg border-2 ${
              cell 
                ? ((cell.events.length > 0 || (cell.birthdays || []).length > 0)
                    ? ((cell.birthdays || []).length > 0
                        ? 'bg-pink-50/50 border-pink-300/40 shadow-sm'
                        : 'bg-white border-animato-primary/30 shadow-sm')
                    : 'bg-white border-gray-100 hover:bg-gray-50') 
                : 'bg-gray-50 border-transparent'
            }`}>
              {cell && (
                <div>
                  <div class={`text-right text-sm font-semibold mb-1 ${
                    (cell.events.length > 0 || (cell.birthdays || []).length > 0) ? 'text-animato-primary' : 'text-gray-500'
                  }`}>
                    {(cell.birthdays || []).length > 0 && (
                      <span class="mr-1 text-pink-500" title="Verjaardag!">🎂</span>
                    )}
                    {cell.day}
                    {(cell.events.length + (cell.birthdays || []).length) > 0 && (
                      <span class={`ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full text-white ${
                        (cell.birthdays || []).length > 0 ? 'bg-pink-500' : 'bg-animato-primary'
                      }`}>
                        {cell.events.length + (cell.birthdays || []).length}
                      </span>
                    )}
                  </div>
                  <div class="space-y-1">
                    {/* Birthday entries */}
                    {(cell.birthdays || []).map((bm: any) => (
                      <span
                        class="block text-xs px-2 py-1.5 rounded-md truncate font-medium shadow-sm bg-pink-100 text-pink-800 border-l-4 border-pink-400"
                        title={`🎂 ${bm.voornaam} ${bm.achternaam} - Verjaardag!`}
                      >
                        🎂 {bm.voornaam} {bm.achternaam}
                      </span>
                    ))}
                    {cell.events.slice(0, 3 - (cell.birthdays || []).length).map((event: any) => {
                      const eventHref = event.type === 'concert' && event.slug
                        ? `/concerten/${event.slug}`
                        : event.slug
                          ? `/agenda/${event.slug}`
                          : null
                      return (
                      <span
                        onclick={eventHref ? `window.location.href='${eventHref}'` : 'showEventDetailFromEl(this)'}
                        data-event-id={String(event.id)}
                        data-event-type={event.type}
                        data-event-titel={event.titel}
                        data-event-start={event.start_at}
                        data-event-end={event.end_at || ''}
                        data-event-locatie={event.locatie || ''}
                        data-event-slug={event.slug || ''}
                        data-event-beschrijving={event.beschrijving || ''}
                        class={`block text-xs px-2 py-1.5 rounded-md truncate hover:opacity-80 transition cursor-pointer font-medium shadow-sm ${
                          event.type === 'concert' ? 'bg-yellow-200 text-yellow-900 border-l-4 border-yellow-500' :
                          event.type === 'repetitie' ? 'bg-blue-200 text-blue-900 border-l-4 border-blue-500' :
                          event.type === 'activiteit' ? 'bg-green-200 text-green-900 border-l-4 border-green-500' :
                          event.type === 'workshop' ? 'bg-purple-200 text-purple-900 border-l-4 border-purple-500' :
                          'bg-gray-200 text-gray-800 border-l-4 border-gray-500'
                        }`}
                        title={`${event.titel} - ${new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`}
                      >
                        {new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} {event.titel}
                      </span>
                      )
                    })}
                    {(cell.events.length + (cell.birthdays || []).length) > 3 && (
                      <div class="text-xs text-animato-primary font-semibold text-center mt-1">
                        +{(cell.events.length + (cell.birthdays || []).length) - 3} meer
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default app
