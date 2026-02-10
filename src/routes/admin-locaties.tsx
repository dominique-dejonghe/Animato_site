// Admin Locations Management
// Create, edit, and manage choir locations (rehearsal venues, concert halls)

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// HELPER: GENERATE GOOGLE MAPS EMBED URL
// =====================================================

function getGoogleMapsEmbedUrl(location: any): string {
  if (!location.google_maps_url) {
    return ''
  }

  const url = location.google_maps_url
  
  // Format 1: https://maps.google.com/?q=lat,lng
  const coordMatch = url.match(/[?&]q=([-\d.]+),([-\d.]+)/)
  if (coordMatch) {
    return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d100!2d${coordMatch[2]}!3d${coordMatch[1]}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1`
  }
  
  // Format 2: https://www.google.com/maps/place/Name/@lat,lng
  const atMatch = url.match(/@([-\d.]+),([-\d.]+)/)
  if (atMatch) {
    return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d100!2d${atMatch[2]}!3d${atMatch[1]}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1`
  }
  
  // Format 3: Already an embed URL
  if (url.includes('/embed')) {
    return url
  }
  
  // Fallback: Use iframe with search query
  if (location.naam) {
    const searchQuery = encodeURIComponent(`${location.naam} ${location.adres || ''} ${location.stad || ''}`.trim())
    return `https://maps.google.com/maps?q=${searchQuery}&output=embed`
  }
  
  return ''
}

// =====================================================
// LOCATIONS OVERVIEW
// =====================================================

