// Admin Events Management
// Create, edit, and manage events with recurring options and locations

import { Hono } from 'hono'
import type { Bindings, SessionUser, Event, Location, RecurrenceRule } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { QuillLinkPicker } from '../components/QuillLinkPicker'
import { requireAuth, requireRole, requireBestuurslid } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'
import { createEventOccurrences, formatRecurrenceRule } from '../utils/recurring-events'
import { generateICS, generateBulkICS, generateGoogleCalendarURL } from '../utils/ics'
import { uploadDataUrlToR2, deleteFromR2, isDataUrl, r2KeyFromUrl } from '../utils/r2-storage'
import { notifyAllActiveMembers } from '../utils/notifications'
import { formatBrusselsDate, formatBrusselsTime, formatBrusselsDateTime, brusselsLocalToUTC, utcToBrusselsLocal } from '../utils/time'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware
app.use('/admin/*', requireAuth)
app.use('/admin/*', requireBestuurslid)

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
           COUNT(DISTINCT ea.id) as aanmeldingen,
           c.id as concert_id
    FROM events e
    LEFT JOIN locations l ON l.id = e.location_id
    LEFT JOIN event_attendance ea ON ea.event_id = e.id AND ea.status = 'aanwezig'
    LEFT JOIN concerts c ON c.event_id = e.id
    WHERE 1=1
  `
  const params: any[] = []

  // Filter by view (upcoming/past/recurring/all)
  if (view === 'upcoming') {
    query += ` AND datetime(e.start_at) >= datetime('now')`
  } else if (view === 'past') {
    query += ` AND datetime(e.start_at) < datetime('now')`
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
      title="Activiteiten Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' }
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="events" />
        <div class="flex-1 min-w-0">
          {/* Header */}
          <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-calendar-alt text-purple-600 mr-3"></i>
                  Activiteiten Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer repetities, concerten en andere activiteiten
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="/admin/calendar"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  <i class="fas fa-calendar-alt mr-2"></i>
                  Kalender
                </a>
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
                  Nieuwe Activiteit
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
                  <option value="upcoming" selected={view === 'upcoming'}>Komende Activiteiten</option>
                  <option value="past" selected={view === 'past'}>Afgelopen Activiteiten</option>
                  <option value="recurring" selected={view === 'recurring'}>Terugkerende Activiteiten</option>
                  <option value="all" selected={view === 'all'}>Alle Activiteiten</option>
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
                  <option value="vergadering" selected={type === 'vergadering'}>Vergadering</option>
                  <option value="activiteit" selected={type === 'activiteit'}>Activiteit / Jaarfeest</option>
                  <option value="workshop" selected={type === 'workshop'}>Workshop</option>
                  <option value="uitstap" selected={type === 'uitstap'}>Uitstap</option>
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
                        Activiteit
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
                        <p>Geen activiteiten gevonden</p>
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
                            {!!event.is_recurring && (
                              <i class="fas fa-sync text-purple-600 mr-2" title="Terugkerende activiteit"></i>
                            )}
                            {!!event.parent_event_id && (
                              <i class="fas fa-link text-gray-400 mr-2" title="Onderdeel van reeks"></i>
                            )}
                            <div>
                              <div class="text-sm font-medium text-gray-900">{event.titel}</div>
                              {event.beschrijving && (
                                <div class="text-sm text-gray-500 line-clamp-1">{event.beschrijving.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 120)}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <span class={`px-2 py-1 text-xs font-semibold rounded-full ${
                            event.type === 'repetitie' ? 'bg-blue-100 text-blue-800' :
                            event.type === 'concert' ? 'bg-purple-100 text-purple-800' :
                            event.type === 'activiteit' ? 'bg-orange-100 text-orange-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {event.type === 'repetitie' ? 'Repetitie' :
                             event.type === 'concert' ? 'Concert' :
                             event.type === 'activiteit' ? '🎉 Activiteit' : 'Ander'}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>{formatBrusselsDate(event.start_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                          <div class="text-gray-500">
                            {formatBrusselsTime(event.start_at)}
                            {' - '}
                            {formatBrusselsTime(event.end_at)}
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
                              href={event.type === 'activiteit' ? `/admin/events/${event.id}` : `/admin/events/${event.id}`}
                              class="text-animato-primary hover:text-animato-secondary"
                              title="Bewerken"
                            >
                              <i class="fas fa-edit"></i>
                            </a>

                            {/* Ticket Management (for concerts only) */}
                            {event.type === 'concert' && event.concert_id && (
                              <a
                                href={`/admin/tickets/concert/${event.concert_id}/settings`}
                                class="text-purple-600 hover:text-purple-900"
                                title="Ticketbeheer (prijzen, capaciteit, bestellingen)"
                              >
                                <i class="fas fa-ticket-alt"></i>
                              </a>
                            )}

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
                                  <div class="border-t border-gray-200 my-1"></div>
                                  <button
                                    onclick={`openDeleteModal('/admin/events/${event.id}/delete', 'POST', 'Weet je zeker dat je dit event wilt verwijderen?${event.is_recurring ? '\\n\\nLET OP: Dit verwijdert ALLE herhalingen!' : ''}')`}
                                    class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    <i class="fas fa-trash mr-2"></i>Verwijder
                                  </button>
                                </div>
                              </div>
                            </div>
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
              <div class="text-sm text-gray-600">Totaal Activiteiten</div>
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
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Activiteiten</div>
              <div class="text-2xl font-bold text-orange-600">
                {events.filter((e: any) => e.type === 'activiteit').length}
              </div>
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
              alert('Geen activiteiten geselecteerd');
              return;
            }

            // Custom modal logic for bulk delete
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            const modalBody = document.getElementById('deleteModalBody');
            
            modalBody.innerText = 'Weet je zeker dat je ' + eventIds.length + ' event(s) wilt verwijderen?\\n\\n' +
              'Let op: Als je terugkerende activiteiten verwijdert, worden ALLE occurrences verwijderd!';
            
            // Override the onclick handler for this specific action
            const newConfirmBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            
            newConfirmBtn.addEventListener('click', async function() {
              closeDeleteModal();
              
              // Show loading state
              const bulkBar = document.getElementById('bulkActionsBar');
              const originalHTML = bulkBar.innerHTML;
              bulkBar.innerHTML = '<div class="text-center py-2"><i class="fas fa-spinner fa-spin mr-2"></i>Activiteiten verwijderen...</div>';

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
                alert('Er is een fout opgetreden bij het verwijderen van activiteiten');
                console.error('Delete error:', error);
              }
            });
            
            document.getElementById('deleteModal').classList.remove('hidden');
          }

          function exportSelectedEvents() {
            const checkboxes = document.querySelectorAll('.event-checkbox:checked');
            const eventIds = Array.from(checkboxes).map(cb => cb.dataset.eventId);
            
            if (eventIds.length === 0) {
              alert('Geen activiteiten geselecteerd');
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
                    <p class="text-sm text-gray-500" id="deleteModalBody">
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

      <script dangerouslySetInnerHTML={{ __html: `
        let deleteUrl = null;
        let deleteMethod = 'POST';

        function openDeleteModal(url, method = 'POST', message = null) {
          deleteUrl = url;
          deleteMethod = method;
          if (message) {
             const body = document.getElementById('deleteModalBody');
             if (body) body.innerText = message;
          }
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteUrl) {
            fetch(deleteUrl, { method: deleteMethod })
              .then(response => {
                if (response.ok) {
                  if (window.location.pathname.includes('/admin/events/')) {
                     window.location.href = '/admin/events';
                  } else {
                     window.location.reload();
                  }
                } else {
                  alert('Er ging iets mis bij het verwijderen.');
                }
              })
              .catch(error => {
                console.error('Error:', error);
                alert('Er ging iets mis bij het verwijderen.');
              });
          }
          closeDeleteModal();
        });
      ` }} />
    </Layout>
  )
})

