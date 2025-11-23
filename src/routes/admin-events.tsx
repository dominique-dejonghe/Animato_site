// Admin Events Management
// Create, edit, and manage events with recurring options and locations

import { Hono } from 'hono'
import type { Bindings, SessionUser, Event, Location, RecurrenceRule } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'
import { createEventOccurrences, formatRecurrenceRule } from '../utils/recurring-events'
import { generateICS, generateBulkICS, generateGoogleCalendarURL } from '../utils/ics'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// EVENTS OVERVIEW
// =====================================================

app.get('/admin/events', async (c) => {
  const user = c.get('user') as SessionUser
  const type = c.req.query('type') || 'all'
  const search = c.req.query('search') || ''
  const view = c.req.query('view') || 'upcoming'
  const sortBy = c.req.query('sort') || 'start_at'
  const sortOrder = c.req.query('order') || 'asc'

  // Build query based on filters
  let query = `
    SELECT e.*, l.naam as locatie_naam, l.stad as locatie_stad,
           COUNT(DISTINCT ea.id) as aanmeldingen
    FROM events e
    LEFT JOIN locations l ON l.id = e.location_id
    LEFT JOIN event_attendance ea ON ea.event_id = e.id AND ea.status = 'aanwezig'
    WHERE 1=1
  `
  const params: any[] = []

  // Filter by view (upcoming/past/recurring/all)
  if (view === 'upcoming') {
    query += ` AND e.start_at >= datetime('now')`
  } else if (view === 'past') {
    query += ` AND e.start_at < datetime('now')`
  } else if (view === 'recurring') {
    // Show only parent recurring events (not individual occurrences)
    query += ` AND e.is_recurring = 1 AND e.parent_event_id IS NULL`
  }
  // Note: 'all' view shows everything including child occurrences

  // Filter by type
  if (type !== 'all') {
    query += ` AND e.type = ?`
    params.push(type)
  }

  // Search
  if (search) {
    query += ` AND (e.titel LIKE ? OR e.beschrijving LIKE ? OR e.locatie LIKE ?)`
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  // Sorting - validate sort column and order
  const validSortColumns: Record<string, string> = {
    'titel': 'e.titel',
    'type': 'e.type',
    'start_at': 'e.start_at',
    'locatie': 'COALESCE(l.naam, e.locatie)',
    'aanmeldingen': 'aanmeldingen'
  }
  
  const sortColumn = validSortColumns[sortBy] || 'e.start_at'
  const sortDirection = sortOrder === 'desc' ? 'DESC' : 'ASC'
  
  query += ` GROUP BY e.id ORDER BY ${sortColumn} ${sortDirection}`

  const events = await queryAll(c.env.DB, query, params)

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title="Events Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Events', href: '/admin/events' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-calendar-alt text-purple-600 mr-3"></i>
                  Events Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer repetities, concerten en andere events
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="/admin/locations"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  <i class="fas fa-map-marker-alt mr-2"></i>
                  Locaties
                </a>
                <a
                  href="/admin/events/nieuw"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuw Event
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Filters */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              {/* View Filter */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Weergave</label>
                <select
                  onchange={`window.location.href='/admin/events?view=' + this.value + '&type=${type}' + '&search=${search}'`}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="upcoming" selected={view === 'upcoming'}>Komende Events</option>
                  <option value="past" selected={view === 'past'}>Afgelopen Events</option>
                  <option value="recurring" selected={view === 'recurring'}>Terugkerende Events</option>
                  <option value="all" selected={view === 'all'}>Alle Events</option>
                </select>
              </div>

              {/* Type Filter */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Type</label>
                <select
                  onchange={`window.location.href='/admin/events?view=${view}&type=' + this.value + '&search=${search}'`}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all" selected={type === 'all'}>Alle Types</option>
                  <option value="repetitie" selected={type === 'repetitie'}>Repetitie</option>
                  <option value="concert" selected={type === 'concert'}>Concert</option>
                  <option value="ander" selected={type === 'ander'}>Ander</option>
                </select>
              </div>

              {/* Search */}
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">Zoeken</label>
                <form action="/admin/events" method="GET" class="flex gap-2">
                  <input type="hidden" name="view" value={view} />
                  <input type="hidden" name="type" value={type} />
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek op titel, beschrijving of locatie..."
                    class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                  <button
                    type="submit"
                    class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                  >
                    <i class="fas fa-search"></i>
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Bulk Actions Bar */}
          <div id="bulkActionsBar" class="hidden bg-animato-primary text-white rounded-lg shadow-md p-4 mb-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <span id="selectedCount" class="font-semibold">0 geselecteerd</span>
                <button
                  onclick="clearSelection()"
                  class="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition text-sm"
                >
                  <i class="fas fa-times mr-2"></i>Selectie wissen
                </button>
              </div>
              <div class="flex items-center gap-3">
                <button
                  onclick="exportSelectedEvents()"
                  class="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition font-semibold"
                >
                  <i class="fas fa-calendar-plus mr-2"></i>Exporteer naar Kalender
                </button>
                <button
                  onclick="deleteSelectedEvents()"
                  class="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition font-semibold"
                >
                  <i class="fas fa-trash mr-2"></i>Verwijder geselecteerde
                </button>
              </div>
            </div>
          </div>

          {/* Events List */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        id="selectAll"
                        onchange="toggleSelectAll(this)"
                        class="h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded cursor-pointer"
                      />
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <a href={`/admin/events?view=${view}&type=${type}&search=${search}&sort=titel&order=${sortBy === 'titel' && sortOrder === 'asc' ? 'desc' : 'asc'}`} class="flex items-center hover:text-animato-primary cursor-pointer">
                        Event
                        {sortBy === 'titel' && (
                          <i class={`fas fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-2 text-animato-primary`}></i>
                        )}
                        {sortBy !== 'titel' && <i class="fas fa-sort ml-2 text-gray-300"></i>}
                      </a>
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <a href={`/admin/events?view=${view}&type=${type}&search=${search}&sort=type&order=${sortBy === 'type' && sortOrder === 'asc' ? 'desc' : 'asc'}`} class="flex items-center hover:text-animato-primary cursor-pointer">
                        Type
                        {sortBy === 'type' && (
                          <i class={`fas fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-2 text-animato-primary`}></i>
                        )}
                        {sortBy !== 'type' && <i class="fas fa-sort ml-2 text-gray-300"></i>}
                      </a>
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <a href={`/admin/events?view=${view}&type=${type}&search=${search}&sort=start_at&order=${sortBy === 'start_at' && sortOrder === 'asc' ? 'desc' : 'asc'}`} class="flex items-center hover:text-animato-primary cursor-pointer">
                        Datum & Tijd
                        {sortBy === 'start_at' && (
                          <i class={`fas fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-2 text-animato-primary`}></i>
                        )}
                        {sortBy !== 'start_at' && <i class="fas fa-sort ml-2 text-gray-300"></i>}
                      </a>
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <a href={`/admin/events?view=${view}&type=${type}&search=${search}&sort=locatie&order=${sortBy === 'locatie' && sortOrder === 'asc' ? 'desc' : 'asc'}`} class="flex items-center hover:text-animato-primary cursor-pointer">
                        Locatie
                        {sortBy === 'locatie' && (
                          <i class={`fas fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-2 text-animato-primary`}></i>
                        )}
                        {sortBy !== 'locatie' && <i class="fas fa-sort ml-2 text-gray-300"></i>}
                      </a>
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <a href={`/admin/events?view=${view}&type=${type}&search=${search}&sort=aanmeldingen&order=${sortBy === 'aanmeldingen' && sortOrder === 'asc' ? 'desc' : 'asc'}`} class="flex items-center hover:text-animato-primary cursor-pointer">
                        Aanmeldingen
                        {sortBy === 'aanmeldingen' && (
                          <i class={`fas fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-2 text-animato-primary`}></i>
                        )}
                        {sortBy !== 'aanmeldingen' && <i class="fas fa-sort ml-2 text-gray-300"></i>}
                      </a>
                    </th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acties
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {events.length === 0 ? (
                    <tr>
                      <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-calendar-times text-4xl mb-2"></i>
                        <p>Geen events gevonden</p>
                      </td>
                    </tr>
                  ) : (
                    events.map((event: any) => (
                      <tr class="hover:bg-gray-50" id={`row-${event.id}`}>
                        <td class="px-6 py-4">
                          <input
                            type="checkbox"
                            class="event-checkbox h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded cursor-pointer"
                            data-event-id={event.id}
                            onchange="updateBulkActions()"
                          />
                        </td>
                        <td class="px-6 py-4">
                          <div class="flex items-center">
                            {event.is_recurring && (
                              <i class="fas fa-sync text-purple-600 mr-2" title="Terugkerend event"></i>
                            )}
                            {event.parent_event_id && (
                              <i class="fas fa-link text-gray-400 mr-2" title="Onderdeel van reeks"></i>
                            )}
                            <div>
                              <div class="text-sm font-medium text-gray-900">{event.titel}</div>
                              {event.beschrijving && (
                                <div class="text-sm text-gray-500 line-clamp-1 whitespace-pre-line">{event.beschrijving}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <span class={`px-2 py-1 text-xs font-semibold rounded-full ${
                            event.type === 'repetitie' ? 'bg-blue-100 text-blue-800' :
                            event.type === 'concert' ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {event.type === 'repetitie' ? 'Repetitie' :
                             event.type === 'concert' ? 'Concert' : 'Ander'}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>{new Date(event.start_at).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                          <div class="text-gray-500">
                            {new Date(event.start_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                            {' - '}
                            {new Date(event.end_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-900">
                          <div class="flex items-center">
                            <i class="fas fa-map-marker-alt text-red-500 mr-2"></i>
                            <div>
                              <div>{event.locatie_naam || event.locatie}</div>
                              {event.locatie_stad && (
                                <div class="text-gray-500 text-xs">{event.locatie_stad}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <i class="fas fa-users mr-1"></i>
                          {event.aanmeldingen || 0}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div class="flex items-center justify-end gap-2">
                            <a
                              href={`/admin/events/${event.id}`}
                              class="text-animato-primary hover:text-animato-secondary"
                              title="Bewerken"
                            >
                              <i class="fas fa-edit"></i>
                            </a>
                            
                            {/* Export Dropdown */}
                            <div class="relative inline-block">
                              <button
                                onclick={`toggleExportMenu(${event.id})`}
                                class="text-green-600 hover:text-green-900"
                                title="Exporteren"
                              >
                                <i class="fas fa-calendar-plus"></i>
                              </button>
                              <div id={`export-menu-${event.id}`} class="hidden absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                                <div class="py-1">
                                  <a
                                    href={`/admin/events/${event.id}/google-calendar`}
                                    target="_blank"
                                    class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    <i class="fab fa-google text-red-500 mr-2"></i>Google Calendar
                                  </a>
                                  <a
                                    href={`/admin/events/${event.id}/export.ics`}
                                    download
                                    class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    <i class="fas fa-calendar text-blue-500 mr-2"></i>Outlook / Apple
                                  </a>
                                </div>
                              </div>
                            </div>
                            
                            <button
                              onclick={`if(confirm('Weet je zeker dat je dit event wilt verwijderen?${event.is_recurring ? ' Dit verwijdert ALLE occurrences!' : ''}')) { 
                                fetch('/admin/events/${event.id}/delete', {method: 'POST'}).then(() => location.reload()) 
                              }`}
                              class="text-red-600 hover:text-red-900"
                              title="Verwijderen"
                            >
                              <i class="fas fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stats */}
          <div class="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Totaal Events</div>
              <div class="text-2xl font-bold text-gray-900">{events.length}</div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Repetities</div>
              <div class="text-2xl font-bold text-blue-600">
                {events.filter((e: any) => e.type === 'repetitie').length}
              </div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Concerten</div>
              <div class="text-2xl font-bold text-purple-600">
                {events.filter((e: any) => e.type === 'concert').length}
              </div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Terugkerend</div>
              <div class="text-2xl font-bold text-green-600">
                {events.filter((e: any) => e.is_recurring).length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-select JavaScript */}
      <script dangerouslySetInnerHTML={{
        __html: `
          function toggleSelectAll(checkbox) {
            const checkboxes = document.querySelectorAll('.event-checkbox');
            checkboxes.forEach(cb => {
              cb.checked = checkbox.checked;
            });
            updateBulkActions();
          }

          function updateBulkActions() {
            const checkboxes = document.querySelectorAll('.event-checkbox:checked');
            const count = checkboxes.length;
            const bulkBar = document.getElementById('bulkActionsBar');
            const countSpan = document.getElementById('selectedCount');
            const selectAllCheckbox = document.getElementById('selectAll');
            const allCheckboxes = document.querySelectorAll('.event-checkbox');

            if (count > 0) {
              bulkBar.classList.remove('hidden');
              countSpan.textContent = count + ' geselecteerd';
            } else {
              bulkBar.classList.add('hidden');
            }

            // Update "select all" checkbox state
            if (count === 0) {
              selectAllCheckbox.checked = false;
              selectAllCheckbox.indeterminate = false;
            } else if (count === allCheckboxes.length) {
              selectAllCheckbox.checked = true;
              selectAllCheckbox.indeterminate = false;
            } else {
              selectAllCheckbox.checked = false;
              selectAllCheckbox.indeterminate = true;
            }
          }

          function clearSelection() {
            const checkboxes = document.querySelectorAll('.event-checkbox');
            checkboxes.forEach(cb => {
              cb.checked = false;
            });
            document.getElementById('selectAll').checked = false;
            updateBulkActions();
          }

          async function deleteSelectedEvents() {
            const checkboxes = document.querySelectorAll('.event-checkbox:checked');
            const eventIds = Array.from(checkboxes).map(cb => cb.dataset.eventId);
            
            if (eventIds.length === 0) {
              alert('Geen events geselecteerd');
              return;
            }

            const confirmed = confirm(
              'Weet je zeker dat je ' + eventIds.length + ' event(s) wilt verwijderen?\\n\\n' +
              'Let op: Als je terugkerende events verwijdert, worden ALLE occurrences verwijderd!'
            );

            if (!confirmed) return;

            // Show loading state
            const bulkBar = document.getElementById('bulkActionsBar');
            const originalHTML = bulkBar.innerHTML;
            bulkBar.innerHTML = '<div class="text-center py-2"><i class="fas fa-spinner fa-spin mr-2"></i>Events verwijderen...</div>';

            try {
              // Delete events one by one
              for (const eventId of eventIds) {
                await fetch('/admin/events/' + eventId + '/delete', {
                  method: 'POST'
                });
              }

              // Reload page to show updated list
              location.reload();
            } catch (error) {
              bulkBar.innerHTML = originalHTML;
              alert('Er is een fout opgetreden bij het verwijderen van events');
              console.error('Delete error:', error);
            }
          }

          function exportSelectedEvents() {
            const checkboxes = document.querySelectorAll('.event-checkbox:checked');
            const eventIds = Array.from(checkboxes).map(cb => cb.dataset.eventId);
            
            if (eventIds.length === 0) {
              alert('Geen events geselecteerd');
              return;
            }

            // Create form and submit for bulk ICS export
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/admin/events/export-bulk.ics';
            
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'event_ids';
            input.value = eventIds.join(',');
            
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
          }

          // Toggle export menu for individual events
          function toggleExportMenu(eventId) {
            const menu = document.getElementById('export-menu-' + eventId);
            const allMenus = document.querySelectorAll('[id^="export-menu-"]');
            
            // Close all other menus
            allMenus.forEach(m => {
              if (m.id !== 'export-menu-' + eventId) {
                m.classList.add('hidden');
              }
            });
            
            // Toggle this menu
            menu.classList.toggle('hidden');
          }

          // Close export menus when clicking outside
          document.addEventListener('click', function(e) {
            if (!e.target.closest('.fa-calendar-plus') && !e.target.closest('[id^="export-menu-"]')) {
              document.querySelectorAll('[id^="export-menu-"]').forEach(menu => {
                menu.classList.add('hidden');
              });
            }
          });
        `
      }}></script>
    </Layout>
  )
})

// =====================================================
// CREATE/EDIT EVENT FORM
// =====================================================

app.get('/admin/events/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Get all active locations
  const locations = await queryAll(
    c.env.DB,
    `SELECT * FROM locations WHERE is_actief = 1 ORDER BY naam ASC`
  )

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title="Nieuw Event"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Events', href: '/admin/events' },
        { label: 'Nieuw Event', href: '/admin/events/nieuw' }
      ]}
    >
      {renderEventForm(null, locations)}
    </Layout>
  )
})

app.get('/admin/events/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')

  // Get event
  const event = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM events WHERE id = ?`,
    [id]
  )

  if (!event) {
    return c.redirect('/admin/events')
  }

  // Get all active locations
  const locations = await queryAll(
    c.env.DB,
    `SELECT * FROM locations WHERE is_actief = 1 ORDER BY naam ASC`
  )

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title={`Bewerk Event: ${event.titel}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Events', href: '/admin/events' },
        { label: 'Bewerken', href: `/admin/events/${id}` }
      ]}
    >
      {renderEventForm(event, locations)}
    </Layout>
  )
})

// =====================================================
// SAVE EVENT (CREATE/UPDATE)
// =====================================================

app.post('/admin/events/save', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()

  const {
    id, type, titel, slug, beschrijving, afbeelding, locatie, location_id,
    start_at, end_at, max_deelnemers, aanmelden_verplicht, doelgroep,
    zichtbaar_publiek, toon_op_homepage,
    is_recurring, recurrence_frequency, recurrence_interval,
    recurrence_end_date, recurrence_count, recurrence_days
  } = body

  try {
    // Generate slug from title if not provided
    let baseSlug = slug || String(titel).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    
    // Check for duplicate slugs and append number if needed
    let finalSlug = baseSlug
    let counter = 1
    while (true) {
      const existing = await queryOne(
        c.env.DB,
        `SELECT id FROM events WHERE slug = ? AND id != ?`,
        [finalSlug, id || 0]
      )
      if (!existing) break
      finalSlug = `${baseSlug}-${counter}`
      counter++
    }

    // Ensure locatie has a value (NOT NULL constraint)
    let finalLocatie = locatie as string || ''
    
    // Normalize location_id: empty string → null
    const finalLocationId = (location_id && String(location_id).trim() !== '') ? parseInt(String(location_id)) : null
    
    // If location_id is provided, fetch the location name
    if (finalLocationId) {
      const location = await queryOne<any>(
        c.env.DB,
        `SELECT naam FROM locations WHERE id = ?`,
        [finalLocationId]
      )
      if (location) {
        finalLocatie = location.naam
      }
    }
    
    // If still empty, use a default
    if (!finalLocatie) {
      finalLocatie = 'Te bepalen'
    }

    // Parse recurring settings
    let recurrenceRule: RecurrenceRule | null = null
    if (is_recurring === 'on') {
      recurrenceRule = {
        frequency: recurrence_frequency as any,
        interval: parseInt(recurrence_interval as string) || 1,
        end_date: recurrence_end_date ? (recurrence_end_date as string) : null,
        count: recurrence_count ? parseInt(recurrence_count as string) : undefined,
        days_of_week: recurrence_days ? 
          (Array.isArray(recurrence_days) ? recurrence_days : [recurrence_days]).map(d => parseInt(d as string)) 
          : undefined
      }
    }

    if (id) {
      // UPDATE existing event
      await execute(
        c.env.DB,
        `UPDATE events 
         SET type = ?, titel = ?, slug = ?, beschrijving = ?, afbeelding = ?, locatie = ?, location_id = ?,
             start_at = ?, end_at = ?, max_deelnemers = ?, aanmelden_verplicht = ?, doelgroep = ?,
             zichtbaar_publiek = ?, toon_op_homepage = ?,
             is_recurring = ?, recurrence_rule = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          type, titel, finalSlug, beschrijving || null, afbeelding || null, finalLocatie, finalLocationId,
          start_at, end_at, max_deelnemers || null, aanmelden_verplicht === 'on' ? 1 : 0, doelgroep || 'all',
          zichtbaar_publiek === 'on' ? 1 : 0, toon_op_homepage === 'on' ? 1 : 0,
          is_recurring === 'on' ? 1 : 0, recurrenceRule ? JSON.stringify(recurrenceRule) : null,
          id
        ]
      )

      // If recurring was enabled, regenerate occurrences
      if (is_recurring === 'on' && recurrenceRule) {
        // Delete old occurrences
        await execute(
          c.env.DB,
          `DELETE FROM events WHERE parent_event_id = ?`,
          [id]
        )

        // Generate new occurrences
        const baseEvent = {
          type, titel, beschrijving, locatie: finalLocatie, location_id: finalLocationId,
          start_at, end_at, max_deelnemers, aanmelden_verplicht: aanmelden_verplicht === 'on',
          zichtbaar_publiek: zichtbaar_publiek === 'on', toon_op_homepage: false, // Don't show on homepage
          slug: null // Each occurrence gets unique slug
        }
        await generateAndSaveOccurrences(c.env.DB, parseInt(id as string), baseEvent, recurrenceRule, user.id)
      }

    } else {
      // CREATE new event
      const isPubliekValue = zichtbaar_publiek === 'on' ? 1 : 0
      const result = await execute(
        c.env.DB,
        `INSERT INTO events 
         (type, titel, slug, beschrijving, afbeelding, locatie, location_id, start_at, end_at, 
          max_deelnemers, aanmelden_verplicht, doelgroep, is_publiek, zichtbaar_publiek, toon_op_homepage,
          is_recurring, recurrence_rule, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type, titel, finalSlug, beschrijving || null, afbeelding || null, finalLocatie, finalLocationId,
          start_at, end_at, max_deelnemers || null, aanmelden_verplicht === 'on' ? 1 : 0, doelgroep || 'all',
          isPubliekValue, isPubliekValue, toon_op_homepage === 'on' ? 1 : 0,
          is_recurring === 'on' ? 1 : 0, recurrenceRule ? JSON.stringify(recurrenceRule) : null,
          user.id
        ]
      )

      // If type is concert, automatically create concerts table entry
      if (type === 'concert' && result.meta.last_row_id) {
        await execute(
          c.env.DB,
          `INSERT INTO concerts (event_id, programma, ticketing_enabled, uitverkocht)
           VALUES (?, ?, ?, ?)`,
          [result.meta.last_row_id, '', 0, 0]
        )
      }

      // If recurring, generate occurrences
      if (is_recurring === 'on' && recurrenceRule && result.meta.last_row_id) {
        const baseEvent = {
          type, titel, beschrijving, locatie: finalLocatie, location_id: finalLocationId,
          start_at, end_at, max_deelnemers, aanmelden_verplicht: aanmelden_verplicht === 'on',
          zichtbaar_publiek: zichtbaar_publiek === 'on', toon_op_homepage: false,
          slug: null
        }
        await generateAndSaveOccurrences(c.env.DB, result.meta.last_row_id, baseEvent, recurrenceRule, user.id)
      }
    }

    return c.redirect('/admin/events')
  } catch (error: any) {
    console.error('Error saving event:', error)
    const errorMessage = error?.message || String(error)
    return c.html(
      <div class="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl p-8 max-w-2xl w-full">
          <div class="flex items-center mb-4">
            <i class="fas fa-exclamation-triangle text-red-600 text-3xl mr-4"></i>
            <h1 class="text-2xl font-bold text-gray-900">Error bij opslaan event</h1>
          </div>
          <div class="bg-red-100 border border-red-400 rounded-lg p-4 mb-4">
            <p class="text-red-800 font-mono text-sm whitespace-pre-wrap">{errorMessage}</p>
          </div>
          <div class="bg-gray-100 rounded-lg p-4 mb-4">
            <h2 class="font-bold mb-2">Debug Info:</h2>
            <pre class="text-xs overflow-auto">{JSON.stringify({
              type: body.type,
              titel: body.titel,
              start_at: body.start_at,
              end_at: body.end_at,
              locatie: body.locatie,
              location_id: body.location_id,
              doelgroep: body.doelgroep,
              afbeelding_length: body.afbeelding ? String(body.afbeelding).length : 0
            }, null, 2)}</pre>
          </div>
          <div class="flex gap-3">
            <a href="/admin/events/nieuw" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition">
              <i class="fas fa-arrow-left mr-2"></i>Probeer Opnieuw
            </a>
            <a href="/admin/events" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
              Terug naar Overzicht
            </a>
          </div>
        </div>
      </div>
    , 500)
  }
})

// =====================================================
// DELETE EVENT
// =====================================================

app.post('/admin/events/:id/delete', async (c) => {
  const id = c.req.param('id')

  try {
    // Check if this is a recurring parent event
    const event = await queryOne<any>(
      c.env.DB,
      `SELECT is_recurring FROM events WHERE id = ?`,
      [id]
    )

    if (event?.is_recurring) {
      // Delete all child occurrences
      await execute(
        c.env.DB,
        `DELETE FROM events WHERE parent_event_id = ?`,
        [id]
      )
    }

    // Delete the event
    await execute(
      c.env.DB,
      `DELETE FROM events WHERE id = ?`,
      [id]
    )

    // Delete attendance records
    await execute(
      c.env.DB,
      `DELETE FROM event_attendance WHERE event_id = ?`,
      [id]
    )

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting event:', error)
    return c.json({ success: false, error: 'Failed to delete event' }, 500)
  }
})

// =====================================================
// HELPER: RENDER EVENT FORM
// =====================================================

function renderEventForm(event: any | null, locations: any[]) {
  const isEdit = !!event
  const recurrenceRule: RecurrenceRule | null = event?.recurrence_rule ? 
    JSON.parse(event.recurrence_rule) : null

  return (
    <div class="bg-gray-50 min-h-screen">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="bg-white rounded-lg shadow-md p-8">
          
          <form method="POST" action="/admin/events/save" id="eventForm">
            {isEdit && <input type="hidden" name="id" value={event.id} />}

            {/* Basic Info Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-info-circle text-purple-600 mr-2"></i>
                Basis Informatie
              </h2>

              {/* Type */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Event Type *
                </label>
                <select
                  name="type"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="repetitie" selected={event?.type === 'repetitie'}>Repetitie</option>
                  <option value="concert" selected={event?.type === 'concert'}>Concert</option>
                  <option value="ander" selected={event?.type === 'ander'}>Ander</option>
                </select>
              </div>

              {/* Doelgroep */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-users text-blue-600 mr-2"></i>
                  Voor Wie? *
                </label>
                <select
                  name="doelgroep"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all" selected={!event?.doelgroep || event?.doelgroep === 'all'}>Iedereen (Alle stemmen)</option>
                  <optgroup label="Individuele Stemmen">
                    <option value="S" selected={event?.doelgroep === 'S'}>🎵 Sopraan</option>
                    <option value="A" selected={event?.doelgroep === 'A'}>🎵 Alt</option>
                    <option value="T" selected={event?.doelgroep === 'T'}>🎵 Tenor</option>
                    <option value="B" selected={event?.doelgroep === 'B'}>🎵 Bas</option>
                  </optgroup>
                  <optgroup label="Combinaties">
                    <option value="SA" selected={event?.doelgroep === 'SA'}>🎵 SA (Sopraan + Alt)</option>
                    <option value="TB" selected={event?.doelgroep === 'TB'}>🎵 TB (Tenor + Bas)</option>
                    <option value="SATB" selected={event?.doelgroep === 'SATB'}>🎵 SATB (Alle zangers)</option>
                  </optgroup>
                  <optgroup label="Overig">
                    <option value="bestuur" selected={event?.doelgroep === 'bestuur'}>👔 Bestuur</option>
                  </optgroup>
                </select>
                <p class="text-xs text-gray-500 mt-1">
                  💡 Voor repetities: selecteer de stemgroep(en). Alleen geselecteerde leden zien dit event.
                </p>
              </div>

              {/* Titel */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel *
                </label>
                <input
                  type="text"
                  name="titel"
                  id="titelInput"
                  value={event?.titel || ''}
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijvoorbeeld: Weekrepetitie"
                />
              </div>

              {/* Beschrijving */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving
                </label>
                <textarea
                  name="beschrijving"
                  rows={4}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Optionele beschrijving van het event..."
                >{event?.beschrijving || ''}</textarea>
              </div>

              {/* Afbeelding */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-image text-purple-600 mr-2"></i>
                  Afbeelding (optioneel)
                </label>

                {/* Toggle between Upload and URL */}
                <div class="flex gap-2 mb-3">
                  <button
                    type="button"
                    id="uploadTabBtn"
                    onclick="switchImageMode('upload')"
                    class="flex-1 px-4 py-2 text-sm font-medium rounded-lg border-2 border-animato-primary bg-animato-primary text-white transition"
                  >
                    <i class="fas fa-upload mr-2"></i>
                    Upload Bestand
                  </button>
                  <button
                    type="button"
                    id="urlTabBtn"
                    onclick="switchImageMode('url')"
                    class="flex-1 px-4 py-2 text-sm font-medium rounded-lg border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                  >
                    <i class="fas fa-link mr-2"></i>
                    URL Invoeren
                  </button>
                </div>

                {/* Upload Mode */}
                <div id="uploadMode">
                  <input
                    type="file"
                    id="afbeeldingUpload"
                    accept="image/*"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-animato-primary file:text-white hover:file:bg-animato-secondary file:cursor-pointer"
                    onchange="handleImageUpload(event)"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    <i class="fas fa-info-circle mr-1"></i>
                    Upload een afbeelding (JPG, PNG, max 2MB). Wordt automatisch geconverteerd naar data URL.
                  </p>
                </div>

                {/* URL Mode */}
                <div id="urlMode" class="hidden">
                  <input
                    type="url"
                    id="afbeeldingInput"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    placeholder="https://example.com/image.jpg"
                    onchange="previewImageFromUrl()"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    <i class="fas fa-info-circle mr-1"></i>
                    Plak een URL van een online afbeelding
                  </p>
                </div>

                {/* Hidden field to store actual image data/URL */}
                <input
                  type="hidden"
                  name="afbeelding"
                  id="afbeeldingValue"
                  value={event?.afbeelding || ''}
                />

                {/* Image Preview */}
                <div id="imagePreview" class={`mt-3 ${event?.afbeelding ? '' : 'hidden'}`}>
                  <div class="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                    <img 
                      id="previewImg" 
                      src={event?.afbeelding || ''} 
                      alt="Preview"
                      class="w-full h-full object-cover"
                      onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-gray-400\\'>Afbeelding niet geladen</div>'"
                    />
                    <button
                      type="button"
                      onclick="clearImage()"
                      class="absolute top-2 right-2 bg-red-500 text-white w-8 h-8 rounded-full hover:bg-red-600 transition"
                      title="Verwijder afbeelding"
                    >
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Location Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-map-marker-alt text-red-600 mr-2"></i>
                Locatie
              </h2>

              {/* Location Selector */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Selecteer Locatie
                </label>
                <div class="flex gap-2">
                  <select
                    name="location_id"
                    id="locationSelect"
                    class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    onchange="updateLocationInfo()"
                  >
                    <option value="">Geen vaste locatie</option>
                    {locations.map((loc: any) => (
                      <option 
                        value={loc.id} 
                        selected={event?.location_id === loc.id}
                        data-adres={loc.adres}
                        data-stad={loc.stad}
                        data-maps={loc.google_maps_url}
                      >
                        {loc.naam} - {loc.stad}
                      </option>
                    ))}
                  </select>
                  <a
                    href="/admin/locations/nieuw"
                    target="_blank"
                    class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition whitespace-nowrap"
                  >
                    <i class="fas fa-plus mr-2"></i>
                    Nieuw
                  </a>
                </div>
              </div>

              {/* Manual Location (fallback) */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Of: Handmatige Locatie
                </label>
                <input
                  type="text"
                  name="locatie"
                  id="locatieInput"
                  value={event?.locatie || ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Alleen invullen als je geen vaste locatie selecteert"
                />
                <p class="text-xs text-gray-500 mt-1">
                  Let op: Vaste locaties hebben Google Maps integratie
                </p>
              </div>

              {/* Location Preview */}
              <div id="locationPreview" class="hidden bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div class="flex items-start gap-3">
                  <i class="fas fa-map-marker-alt text-blue-600 text-xl mt-1"></i>
                  <div class="flex-1">
                    <div id="previewNaam" class="font-medium text-gray-900"></div>
                    <div id="previewAdres" class="text-sm text-gray-600"></div>
                    <a id="previewMaps" href="#" target="_blank" class="text-sm text-blue-600 hover:underline mt-1 inline-block">
                      <i class="fas fa-external-link-alt mr-1"></i>
                      Bekijk op Google Maps
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Date & Time Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-clock text-green-600 mr-2"></i>
                Datum & Tijd
              </h2>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Start Date & Time */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Start *
                  </label>
                  <input
                    type="datetime-local"
                    name="start_at"
                    id="start_at"
                    value={event?.start_at ? event.start_at.slice(0, 16) : ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    onchange="checkPastDate()"
                  />
                </div>

                {/* End Date & Time */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Einde *
                  </label>
                  <input
                    type="datetime-local"
                    name="end_at"
                    value={event?.end_at ? event.end_at.slice(0, 16) : ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                </div>
              </div>

              {/* Past Date Warning */}
              <div id="pastDateWarning" class="hidden mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div class="flex items-start gap-3">
                  <i class="fas fa-archive text-amber-600 text-lg mt-0.5"></i>
                  <div>
                    <p class="text-sm font-semibold text-amber-800">
                      Archief Concert
                    </p>
                    <p class="text-sm text-amber-700 mt-1">
                      Dit event vindt plaats in het verleden. Het wordt automatisch als archief getoond zonder ticketing mogelijkheden.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recurring Options Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-sync text-purple-600 mr-2"></i>
                Terugkerend Event
              </h2>

              {/* Enable Recurring */}
              <div class="mb-4">
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="is_recurring"
                    id="isRecurringCheckbox"
                    checked={event?.is_recurring || false}
                    onchange="toggleRecurringOptions()"
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="ml-2 text-gray-700">
                    Dit is een terugkerend event (herhaalt zich automatisch)
                  </span>
                </label>
              </div>

              {/* Recurring Options (hidden by default) */}
              <div id="recurringOptions" class={`space-y-4 ${event?.is_recurring ? '' : 'hidden'}`}>
                
                {/* Frequency */}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      Frequentie *
                    </label>
                    <select
                      name="recurrence_frequency"
                      id="frequencySelect"
                      onchange="updateRecurrencePreview()"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    >
                      <option value="daily" selected={recurrenceRule?.frequency === 'daily'}>Dagelijks</option>
                      <option value="weekly" selected={recurrenceRule?.frequency === 'weekly'}>Wekelijks</option>
                      <option value="monthly" selected={recurrenceRule?.frequency === 'monthly'}>Maandelijks</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      Interval *
                    </label>
                    <input
                      type="number"
                      name="recurrence_interval"
                      id="intervalInput"
                      value={recurrenceRule?.interval || 1}
                      min="1"
                      max="12"
                      onchange="updateRecurrencePreview()"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    />
                    <p class="text-xs text-gray-500 mt-1">
                      Bijvoorbeeld: 2 = elke 2 weken
                    </p>
                  </div>
                </div>

                {/* Days of Week (only for weekly) */}
                <div id="daysOfWeekSection" class={`${recurrenceRule?.frequency === 'weekly' ? '' : 'hidden'}`}>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Dagen van de Week
                  </label>
                  <div class="flex flex-wrap gap-2">
                    {[
                      { value: 1, label: 'Ma' },
                      { value: 2, label: 'Di' },
                      { value: 3, label: 'Wo' },
                      { value: 4, label: 'Do' },
                      { value: 5, label: 'Vr' },
                      { value: 6, label: 'Za' },
                      { value: 0, label: 'Zo' }
                    ].map(day => (
                      <label class="flex items-center px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          name="recurrence_days"
                          value={day.value}
                          checked={recurrenceRule?.days_of_week?.includes(day.value)}
                          class="w-4 h-4 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                        />
                        <span class="ml-2 text-sm text-gray-700">{day.label}</span>
                      </label>
                    ))}
                  </div>
                  <p class="text-xs text-gray-500 mt-2">
                    Laat leeg om de dag van het start event te gebruiken
                  </p>
                </div>

                {/* End Condition */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Einddatum
                  </label>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                      type="date"
                      name="recurrence_end_date"
                      id="endDateInput"
                      value={recurrenceRule?.end_date || ''}
                      onchange="updateRecurrencePreview()"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    />
                    <div>
                      <label class="text-xs text-gray-600 mb-1 block">Of: Aantal keren</label>
                      <input
                        type="number"
                        name="recurrence_count"
                        id="countInput"
                        value={recurrenceRule?.count || ''}
                        min="1"
                        max="100"
                        placeholder="Laat leeg voor einddatum"
                        onchange="updateRecurrencePreview()"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                      />
                    </div>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">
                    Kies einddatum OF aantal keren (niet beide)
                  </p>
                </div>

                {/* Preview */}
                <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div class="flex items-start gap-3">
                    <i class="fas fa-info-circle text-purple-600 text-lg mt-0.5"></i>
                    <div>
                      <div class="font-medium text-gray-900 mb-1">Voorbeeld Herhaling:</div>
                      <div id="recurrencePreview" class="text-sm text-gray-700">
                        {recurrenceRule ? formatRecurrenceRule(recurrenceRule) : 'Configureer herhaling opties...'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-cog text-gray-600 mr-2"></i>
                Instellingen
              </h2>

              <div class="space-y-3">
                {/* Max Deelnemers */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Maximaal Aantal Deelnemers
                  </label>
                  <input
                    type="number"
                    name="max_deelnemers"
                    value={event?.max_deelnemers || ''}
                    min="1"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    placeholder="Laat leeg voor onbeperkt"
                  />
                </div>

                {/* Checkboxes */}
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="aanmelden_verplicht"
                    checked={event?.aanmelden_verplicht || false}
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="ml-2 text-gray-700">Aanmelden verplicht</span>
                </label>

                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="zichtbaar_publiek"
                    checked={event?.zichtbaar_publiek !== false}
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="ml-2 text-gray-700">Zichtbaar voor publiek</span>
                </label>

                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="toon_op_homepage"
                    checked={event?.toon_op_homepage || false}
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="ml-2 text-gray-700">Toon op homepage</span>
                </label>
              </div>
            </div>

            {/* Submit Buttons */}
            <div class="flex items-center justify-between pt-6 border-t">
              <a
                href="/admin/events"
                class="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                Annuleren
              </a>
              <button
                type="submit"
                class="px-6 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
              >
                <i class="fas fa-save mr-2"></i>
                {isEdit ? 'Wijzigingen Opslaan' : 'Event Aanmaken'}
              </button>
            </div>
          </form>

        </div>
      </div>

      {/* JavaScript for form interactions */}
      <script dangerouslySetInnerHTML={{
        __html: `
          // Location preview
          function updateLocationInfo() {
            const select = document.getElementById('locationSelect');
            const preview = document.getElementById('locationPreview');
            const locatieInput = document.getElementById('locatieInput');
            
            if (select.value) {
              const option = select.options[select.selectedIndex];
              const naam = option.text;
              const adres = option.dataset.adres || '';
              const maps = option.dataset.maps || '';
              
              document.getElementById('previewNaam').textContent = naam;
              document.getElementById('previewAdres').textContent = adres;
              
              if (maps) {
                document.getElementById('previewMaps').href = maps;
                document.getElementById('previewMaps').classList.remove('hidden');
              } else {
                document.getElementById('previewMaps').classList.add('hidden');
              }
              
              preview.classList.remove('hidden');
              locatieInput.value = ''; // Clear manual input
            } else {
              preview.classList.add('hidden');
            }
          }

          // Image mode switching
          function switchImageMode(mode) {
            const uploadMode = document.getElementById('uploadMode');
            const urlMode = document.getElementById('urlMode');
            const uploadBtn = document.getElementById('uploadTabBtn');
            const urlBtn = document.getElementById('urlTabBtn');
            
            if (mode === 'upload') {
              uploadMode.classList.remove('hidden');
              urlMode.classList.add('hidden');
              uploadBtn.classList.add('border-animato-primary', 'bg-animato-primary', 'text-white');
              uploadBtn.classList.remove('border-gray-300', 'text-gray-700', 'bg-white');
              urlBtn.classList.remove('border-animato-primary', 'bg-animato-primary', 'text-white');
              urlBtn.classList.add('border-gray-300', 'text-gray-700', 'bg-white');
            } else {
              urlMode.classList.remove('hidden');
              uploadMode.classList.add('hidden');
              urlBtn.classList.add('border-animato-primary', 'bg-animato-primary', 'text-white');
              urlBtn.classList.remove('border-gray-300', 'text-gray-700', 'bg-white');
              uploadBtn.classList.remove('border-animato-primary', 'bg-animato-primary', 'text-white');
              uploadBtn.classList.add('border-gray-300', 'text-gray-700', 'bg-white');
            }
          }

          // Handle file upload and convert to base64
          function handleImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Check file size (max 2MB)
            if (file.size > 2 * 1024 * 1024) {
              alert('Bestand is te groot! Maximaal 2MB toegestaan.');
              event.target.value = '';
              return;
            }

            // Check file type
            if (!file.type.startsWith('image/')) {
              alert('Alleen afbeeldingen zijn toegestaan!');
              event.target.value = '';
              return;
            }

            // Convert to base64
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64 = e.target.result;
              const hiddenInput = document.getElementById('afbeeldingValue');
              const preview = document.getElementById('imagePreview');
              const img = document.getElementById('previewImg');
              
              // Store base64 in hidden field
              hiddenInput.value = base64;
              
              // Show preview
              img.src = base64;
              preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
          }

          // Preview image from URL
          function previewImageFromUrl() {
            const input = document.getElementById('afbeeldingInput');
            const hiddenInput = document.getElementById('afbeeldingValue');
            const preview = document.getElementById('imagePreview');
            const img = document.getElementById('previewImg');
            
            if (input.value) {
              hiddenInput.value = input.value;
              img.src = input.value;
              preview.classList.remove('hidden');
            } else {
              preview.classList.add('hidden');
            }
          }

          function clearImage() {
            const uploadInput = document.getElementById('afbeeldingUpload');
            const urlInput = document.getElementById('afbeeldingInput');
            const hiddenInput = document.getElementById('afbeeldingValue');
            const preview = document.getElementById('imagePreview');
            
            if (uploadInput) uploadInput.value = '';
            if (urlInput) urlInput.value = '';
            if (hiddenInput) hiddenInput.value = '';
            preview.classList.add('hidden');
          }

          // Check if date is in the past
          function checkPastDate() {
            const startInput = document.getElementById('start_at');
            const warning = document.getElementById('pastDateWarning');
            
            if (startInput && warning) {
              const startDate = new Date(startInput.value);
              const now = new Date();
              
              if (startDate < now) {
                warning.classList.remove('hidden');
              } else {
                warning.classList.add('hidden');
              }
            }
          }

          // Check on page load if editing
          document.addEventListener('DOMContentLoaded', function() {
            checkPastDate();
            
            // Show preview if there's already an image
            const hiddenInput = document.getElementById('afbeeldingValue');
            const preview = document.getElementById('imagePreview');
            const img = document.getElementById('previewImg');
            
            if (hiddenInput && hiddenInput.value) {
              img.src = hiddenInput.value;
              preview.classList.remove('hidden');
            }
          });

          // Toggle recurring options
          function toggleRecurringOptions() {
            const checkbox = document.getElementById('isRecurringCheckbox');
            const options = document.getElementById('recurringOptions');
            
            if (checkbox.checked) {
              options.classList.remove('hidden');
              updateRecurrencePreview();
            } else {
              options.classList.add('hidden');
            }
          }

          // Update days of week visibility
          document.getElementById('frequencySelect')?.addEventListener('change', function() {
            const daysSection = document.getElementById('daysOfWeekSection');
            if (this.value === 'weekly') {
              daysSection.classList.remove('hidden');
            } else {
              daysSection.classList.add('hidden');
            }
          });

          // Update recurrence preview
          function updateRecurrencePreview() {
            const frequency = document.getElementById('frequencySelect').value;
            const interval = document.getElementById('intervalInput').value || 1;
            const endDate = document.getElementById('endDateInput').value;
            const count = document.getElementById('countInput').value;
            
            let preview = '';
            
            // Frequency text
            if (frequency === 'daily') {
              preview = interval == 1 ? 'Elke dag' : \`Elke \${interval} dagen\`;
            } else if (frequency === 'weekly') {
              preview = interval == 1 ? 'Elke week' : \`Elke \${interval} weken\`;
              
              const checkedDays = Array.from(document.querySelectorAll('input[name="recurrence_days"]:checked'))
                .map(cb => cb.nextElementSibling.textContent);
              if (checkedDays.length > 0) {
                preview += ' op ' + checkedDays.join(', ');
              }
            } else if (frequency === 'monthly') {
              preview = interval == 1 ? 'Elke maand' : \`Elke \${interval} maanden\`;
            }
            
            // End condition
            if (endDate) {
              const date = new Date(endDate);
              preview += ' tot ' + date.toLocaleDateString('nl-NL');
            } else if (count) {
              preview += \`, \${count} keer\`;
            } else {
              preview += ' (tot 52 herhalingen max)';
            }
            
            document.getElementById('recurrencePreview').textContent = preview;
          }

          // Initialize on load
          if (document.getElementById('locationSelect').value) {
            updateLocationInfo();
          }
          if (document.getElementById('isRecurringCheckbox').checked) {
            updateRecurrencePreview();
          }
        `
      }}></script>
    </div>
  )
}

// =====================================================
// HELPER: GENERATE AND SAVE OCCURRENCES
// =====================================================

async function generateAndSaveOccurrences(
  db: D1Database,
  parentEventId: number,
  baseEvent: any,
  rule: RecurrenceRule,
  createdBy: number
): Promise<void> {
  const occurrences = createEventOccurrences(baseEvent, rule)
  
  // Insert each occurrence
  for (const occ of occurrences) {
    const isPubliekValue = baseEvent.zichtbaar_publiek ? 1 : 0
    await execute(
      db,
      `INSERT INTO events 
       (type, titel, beschrijving, locatie, location_id, start_at, end_at,
        max_deelnemers, aanmelden_verplicht, is_publiek, zichtbaar_publiek, toon_op_homepage,
        parent_event_id, occurrence_date, is_recurring, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        baseEvent.type, occ.titel, baseEvent.beschrijving, baseEvent.locatie, baseEvent.location_id,
        occ.start_at, occ.end_at, baseEvent.max_deelnemers, baseEvent.aanmelden_verplicht ? 1 : 0,
        isPubliekValue, isPubliekValue, 0, // Don't show child events on homepage
        parentEventId, occ.occurrence_date, 0, // Child events are not recurring themselves
        createdBy // Use actual user ID
      ]
    )
  }
}

// =====================================================
// ICS EXPORT ROUTES
// =====================================================

// Export single event as ICS
app.get('/admin/events/:id/export.ics', async (c) => {
  const id = c.req.param('id')
  
  const event = await queryOne<any>(
    c.env.DB,
    `SELECT e.*, l.naam as locatie_naam 
     FROM events e
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE e.id = ?`,
    [id]
  )
  
  if (!event) {
    return c.text('Event not found', 404)
  }
  
  const icsContent = generateICS({
    id: event.id,
    titel: event.titel,
    beschrijving: event.beschrijving,
    locatie: event.locatie_naam || event.locatie,
    start_at: event.start_at,
    end_at: event.end_at,
    url: `https://animato-koor.pages.dev/events/${event.slug}`
  })
  
  return c.body(icsContent, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="animato-event-${event.id}.ics"`
  })
})

// Export multiple events as ICS (bulk)
app.post('/admin/events/export-bulk.ics', async (c) => {
  const body = await c.req.parseBody()
  const eventIds = body.event_ids ? String(body.event_ids).split(',') : []
  
  if (eventIds.length === 0) {
    return c.text('No events selected', 400)
  }
  
  const placeholders = eventIds.map(() => '?').join(',')
  const events = await queryAll(
    c.env.DB,
    `SELECT e.*, l.naam as locatie_naam 
     FROM events e
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE e.id IN (${placeholders})`,
    eventIds
  )
  
  const icsEvents = events.map((e: any) => ({
    id: e.id,
    titel: e.titel,
    beschrijving: e.beschrijving,
    locatie: e.locatie_naam || e.locatie,
    start_at: e.start_at,
    end_at: e.end_at,
    url: `https://animato-koor.pages.dev/events/${e.slug}`
  }))
  
  const icsContent = generateBulkICS(icsEvents)
  
  return c.body(icsContent, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="animato-events-export.ics"`
  })
})

// Get Google Calendar URL (redirect)
app.get('/admin/events/:id/google-calendar', async (c) => {
  const id = c.req.param('id')
  
  const event = await queryOne<any>(
    c.env.DB,
    `SELECT e.*, l.naam as locatie_naam 
     FROM events e
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE e.id = ?`,
    [id]
  )
  
  if (!event) {
    return c.text('Event not found', 404)
  }
  
  const googleURL = generateGoogleCalendarURL({
    id: event.id,
    titel: event.titel,
    beschrijving: event.beschrijving,
    locatie: event.locatie_naam || event.locatie,
    start_at: event.start_at,
    end_at: event.end_at
  })
  
  return c.redirect(googleURL)
})

export default app