app.get('/admin/locaties', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''
  const status = c.req.query('status') || 'all'

  // Disable caching for admin pages
  noCacheHeaders(c)

  // Build query based on filters
  let query = `
    SELECT l.*,
           COUNT(DISTINCT e.id) as event_count
    FROM locations l
    LEFT JOIN events e ON e.location_id = l.id
    WHERE 1=1
  `
  const params: any[] = []

  // Filter by status
  if (status === 'actief') {
    query += ` AND l.is_actief = 1`
  } else if (status === 'inactief') {
    query += ` AND l.is_actief = 0`
  }

  // Search
  if (search) {
    query += ` AND (l.naam LIKE ? OR l.adres LIKE ? OR l.stad LIKE ?)`
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  query += ` GROUP BY l.id ORDER BY l.naam ASC`

  const locations = await queryAll(c.env.DB, query, params)

  // Get stats
  const stats = {
    total: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM locations`),
    actief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM locations WHERE is_actief = 1`),
    inactief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM locations WHERE is_actief = 0`),
  }

  return c.html(
    <Layout 
      title="Locaties Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Locaties', href: '/admin/locaties' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-map-marker-alt text-red-600 mr-3"></i>
                  Locaties Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer repetitieruimtes, concertzalen en andere locaties
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
                <a
                  href="/admin/locaties/nieuw"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuwe Locatie
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Stats */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Totaal Locaties</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-map-marker-alt text-red-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Actieve Locaties</p>
                  <p class="text-3xl font-bold text-green-600">{stats.actief?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-check-circle text-green-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Inactieve Locaties</p>
                  <p class="text-3xl font-bold text-gray-400">{stats.inactief?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-times-circle text-gray-400 text-xl"></i>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Status Filter */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  onchange={`window.location.href='/admin/locaties?status=' + this.value + '&search=${search}'`}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all" selected={status === 'all'}>Alle Locaties</option>
                  <option value="actief" selected={status === 'actief'}>Alleen Actieve</option>
                  <option value="inactief" selected={status === 'inactief'}>Alleen Inactieve</option>
                </select>
              </div>

              {/* Search */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Zoeken</label>
                <form action="/admin/locaties" method="GET" class="flex gap-2">
                  <input type="hidden" name="status" value={status} />
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek op naam, adres of stad..."
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

          {/* Locations Grid */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations.length === 0 ? (
              <div class="col-span-full bg-white rounded-lg shadow-md p-12 text-center">
                <i class="fas fa-map-marker-alt text-6xl text-gray-300 mb-4"></i>
                <p class="text-lg text-gray-500 mb-2">Geen locaties gevonden</p>
                <p class="text-sm text-gray-400 mb-6">Voeg je eerste locatie toe om te beginnen</p>
                <a
                  href="/admin/locaties/nieuw"
                  class="inline-block px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuwe Locatie
                </a>
              </div>
            ) : (
              locations.map((location: any) => {
                const embedUrl = getGoogleMapsEmbedUrl(location)
                
                return (
                  <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition">
                    {/* Card Header - Google Maps or Gradient */}
                    {embedUrl ? (
                      <div class="relative w-full h-48 bg-gray-200">
                        <iframe
                          src={embedUrl}
                          width="100%"
                          height="100%"
                          style="border:0;"
                          loading="lazy"
                          referrerpolicy="no-referrer-when-downgrade"
                          title={`Map of ${location.naam}`}
                        ></iframe>
                        {/* Overlay with location name and status */}
                        <div class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4">
                          <div class="flex items-start justify-between">
                            <div class="flex-1">
                              <h3 class="text-lg font-bold text-white mb-1">{location.naam}</h3>
                              <div class="flex items-center text-sm text-white/90">
                                <i class="fas fa-calendar-alt mr-2"></i>
                                {location.event_count || 0} event(s)
                              </div>
                            </div>
                            <div>
                              {location.is_actief ? (
                                <span class="px-2 py-1 bg-green-500 rounded-full text-xs font-semibold text-white">
                                  Actief
                                </span>
                              ) : (
                                <span class="px-2 py-1 bg-gray-500 rounded-full text-xs font-semibold text-white">
                                  Inactief
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div class="bg-gradient-to-r from-red-500 to-pink-500 p-4 text-white h-48 flex flex-col justify-between">
                        <div class="flex items-start justify-between">
                          <div class="flex-1">
                            <h3 class="text-lg font-bold mb-1">{location.naam}</h3>
                            <div class="flex items-center text-sm opacity-90">
                              <i class="fas fa-calendar-alt mr-2"></i>
                              {location.event_count || 0} event(s)
                            </div>
                          </div>
                          <div>
                            {location.is_actief ? (
                              <span class="px-2 py-1 bg-green-500 rounded-full text-xs font-semibold">
                                Actief
                              </span>
                            ) : (
                              <span class="px-2 py-1 bg-gray-500 rounded-full text-xs font-semibold">
                                Inactief
                              </span>
                            )}
                          </div>
                        </div>
                        <div class="text-center">
                          <i class="fas fa-map-marker-alt text-6xl opacity-30"></i>
                          <p class="text-sm opacity-75 mt-2">Geen Google Maps URL</p>
                        </div>
                      </div>
                    )}

                    {/* Card Body */}
                    <div class="p-4">
                    {/* Address */}
                    <div class="mb-3">
                      <div class="flex items-start text-sm text-gray-700">
                        <i class="fas fa-map-marker-alt text-red-500 mr-2 mt-0.5"></i>
                        <div>
                          {location.adres && <div>{location.adres}</div>}
                          {location.postcode && location.stad && (
                            <div>{location.postcode} {location.stad}</div>
                          )}
                          {location.land && location.land !== 'België' && (
                            <div class="text-gray-500">{location.land}</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Capacity */}
                    {location.capaciteit && (
                      <div class="flex items-center text-sm text-gray-600 mb-3">
                        <i class="fas fa-users text-blue-500 mr-2"></i>
                        Capaciteit: {location.capaciteit} personen
                      </div>
                    )}

                    {/* Notes Preview */}
                    {location.notities && (
                      <div class="mb-3 p-3 bg-gray-50 rounded border border-gray-200">
                        <div class="text-xs text-gray-600 line-clamp-2">
                          <i class="fas fa-sticky-note text-yellow-500 mr-1"></i>
                          {location.notities}
                        </div>
                      </div>
                    )}

                    {/* Google Maps Link */}
                    {location.google_maps_url && (
                      <a
                        href={location.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 mb-3"
                      >
                        <i class="fas fa-external-link-alt mr-1"></i>
                        Bekijk op Google Maps
                      </a>
                    )}

                    {/* Actions */}
                    <div class="flex items-center gap-2 pt-3 border-t border-gray-200 mt-3">
                      <a
                        href={`/admin/locaties/${location.id}`}
                        class="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-center text-sm hover:bg-gray-200 transition"
                      >
                        <i class="fas fa-edit mr-1"></i>
                        Bewerken
                      </a>
                      <button
                        onclick={`openDeleteModal('/admin/locaties/${location.id}/delete')`}
                        class="px-3 py-2 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 transition"
                      >
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
                )
              })
            )}
          </div>

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
                    <p class="text-sm text-gray-500">
                      Weet je zeker dat je deze locatie wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
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

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteUrl) {
            fetch(deleteUrl, { method: 'POST' })
              .then(response => {
                if (response.ok) {
                  window.location.reload();
                } else {
                  return response.json().then(data => {
                    alert(data.error || 'Er ging iets mis bij het verwijderen.');
                  });
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
// CREATE/EDIT LOCATION FORM
// =====================================================

app.get('/admin/locaties/nieuw', async (c) => {
  const user = c.get('user') as SessionUser

  // Disable caching for admin pages
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title="Nieuwe Locatie"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Locaties', href: '/admin/locaties' },
        { label: 'Nieuwe Locatie', href: '/admin/locaties/nieuw' }
      ]}
    >
      {renderLocationForm(null)}
    </Layout>
  )
})

app.get('/admin/locaties/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')

  // Disable caching for admin pages
  noCacheHeaders(c)

  // Get location
  const location = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM locations WHERE id = ?`,
    [id]
  )

  if (!location) {
    return c.redirect('/admin/locaties')
  }

  return c.html(
    <Layout 
      title={`Bewerk Locatie: ${location.naam}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Locaties', href: '/admin/locaties' },
        { label: 'Bewerken', href: `/admin/locaties/${id}` }
      ]}
    >
      {renderLocationForm(location)}
    </Layout>
  )
})

// =====================================================
// SAVE LOCATION (CREATE/UPDATE)
// =====================================================

app.post('/admin/locaties/save', async (c) => {
  const body = await c.req.parseBody()

  const {
    id, naam, adres, postcode, stad, land,
    capaciteit, opmerkingen, google_maps_url, is_actief
  } = body

  try {
    if (id) {
      // UPDATE existing location
      await execute(
        c.env.DB,
        `UPDATE locations 
         SET naam = ?, adres = ?, postcode = ?, stad = ?, land = ?,
             capaciteit = ?, notities = ?, google_maps_url = ?, is_actief = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          naam, adres || '', postcode || null, stad || null, land || 'België',
          capaciteit || null, opmerkingen || null, google_maps_url || null,
          is_actief === 'on' ? 1 : 0,
          id
        ]
      )
    } else {
      // CREATE new location
      await execute(
        c.env.DB,
        `INSERT INTO locations 
         (naam, adres, postcode, stad, land, capaciteit, notities, google_maps_url, is_actief)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          naam, adres || '', postcode || null, stad || null, land || 'België',
          capaciteit || null, opmerkingen || null, google_maps_url || null,
          is_actief === 'on' ? 1 : 0
        ]
      )
    }

    return c.redirect('/admin/locaties')
  } catch (error) {
    console.error('Error saving location:', error)
    return c.text('Error saving location', 500)
  }
})

// =====================================================
// DELETE LOCATION
// =====================================================

app.post('/admin/locaties/:id/delete', async (c) => {
  const id = c.req.param('id')

  try {
    // Check if location is used by any events
    const eventsUsingLocation = await queryOne<any>(
      c.env.DB,
      `SELECT COUNT(*) as count FROM events WHERE location_id = ?`,
      [id]
    )

    if (eventsUsingLocation && eventsUsingLocation.count > 0) {
      // Don't delete, just mark as inactive
      await execute(
        c.env.DB,
        `UPDATE locations SET is_actief = 0 WHERE id = ?`,
        [id]
      )
    } else {
      // Safe to delete
      await execute(
        c.env.DB,
        `DELETE FROM locations WHERE id = ?`,
        [id]
      )
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting location:', error)
    return c.json({ success: false, error: 'Failed to delete location' }, 500)
  }
})

// =====================================================
// HELPER: RENDER LOCATION FORM
// =====================================================

function renderLocationForm(location: any | null) {
  const isEdit = !!location

  return (
    <div class="bg-gray-50 min-h-screen">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="bg-white rounded-lg shadow-md p-8">
          
          <form method="POST" action="/admin/locaties/save">
            {isEdit && <input type="hidden" name="id" value={location.id} />}

            {/* Basic Info Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-info-circle text-red-600 mr-2"></i>
                Basis Informatie
              </h2>

              {/* Naam */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Naam *
                </label>
                <input
                  type="text"
                  name="naam"
                  value={location?.naam || ''}
                  required
                  placeholder="Bijvoorbeeld: Cultuurcentrum De Kroon"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
              </div>

              {/* Adres */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Adres
                </label>
                <input
                  type="text"
                  name="adres"
                  value={location?.adres || ''}
                  placeholder="Koorstraat 123"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Postcode */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Postcode
                  </label>
                  <input
                    type="text"
                    name="postcode"
                    value={location?.postcode || ''}
                    placeholder="1000"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                </div>

                {/* Stad */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Stad
                  </label>
                  <input
                    type="text"
                    name="stad"
                    value={location?.stad || ''}
                    placeholder="Brussel"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                </div>
              </div>

              {/* Land */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Land
                </label>
                <input
                  type="text"
                  name="land"
                  value={location?.land || 'België'}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
              </div>

              {/* Capaciteit */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Capaciteit (aantal personen)
                </label>
                <input
                  type="number"
                  name="capaciteit"
                  value={location?.capaciteit || ''}
                  min="1"
                  placeholder="200"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
              </div>
            </div>

            {/* Google Maps Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-map text-blue-600 mr-2"></i>
                Google Maps
              </h2>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Google Maps URL
                </label>
                <input
                  type="url"
                  name="google_maps_url"
                  value={location?.google_maps_url || ''}
                  placeholder="https://maps.google.com/..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
                <p class="text-xs text-gray-500 mt-1">
                  Open Google Maps, zoek de locatie, klik op "Delen" en plak de link hier
                </p>
              </div>
            </div>

            {/* Notes Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-sticky-note text-yellow-600 mr-2"></i>
                Opmerkingen
              </h2>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Opmerkingen (optioneel)
                </label>
                <textarea
                  name="opmerkingen"
                  rows={4}
                  placeholder="Parkeerinformatie, toegankelijkheid, bijzonderheden..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >{location?.notities || ''}</textarea>
              </div>
            </div>

            {/* Status Section */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-toggle-on text-green-600 mr-2"></i>
                Status
              </h2>

              <label class="flex items-center">
                <input
                  type="checkbox"
                  name="is_actief"
                  checked={location?.is_actief !== false}
                  class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                />
                <span class="ml-2 text-gray-700">
                  Locatie is actief (beschikbaar voor nieuwe events)
                </span>
              </label>
            </div>

            {/* Submit Buttons */}
            <div class="flex items-center justify-between pt-6 border-t">
              <a
                href="/admin/locaties"
                class="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                Annuleren
              </a>
              <button
                type="submit"
                class="px-6 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
              >
                <i class="fas fa-save mr-2"></i>
                {isEdit ? 'Wijzigingen Opslaan' : 'Locatie Aanmaken'}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  )
}

export default app