// =====================================================
// CREATE/EDIT EVENT FORM
// =====================================================

app.get('/admin/events/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  const preselectedType = c.req.query('type') || null
  
  // Get all active locations
  const locations = await queryAll(
    c.env.DB,
    `SELECT * FROM locations WHERE is_actief = 1 ORDER BY naam ASC`
  )

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title="Nieuwe Activiteit"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' },
        { label: 'Nieuwe Activiteit', href: '/admin/events/nieuw' }
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="events" />
        <div class="flex-1 min-w-0">
          {renderEventForm(null, locations, null, preselectedType)}
        </div>
      </div>
    </Layout>
  )
})

app.get('/admin/events/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')

  // Laad het event uit de database
  const event = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM events WHERE id = ?`,
    [id]
  )

  if (!event) {
    return c.json({ error: 'Event niet gevonden', id }, 404)
  }

  // Get all active locations
  const locations = await queryAll(
    c.env.DB,
    `SELECT * FROM locations WHERE is_actief = 1 ORDER BY naam ASC`
  )

  // Load activity details if type = activiteit
  const activity = event.type === 'activiteit'
    ? await queryOne<any>(c.env.DB, `SELECT * FROM activities WHERE event_id = ?`, [id])
    : null

  // Load concert details for ticket status banner if type = concert
  const concert = event.type === 'concert'
    ? await queryOne<any>(c.env.DB, `SELECT id, ticketing_enabled, uitverkocht, tickets_aangekondigd, voorverkoop_start_at, capaciteit, verkocht FROM concerts WHERE event_id = ?`, [id])
    : null

  // Partituurlijst voor dit event (concert OF activiteit OF willekeurig event-type)
  const partituren = await queryAll(c.env.DB, `
    SELECT ep.id as link_id, ep.volgorde, ep.opmerking,
           p.id as piece_id, p.titel as piece_titel, p.toonsoort, p.tempo, p.duur_minuten,
           w.id as work_id, w.componist, w.titel as work_titel, w.jaar
    FROM event_pieces ep
    JOIN pieces p ON p.id = ep.piece_id
    JOIN works w ON w.id = p.work_id
    WHERE ep.event_id = ?
    ORDER BY ep.volgorde ASC, ep.id ASC
  `, [id]) as any[]

  // Tel materialen per piece (voor admin info-badge)
  const materialCounts = await queryAll(c.env.DB, `
    SELECT piece_id, COUNT(*) as n
    FROM materials
    WHERE is_actief = 1 AND piece_id IN (
      SELECT piece_id FROM event_pieces WHERE event_id = ?
    )
    GROUP BY piece_id
  `, [id]) as any[]
  const matCountMap: Record<number, number> = {}
  materialCounts.forEach((m: any) => { matCountMap[m.piece_id] = m.n })

  // Beschikbare stukken (die nog niet aan dit event gekoppeld zijn)
  const availablePieces = await queryAll(c.env.DB, `
    SELECT p.id, p.titel as piece_titel, p.toonsoort, w.componist, w.titel as work_titel
    FROM pieces p
    JOIN works w ON w.id = p.work_id
    WHERE p.id NOT IN (SELECT piece_id FROM event_pieces WHERE event_id = ?)
    ORDER BY w.componist, w.titel, p.nummer, p.titel
  `, [id]) as any[]

  // Gekoppeld foto-album voor dit event (indien aanwezig) + foto-aantal
  const eventAlbum = await queryOne<any>(c.env.DB, `
    SELECT a.id, a.titel, a.slug, a.cover_url, a.is_publiek,
           (SELECT COUNT(*) FROM photos WHERE album_id = a.id) as photo_count
    FROM albums a
    WHERE a.event_id = ?
    LIMIT 1
  `, [id])

  // Beschikbare albums om aan dit event te koppelen (nog niet aan een event gelinkt)
  // → voorkomt dat je per ongeluk een album van een ander event "steelt"
  const linkableAlbums = await queryAll<any>(c.env.DB, `
    SELECT a.id, a.titel, a.datum,
           (SELECT COUNT(*) FROM photos WHERE album_id = a.id) as photo_count
    FROM albums a
    WHERE (a.event_id IS NULL OR a.event_id = 0)
    ORDER BY a.datum DESC, a.titel ASC
    LIMIT 200
  `) as any[]

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title={`Bewerk Activiteit: ${event.titel}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' },
        { label: 'Bewerken', href: `/admin/events/${id}` }
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="events" />
        <div class="flex-1 min-w-0">
          {renderEventForm(event, locations, activity, null, null, concert)}

          {/* ===================================================== */}
          {/* FOTO-ALBUM — gekoppeld album of nieuw aanmaken         */}
          {/* ===================================================== */}
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="bg-white rounded-lg shadow-md p-6 mt-4">
              <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 class="text-xl font-bold text-gray-900">
                  <i class="fas fa-images text-pink-500 mr-2"></i>
                  Foto-album
                </h2>
                {eventAlbum ? (
                  <span class="text-sm text-gray-500">
                    {eventAlbum.photo_count} foto{eventAlbum.photo_count === 1 ? '' : "'s"} ·
                    <span class={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${eventAlbum.is_publiek ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {eventAlbum.is_publiek ? 'Publiek' : 'Leden'}
                    </span>
                  </span>
                ) : null}
              </div>

              {eventAlbum ? (
                <div class="flex flex-col sm:flex-row gap-4 items-start">
                  {eventAlbum.cover_url && (
                    <img src={eventAlbum.cover_url} alt={eventAlbum.titel}
                         class="w-32 h-32 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                  )}
                  <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-gray-800 text-lg mb-2">{eventAlbum.titel}</h3>
                    <p class="text-sm text-gray-600 mb-3">
                      Voeg meerdere foto's tegelijk toe via de <strong>Bulk Upload</strong>-tab in het album.
                    </p>
                    <div class="flex flex-wrap gap-2">
                      <a href={`/admin/fotoboek/album/${eventAlbum.id}`}
                         class="inline-flex items-center bg-pink-500 hover:bg-pink-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                        <i class="fas fa-cloud-upload-alt mr-2"></i> Foto's beheren / bulk upload
                      </a>
                      <a href={`/fotoboek/${eventAlbum.slug}`} target="_blank"
                         class="inline-flex items-center bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition">
                        <i class="fas fa-external-link-alt mr-2"></i> Bekijk album
                      </a>
                      <form method="POST" action={`/admin/fotoboek/album/${eventAlbum.id}/unlink-from-event`}
                            onsubmit="return confirm('Album loskoppelen van dit event? Het album zelf en de foto\\'s blijven bestaan.')"
                            class="inline-block">
                        <button type="submit"
                                class="inline-flex items-center bg-white hover:bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium transition">
                          <i class="fas fa-unlink mr-2"></i> Loskoppelen
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ) : (
                <div class="space-y-4">
                  {/* Optie 1: nieuw album aanmaken */}
                  <div class="bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-200 rounded-lg p-6 text-center">
                    <i class="fas fa-camera-retro text-4xl text-pink-300 mb-3"></i>
                    <p class="text-gray-700 mb-1 font-semibold">Nog geen album gekoppeld aan dit event.</p>
                    <p class="text-sm text-gray-500 mb-4">
                      Maak een nieuw album aan om <strong>meerdere foto's tegelijk</strong> te kunnen uploaden.
                    </p>
                    <form method="POST" action="/admin/fotoboek/album/create-for-event" class="inline-block">
                      <input type="hidden" name="event_id" value={id} />
                      <input type="hidden" name="titel" value={event.titel} />
                      <input type="hidden" name="datum" value={event.start_datum || ''} />
                      <button type="submit"
                              class="inline-flex items-center bg-pink-500 hover:bg-pink-600 text-white px-5 py-2 rounded-lg font-semibold transition shadow-sm">
                        <i class="fas fa-plus mr-2"></i> Nieuw album aanmaken
                      </button>
                    </form>
                  </div>

                  {/* Optie 2: bestaand album koppelen */}
                  {linkableAlbums.length > 0 && (
                    <div class="bg-white border border-gray-200 rounded-lg p-6">
                      <div class="flex items-start gap-3 mb-4">
                        <i class="fas fa-link text-purple-500 text-lg mt-1"></i>
                        <div class="flex-1">
                          <h3 class="font-semibold text-gray-800">Of: bestaand album koppelen</h3>
                          <p class="text-sm text-gray-500 mt-1">
                            Heb je al een album waarin je foto's hebt geladen?
                            Koppel het hier zodat ze automatisch onder dit concert verschijnen.
                          </p>
                        </div>
                      </div>
                      <form method="POST" action="/admin/fotoboek/album/link-to-event" class="flex flex-col sm:flex-row gap-2">
                        <input type="hidden" name="event_id" value={id} />
                        <select name="album_id" required
                                class="flex-1 border-gray-300 rounded-lg shadow-sm p-2 border focus:ring-purple-500 focus:border-purple-500 text-sm">
                          <option value="">— Kies een album —</option>
                          {linkableAlbums.map((a: any) => (
                            <option value={a.id}>
                              {a.titel}
                              {a.datum ? ` (${String(a.datum).substring(0, 10)})` : ''}
                              {' · ' + a.photo_count + " foto's"}
                            </option>
                          ))}
                        </select>
                        <button type="submit"
                                class="inline-flex items-center justify-center bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm whitespace-nowrap">
                          <i class="fas fa-link mr-2"></i> Koppelen
                        </button>
                      </form>
                      <p class="text-xs text-gray-400 mt-2">
                        <i class="fas fa-info-circle mr-1"></i>
                        Enkel albums die nog niet aan een ander event hangen, worden getoond ({linkableAlbums.length} beschikbaar).
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ===================================================== */}
          {/* PARTITUURLIJST — gekoppelde stukken voor dit event    */}
          {/* ===================================================== */}
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
            <div class="bg-white rounded-lg shadow-md p-6 mt-4">
              <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 class="text-xl font-bold text-gray-900">
                  <i class="fas fa-music text-animato-primary mr-2"></i>
                  Partituurlijst ({partituren.length})
                </h2>
                <button
                  type="button"
                  onclick="document.getElementById('add-piece-modal').classList.remove('hidden')"
                  class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 text-sm font-semibold"
                >
                  <i class="fas fa-plus mr-2"></i> Stuk toevoegen
                </button>
              </div>
              <p class="text-sm text-gray-500 mb-2">
                Sleep stukken om de volgorde aan te passen. Wijzigingen worden automatisch bewaard.
                <span id="partituren-save-status" class="text-sm ml-3"></span>
              </p>
              <p class="text-xs text-gray-400 mb-4">
                <i class="fas fa-info-circle mr-1"></i>
                Leden zien deze lijst op de event-detailpagina en kunnen daar de partituren downloaden of inline bekijken.
              </p>

              {partituren.length === 0 ? (
                <div class="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                  <i class="fas fa-music text-4xl mb-3 text-gray-300"></i>
                  <p>Nog geen stukken gekoppeld aan dit event.</p>
                  <p class="text-xs mt-1">Klik op <strong>"Stuk toevoegen"</strong> om te beginnen.</p>
                </div>
              ) : (
                <ul id="partituren-list" class="space-y-2" data-event-id={id}>
                  {partituren.map((p: any, idx: number) => (
                    <li
                      data-link-id={p.link_id}
                      class="partituur-item flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg cursor-move transition"
                      draggable={true}
                    >
                      <i class="fas fa-grip-vertical text-gray-400 flex-shrink-0"></i>
                      <span class="flex-shrink-0 w-7 h-7 rounded-full bg-animato-primary text-white text-xs font-bold flex items-center justify-center order-number">
                        {idx + 1}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold text-gray-900 truncate">
                          {p.work_titel}{p.piece_titel && p.piece_titel !== p.work_titel ? ` — ${p.piece_titel}` : ''}
                        </div>
                        <div class="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                          <span><i class="fas fa-user-edit mr-1"></i>{p.componist}{p.jaar ? ` (${p.jaar})` : ''}</span>
                          {p.toonsoort && <span><i class="fas fa-key mr-1"></i>{p.toonsoort}</span>}
                          {p.tempo && <span><i class="fas fa-tachometer-alt mr-1"></i>{p.tempo}</span>}
                          {p.duur_minuten && <span><i class="fas fa-clock mr-1"></i>{p.duur_minuten} min</span>}
                          <span class={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${matCountMap[p.piece_id] ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            <i class="fas fa-file-pdf mr-1"></i>
                            {matCountMap[p.piece_id] || 0} bestand{matCountMap[p.piece_id] === 1 ? '' : 'en'}
                          </span>
                        </div>
                        {p.opmerking && (
                          <div class="text-xs text-amber-700 mt-1 italic">
                            <i class="fas fa-comment mr-1"></i>{p.opmerking}
                          </div>
                        )}
                      </div>
                      <a
                        href={`/admin/bestanden?piece=${p.piece_id}`}
                        target="_blank"
                        class="text-blue-600 hover:text-blue-800 text-sm flex-shrink-0"
                        title="Bekijk/upload partituren voor dit stuk"
                      >
                        <i class="fas fa-folder-open"></i>
                      </a>
                      <button
                        type="button"
                        data-link-id={p.link_id}
                        data-piece-titel={p.piece_titel || p.work_titel}
                        data-opmerking={p.opmerking || ''}
                        onclick="openEditPartituurFromDataset(this)"
                        class="text-gray-500 hover:text-blue-600 text-sm flex-shrink-0"
                        title="Opmerking bewerken"
                      >
                        <i class="fas fa-edit"></i>
                      </button>
                      <button
                        type="button"
                        onclick={`removePartituur(${p.link_id}, ${id})`}
                        class="text-gray-400 hover:text-red-600 flex-shrink-0"
                        title="Verwijder uit lijst"
                      >
                        <i class="fas fa-times"></i>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <i class="fas fa-info-circle mr-1"></i>
                <strong>Geen partituren bij een stuk?</strong> Ga naar <a href="/admin/bestanden" target="_blank" class="underline font-semibold">Oefenmateriaal</a> om PDF's per stemgroep te uploaden. Daar koppel je ook YouTube-tracks en oefenopnames.
              </div>
            </div>
          </div>

          {/* Add Piece Modal */}
          <div id="add-piece-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" role="dialog" aria-modal="true">
            <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" onclick="document.getElementById('add-piece-modal').classList.add('hidden')"></div>
              <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
              <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                    Stuk toevoegen aan partituurlijst
                  </h3>
                  {availablePieces.length === 0 ? (
                    <p class="text-gray-600 py-4">
                      Alle bestaande stukken zijn al gekoppeld. Maak eerst een nieuw stuk aan via <a href="/admin/bestanden" target="_blank" class="text-animato-primary underline">Oefenmateriaal</a>.
                    </p>
                  ) : (
                    <form id="add-piece-form" onsubmit="addPartituur(event); return false;">
                      <input type="hidden" name="event_id" value={id} />
                      <div class="mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Zoek stuk</label>
                        <input type="text" id="piece-search" placeholder="Type om te filteren op componist of titel..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border" oninput="filterPieces(this.value)" />
                      </div>
                      <div class="mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Kies stuk *</label>
                        <select name="piece_id" id="piece-select" required size={8} class="w-full border-gray-300 rounded-lg shadow-sm p-2 border text-sm">
                          {availablePieces.map((ap: any) => (
                            <option value={ap.id} data-search={`${ap.componist} ${ap.work_titel} ${ap.piece_titel}`.toLowerCase()}>
                              {ap.componist} — {ap.work_titel}{ap.piece_titel && ap.piece_titel !== ap.work_titel ? ` (${ap.piece_titel})` : ''}{ap.toonsoort ? ` [${ap.toonsoort}]` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div class="mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Opmerking (optioneel)</label>
                        <input type="text" name="opmerking" placeholder="bv. encore, alleen sopraan, intro voor de pauze..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border" />
                      </div>
                      <div class="flex justify-end gap-3 mt-6">
                        <button type="button" onclick="document.getElementById('add-piece-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium">Annuleren</button>
                        <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 font-medium shadow-md">Toevoegen</button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Edit Partituur Opmerking Modal */}
          <div id="edit-partituur-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" role="dialog" aria-modal="true">
            <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" onclick="document.getElementById('edit-partituur-modal').classList.add('hidden')"></div>
              <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
              <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-blue-500">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                    Opmerking bewerken
                  </h3>
                  <form id="edit-partituur-form" onsubmit="saveEditPartituur(event); return false;">
                    <input type="hidden" id="edit-link-id" />
                    <div class="mb-3">
                      <label class="block text-sm font-medium text-gray-700 mb-1">Stuk</label>
                      <input type="text" id="edit-piece-titel" disabled class="w-full border-gray-200 rounded-lg p-3 border bg-gray-100 text-gray-700" />
                    </div>
                    <div class="mb-3">
                      <label class="block text-sm font-medium text-gray-700 mb-1">Opmerking</label>
                      <input type="text" id="edit-opmerking" placeholder="bv. encore, alleen sopraan..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border" />
                    </div>
                    <div class="flex justify-end gap-3 mt-6">
                      <button type="button" onclick="document.getElementById('edit-partituur-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium">Annuleren</button>
                      <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 font-medium shadow-md">Opslaan</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            function filterPieces(q) {
              var qq = (q || '').toLowerCase().trim();
              var sel = document.getElementById('piece-select');
              if (!sel) return;
              Array.from(sel.options).forEach(function(opt) {
                var match = !qq || (opt.dataset.search || '').indexOf(qq) !== -1;
                opt.style.display = match ? '' : 'none';
              });
            }
            window.filterPieces = filterPieces;

            async function addPartituur(e) {
              if (e) e.preventDefault();
              var form = document.getElementById('add-piece-form');
              var fd = new FormData(form);
              var res = await fetch('/api/admin/events/' + fd.get('event_id') + '/pieces/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  piece_id: fd.get('piece_id'),
                  opmerking: fd.get('opmerking') || ''
                })
              });
              if (res.ok) { window.location.reload(); }
              else { alert('Fout bij toevoegen: ' + (await res.text())); }
            }
            window.addPartituur = addPartituur;

            async function removePartituur(linkId, eventId) {
              if (!confirm('Dit stuk uit de partituurlijst halen?')) return;
              var res = await fetch('/api/admin/events/pieces/' + linkId + '/remove', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: eventId })
              });
              if (res.ok) { window.location.reload(); }
              else { alert('Fout bij verwijderen: ' + (await res.text())); }
            }
            window.removePartituur = removePartituur;

            function openEditPartituurFromDataset(btn) {
              var ds = btn.dataset;
              document.getElementById('edit-link-id').value = ds.linkId;
              document.getElementById('edit-piece-titel').value = ds.pieceTitel || '';
              document.getElementById('edit-opmerking').value = ds.opmerking || '';
              document.getElementById('edit-partituur-modal').classList.remove('hidden');
            }
            window.openEditPartituurFromDataset = openEditPartituurFromDataset;

            async function saveEditPartituur(e) {
              if (e) e.preventDefault();
              var linkId = document.getElementById('edit-link-id').value;
              var opmerking = document.getElementById('edit-opmerking').value || '';
              var res = await fetch('/api/admin/events/pieces/' + linkId + '/update', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opmerking: opmerking })
              });
              if (res.ok) { window.location.reload(); }
              else { alert('Fout bij opslaan: ' + (await res.text())); }
            }
            window.saveEditPartituur = saveEditPartituur;

            // Drag & drop reorder
            (function() {
              var list = document.getElementById('partituren-list');
              if (!list) return;
              var dragSrc = null;
              var eventId = list.dataset.eventId;

              list.querySelectorAll('.partituur-item').forEach(function(item) {
                item.addEventListener('dragstart', function(e) {
                  dragSrc = item;
                  item.style.opacity = '0.4';
                  e.dataTransfer.effectAllowed = 'move';
                });
                item.addEventListener('dragend', function() {
                  item.style.opacity = '';
                });
                item.addEventListener('dragover', function(e) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  return false;
                });
                item.addEventListener('drop', function(e) {
                  e.stopPropagation();
                  e.preventDefault();
                  if (dragSrc && dragSrc !== item) {
                    var rect = item.getBoundingClientRect();
                    var below = (e.clientY - rect.top) > rect.height / 2;
                    if (below) {
                      item.parentNode.insertBefore(dragSrc, item.nextSibling);
                    } else {
                      item.parentNode.insertBefore(dragSrc, item);
                    }
                    list.querySelectorAll('.partituur-item').forEach(function(el, idx) {
                      var num = el.querySelector('.order-number');
                      if (num) num.textContent = idx + 1;
                    });
                    var ids = Array.from(list.querySelectorAll('.partituur-item')).map(function(el) {
                      return parseInt(el.dataset.linkId);
                    });
                    // Toon feedback aan gebruiker
                    var statusEl = document.getElementById('partituren-save-status');
                    if (statusEl) {
                      statusEl.textContent = '💾 Volgorde opslaan...';
                      statusEl.className = 'text-sm text-blue-600 ml-3';
                    }
                    fetch('/api/admin/events/' + eventId + '/pieces/reorder', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ids: ids })
                    }).then(function(r) { return r.json(); })
                      .then(function(data) {
                        if (statusEl) {
                          if (data.success) {
                            statusEl.textContent = '✓ Volgorde bewaard';
                            statusEl.className = 'text-sm text-green-600 ml-3';
                            setTimeout(function() { statusEl.textContent = ''; }, 2500);
                          } else {
                            statusEl.textContent = '✗ Fout: ' + (data.error || 'onbekend');
                            statusEl.className = 'text-sm text-red-600 ml-3';
                          }
                        }
                      })
                      .catch(function(err) {
                        console.error(err);
                        if (statusEl) {
                          statusEl.textContent = '✗ Netwerkfout: ' + err.message;
                          statusEl.className = 'text-sm text-red-600 ml-3';
                        }
                      });
                  }
                  return false;
                });
              });
            })();
          ` }} />
        </div>
      </div>
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
                    <p class="text-sm text-gray-500" id="deleteModalBody">
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

      <script dangerouslySetInnerHTML={{ __html: `
        let deleteUrl = null;
        let deleteMethod = 'POST';

        function openDeleteModal(url, method = 'POST', message = null) {
          deleteUrl = url;
          deleteMethod = method;
          if (message) {
             const body = document.getElementById('deleteModalBody');
             if (body) body.innerText = message;
          }
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteUrl) {
            fetch(deleteUrl, { method: deleteMethod })
              .then(response => {
                if (response.ok) {
                  if (window.location.pathname.includes('/admin/events/')) {
                     window.location.href = '/admin/events';
                  } else {
                     window.location.reload();
                  }
                } else {
                  alert('Er ging iets mis bij het verwijderen.');
                }
              })
              .catch(error => {
                console.error('Error:', error);
                alert('Er ging iets mis bij het verwijderen.');
              });
          }
          closeDeleteModal();
        });
      ` }} />
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
    id, type, titel, slug, beschrijving, image_url, locatie, location_id,
    start_at, end_at, max_deelnemers, aanmelden_verplicht, doelgroep,
    zichtbaar_publiek, toon_op_homepage,
    is_recurring, recurrence_frequency, recurrence_interval,
    recurrence_end_date, recurrence_count, recurrence_days,
    // Activity fields (only used when type === 'activiteit')
    act_price_member, act_price_guest, act_deadline, act_max_guests,
    act_intro_text, act_payment_instruction,
    // Optional redirect after save (e.g. back to public /concerten page)
    redirect_to
  } = body

  try {
    // Sanitize HTML beschrijving (remove script tags, event handlers)
    let cleanBeschrijving = beschrijving ? String(beschrijving)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\s*on\w+\s*=\s*'[^']*'/gi, '')
      : null

    // Bug #213 — rollback van #208. De rest van de codebase (49 bestaande
    // events, alle e-mails, oudere ICS-feeds) gaat ervan uit dat start_at en
    // end_at NAIEVE strings zijn die als Brussels-tijd geïnterpreteerd worden.
    // #208 brak die conventie door enkel nieuwe records in UTC op te slaan,
    // wat in een mengelmoes van naieve+UTC strings resulteerde en alle uren
    // op /agenda met 2u liet schuiven. We slaan dus opnieuw de naieve string
    // van het datetime-local input op, ZONDER conversie.
    const startAtUTC = start_at ? String(start_at) : null
    const endAtUTC = end_at ? String(end_at) : null

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

    // === Cover image: upload data:URL → R2, externe URL blijft, geen wijziging = behoud bestaande ===
    let finalImageUrl: string | null = (image_url as string) || null
    let oldR2KeyToDelete: string | null = null
    if (image_url && typeof image_url === 'string' && isDataUrl(image_url)) {
      if (!c.env.R2) {
        return c.html('<p>R2 storage niet geconfigureerd</p>', 500)
      }
      // Hard-cap (Worker request body)
      if (image_url.length > 35_000_000) {
        return c.html(`<p>Cover foto te groot (${Math.round(image_url.length / 1024 / 1024)} MB). Comprimeer of gebruik een URL.</p>`, 413)
      }
      const eventIdForKey = id || 'new'
      const up = await uploadDataUrlToR2(c.env.R2, `covers/events/${eventIdForKey}`, image_url)
      if (!up) {
        return c.html('<p>Cover upload naar R2 mislukt</p>', 500)
      }
      finalImageUrl = up.url
      // Bij UPDATE: oude R2-cover (indien aanwezig) opruimen na succesvolle DB-update
      if (id) {
        const prev = await queryOne<{ image_url: string | null }>(c.env.DB,
          `SELECT image_url FROM events WHERE id = ?`, [id]) as any
        oldR2KeyToDelete = r2KeyFromUrl(prev?.image_url || null)
      }
    }

    if (id) {
      // UPDATE existing event
      await execute(
        c.env.DB,
        `UPDATE events 
         SET type = ?, titel = ?, slug = ?, beschrijving = ?, image_url = ?, locatie = ?, location_id = ?,
             start_at = ?, end_at = ?, max_deelnemers = ?, aanmelden_verplicht = ?, doelgroep = ?,
             zichtbaar_publiek = ?, toon_op_homepage = ?,
             is_recurring = ?, recurrence_rule = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          type, titel, finalSlug, cleanBeschrijving, finalImageUrl, finalLocatie, finalLocationId,
          startAtUTC, endAtUTC, max_deelnemers || null, aanmelden_verplicht === 'on' ? 1 : 0, doelgroep || 'all',
          zichtbaar_publiek === 'on' ? 1 : 0, toon_op_homepage === 'on' ? 1 : 0,
          is_recurring === 'on' ? 1 : 0, recurrenceRule ? JSON.stringify(recurrenceRule) : null,
          id
        ]
      )

      // Pas na succesvolle UPDATE: oude R2-cover opruimen (best-effort)
      if (oldR2KeyToDelete && c.env.R2) {
        try { await deleteFromR2(c.env.R2, oldR2KeyToDelete) } catch {}
      }

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
          start_at: startAtUTC, end_at: endAtUTC, max_deelnemers, aanmelden_verplicht: aanmelden_verplicht === 'on',
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
         (type, titel, slug, beschrijving, image_url, locatie, location_id, start_at, end_at, 
          max_deelnemers, aanmelden_verplicht, doelgroep, is_publiek, zichtbaar_publiek, toon_op_homepage,
          is_recurring, recurrence_rule, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type, titel, finalSlug, cleanBeschrijving, finalImageUrl, finalLocatie, finalLocationId,
          startAtUTC, endAtUTC, max_deelnemers || null, aanmelden_verplicht === 'on' ? 1 : 0, doelgroep || 'all',
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
          start_at: startAtUTC, end_at: endAtUTC, max_deelnemers, aanmelden_verplicht: aanmelden_verplicht === 'on',
          zichtbaar_publiek: zichtbaar_publiek === 'on', toon_op_homepage: false,
          slug: null
        }
        await generateAndSaveOccurrences(c.env.DB, result.meta.last_row_id, baseEvent, recurrenceRule, user.id)
      }

      // 🔔 Notify alle leden — alleen bij CREATE van een master-event.
      // Niet bij edit (te ruisig) en niet voor losse recurring-occurrences
      // (die worden via generateAndSaveOccurrences gemaakt en zouden 50
      // notifs opleveren voor één wekelijkse repetitie). Type mappt naar
      // de relevante NotificationType: 'concert' / 'repetitie' / 'systeem'.
      try {
        const notifType: 'concert' | 'repetitie' | 'systeem' =
          type === 'concert' ? 'concert'
          : type === 'repetitie' ? 'repetitie'
          : 'systeem'
        const fmtDate = (s: string) => {
          try {
            return new Date(s).toLocaleDateString('nl-BE', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })
          } catch { return s }
        }
        const titelPrefix = type === 'concert' ? 'Nieuw concert' :
                            type === 'repetitie' ? 'Nieuwe repetitie' :
                            type === 'activiteit' ? 'Nieuwe activiteit' :
                            'Nieuwe agenda-item'
        const niceDate = fmtDate(start_at as string)
        const link = finalSlug ? `/agenda/${finalSlug}` : '/agenda'
        await notifyAllActiveMembers(
          c.env.DB,
          notifType,
          `${titelPrefix}: ${titel}`,
          niceDate + (finalLocatie ? ' — ' + finalLocatie : ''),
          link
        )
      } catch (e) {
        console.error('[notif] event-create notify failed:', e)
        // niet-fataal — event is al opgeslagen
      }
    }

    // If type is activiteit, upsert activities record
    if (type === 'activiteit') {
      const eventId = id || (await queryOne<any>(c.env.DB, 
        `SELECT id FROM events WHERE slug = ? ORDER BY id DESC LIMIT 1`, [String(titel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]
      ))?.id
      if (eventId) {
        const existingActivity = await queryOne<any>(c.env.DB, `SELECT id FROM activities WHERE event_id = ?`, [eventId])
        if (existingActivity) {
          await execute(c.env.DB,
            `UPDATE activities SET price_member=?, price_guest=?, deadline=?, max_guests=?, intro_text=?, payment_instruction=? WHERE event_id=?`,
            [
              parseFloat(String(act_price_member)) || 0,
              parseFloat(String(act_price_guest)) || 0,
              act_deadline || null,
              parseInt(String(act_max_guests)) || 1,
              act_intro_text || null,
              act_payment_instruction || null,
              eventId
            ]
          )
        } else {
          await execute(c.env.DB,
            `INSERT INTO activities (event_id, price_member, price_guest, deadline, max_guests, intro_text, payment_instruction, is_active) VALUES (?,?,?,?,?,?,?,1)`,
            [
              eventId,
              parseFloat(String(act_price_member)) || 0,
              parseFloat(String(act_price_guest)) || 0,
              act_deadline || null,
              parseInt(String(act_max_guests)) || 1,
              act_intro_text || null,
              act_payment_instruction || null
            ]
          )
        }
      }
    }

    // Redirect: use redirect_to if provided (e.g. /concerten), else default admin
    const finalRedirect = (redirect_to && String(redirect_to).startsWith('/')) 
      ? String(redirect_to) 
      : '/admin/events'
    return c.redirect(finalRedirect)
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
              image_url_length: body.image_url ? String(body.image_url).length : 0
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

// Toggle publicatie status van een event
app.post('/admin/events/:id/toggle-publiek', async (c) => {
  const id = c.req.param('id')
  try {
    const { is_publiek } = await c.req.json<{ is_publiek: number }>()
    await execute(
      c.env.DB,
      `UPDATE events SET is_publiek = ?, updated_at = datetime('now') WHERE id = ?`,
      [is_publiek, id]
    )
    return c.json({ success: true, is_publiek })
  } catch (error) {
    console.error('Error toggling publiek:', error)
    return c.json({ success: false, error: 'Failed to toggle visibility' }, 500)
  }
})

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

function renderEventForm(event: any | null, locations: any[], activity: any | null = null, preselectedType: string | null = null, redirectTo: string | null = null, concert: any | null = null) {
  const isEdit = !!event
  const recurrenceRule: RecurrenceRule | null = event?.recurrence_rule ? 
    JSON.parse(event.recurrence_rule) : null
  const deadline = activity?.deadline ? new Date(activity.deadline).toISOString().split('T')[0] : ''
  const isConcert = (event?.type || preselectedType) === 'concert'
  // For concerts: after save go back to /concerten, unless a specific redirect is given
  const finalRedirectTo = redirectTo || (isConcert ? '/concerten' : null)

  return (
    <div class="bg-gray-50 min-h-screen">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Quick-nav: public concert page link */}
        {isEdit && isConcert && event?.slug && (
          <div class="mb-4 flex items-center justify-between">
            <a
              href="/concerten"
              class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-animato-primary transition"
            >
              <i class="fas fa-arrow-left"></i>
              Terug naar concertenoverzicht
            </a>
            <a
              href={`/concerten/${event.slug}`}
              class="inline-flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition"
            >
              <i class="fas fa-external-link-alt"></i>
              Bekijk publieke pagina
            </a>
          </div>
        )}
        {isEdit && !isConcert && (
          <div class="mb-4">
            <a
              href="/admin/events"
              class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-animato-primary transition"
            >
              <i class="fas fa-arrow-left"></i>
              Terug naar events
            </a>
          </div>
        )}

        {/* Ticketstatus banner (alleen voor concerten met concert-record) */}
        {isEdit && isConcert && concert && (() => {
          const voorverkoopStart = concert.voorverkoop_start_at ? new Date(String(concert.voorverkoop_start_at).replace(' ', 'T')) : null
          const voorverkoopInToekomst = !!(voorverkoopStart && voorverkoopStart.getTime() > Date.now())
          const fmtDate = voorverkoopStart
            ? formatBrusselsDateTime(voorverkoopStart, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : ''

          // Status bepalen — zelfde logica als publieke pagina
          let statusLabel = 'Ticketinfo volgt'
          let statusColor = 'bg-gray-100 text-gray-700 border-gray-300'
          let statusIcon = 'fa-info-circle'
          let statusDetail = 'Geen ticketverkoop actief — publieke pagina toont "Ticketinfo volgt".'
          let urgent = false

          if (concert.uitverkocht == 1) {
            statusLabel = 'Uitverkocht'
            statusColor = 'bg-red-50 text-red-800 border-red-300'
            statusIcon = 'fa-ban'
            statusDetail = 'Alle tickets zijn verkocht. Publieke pagina toont een rode "Uitverkocht"-banner.'
          } else if (concert.tickets_aangekondigd == 1 || voorverkoopInToekomst) {
            statusLabel = 'Nog geen tickets beschikbaar'
            statusColor = 'bg-amber-50 text-amber-900 border-amber-300'
            statusIcon = 'fa-hourglass-half'
            statusDetail = voorverkoopInToekomst
              ? `Voorverkoop opent op ${fmtDate}. Publieke pagina toont een live aftelteller.`
              : 'Publieke pagina toont "Tickets volgen binnenkort".'
            urgent = true
          } else if (concert.ticketing_enabled == 1) {
            statusLabel = 'Ticketverkoop open'
            statusColor = 'bg-green-50 text-green-800 border-green-300'
            statusIcon = 'fa-shopping-cart'
            const verkocht = concert.verkocht || 0
            const capaciteit = concert.capaciteit || 0
            statusDetail = capaciteit > 0
              ? `Bestelformulier is actief. ${verkocht} van ${capaciteit} tickets verkocht (${Math.round((verkocht / capaciteit) * 100)}%).`
              : 'Bestelformulier is actief.'
          }

          return (
            <div class={`mb-4 border-2 ${statusColor} rounded-lg p-4 flex items-start gap-4`}>
              <div class={`flex-shrink-0 w-11 h-11 rounded-full bg-white/60 flex items-center justify-center ${urgent ? 'animate-pulse' : ''}`}>
                <i class={`fas ${statusIcon} text-xl`}></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center flex-wrap gap-2 mb-1">
                  <span class="text-xs uppercase tracking-wide font-semibold opacity-70">Ticketstatus</span>
                  <span class="text-base font-bold">{statusLabel}</span>
                </div>
                <p class="text-sm leading-snug">{statusDetail}</p>
              </div>
              <div class="flex-shrink-0 flex flex-col gap-2">
                <a
                  href={`/admin/tickets/concert/${concert.id}/settings`}
                  class="inline-flex items-center gap-2 text-sm bg-white/80 hover:bg-white text-gray-900 font-semibold px-3 py-2 rounded-lg shadow-sm transition"
                >
                  <i class="fas fa-cog"></i>
                  Ticketinstellingen
                </a>
                <a
                  href={`/admin/tickets/concert/${concert.id}/orders`}
                  class="inline-flex items-center gap-2 text-xs text-gray-700 hover:text-gray-900 px-3 py-1 transition"
                >
                  <i class="fas fa-receipt"></i>
                  Bestellingen bekijken
                </a>
              </div>
            </div>
          )
        })()}

        <div class="bg-white rounded-lg shadow-md p-8">
          
          <form method="POST" action="/admin/events/save" id="eventForm">
            {isEdit && <input type="hidden" name="id" value={event.id} />}
            {finalRedirectTo && <input type="hidden" name="redirect_to" value={finalRedirectTo} />}

            {/* Basic Info Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-info-circle text-purple-600 mr-2"></i>
                Basis Informatie
              </h2>

              {/* Type */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Type *
                </label>
                <select
                  name="type"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  {(() => {
                    const activeType = event?.type || preselectedType || 'repetitie'
                    return (
                      <>
                        <option value="repetitie" selected={activeType === 'repetitie'}>🎵 Repetitie</option>
                        <option value="concert" selected={activeType === 'concert'}>🎤 Concert</option>
                        <option value="vergadering" selected={activeType === 'vergadering'}>📋 Vergadering</option>
                        <option value="activiteit" selected={activeType === 'activiteit'}>🎉 Activiteit / Jaarfeest</option>
                        <option value="workshop" selected={activeType === 'workshop'}>📚 Workshop</option>
                        <option value="uitstap" selected={activeType === 'uitstap'}>🚌 Uitstap</option>
                        <option value="ander" selected={activeType === 'ander'}>Ander</option>
                      </>
                    )
                  })()}
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

              {/* Beschrijving — Rich Text Editor */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-align-left text-blue-500 mr-1"></i>
                  Beschrijving
                </label>
                <input type="hidden" name="beschrijving" id="beschrijving-hidden" value={event?.beschrijving || ''} />
                <div id="beschrijving-editor" class="bg-white rounded-b-lg" />
                <p class="text-xs text-gray-400 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Gebruik de werkbalk voor opmaak: vet, cursief, lijsten, links, enz.
                </p>
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
                    Upload een afbeelding (JPG, PNG, max 25 MB). Wordt opgeslagen in R2 cloud-storage.
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
                  name="image_url"
                  id="afbeeldingValue"
                  value={event?.image_url || ''}
                />

                {/* Image Preview */}
                <div id="imagePreview" class={`mt-3 ${event?.image_url ? '' : 'hidden'}`}>
                  <div class="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                    <img 
                      id="previewImg" 
                      src={event?.image_url || ''} 
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
                    <option value="new">+ Nieuwe locatie aanmaken...</option>
                  </select>
                  {/* <a
                    href="/admin/locations/nieuw"
                    target="_blank"
                    class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition whitespace-nowrap"
                  >
                    <i class="fas fa-plus mr-2"></i>
                    Nieuw
                  </a> */}
                </div>
              </div>

              {/* Manual Location (fallback) - Removed per request */}
              {/* <div class="mb-4">
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
              </div> */}

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
                    value={event?.start_at ? utcToBrusselsLocal(event.start_at) : ''}
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
                    value={event?.end_at ? utcToBrusselsLocal(event.end_at) : ''}
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
                Terugkerende Activiteit
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

            {/* ── Activiteit / Jaarfeest Details ─────────────── */}
            <div id="activity-section" style={`display:${(event?.type === 'activiteit' || preselectedType === 'activiteit') ? 'block' : 'none'}`}>
              <div class="mb-8 mt-2">
                <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                  <i class="fas fa-glass-cheers text-orange-500 mr-2"></i>
                  Inschrijfdetails Activiteit
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Prijs per Lid (€)</label>
                    <input type="number" step="0.01" name="act_price_member"
                      value={activity?.price_member ?? '0.00'}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Prijs per Gast (€)</label>
                    <input type="number" step="0.01" name="act_price_guest"
                      value={activity?.price_guest ?? '0.00'}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Deadline Inschrijven</label>
                    <input type="date" name="act_deadline" value={deadline}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Max. gasten per lid</label>
                    <select name="act_max_guests" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary">
                      <option value="0" selected={activity?.max_guests === 0}>Geen gasten (alleen leden)</option>
                      <option value="1" selected={!activity || activity.max_guests === 1}>1 Partner / Gast</option>
                      <option value="2" selected={activity?.max_guests === 2}>Max. 2 gasten</option>
                      <option value="99" selected={activity?.max_guests > 2}>Onbeperkt</option>
                    </select>
                  </div>
                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Uitnodigingstekst (voor e-mail & pagina)</label>
                    <textarea name="act_intro_text" rows={4}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                      placeholder="Beste leden, we nodigen jullie graag uit..."
                    >{activity?.intro_text || ''}</textarea>
                  </div>
                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Betaalinstructies</label>
                    <textarea name="act_payment_instruction" rows={3}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                      placeholder="bv. Overschrijven op BE12… met mededeling 'Naam + Jaarfeest'"
                    >{activity?.payment_instruction || ''}</textarea>
                    <p class="text-xs text-gray-500 mt-1">Wordt getoond na inschrijving als er betaald moet worden.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Buttons */}
            <div class="flex items-center justify-between pt-6 border-t">
              <div class="flex items-center gap-3">
                <a
                  href="/admin/events"
                  class="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                >
                  Annuleren
                </a>
                {isEdit && (
                  <button
                    type="button"
                    onclick={`openDeleteModal('/admin/events/${event?.id}/delete', 'POST', 'Weet je zeker dat je dit event wilt verwijderen?${event?.is_recurring ? '\\n\\nLET OP: Dit verwijdert ALLE herhalingen!' : ''}')`}
                    class="px-6 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition"
                  >
                    <i class="fas fa-trash mr-2"></i>
                    Verwijderen
                  </button>
                )}
              </div>
              <button
                type="submit"
                class="px-6 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
              >
                <i class="fas fa-save mr-2"></i>
                {isEdit ? 'Wijzigingen Opslaan' : 'Activiteit Aanmaken'}
              </button>
            </div>
          </form>

        </div>
      </div>

      {/* Quill Rich Text Editor */}
      <link href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css" rel="stylesheet" />
      <script src="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js"></script>

      {/* #120: Link picker met interne-pagina selector — moet vóór de Quill init staan */}
      <QuillLinkPicker />
      <style dangerouslySetInnerHTML={{ __html: `
        .ql-toolbar.ql-snow { border-top-left-radius: 0.5rem; border-top-right-radius: 0.5rem; border-color: #d1d5db; background: #f9fafb; }
        .ql-container.ql-snow { border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem; border-color: #d1d5db; font-size: 0.95rem; }
        /* .ql-editor max-height & scroll geregeld in Layout.tsx (globaal) */
        .ql-editor p { margin-bottom: 0.5em; }
        .ql-editor h1, .ql-editor h2, .ql-editor h3 { margin-top: 0.8em; margin-bottom: 0.4em; }
        .ql-snow .ql-picker.ql-header .ql-picker-label::before, .ql-snow .ql-picker.ql-header .ql-picker-item::before { content: 'Normaal'; }
        .ql-snow .ql-picker.ql-header .ql-picker-label[data-value="1"]::before, .ql-snow .ql-picker.ql-header .ql-picker-item[data-value="1"]::before { content: 'Kop 1'; }
        .ql-snow .ql-picker.ql-header .ql-picker-label[data-value="2"]::before, .ql-snow .ql-picker.ql-header .ql-picker-item[data-value="2"]::before { content: 'Kop 2'; }
        .ql-snow .ql-picker.ql-header .ql-picker-label[data-value="3"]::before, .ql-snow .ql-picker.ql-header .ql-picker-item[data-value="3"]::before { content: 'Kop 3'; }
      ` }} />
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var hiddenInput = document.getElementById('beschrijving-hidden');
          var editorEl = document.getElementById('beschrijving-editor');
          if (!editorEl) return;

          var quill = new Quill('#beschrijving-editor', {
            theme: 'snow',
            placeholder: 'Beschrijf het event... (gebruik de werkbalk voor opmaak)',
            modules: {
              toolbar: {
                container: [
                  [{ 'header': [1, 2, 3, false] }],
                  ['bold', 'italic', 'underline', 'strike'],
                  [{ 'color': [] }, { 'background': [] }],
                  [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                  ['blockquote'],
                  ['link'],
                  ['clean']
                ],
                handlers: {
                  // #120: gebruik onze interne-pagina-picker
                  link: function(value) {
                    if (typeof window.__quillLinkHandler === 'function') {
                      return window.__quillLinkHandler.call(this, value);
                    }
                    // Fallback (component nog niet geladen)
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
          // Extra fallback: hang link-picker aan na init
          if (window.__attachQuillLinkPicker) window.__attachQuillLinkPicker(quill);

          // Load existing HTML content
          if (hiddenInput.value) {
            quill.root.innerHTML = hiddenInput.value;
          }

          // Sync to hidden input on every change
          quill.on('text-change', function() {
            var html = quill.root.innerHTML;
            // If only empty paragraph, set to empty
            if (html === '<p><br></p>' || html === '<p></p>') html = '';
            hiddenInput.value = html;
          });

          // Also sync before form submit
          var form = document.getElementById('eventForm');
          if (form) {
            form.addEventListener('submit', function() {
              var html = quill.root.innerHTML;
              if (html === '<p><br></p>' || html === '<p></p>') html = '';
              hiddenInput.value = html;
            });
          }
        })();
      ` }} />

      {/* JavaScript for form interactions */}
      <script dangerouslySetInnerHTML={{
        __html: `
          // Location preview
          function updateLocationInfo() {
            const select = document.getElementById('locationSelect');
            const preview = document.getElementById('locationPreview');
            // const locatieInput = document.getElementById('locatieInput');
            
            if (select.value === 'new') {
               // Redirect to create new location
               window.open('/admin/locations/nieuw', '_blank');
               select.value = ''; // Reset selection
               return;
            }
            
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
              // locatieInput.value = ''; // Clear manual input
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

            // Check file size (max 25MB → R2 storage)
            if (file.size > 25 * 1024 * 1024) {
              alert('Bestand is te groot! Maximaal 25 MB toegestaan.');
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

            // Toggle activity section based on event type
            function updateActivitySection() {
              const typeSelect = document.querySelector('select[name="type"]');
              const actSection = document.getElementById('activity-section');
              if (typeSelect && actSection) {
                actSection.style.display = typeSelect.value === 'activiteit' ? 'block' : 'none';
              }
            }
            const typeSelect = document.querySelector('select[name="type"]');
            if (typeSelect) {
              typeSelect.addEventListener('change', updateActivitySection);
              updateActivitySection();
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

// ===========================================================================
// PARTITUURLIJST API — gekoppelde stukken per event (event_pieces tabel)
// ===========================================================================

// Voeg een stuk toe aan de partituurlijst van een event
app.post('/api/admin/events/:eventId/pieces/add', async (c) => {
  const eventId = parseInt(c.req.param('eventId'))
  const body = await c.req.json<{ piece_id: number; opmerking?: string }>()
  const pieceId = parseInt(String(body.piece_id))
  const opmerking = (body.opmerking || '').toString().trim() || null

  if (!eventId || !pieceId) {
    return c.json({ error: 'event_id en piece_id zijn verplicht' }, 400)
  }

  // Check duplicate
  const existing = await queryOne<any>(
    c.env.DB,
    'SELECT id FROM event_pieces WHERE event_id = ? AND piece_id = ?',
    [eventId, pieceId]
  )
  if (existing) {
    return c.json({ error: 'Dit stuk is al gekoppeld aan dit event.' }, 409)
  }

  // Volgende volgorde = max + 10 (zodat manueel reorderen ruimte heeft)
  const maxRow = await queryOne<any>(
    c.env.DB,
    'SELECT COALESCE(MAX(volgorde), 0) as max_v FROM event_pieces WHERE event_id = ?',
    [eventId]
  )
  const nextVolgorde = (maxRow?.max_v ?? 0) + 10

  await execute(
    c.env.DB,
    'INSERT INTO event_pieces (event_id, piece_id, volgorde, opmerking) VALUES (?, ?, ?, ?)',
    [eventId, pieceId, nextVolgorde, opmerking]
  )

  return c.json({ success: true })
})

// Verwijder een stuk uit de partituurlijst (link blijft, piece niet)
app.post('/api/admin/events/pieces/:linkId/remove', async (c) => {
  const linkId = parseInt(c.req.param('linkId'))
  if (!linkId) return c.json({ error: 'link_id ontbreekt' }, 400)
  await execute(c.env.DB, 'DELETE FROM event_pieces WHERE id = ?', [linkId])
  return c.json({ success: true })
})

// Update opmerking voor een gekoppeld stuk
app.post('/api/admin/events/pieces/:linkId/update', async (c) => {
  const linkId = parseInt(c.req.param('linkId'))
  if (!linkId) return c.json({ error: 'link_id ontbreekt' }, 400)
  const body = await c.req.json<{ opmerking?: string }>()
  const opmerking = (body.opmerking || '').toString().trim() || null
  await execute(
    c.env.DB,
    'UPDATE event_pieces SET opmerking = ? WHERE id = ?',
    [opmerking, linkId]
  )
  return c.json({ success: true })
})

// Volgorde aanpassen (drag-and-drop) — body = { ids: [linkId, ...] }
app.post('/api/admin/events/:eventId/pieces/reorder', async (c) => {
  const eventId = parseInt(c.req.param('eventId'))
  const body = await c.req.json<{ ids: number[] }>()
  if (!eventId || !Array.isArray(body.ids)) {
    return c.json({ error: 'event_id en ids[] zijn verplicht' }, 400)
  }
  // Update volgorde in stappen van 10
  for (let i = 0; i < body.ids.length; i++) {
    const linkId = parseInt(String(body.ids[i]))
    if (!linkId) continue
    await execute(
      c.env.DB,
      'UPDATE event_pieces SET volgorde = ? WHERE id = ? AND event_id = ?',
      [(i + 1) * 10, linkId, eventId]
    )
  }
  return c.json({ success: true })
})

export default app
