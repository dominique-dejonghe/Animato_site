// Agenda & Concert routes
// Kalender, filters, ICS export, concert details

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { optionalAuth } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'
import { processBodyLinks } from '../utils/text'
import { formatBrusselsTime, formatBrusselsDate, formatBrusselsDateTime, parseBrusselsDate } from '../utils/time'
import { notifyUserIfEnabled } from '../utils/notifications'
import { getReactionsForTargets } from '../utils/comment-reactions'

// Helper: hosts die als 'intern' gelden bij rich-text linkprocessing (#90)
function siteHosts(url: string): string[] {
  try {
    return [new URL(url).hostname, 'animato-live.pages.dev', 'animato.be', 'www.animato.be']
  } catch {
    return ['animato-live.pages.dev', 'animato.be', 'www.animato.be']
  }
}

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

  // Markeer dit als sectiebezoek voor "Nieuw sinds vorige bezoek"-badges
  if (user && (user as any).id) {
    try {
      const { markSectionVisit } = await import('../utils/section-visits')
      await markSectionVisit(c.env.DB, (user as any).id, 'agenda')
    } catch (_) {}
  }

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
    query += ` AND datetime(e.start_at) >= datetime('now')`
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
      // Get ALL birthdays for the full calendar year, starting from today —
      // OF van een door gebruiker gekozen startmaand (?birthday_start=09 = vanaf september).
      // Default = vandaag. Verjaardagen die al voorbij zijn rollen door naar
      // het volgende jaar zodat de lijst chronologisch 12 maanden vooruit loopt.
      const today = new Date()
      const startMonthQ = (c.req.query('birthday_start') || '').trim()
      let mmddStart: string
      if (/^(0?[1-9]|1[0-2])$/.test(startMonthQ)) {
        // Geldige maand 1-12 → start op de eerste van die maand
        mmddStart = `${startMonthQ.padStart(2, '0')}-01`
      } else {
        mmddStart = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      }

      birthdayQuery = `
        SELECT p.voornaam, p.achternaam, p.foto_url, p.geboortedatum, u.id as user_id, u.stemgroep
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        WHERE u.status = 'actief'
          AND p.geboortedatum IS NOT NULL
        ORDER BY
          CASE WHEN strftime('%m-%d', p.geboortedatum) >= ? THEN 0 ELSE 1 END,
          strftime('%m-%d', p.geboortedatum) ASC
      `
      birthdayFilters = [mmddStart]
    }
    
    const birthdayMembers = await queryAll<any>(c.env.DB, birthdayQuery, birthdayFilters)

    // Group by date
    // - In calendar view: altijd huidige jaar (view toont één specifieke maand)
    // - In list view: verjaardagen die al voorbij zijn (relatief tot startMmdd)
    //   rollen over naar volgend jaar, zodat de lijst 12 maanden vooruit loopt
    //   in chronologische volgorde.
    const today = new Date()
    const currentYear = today.getFullYear()
    const startMonthQ = (c.req.query('birthday_start') || '').trim()
    const startMmdd = (/^(0?[1-9]|1[0-2])$/.test(startMonthQ))
      ? `${startMonthQ.padStart(2, '0')}-01`
      : `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    for (const bm of birthdayMembers as any[]) {
      if (!bm.geboortedatum) continue
      const mmdd = bm.geboortedatum.substring(5) // "MM-DD"
      const yearForDisplay = (view !== 'calendar' && mmdd < startMmdd)
        ? currentYear + 1
        : currentYear
      const displayDate = `${yearForDisplay}-${mmdd}`

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
    const monthKey = formatBrusselsDate(event.start_at, { year: 'numeric', month: 'long' })
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
          {user && (
            <div class="mb-4">
              <a href="/leden" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
                <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
              </a>
            </div>
          )}
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
                  <option value="vergadering" selected={type === 'vergadering'}>Vergaderingen</option>
                  <option value="activiteit" selected={type === 'activiteit'}>Activiteiten</option>
                  <option value="workshop" selected={type === 'workshop'}>Workshops</option>
                  <option value="uitstap" selected={type === 'uitstap'}>Uitstappen</option>
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
                {/* #98 — Startmaand voor verjaardagslijst (alleen in list view) */}
                {user && showBirthdays && view !== 'calendar' && (
                  <select
                    onchange="(function(s){var u=new URL(location.href); if(s.value){u.searchParams.set('birthday_start', s.value);}else{u.searchParams.delete('birthday_start');} location.href=u.toString();})(this)"
                    class="px-3 py-2 border-2 border-pink-200 bg-pink-50 text-pink-700 rounded-lg text-sm font-medium hover:bg-pink-100 cursor-pointer"
                    title="Vanaf welke maand wil je verjaardagen tonen?"
                  >
                    <option value="">Vanaf vandaag</option>
                    {[
                      ['01','januari'], ['02','februari'], ['03','maart'], ['04','april'],
                      ['05','mei'], ['06','juni'], ['07','juli'], ['08','augustus'],
                      ['09','september'], ['10','oktober'], ['11','november'], ['12','december']
                    ].map(([v, label]) => (
                      <option value={v} selected={(c.req.query('birthday_start') || '').padStart(2,'0') === v}>
                        Vanaf {label}
                      </option>
                    ))}
                  </select>
                )}
                <div class="relative inline-block" id="export-dropdown-wrapper">
                  <button
                    type="button"
                    onclick="document.getElementById('export-dropdown').classList.toggle('hidden')"
                    class="inline-flex items-center px-4 py-2 bg-animato-primary hover:bg-animato-secondary text-white rounded-lg font-semibold transition"
                  >
                    <i class="fas fa-calendar-alt mr-2"></i>
                    Exporteer
                    <i class="fas fa-chevron-down ml-2 text-xs"></i>
                  </button>
                  <div id="export-dropdown" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-1">
                    <a href="/api/agenda/ics/all" download="animato-agenda.ics" class="flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition">
                      <i class="fas fa-download w-6 text-gray-400"></i>
                      <div>
                        <div class="font-medium">Download ICS</div>
                        <div class="text-xs text-gray-400">Apple / Android / Outlook</div>
                      </div>
                    </a>
                    <a href="#" id="export-google-all" target="_blank" rel="noopener" class="flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition">
                      <i class="fab fa-google w-6 text-red-500"></i>
                      <div>
                        <div class="font-medium">Google Calendar</div>
                        <div class="text-xs text-gray-400">Abonneren via webcal</div>
                      </div>
                    </a>
                    <a href="#" id="export-outlook-all" target="_blank" rel="noopener" class="flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition">
                      <i class="fab fa-microsoft w-6 text-blue-500"></i>
                      <div>
                        <div class="font-medium">Outlook.com</div>
                        <div class="text-xs text-gray-400">Abonneren via webcal</div>
                      </div>
                    </a>
                  </div>
                </div>
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
                                  const age = m.geboortedatum
                                    ? ((parseBrusselsDate(date)?.getFullYear() ?? 0) - (parseBrusselsDate(m.geboortedatum + 'T00:00:00')?.getFullYear() ?? 0))
                                    : null
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
                                {formatBrusselsDate(event.start_at, { day: 'numeric' })}
                              </div>
                              <div class="text-sm text-gray-600 uppercase">
                                {formatBrusselsDate(event.start_at, { month: 'short' })}
                              </div>
                            </div>

                            {/* Event info */}
                            <div class="flex-1">
                              <div class="flex items-start justify-between mb-2">
                                <div>
                                  <span class={`inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2 ${
                                    event.type === 'concert'     ? 'bg-yellow-100 text-yellow-800' :
                                    event.type === 'repetitie'   ? 'bg-blue-100 text-blue-800' :
                                    event.type === 'vergadering' ? 'bg-indigo-100 text-indigo-800' :
                                    event.type === 'activiteit'  ? 'bg-green-100 text-green-800' :
                                    event.type === 'workshop'    ? 'bg-purple-100 text-purple-800' :
                                    event.type === 'uitstap'     ? 'bg-pink-100 text-pink-800' :
                                    'bg-gray-100 text-gray-800'
                                  }`}>
                                    {event.type === 'concert'     ? '🎤 Concert' :
                                     event.type === 'repetitie'   ? '🎵 Repetitie' :
                                     event.type === 'vergadering' ? '📋 Vergadering' :
                                     event.type === 'activiteit'  ? '🎉 Activiteit' :
                                     event.type === 'workshop'    ? '📚 Workshop' :
                                     event.type === 'uitstap'     ? '🚌 Uitstap' :
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
                                    {formatBrusselsTime(event.start_at)}
                                    {' - '}
                                    {event.end_at ? formatBrusselsTime(event.end_at) : '?'}
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
            <div class="grid grid-cols-3 gap-2 mb-2">
              <a id="event-modal-google" href="#" target="_blank" rel="noopener" class="text-center px-3 py-2 border border-red-300 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 transition">
                <i class="fab fa-google mr-1"></i>Google
              </a>
              <a id="event-modal-outlook" href="#" target="_blank" rel="noopener" class="text-center px-3 py-2 border border-blue-300 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-50 transition">
                <i class="fab fa-microsoft mr-1"></i>Outlook
              </a>
              <a id="event-modal-ics" href="#" class="text-center px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 transition" download>
                <i class="fas fa-download mr-1"></i>ICS
              </a>
            </div>
            <div class="flex gap-3">
              <a id="event-modal-link" href="#" class="flex-1 text-center px-4 py-2 bg-animato-primary text-white rounded-lg text-sm font-semibold hover:bg-animato-secondary transition hidden">
                <i class="fas fa-comments mr-2"></i>Details &amp; reacties
              </a>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{__html: `
        // Export dropdown: webcal links + close on outside click
        (function() {
          var base = location.origin + '/api/agenda/ics/all';
          var webcal = base.replace('https://', 'webcal://').replace('http://', 'webcal://');
          var gSub = document.getElementById('export-google-all');
          var oSub = document.getElementById('export-outlook-all');
          if (gSub) gSub.href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
          if (oSub) oSub.href = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(webcal) + '&name=Animato';
          document.addEventListener('click', function(e) {
            var dd = document.getElementById('export-dropdown');
            var wr = document.getElementById('export-dropdown-wrapper');
            if (dd && wr && !wr.contains(e.target)) dd.classList.add('hidden');
          });
        })();

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
            document.getElementById('event-modal-description').innerHTML = evt.beschrijving;
            descRow.classList.remove('hidden');
          } else {
            descRow.classList.add('hidden');
          }

          document.getElementById('event-modal-ics').href = '/api/agenda/ics?event=' + evt.id;

          // === Robuuste datum-normalisatie ===
          // DB-formaten kunnen zijn: "2025-11-26T19:30",  "2025-12-03T19:30:00.000Z",
          // "2025-11-26 19:30:00", "2025-11-26T19:30:00", etc.
          // Voor Google: compact ISO basic format YYYYMMDDTHHMMSSZ (in UTC)
          // Voor Outlook: ISO extended format YYYY-MM-DDTHH:MM:SSZ
          function parseDateFlexible(s) {
            if (!s) return null;
            // Voeg seconden toe als ze ontbreken: "2025-11-26T19:30" -> "2025-11-26T19:30:00"
            var n = String(s).trim();
            if (n.includes(' ') && !n.includes('T')) n = n.replace(' ', 'T');
            if (/T\\d{2}:\\d{2}$/.test(n)) n += ':00';
            // Als er geen timezone-suffix is, behandel als lokale tijd (Belgische tijd)
            // Maar wij gaan ervan uit dat DB-tijden Belgisch zijn, dus we maken er een Date van
            var d = new Date(n);
            if (isNaN(d.getTime())) return null;
            return d;
          }
          function toGoogleFormat(d) {
            // YYYYMMDDTHHMMSSZ (UTC)
            var pad = function(x) { return String(x).padStart(2, '0'); };
            return d.getUTCFullYear()
              + pad(d.getUTCMonth() + 1)
              + pad(d.getUTCDate()) + 'T'
              + pad(d.getUTCHours())
              + pad(d.getUTCMinutes())
              + pad(d.getUTCSeconds()) + 'Z';
          }
          function toOutlookFormat(d) {
            // ISO 8601 extended: 2025-12-03T18:30:00.000Z
            return d.toISOString();
          }

          var startDate = parseDateFlexible(evt.start_at);
          var endDate = parseDateFlexible(evt.end_at) || (startDate ? new Date(startDate.getTime() + 60*60*1000) : null);
          var details = (evt.beschrijving || '').replace(/<[^>]*>/g, '').substring(0, 500);

          // Google Calendar link
          if (startDate && endDate) {
            var gUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
              + '&text=' + encodeURIComponent(evt.titel)
              + '&dates=' + toGoogleFormat(startDate) + '/' + toGoogleFormat(endDate)
              + '&location=' + encodeURIComponent(evt.locatie || '')
              + '&details=' + encodeURIComponent(details);
            document.getElementById('event-modal-google').href = gUrl;
            document.getElementById('event-modal-google').style.pointerEvents = '';
            document.getElementById('event-modal-google').style.opacity = '';
          } else {
            document.getElementById('event-modal-google').href = '#';
            document.getElementById('event-modal-google').style.pointerEvents = 'none';
            document.getElementById('event-modal-google').style.opacity = '0.4';
          }

          // Outlook.com link
          if (startDate && endDate) {
            var oUrl = 'https://outlook.live.com/calendar/0/deeplink/compose?rru=addevent&path=/calendar/action/compose'
              + '&subject=' + encodeURIComponent(evt.titel)
              + '&startdt=' + encodeURIComponent(toOutlookFormat(startDate))
              + '&enddt=' + encodeURIComponent(toOutlookFormat(endDate))
              + '&location=' + encodeURIComponent(evt.locatie || '')
              + '&body=' + encodeURIComponent(details);
            document.getElementById('event-modal-outlook').href = oUrl;
            document.getElementById('event-modal-outlook').style.pointerEvents = '';
            document.getElementById('event-modal-outlook').style.opacity = '';
          } else {
            document.getElementById('event-modal-outlook').href = '#';
            document.getElementById('event-modal-outlook').style.pointerEvents = 'none';
            document.getElementById('event-modal-outlook').style.opacity = '0.4';
          }

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
  // Belangrijk: NIET 'e.*' gebruiken (kan grote base64-velden bevatten → SQLITE_TOOBIG).
  // Selecteer enkel de velden die de overzichtspagina écht nodig heeft.
  // Belangrijk: image_url & poster_url kunnen base64 data-URLs zijn (>200KB).
  // Meerdere rijen samen → SQLITE_TOOBIG. We selecteren ze NIET rechtstreeks.
  // In plaats daarvan: voor base64 (data:...) → NULL teruggeven (de UI valt terug op cover_r2_key via /api/events/<id>/cover).
  // Voor http(s)/r2 paden behouden we de URL.
  let query = `
    SELECT e.id, e.titel, e.slug, e.start_at, e.end_at, e.locatie,
           CASE WHEN e.image_url LIKE 'data:%' THEN NULL ELSE e.image_url END as image_url,
           e.is_publiek, e.type, e.cover_r2_key,
           CASE WHEN c.poster_url LIKE 'data:%' THEN NULL ELSE c.poster_url END as poster_url,
           c.uitverkocht, c.voorverkoop_start_at, c.ticketing_enabled,
           COALESCE(
             CASE WHEN c.poster_url LIKE 'data:%' THEN NULL ELSE c.poster_url END,
             CASE WHEN e.image_url LIKE 'data:%' THEN NULL ELSE e.image_url END,
             CASE WHEN e.cover_r2_key IS NOT NULL THEN '/r2/' || e.cover_r2_key END
           ) as display_image
    FROM events e
    LEFT JOIN concerts c ON c.event_id = e.id
    WHERE e.type = 'concert'${isAdmin ? '' : ' AND e.is_publiek = 1'}
  `

  if (view === 'upcoming') {
    query += ` AND datetime(e.start_at) >= datetime('now') ORDER BY e.start_at ASC`
  } else if (view === 'past') {
    query += ` AND datetime(e.start_at) < datetime('now') ORDER BY e.start_at DESC`
  } else {
    query += ` AND datetime(e.start_at) >= datetime('now') ORDER BY e.start_at ASC`
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
                          <img src="/static/images/animato-note.png" alt="" class="h-24 w-auto brightness-0 invert opacity-70" />
                        </div>
                      )}
                      {concert.uitverkocht == 1 && (
                        <div class="absolute top-4 right-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                          Uitverkocht
                        </div>
                      )}
                      {/* Voorverkoop-nog-niet-open badge */}
                      {concert.uitverkocht != 1 && concert.voorverkoop_start_at && (parseBrusselsDate(concert.voorverkoop_start_at)?.getTime() ?? 0) > Date.now() && (
                        <div class="absolute top-4 right-4 bg-amber-500 text-white px-3 py-1 rounded-full text-sm font-semibold shadow">
                          <i class="fas fa-clock mr-1"></i>
                          Voorverkoop binnenkort
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
                          {formatBrusselsDate(concert.start_at, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                          })}
                        </div>
                        <div class="flex items-center">
                          <i class="far fa-clock mr-3 text-animato-primary"></i>
                          {formatBrusselsTime(concert.start_at)} uur
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
    `SELECT e.*, c.id AS concert_id, c.poster_url, c.programma, c.prijsstructuur, c.capaciteit, c.uitverkocht, c.ticketing_enabled, c.tickets_aangekondigd, c.voorverkoop_start_at,
            c.parking, c.toegankelijkheid, c.duur_info, c.sfeer_dresscode, c.extra_info,
            c.doors_open_at, c.concert_start_at,
            -- BUG-FIX bezetting: live berekenen uit betaalde tickets (was stale counter)
            (SELECT COALESCE(SUM(t.aantal), 0) FROM tickets t
             WHERE t.concert_id = c.id AND t.status = 'paid') AS verkocht
     FROM events e
     LEFT JOIN concerts c ON c.event_id = e.id
     WHERE e.slug = ? AND e.type = 'concert'`,
    [slug]
  )

  if (!concert) {
    return c.notFound()
  }

  const prijzen = concert.prijsstructuur ? JSON.parse(concert.prijsstructuur) : []

  // ── Partituurlijst (alleen voor ingelogde leden) ──────────────
  // Per stuk halen we ook de bijhorende materialen (partituren) op,
  // gefilterd op de stemgroep van de huidige gebruiker.
  let partituren: any[] = []
  let userStem = ''
  if (user) {
    userStem = String((user as any).stemgroep || '').toUpperCase()
    // Bepaal welke 'stem' waarden zichtbaar zijn voor deze gebruiker
    // S/A/T/B → ook SA, TB, SATB, algemeen, piano, orgel zijn relevant
    const stemFilter: string[] = ['SATB', 'algemeen', 'piano', 'orgel']
    if (userStem === 'S') stemFilter.push('S', 'SA')
    else if (userStem === 'A') stemFilter.push('A', 'SA')
    else if (userStem === 'T') stemFilter.push('T', 'TB')
    else if (userStem === 'B') stemFilter.push('B', 'TB')
    else stemFilter.push('S', 'A', 'T', 'B', 'SA', 'TB') // bv. dirigent / admin

    if ((concert as any).id) {
      // event_pieces gebruikt rechtstreeks events.id (= concert.id hier)
      partituren = await queryAll(c.env.DB, `
        SELECT ep.id as link_id, ep.volgorde, ep.opmerking,
               p.id as piece_id, p.titel as piece_titel, p.toonsoort, p.tempo, p.duur_minuten,
               w.componist, w.titel as work_titel, w.jaar
        FROM event_pieces ep
        JOIN pieces p ON p.id = ep.piece_id
        JOIN works w ON w.id = p.work_id
        WHERE ep.event_id = ?
        ORDER BY ep.volgorde ASC, ep.id ASC
      `, [(concert as any).id]) as any[]

      if (partituren.length > 0) {
          const pieceIds = partituren.map((p: any) => p.piece_id)
          const placeholders = pieceIds.map(() => '?').join(',')
          const stemPlaceholders = stemFilter.map(() => '?').join(',')
          const mats = await queryAll(c.env.DB, `
            SELECT id, piece_id, stem, type, titel, url, mime_type
            FROM materials
            WHERE is_actief = 1 AND piece_id IN (${placeholders})
              AND stem IN (${stemPlaceholders})
            ORDER BY
              CASE stem
                WHEN ? THEN 1
                WHEN 'SATB' THEN 2
                WHEN 'algemeen' THEN 3
                ELSE 4 END,
              type
          `, [...pieceIds, ...stemFilter, userStem]) as any[]

          // Group materials per piece
          const matsByPiece: Record<number, any[]> = {}
          mats.forEach((m: any) => {
            if (!matsByPiece[m.piece_id]) matsByPiece[m.piece_id] = []
            matsByPiece[m.piece_id].push(m)
          })
          partituren.forEach((p: any) => {
            p.materials = matsByPiece[p.piece_id] || []
          })
        }
    }
  }

  // ── Gekoppelde fotoboeken ──────────────────────────────────────
  // Publieke bezoekers zien enkel publieke albums; ingelogde leden zien álle albums.
  // We tellen ook het aantal foto's per album voor een mooiere teaser.
  const albumsQuery = user
    ? `SELECT a.id, a.titel, a.slug, a.cover_url, a.beschrijving, a.is_publiek,
              (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) as foto_count
       FROM albums a
       WHERE a.event_id = ?
       ORDER BY a.sorteer_volgorde ASC, a.created_at DESC`
    : `SELECT a.id, a.titel, a.slug, a.cover_url, a.beschrijving, a.is_publiek,
              (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) as foto_count
       FROM albums a
       WHERE a.event_id = ? AND a.is_publiek = 1
       ORDER BY a.sorteer_volgorde ASC, a.created_at DESC`
  const concertAlbums = await queryAll<any>(c.env.DB, albumsQuery, [(concert as any).id])

  // Ticket-status logica
  // Prioriteit: uitverkocht > (aangekondigd OR datum in toekomst) > verkoop open > gratis
  const voorverkoopStart = parseBrusselsDate(concert.voorverkoop_start_at)
  const voorverkoopDatumInToekomst = !!(voorverkoopStart && voorverkoopStart.getTime() > Date.now())
  const ticketsAangekondigd = concert.tickets_aangekondigd == 1
  // "Nog niet beschikbaar"-modus is actief als: admin heeft expliciet aangevinkt OF er is een toekomstige datum
  const voorverkoopNogNietOpen = ticketsAangekondigd || voorverkoopDatumInToekomst
  const voorverkoopStartFormatted = voorverkoopStart
    ? formatBrusselsDateTime(voorverkoopStart, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  // ISO string voor client-side countdown (alleen als er een toekomstige datum is)
  const voorverkoopStartIso = voorverkoopDatumInToekomst && voorverkoopStart
    ? voorverkoopStart.toISOString()
    : ''

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
              <img src="/static/images/animato-note.png" alt="" class="h-40 w-auto brightness-0 invert opacity-40" />
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
                        {formatBrusselsDate(concert.start_at, {
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
                      {/* Bug #214 — gebruik concert_start_at als die gezet is,
                          anders fallback op events.start_at. Toon deuren apart
                          als die los is ingesteld. */}
                      <div class="text-sm text-gray-500">Aanvang</div>
                      <div class="font-semibold">
                        {formatBrusselsTime(concert.concert_start_at || concert.start_at)} uur
                      </div>
                      {concert.doors_open_at && (
                        <div class="text-xs text-gray-500 mt-0.5">
                          <i class="fas fa-door-open mr-1"></i>
                          Deuren open: <strong>{formatBrusselsTime(concert.doors_open_at)} uur</strong>
                        </div>
                      )}
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
                  <div class="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: processBodyLinks(concert.beschrijving, siteHosts(c.req.url)) }} />
                </div>
              )}

              {/* Program — alleen zichtbaar voor ingelogde leden (#155).
                  Reden: het concrete repertoire (welke liedjes we zingen) is intern info
                  en niet bestemd voor het publiek. Voor publiek tonen we een lock-bericht. */}
              {concert.programma && user && (
                <div class="bg-white rounded-lg shadow-md p-8 mb-8 border-l-4 border-animato-primary">
                  <h2 class="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                    <img src="/static/images/animato-note.png" alt="" class="h-7 w-auto" />
                    Programma
                    <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      <i class="fas fa-lock mr-1"></i>Leden
                    </span>
                  </h2>
                  <p class="text-xs text-gray-500 mb-4">
                    <i class="fas fa-eye-slash mr-1"></i>
                    Dit programma is alleen zichtbaar voor ingelogde leden — niet voor het publiek.
                  </p>
                  <div class="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: processBodyLinks(concert.programma, siteHosts(c.req.url)) }} />
                </div>
              )}
              {concert.programma && !user && (
                <div class="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg shadow-md p-8 mb-8 border-2 border-dashed border-gray-300">
                  <h2 class="text-xl font-bold text-gray-700 mb-3 flex items-center gap-3">
                    <i class="fas fa-lock text-gray-400"></i>
                    Programma
                  </h2>
                  <p class="text-gray-600">
                    Het concrete repertoire wordt intern met onze leden gedeeld.
                    <a href="/auth/login" class="text-animato-primary hover:underline font-semibold ml-1">Log in</a> om het programma te bekijken.
                  </p>
                </div>
              )}

              {/* ─────────────────────────────────────────────────────── */}
              {/* Gekoppelde fotoboeken — zichtbaar als er albums zijn   */}
              {/* gelinkt aan dit concert/event                          */}
              {/* ─────────────────────────────────────────────────────── */}
              {concertAlbums.length > 0 && (
                <div class="bg-white rounded-lg shadow-md p-6 sm:p-8 mb-8 border-l-4 border-animato-primary">
                  <div class="flex items-start justify-between flex-wrap gap-3 mb-4">
                    <h2 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
                      <i class="fas fa-camera-retro text-animato-primary"></i>
                      Foto{concertAlbums.length === 1 ? "'s" : "boeken"}
                      <span class="text-base font-medium text-gray-500">
                        ({concertAlbums.length} album{concertAlbums.length === 1 ? '' : 's'})
                      </span>
                    </h2>
                    <a href="/fotoboek" class="text-sm text-gray-500 hover:text-animato-primary font-medium inline-flex items-center gap-1">
                      Volledig fotoboek <i class="fas fa-arrow-right text-xs"></i>
                    </a>
                  </div>
                  <p class="text-sm text-gray-600 mb-5">
                    Beleef dit concert opnieuw — klik op een album om alle foto's te bekijken.
                  </p>
                  <div class={`grid gap-4 ${
                    concertAlbums.length === 1 ? 'grid-cols-1 max-w-md' :
                    concertAlbums.length === 2 ? 'grid-cols-1 sm:grid-cols-2' :
                    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  }`}>
                    {concertAlbums.map((album: any) => (
                      <a href={`/fotoboek/${album.slug}`}
                         class="group relative block rounded-lg overflow-hidden border border-gray-200 hover:border-animato-primary hover:shadow-lg transition">
                        <div class="relative aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
                          {album.cover_url ? (
                            <img src={album.cover_url} alt={album.titel}
                                 loading="lazy"
                                 class="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                          ) : (
                            <div class="w-full h-full flex items-center justify-center">
                              <i class="fas fa-images text-gray-300 text-5xl"></i>
                            </div>
                          )}
                          {/* Hover overlay */}
                          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition"></div>
                          {/* Foto-counter badge */}
                          {album.foto_count > 0 && (
                            <span class="absolute top-2 right-2 bg-white/90 backdrop-blur text-gray-800 text-xs font-bold px-2 py-1 rounded-full shadow">
                              <i class="fas fa-camera mr-1"></i>{album.foto_count}
                            </span>
                          )}
                          {/* Privacy-badge — alleen voor leden zichtbaar (publiek ziet enkel publieke albums) */}
                          {user && !album.is_publiek && (
                            <span class="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow">
                              <i class="fas fa-lock mr-1"></i>Leden
                            </span>
                          )}
                        </div>
                        <div class="p-3">
                          <h3 class="font-semibold text-gray-900 group-hover:text-animato-primary transition line-clamp-1">
                            {album.titel}
                          </h3>
                          {album.beschrijving && (
                            <p class="text-xs text-gray-500 mt-1 line-clamp-2">{album.beschrijving}</p>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Partituurlijst — enkel voor ingelogde leden */}
              {user && partituren.length > 0 && (
                <div class="bg-white rounded-lg shadow-md p-6 sm:p-8 mb-8 border-l-4 border-animato-primary">
                  <div class="flex items-start justify-between flex-wrap gap-3 mb-2">
                    <h2 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
                      <i class="fas fa-music text-animato-primary"></i>
                      Partituren ({partituren.length} stuk{partituren.length === 1 ? '' : 'ken'})
                    </h2>
                    {userStem && ['S','A','T','B'].includes(userStem) && (
                      <span class="text-xs px-2.5 py-1 rounded-full bg-animato-primary/10 text-animato-primary font-semibold">
                        <i class="fas fa-user mr-1"></i>
                        Stemgroep: {userStem === 'S' ? 'Sopraan' : userStem === 'A' ? 'Alt' : userStem === 'T' ? 'Tenor' : 'Bas'}
                      </span>
                    )}
                  </div>
                  <p class="text-sm text-gray-500 mb-5">
                    Klik op een PDF om je partituur te downloaden of in de browser te openen.
                  </p>

                  <ol class="space-y-3">
                    {partituren.map((p: any, idx: number) => (
                      <li class="border border-gray-200 rounded-lg p-4 hover:border-animato-primary transition">
                        <div class="flex items-start gap-3">
                          <span class="flex-shrink-0 w-8 h-8 rounded-full bg-animato-primary text-white text-sm font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div class="flex-1 min-w-0">
                            <h3 class="font-bold text-gray-900 text-lg">
                              {p.work_titel}
                              {p.piece_titel && p.piece_titel !== p.work_titel && (
                                <span class="text-gray-600 font-normal"> — {p.piece_titel}</span>
                              )}
                            </h3>
                            <div class="text-sm text-gray-600 flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              <span><i class="fas fa-user-edit mr-1"></i>{p.componist}{p.jaar ? ` (${p.jaar})` : ''}</span>
                              {p.toonsoort && <span><i class="fas fa-key mr-1"></i>{p.toonsoort}</span>}
                              {p.tempo && <span><i class="fas fa-tachometer-alt mr-1"></i>{p.tempo}</span>}
                              {p.duur_minuten && <span><i class="fas fa-clock mr-1"></i>{p.duur_minuten} min</span>}
                            </div>
                            {p.opmerking && (
                              <div class="text-sm text-amber-700 mt-1 italic bg-amber-50 px-2 py-1 rounded inline-block">
                                <i class="fas fa-comment mr-1"></i>{p.opmerking}
                              </div>
                            )}

                            {/* Materialen-grid */}
                            {(p.materials && p.materials.length > 0) ? (
                              <div class="mt-3 flex flex-wrap gap-2">
                                {p.materials.map((m: any) => {
                                  const stemLabel = m.stem === 'S' ? 'Sopraan' : m.stem === 'A' ? 'Alt' : m.stem === 'T' ? 'Tenor' : m.stem === 'B' ? 'Bas' : m.stem === 'SA' ? 'S+A' : m.stem === 'TB' ? 'T+B' : m.stem === 'SATB' ? 'Alle stemmen' : m.stem === 'algemeen' ? 'Algemeen' : m.stem
                                  const isMine = m.stem === userStem
                                  const url: string = String(m.url || '')
                                  const isDrive = url.includes('drive.google.com')
                                  const isPdfish = m.type === 'pdf' || /\.pdf($|\?)/i.test(url) || isDrive
                                  const iconCls = m.type === 'pdf' ? 'fa-file-pdf text-red-600'
                                                : m.type === 'audio' ? 'fa-headphones text-purple-600'
                                                : m.type === 'video' ? 'fa-video text-blue-600'
                                                : m.type === 'zip' ? 'fa-file-archive text-amber-600'
                                                : isDrive ? 'fa-file-pdf text-red-600'
                                                : 'fa-link text-gray-600'
                                  // Knop-paar voor PDF / Drive: Bekijken (modal preview) + Openen (nieuwe tab)
                                  if (isPdfish) {
                                    return (
                                      <span class={`inline-flex items-stretch rounded-lg overflow-hidden border ${isMine ? 'border-animato-primary' : 'border-gray-300'} text-xs font-medium`}>
                                        <button
                                          type="button"
                                          data-pdf-url={url}
                                          data-pdf-title={`${p.work_titel}${p.piece_titel && p.piece_titel !== p.work_titel ? ' — ' + p.piece_titel : ''} (${stemLabel})`}
                                          onclick="openPartituurPreview(this)"
                                          class={`inline-flex items-center gap-2 px-3 py-2 transition ${isMine ? 'bg-animato-primary/10 text-animato-primary hover:bg-animato-primary/20' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                          title={`Bekijk ${m.titel} in preview`}
                                        >
                                          <i class={`fas ${iconCls}`}></i>
                                          <span>{stemLabel}</span>
                                          <i class="fas fa-eye text-[10px] opacity-70 ml-0.5"></i>
                                        </button>
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener"
                                          class={`inline-flex items-center px-2.5 py-2 border-l ${isMine ? 'border-animato-primary bg-animato-primary/10 text-animato-primary hover:bg-animato-primary/20' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
                                          title="Open in nieuwe tab / download"
                                        >
                                          <i class="fas fa-external-link-alt text-[11px]"></i>
                                        </a>
                                      </span>
                                    )
                                  }
                                  // Andere types: gewone open-knop
                                  return (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener"
                                      class={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition ${isMine ? 'bg-animato-primary/10 border-animato-primary text-animato-primary hover:bg-animato-primary/20' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                      title={m.titel}
                                    >
                                      <i class={`fas ${iconCls}`}></i>
                                      <span>{stemLabel}</span>
                                    </a>
                                  )
                                })}
                              </div>
                            ) : (
                              <div class="mt-3 text-xs text-gray-400 italic">
                                <i class="fas fa-info-circle mr-1"></i>
                                Nog geen partituren beschikbaar voor jouw stemgroep.
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div class="mt-5 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                    <i class="fas fa-lightbulb mr-1"></i>
                    Tip: alle partituren zijn ook beschikbaar via <a href="/leden/oefenmateriaal" class="underline font-semibold">Oefenmateriaal</a> waar je oefenopnames per stem kan beluisteren.
                  </div>

                  {/* PDF Preview Modal */}
                  <div id="partituur-preview-modal" class="fixed inset-0 z-50 hidden" role="dialog" aria-modal="true">
                    <div class="absolute inset-0 bg-gray-900/80 backdrop-blur-sm" onclick="closePartituurPreview()"></div>
                    <div class="absolute inset-0 flex flex-col p-2 sm:p-6">
                      <div class="bg-white rounded-xl shadow-2xl flex flex-col flex-1 max-w-6xl mx-auto w-full overflow-hidden">
                        <div class="flex items-center justify-between gap-3 p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
                          <div class="flex items-center gap-2 min-w-0">
                            <i class="fas fa-file-pdf text-red-600 text-xl"></i>
                            <h3 id="partituur-preview-title" class="font-bold text-gray-900 truncate text-sm sm:text-base">Partituur</h3>
                          </div>
                          <div class="flex items-center gap-2 flex-shrink-0">
                            <a id="partituur-preview-open" href="#" target="_blank" rel="noopener"
                               class="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg text-xs sm:text-sm font-semibold">
                              <i class="fas fa-external-link-alt"></i>
                              <span class="hidden sm:inline">Open in nieuwe tab</span>
                            </a>
                            <button type="button" onclick="closePartituurPreview()"
                                    class="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-white hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-300 rounded-lg" aria-label="Sluiten">
                              <i class="fas fa-times"></i>
                            </button>
                          </div>
                        </div>
                        <div class="flex-1 bg-gray-100 relative">
                          <iframe id="partituur-preview-iframe" class="absolute inset-0 w-full h-full border-0" allow="autoplay" title="Partituur preview"></iframe>
                        </div>
                      </div>
                    </div>
                  </div>

                  <script dangerouslySetInnerHTML={{__html: `
                    // Converteer Google Drive /view of /edit URLs naar /preview voor inline iframe.
                    function toPreviewUrl(rawUrl) {
                      try {
                        var u = new URL(rawUrl);
                        if (u.hostname.includes('drive.google.com')) {
                          // Patronen: /file/d/<id>/view  of /file/d/<id>/edit  of /open?id=<id>
                          var m = u.pathname.match(/\\/file\\/d\\/([^\\/]+)/);
                          if (m && m[1]) {
                            return 'https://drive.google.com/file/d/' + m[1] + '/preview';
                          }
                          var qid = u.searchParams.get('id');
                          if (qid) {
                            return 'https://drive.google.com/file/d/' + qid + '/preview';
                          }
                        }
                      } catch (e) {}
                      return rawUrl;
                    }
                    window.openPartituurPreview = function(btn) {
                      var url = btn.getAttribute('data-pdf-url');
                      var title = btn.getAttribute('data-pdf-title') || 'Partituur';
                      if (!url) return;
                      var modal = document.getElementById('partituur-preview-modal');
                      var iframe = document.getElementById('partituur-preview-iframe');
                      var titleEl = document.getElementById('partituur-preview-title');
                      var openLink = document.getElementById('partituur-preview-open');
                      titleEl.textContent = title;
                      openLink.href = url;
                      iframe.src = toPreviewUrl(url);
                      modal.classList.remove('hidden');
                      document.body.style.overflow = 'hidden';
                    };
                    window.closePartituurPreview = function() {
                      var modal = document.getElementById('partituur-preview-modal');
                      var iframe = document.getElementById('partituur-preview-iframe');
                      modal.classList.add('hidden');
                      iframe.src = 'about:blank';
                      document.body.style.overflow = '';
                    };
                    // ESC sluit
                    document.addEventListener('keydown', function(e) {
                      if (e.key === 'Escape') {
                        var modal = document.getElementById('partituur-preview-modal');
                        if (modal && !modal.classList.contains('hidden')) closePartituurPreview();
                      }
                    });
                  `}} />
                </div>
              )}

              {/* Hint voor niet-ingelogde bezoekers */}
              {!user && (
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-5 mb-8 text-sm text-gray-600">
                  <i class="fas fa-lock mr-1"></i>
                  Ingelogde leden zien hier de volledige partituurlijst voor dit concert. <a href={`/login?redirect=${encodeURIComponent(c.req.path)}`} class="text-animato-primary font-semibold underline">Inloggen</a>
                </div>
              )}

              {/* Practical info blocks */}
              {(concert.duur_info || concert.sfeer_dresscode || concert.parking || concert.toegankelijkheid || concert.extra_info) && (
                <div class="bg-white rounded-lg shadow-md p-8">
                  <h2 class="text-2xl font-bold text-gray-900 mb-6">Praktische informatie</h2>
                  <div class="space-y-6">
                    {concert.duur_info && (
                      <div>
                        <h3 class="text-lg font-semibold text-animato-primary mb-2 flex items-center gap-2">
                          <i class="far fa-clock"></i> Duur
                        </h3>
                        <div class="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: concert.duur_info }} />
                      </div>
                    )}
                    {concert.sfeer_dresscode && (
                      <div>
                        <h3 class="text-lg font-semibold text-animato-primary mb-2 flex items-center gap-2">
                          <i class="fas fa-tshirt"></i> Sfeer &amp; dresscode
                        </h3>
                        <div class="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: concert.sfeer_dresscode }} />
                      </div>
                    )}
                    {concert.parking && (
                      <div>
                        <h3 class="text-lg font-semibold text-animato-primary mb-2 flex items-center gap-2">
                          <i class="fas fa-parking"></i> Parking
                        </h3>
                        <div class="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: concert.parking }} />
                      </div>
                    )}
                    {concert.toegankelijkheid && (
                      <div>
                        <h3 class="text-lg font-semibold text-animato-primary mb-2 flex items-center gap-2">
                          <i class="fas fa-wheelchair"></i> Toegankelijkheid
                        </h3>
                        <div class="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: concert.toegankelijkheid }} />
                      </div>
                    )}
                    {concert.extra_info && (
                      <div>
                        <h3 class="text-lg font-semibold text-animato-primary mb-2 flex items-center gap-2">
                          <i class="fas fa-info-circle"></i> Extra informatie
                        </h3>
                        <div class="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: concert.extra_info }} />
                      </div>
                    )}
                  </div>
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
                ) : voorverkoopNogNietOpen ? (
                  <div class="bg-amber-50 border border-amber-300 rounded-lg p-6 text-center">
                    <i class="fas fa-hourglass-half text-amber-500 text-3xl mb-3"></i>
                    <p class="text-lg font-semibold text-amber-900 mb-1">
                      Nog geen tickets beschikbaar
                    </p>
                    {voorverkoopDatumInToekomst ? (
                      <>
                        <p class="text-sm text-amber-800 leading-relaxed">
                          De voorverkoop start op<br />
                          <strong class="text-base">{voorverkoopStartFormatted}</strong>
                        </p>
                        {/* Live aftelteller */}
                        <div
                          id="voorverkoop-countdown"
                          data-target={voorverkoopStartIso}
                          class="mt-4 grid grid-cols-4 gap-2"
                          aria-live="polite"
                        >
                          <div class="bg-white border border-amber-200 rounded-lg py-3">
                            <div class="text-2xl font-bold text-amber-900" data-unit="days">–</div>
                            <div class="text-[10px] uppercase tracking-wide text-amber-700">Dagen</div>
                          </div>
                          <div class="bg-white border border-amber-200 rounded-lg py-3">
                            <div class="text-2xl font-bold text-amber-900" data-unit="hours">–</div>
                            <div class="text-[10px] uppercase tracking-wide text-amber-700">Uren</div>
                          </div>
                          <div class="bg-white border border-amber-200 rounded-lg py-3">
                            <div class="text-2xl font-bold text-amber-900" data-unit="minutes">–</div>
                            <div class="text-[10px] uppercase tracking-wide text-amber-700">Min</div>
                          </div>
                          <div class="bg-white border border-amber-200 rounded-lg py-3">
                            <div class="text-2xl font-bold text-amber-900" data-unit="seconds">–</div>
                            <div class="text-[10px] uppercase tracking-wide text-amber-700">Sec</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p class="text-sm text-amber-800 leading-relaxed">
                        Tickets volgen binnenkort.<br />
                        <span class="text-xs">Houd deze pagina in de gaten of zet het concert in je agenda.</span>
                      </p>
                    )}
                    {/* Voorbeeld prijzen tonen zodat bezoekers alvast het budget kennen */}
                    {prijzen.length > 0 && (
                      <div class="mt-5 pt-4 border-t border-amber-200 text-left">
                        <p class="text-xs font-semibold text-amber-900 mb-2 uppercase tracking-wide">
                          <i class="fas fa-tag mr-1"></i>Prijzen (ter info)
                        </p>
                        {prijzen.map((prijs: any) => (
                          <div class="flex justify-between items-center py-1 text-sm">
                            <span class="text-amber-900">{prijs.categorie}</span>
                            <span class="font-semibold text-amber-900">€{prijs.prijs}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Agenda-herinnering knop - alleen als er een concrete datum is */}
                    {voorverkoopDatumInToekomst && (
                      <a
                        href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Voorverkoop start: ' + concert.titel)}&dates=${(String(concert.voorverkoop_start_at) || '').replace(/[-: ]/g, '').substring(0, 15)}/${(String(concert.voorverkoop_start_at) || '').replace(/[-: ]/g, '').substring(0, 15)}&details=${encodeURIComponent('Herinner mij om tickets te bestellen voor ' + concert.titel)}`}
                        target="_blank" rel="noopener"
                        class="mt-5 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                      >
                        <i class="fas fa-bell"></i>
                        Zet herinnering in agenda
                      </a>
                    )}
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

                    {/* Book button → echte bestelpagina */}
                    <a
                      href={`/concerten/${concert.id}/tickets`}
                      class="block w-full bg-animato-accent hover:bg-yellow-600 text-white py-4 rounded-lg font-bold text-lg transition shadow-lg text-center"
                    >
                      <i class="fas fa-ticket-alt mr-2"></i>
                      Bestel Tickets
                    </a>

                    <p class="text-xs text-gray-500 text-center mt-4">
                      <i class="fas fa-lock mr-1"></i>
                      Veilige betaling via Mollie (Bancontact)
                    </p>
                  </>
                ) : (
                  <div class="bg-gray-50 rounded-lg p-6 text-center">
                    <i class="fas fa-info-circle text-gray-400 text-3xl mb-3"></i>
                    <p class="text-gray-700 font-medium">
                      Ticketinfo volgt
                    </p>
                    <p class="text-xs text-gray-500 mt-1">
                      Meer details over toegang en tickets binnenkort beschikbaar
                    </p>
                  </div>
                )}

                {/* Add to calendar */}
                <div class="mt-6 pt-6 border-t border-gray-200">
                  <p class="text-xs text-gray-500 text-center mb-3">Toevoegen aan kalender</p>
                  <div class="grid grid-cols-3 gap-2">
                    <a
                      href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(concert.titel)}&dates=${(concert.start_at || '').replace(/[-:]/g, '').replace('.000', '')}/${(concert.end_at || concert.start_at || '').replace(/[-:]/g, '').replace('.000', '')}&location=${encodeURIComponent(concert.locatie || '')}&details=${encodeURIComponent((concert.beschrijving || '').replace(/<[^>]*>/g, '').substring(0, 500))}`}
                      target="_blank" rel="noopener"
                      class="text-center px-2 py-2 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition"
                    >
                      <i class="fab fa-google mr-1"></i>Google
                    </a>
                    <a
                      href={`https://outlook.live.com/calendar/0/action/compose?rru=addevent&subject=${encodeURIComponent(concert.titel)}&startdt=${concert.start_at || ''}&enddt=${concert.end_at || concert.start_at || ''}&location=${encodeURIComponent(concert.locatie || '')}&body=${encodeURIComponent((concert.beschrijving || '').replace(/<[^>]*>/g, '').substring(0, 500))}`}
                      target="_blank" rel="noopener"
                      class="text-center px-2 py-2 border border-blue-200 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-50 transition"
                    >
                      <i class="fab fa-microsoft mr-1"></i>Outlook
                    </a>
                    <a
                      href={`/api/agenda/ics?event=${concert.id}`}
                      download
                      class="text-center px-2 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition"
                    >
                      <i class="fas fa-download mr-1"></i>ICS
                    </a>
                  </div>
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

      {/* Live countdown voor voorverkoop start */}
      {voorverkoopStartIso && (
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var el = document.getElementById('voorverkoop-countdown');
            if (!el) return;
            var target = new Date(el.getAttribute('data-target')).getTime();
            if (isNaN(target)) return;
            var unitEls = {
              days:    el.querySelector('[data-unit="days"]'),
              hours:   el.querySelector('[data-unit="hours"]'),
              minutes: el.querySelector('[data-unit="minutes"]'),
              seconds: el.querySelector('[data-unit="seconds"]')
            };
            function pad(n) { return n < 10 ? '0' + n : String(n); }
            function tick() {
              var now = Date.now();
              var diff = target - now;
              if (diff <= 0) {
                // Tijd zit erop — herlaad de pagina zodat de server de nieuwe status rendert
                window.location.reload();
                return;
              }
              var days = Math.floor(diff / 86400000);
              var hours = Math.floor((diff % 86400000) / 3600000);
              var minutes = Math.floor((diff % 3600000) / 60000);
              var seconds = Math.floor((diff % 60000) / 1000);
              if (unitEls.days)    unitEls.days.textContent = days;
              if (unitEls.hours)   unitEls.hours.textContent = pad(hours);
              if (unitEls.minutes) unitEls.minutes.textContent = pad(minutes);
              if (unitEls.seconds) unitEls.seconds.textContent = pad(seconds);
            }
            tick();
            setInterval(tick, 1000);
          })();
        ` }} />
      )}
    </Layout>
  )
})

// =====================================================
// ICS EXPORT — single event + alle events
// =====================================================

// Datum-helper: maak ISO basic format "20251126T193000Z" uit een DB-string
function toIcsDate(s: string | null | undefined): string {
  if (!s) return ''
  let n = String(s).trim()
  if (n.includes(' ') && !n.includes('T')) n = n.replace(' ', 'T')
  if (/T\d{2}:\d{2}$/.test(n)) n += ':00'
  const d = new Date(n)
  if (isNaN(d.getTime())) return ''
  const pad = (x: number) => String(x).padStart(2, '0')
  return d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
}
// ICS-escape: backslash, comma, semicolon, newline
function icsEscape(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}
function buildVEvent(ev: any, hostUrl: string): string {
  const start = toIcsDate(ev.start_at)
  const end = toIcsDate(ev.end_at) || start
  const desc = icsEscape((ev.beschrijving || '').replace(/<[^>]*>/g, '').substring(0, 1500))
  const uid = `event-${ev.id}@animato.be`
  const dtstamp = toIcsDate(new Date().toISOString())
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(ev.titel || 'Animato evenement')}`,
    `LOCATION:${icsEscape(ev.locatie || '')}`,
    `DESCRIPTION:${desc}`,
    `URL:${hostUrl}/agenda/${ev.slug || ''}`,
    'END:VEVENT'
  ].join('\r\n')
}
function buildIcs(events: any[], hostUrl: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Animato//Agenda//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Animato Agenda',
    'X-WR-TIMEZONE:Europe/Brussels'
  ]
  for (const ev of events) lines.push(buildVEvent(ev, hostUrl))
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// Single event
app.get('/api/agenda/ics', async (c) => {
  const eventId = c.req.query('event')
  if (!eventId) return c.text('Missing ?event=ID', 400)
  const ev = await queryOne<any>(c.env.DB, `SELECT * FROM events WHERE id = ?`, [eventId])
  if (!ev) return c.text('Event niet gevonden', 404)
  const host = new URL(c.req.url).origin
  const body = buildIcs([ev], host)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="animato-event-${ev.id}.ics"`
    }
  })
})

// Alle events
app.get('/api/agenda/ics/all', async (c) => {
  const events = await queryAll<any>(c.env.DB,
    `SELECT id, slug, titel, start_at, end_at, locatie, beschrijving FROM events ORDER BY start_at`
  )
  const host = new URL(c.req.url).origin
  const body = buildIcs(events || [], host)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="animato-agenda.ics"`
    }
  })
})

// =====================================================
// EVENT-REACTIES (reply + emoji) — ledenfunctie
// =====================================================

const EVENT_REACTION_TYPES = ['like', 'love', 'laugh', 'wow', 'sad']

// Plaats een tekstreactie
app.post('/agenda/:id/reply', async (c) => {
  const user = c.get('user') as any
  if (!user?.id) return c.redirect('/login')
  const eventId = parseInt(c.req.param('id'))
  if (!eventId) return c.redirect('/agenda')

  const body = await c.req.parseBody()
  const raw = String(body.body || '').trim()
  if (!raw) {
    const ev = await queryOne<any>(c.env.DB, `SELECT slug FROM events WHERE id = ?`, [eventId])
    return c.redirect(ev?.slug ? `/agenda/${ev.slug}` : '/agenda')
  }
  const safeBody = raw.length > 5000 ? raw.substring(0, 5000) : raw

  const event = await queryOne<any>(c.env.DB, `SELECT id, slug, titel, created_by FROM events WHERE id = ? LIMIT 1`, [eventId])
  if (!event) return c.notFound()

  try {
    await c.env.DB.prepare(
      `INSERT INTO event_replies (event_id, auteur_id, body) VALUES (?, ?, ?)`
    ).bind(eventId, user.id, safeBody).run()
  } catch (e: any) {
    console.warn('Event reply insert failed:', e?.message)
  }

  // 🔔 Notify de event-auteur (vaak admin/bestuur) bij een reactie. We hangen
  // dit onder 'board' notif-type — semantisch is het immers ook een forum-pingback.
  // Honoreert opt-out 'board'. Skip als auteur zelf reageert.
  try {
    if (event.created_by && event.created_by !== user.id) {
      const replierName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || 'Een lid'
      const preview = safeBody.length > 100 ? safeBody.substring(0, 97) + '…' : safeBody
      await notifyUserIfEnabled(
        c.env.DB,
        event.created_by,
        'board',
        `${replierName} reageerde op ${event.titel || 'agenda-item'}`,
        preview,
        `/agenda/${event.slug}`
      )
    }
  } catch (e) { console.error('[notif] agenda-reply notify failed:', e) }

  // 📣 @mentions: detect & notify genoemde personen (skipt auteur zelf en event-auteur die we hierboven al pinged)
  try {
    const { extractMentionTokens, resolveMentions, notifyMentionedUsers } = await import('../utils/mentions')
    const tokens = extractMentionTokens(safeBody)
    if (tokens.length > 0) {
      const mentionMap = await resolveMentions(c.env.DB, tokens)
      // Sluit event-auteur uit van de mentions-notif (al apart genotificeerd)
      if (event.created_by) {
        for (const [k, v] of mentionMap) {
          if (v.userId === event.created_by) mentionMap.delete(k)
        }
      }
      const replierName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || 'Een lid'
      const preview = safeBody.length > 120 ? safeBody.substring(0, 117) + '…' : safeBody
      await notifyMentionedUsers(c.env.DB, mentionMap, {
        authorId: user.id,
        authorName: replierName,
        title: `${replierName} noemde je in ${event.titel || 'een agenda-item'}`,
        bodySnippet: preview,
        link: `/agenda/${event.slug}`,
      })
    }
  } catch (e) { console.error('[mentions] agenda-reply failed:', e) }

  return c.redirect(`/agenda/${event.slug}`)
})

// Verwijder een reactie (eigenaar of staff)
app.post('/agenda/:id/reply/:replyId/delete', async (c) => {
  const user = c.get('user') as any
  if (!user?.id) return c.redirect('/login')
  const eventId = c.req.param('id')
  const replyId = c.req.param('replyId')

  const reply = await queryOne<any>(c.env.DB, `SELECT auteur_id FROM event_replies WHERE id = ? LIMIT 1`, [replyId])
  const ev = await queryOne<any>(c.env.DB, `SELECT slug FROM events WHERE id = ?`, [eventId])
  if (!reply || !ev) return c.redirect('/agenda')

  const isOwner = reply.auteur_id === user.id
  const isStaff = user.role === 'admin' || user.role === 'moderator' || user.role === 'bestuur' || user.is_bestuurslid === 1
  if (!isOwner && !isStaff) return c.redirect(`/agenda/${ev.slug}`)

  try {
    await c.env.DB.prepare(
      `UPDATE event_replies SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(replyId).run()
  } catch (e: any) {
    console.warn('Event reply delete failed:', e?.message)
  }
  return c.redirect(`/agenda/${ev.slug}`)
})

// Emoji-reactie (toggle/switch) — JSON in, JSON out
app.post('/agenda/:id/reactie-emoji', async (c) => {
  const user = c.get('user') as any
  if (!user?.id) return c.json({ error: 'Niet ingelogd' }, 401)
  const eventId = parseInt(c.req.param('id'))
  if (!eventId) return c.json({ error: 'Geen id' }, 400)

  let body: any
  try { body = await c.req.json() } catch { body = {} }
  const type = String(body?.type || '').trim()
  if (!EVENT_REACTION_TYPES.includes(type)) return c.json({ error: 'Ongeldig type' }, 400)

  const event = await queryOne<any>(c.env.DB, `SELECT id FROM events WHERE id = ? LIMIT 1`, [eventId])
  if (!event) return c.json({ error: 'Event niet gevonden' }, 404)

  const existing = await queryOne<any>(
    c.env.DB,
    `SELECT id, type FROM event_reactions WHERE event_id = ? AND user_id = ? LIMIT 1`,
    [eventId, user.id]
  )
  try {
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO event_reactions (event_id, user_id, type) VALUES (?, ?, ?)`
      ).bind(eventId, user.id, type).run()
    } else if (existing.type === type) {
      await c.env.DB.prepare(`DELETE FROM event_reactions WHERE id = ?`).bind(existing.id).run()
    } else {
      await c.env.DB.prepare(
        `UPDATE event_reactions SET type = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(type, existing.id).run()
    }
  } catch (e: any) {
    console.warn('Event reactie mislukt:', e?.message)
    return c.json({ error: 'Opslaan mislukt' }, 500)
  }

  const countsRaw = await queryAll<any>(c.env.DB,
    `SELECT type, COUNT(*) as n FROM event_reactions WHERE event_id = ? GROUP BY type`,
    [eventId]
  )
  const counts: Record<string, number> = {}
  for (const row of countsRaw) counts[row.type] = row.n

  const mine = await queryOne<any>(c.env.DB,
    `SELECT type FROM event_reactions WHERE event_id = ? AND user_id = ? LIMIT 1`,
    [eventId, user.id]
  )
  return c.json({ counts, myReaction: mine?.type || null })
})

// =====================================================
// GENERIEKE EVENT DETAIL PAGINA
// =====================================================

app.get('/agenda/:slug', async (c) => {
  const user = c.get('user') as any
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

  // === Reacties + emoji-reacties (alleen voor ingelogde leden) ===
  const isLoggedIn = !!user?.id
  let replies: any[] = []
  let reactionCounts: Record<string, number> = {}
  let myReactionType: string | null = null
  let replyReactionsMap = new Map<number, any>()

  if (isLoggedIn) {
    replies = await queryAll<any>(
      c.env.DB,
      `SELECT r.id, r.body, r.created_at, r.auteur_id,
              u.email, p.voornaam, p.achternaam, p.foto_url
       FROM event_replies r
       JOIN users u ON r.auteur_id = u.id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE r.event_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at ASC`,
      [event.id]
    )

    // Comment-reactions bulk ophalen (één query voor alle replies in deze event)
    if (replies.length > 0) {
      replyReactionsMap = await getReactionsForTargets(
        c.env.DB, 'event_reply', replies.map((r: any) => r.id), user.id
      )
    }

    // 📣 @mentions: bulk-resolve over alle reply-bodies (plain-text, dus eerst escape)
    if (replies.length > 0) {
      try {
        const { extractMentionTokens, resolveMentions, renderMentions, escapeForMention } =
          await import('../utils/mentions')
        const allTokens = new Set<string>()
        for (const r of replies) {
          for (const t of extractMentionTokens(r.body)) allTokens.add(t)
        }
        if (allTokens.size > 0) {
          const mentionMap = await resolveMentions(c.env.DB, Array.from(allTokens))
          for (const r of replies) {
            const escaped = escapeForMention(r.body)
            r._body_with_mentions = renderMentions(escaped, mentionMap)
          }
        }
      } catch (_) { /* graceful */ }
    }

    const countsRaw = await queryAll<any>(
      c.env.DB,
      `SELECT type, COUNT(*) as n FROM event_reactions WHERE event_id = ? GROUP BY type`,
      [event.id]
    )
    for (const row of countsRaw) reactionCounts[row.type] = row.n

    const myReaction = await queryOne<any>(
      c.env.DB,
      `SELECT type FROM event_reactions WHERE event_id = ? AND user_id = ? LIMIT 1`,
      [event.id, user.id]
    )
    myReactionType = myReaction?.type || null
  }
  // replyReactions is hierboven al gevuld in de isLoggedIn-branch

  const isStaff = isLoggedIn && (user.role === 'admin' || user.role === 'moderator' || user.role === 'bestuur' || user.is_bestuurslid === 1)
  const emojiList: Array<{ type: string; emoji: string; label: string }> = [
    { type: 'like',  emoji: '👍', label: 'Like' },
    { type: 'love',  emoji: '❤️', label: 'Love' },
    { type: 'laugh', emoji: '😄', label: 'Haha' },
    { type: 'wow',   emoji: '😮', label: 'Wow' },
    { type: 'sad',   emoji: '😢', label: 'Sad' }
  ]

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
                    {formatBrusselsDate(event.start_at, {
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
                    {formatBrusselsTime(event.start_at)}
                    {event.end_at && ` - ${formatBrusselsTime(event.end_at)}`}
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
              <div class="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: processBodyLinks(event.beschrijving, siteHosts(c.req.url)) }} />
            </div>
          )}

          {/* === REACTIES + EMOJI === */}
          {isLoggedIn ? (
            <>
              {/* Emoji-reactiebalk */}
              <div class="bg-white rounded-lg shadow-md p-5 mb-6">
                <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <i class="fas fa-smile text-animato-primary"></i>
                  Wat vind je van deze {event.type === 'repetitie' ? 'repetitie' : 'activiteit'}?
                </h3>
                <div id="emoji-reactions-bar" class="flex flex-wrap gap-2" data-event-id={event.id}>
                  {emojiList.map(em => (
                    <button
                      type="button"
                      data-emoji-type={em.type}
                      class={`emoji-btn flex items-center gap-2 px-4 py-2 rounded-full border-2 transition ${
                        myReactionType === em.type
                          ? 'bg-animato-primary border-animato-primary text-white shadow-md'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-animato-primary hover:bg-blue-50'
                      }`}
                    >
                      <span class="text-xl">{em.emoji}</span>
                      <span class="text-xs font-semibold" data-emoji-count={em.type}>{reactionCounts[em.type] || 0}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Reacties */}
              <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                  <i class="fas fa-comments mr-2 text-animato-primary"></i>
                  {replies.length} Reactie{replies.length === 1 ? '' : 's'}
                </h3>

                {replies.length === 0 ? (
                  <p class="text-gray-500 text-sm italic mb-4">Nog geen reacties. Wees de eerste!</p>
                ) : (
                  <div class="space-y-4 mb-6">
                    {replies.map((r: any) => {
                      const naam = `${r.voornaam || ''} ${r.achternaam || ''}`.trim() || r.email
                      const initials = ((r.voornaam || r.email || '?').charAt(0) + (r.achternaam || '').charAt(0)).toUpperCase()
                      const isOwner = r.auteur_id === user.id
                      const canDelete = isOwner || isStaff
                      return (
                        <div class="flex gap-3 items-start border-b border-gray-100 pb-3 last:border-0">
                          {r.foto_url ? (
                            <img src={r.foto_url} alt={naam} class="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div class="w-10 h-10 rounded-full bg-animato-primary text-white flex items-center justify-center font-bold flex-shrink-0">
                              {initials}
                            </div>
                          )}
                          <div class="flex-1">
                            <div class="flex items-baseline justify-between gap-2 flex-wrap">
                              <div>
                                <span class="font-semibold text-gray-900">{naam}</span>
                                <span class="text-xs text-gray-500 ml-2">
                                  {formatBrusselsDateTime(r.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {canDelete && (
                                <form action={`/agenda/${event.id}/reply/${r.id}/delete`} method="POST" class="inline" onsubmit="return confirm('Reactie verwijderen?')">
                                  <button type="submit" class="text-gray-400 hover:text-red-600 text-xs" title="Verwijder reactie">
                                    <i class="fas fa-trash"></i>
                                  </button>
                                </form>
                              )}
                            </div>
                            {r._body_with_mentions ? (
                              <p
                                class="text-gray-700 text-sm mt-1 whitespace-pre-wrap break-words"
                                dangerouslySetInnerHTML={{ __html: r._body_with_mentions }}
                              />
                            ) : (
                              <p class="text-gray-700 text-sm mt-1 whitespace-pre-wrap break-words">{r.body}</p>
                            )}
                            {/* Reacties op deze reply (6 emoji's, polymorphic) */}
                            {(() => {
                              const s = replyReactionsMap.get(r.id)
                              const counts = s ? s.counts : { like:0, love:0, laugh:0, music:0, clap:0, pray:0 }
                              const mine = s ? Array.from(s.mine) : []
                              return (
                                <div
                                  class="comment-reactions mt-2"
                                  data-target-type="event_reply"
                                  data-target-id={r.id}
                                  data-counts={JSON.stringify(counts)}
                                  data-mine={JSON.stringify(mine)}
                                />
                              )
                            })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Reactieformulier */}
                <form action={`/agenda/${event.id}/reply`} method="POST" class="space-y-2">
                  <label class="block text-sm font-semibold text-gray-700">Voeg een reactie toe</label>
                  <textarea
                    name="body"
                    rows={3}
                    required
                    maxlength={5000}
                    placeholder="Typ je reactie… Emoji's en accenten zijn welkom 🎵"
                    class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                  <div class="flex justify-between items-center gap-2 flex-wrap">
                    <p class="text-xs text-gray-500">
                      <i class="fas fa-at text-animato-primary/60 mr-1"></i>
                      Tip: tag iemand met <span class="font-mono bg-gray-100 px-1 rounded">@voornaam</span> — die persoon krijgt een melding.
                    </p>
                    <button type="submit" class="bg-animato-primary hover:bg-animato-secondary text-white px-5 py-2 rounded-lg font-semibold text-sm transition">
                      <i class="fas fa-paper-plane mr-2"></i>Verstuur
                    </button>
                  </div>
                </form>
              </div>

              <script dangerouslySetInnerHTML={{__html: `
                (function() {
                  const bar = document.getElementById('emoji-reactions-bar');
                  if (!bar) return;
                  const eventId = bar.dataset.eventId;
                  bar.querySelectorAll('.emoji-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                      const type = btn.dataset.emojiType;
                      try {
                        const r = await fetch('/agenda/' + eventId + '/reactie-emoji', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ type })
                        });
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        const data = await r.json();
                        // Update counts
                        bar.querySelectorAll('[data-emoji-count]').forEach(el => {
                          const t = el.dataset.emojiCount;
                          el.textContent = data.counts[t] || 0;
                        });
                        // Update active state
                        bar.querySelectorAll('.emoji-btn').forEach(b => {
                          const t = b.dataset.emojiType;
                          if (t === data.myReaction) {
                            b.classList.remove('bg-white','border-gray-200','text-gray-700','hover:border-animato-primary','hover:bg-blue-50');
                            b.classList.add('bg-animato-primary','border-animato-primary','text-white','shadow-md');
                          } else {
                            b.classList.remove('bg-animato-primary','border-animato-primary','text-white','shadow-md');
                            b.classList.add('bg-white','border-gray-200','text-gray-700','hover:border-animato-primary','hover:bg-blue-50');
                          }
                        });
                      } catch (e) {
                        alert('Reactie opslaan mislukt. Probeer opnieuw.');
                        location.reload();
                      }
                    });
                  });
                })();
              `}} />
            </>
          ) : (
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-5 mb-6 text-center">
              <p class="text-sm text-blue-900">
                <i class="fas fa-lock mr-2"></i>
                <a href="/login" class="font-semibold underline hover:text-blue-700">Log in</a> om te reageren of een emoji-reactie achter te laten.
              </p>
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
      {/* Bootstrap voor polymorphic comment_reactions */}
      <script src="/static/js/comment-reactions.js" defer></script>
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
                          event.type === 'concert'     ? 'bg-yellow-200 text-yellow-900 border-l-4 border-yellow-500' :
                          event.type === 'repetitie'   ? 'bg-blue-200 text-blue-900 border-l-4 border-blue-500' :
                          event.type === 'vergadering' ? 'bg-indigo-200 text-indigo-900 border-l-4 border-indigo-500' :
                          event.type === 'activiteit'  ? 'bg-green-200 text-green-900 border-l-4 border-green-500' :
                          event.type === 'workshop'    ? 'bg-purple-200 text-purple-900 border-l-4 border-purple-500' :
                          event.type === 'uitstap'     ? 'bg-pink-200 text-pink-900 border-l-4 border-pink-500' :
                          'bg-gray-200 text-gray-800 border-l-4 border-gray-500'
                        }`}
                        title={`${event.titel} - ${formatBrusselsTime(event.start_at)}`}
                      >
                        {formatBrusselsTime(event.start_at)} {event.titel}
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
