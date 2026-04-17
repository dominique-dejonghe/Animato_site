// Admin Locations Management
// Manage event locations with Google Maps integration

import { Hono } from 'hono'
import type { Bindings, SessionUser, Location } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware
app.use('/admin/*', requireAuth)
app.use('/admin/*', requireRole('admin', 'moderator'))

// =====================================================
// HELPER: BUILD MAP EMBED URL (no API key needed)
// =====================================================

function buildMapEmbedUrl(loc: any): string {
  // Priority 1: if they saved a proper Google embed URL directly
  if (loc.google_maps_embed && loc.google_maps_embed.includes('/embed')) {
    return loc.google_maps_embed
  }
  // Priority 2: extract lat/lng from google_maps_url and use OSM embed
  if (loc.google_maps_url) {
    const atMatch  = loc.google_maps_url.match(/@([-\d.]+),([-\d.]+)/)
    const qMatch   = loc.google_maps_url.match(/[?&]q=([-\d.]+),([-\d.]+)/)
    const match    = atMatch || qMatch
    if (match) {
      const lat = parseFloat(match[1]), lng = parseFloat(match[2])
      const delta = 0.003
      return `https://www.openstreetmap.org/export/embed.html?bbox=${lng-delta}%2C${lat-delta}%2C${lng+delta}%2C${lat+delta}&layer=mapnik&marker=${lat}%2C${lng}`
    }
  }
  // Priority 3: build from address fields via OSM search embed
  const parts = [loc.adres, loc.postcode, loc.stad, loc.land].filter(Boolean)
  if (parts.length >= 2) {
    const q = encodeURIComponent(parts.join(', '))
    return `https://www.openstreetmap.org/export/embed.html?query=${q}&layer=mapnik`
  }
  return ''
}

// =====================================================
// LOCATIONS OVERVIEW
// =====================================================

app.get('/admin/locations', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''
  const status = c.req.query('status') || 'all'

  // Build query
  let query = `SELECT * FROM locations WHERE 1=1`
  const params: any[] = []

  if (status === 'active') {
    query += ` AND is_actief = 1`
  } else if (status === 'inactive') {
    query += ` AND is_actief = 0`
  }

  if (search) {
    query += ` AND (naam LIKE ? OR adres LIKE ? OR stad LIKE ?)`
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  query += ` ORDER BY naam ASC`

  const locations = await queryAll(c.env.DB, query, params)

  return c.html(
    <Layout 
      title="Locaties Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' },
        { label: 'Locaties', href: '/admin/locations' }
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
                  Beheer event locaties en Google Maps integratie
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="/admin/events"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  <i class="fas fa-calendar-alt mr-2"></i>
                  Terug naar Activiteiten
                </a>
                <a
                  href="/admin/locations/nieuw"
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
          
          {/* Filters */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Status Filter */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  onchange={`window.location.href='/admin/locations?status=' + this.value + '&search=${search}'`}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all" selected={status === 'all'}>Alle Locaties</option>
                  <option value="active" selected={status === 'active'}>Actief</option>
                  <option value="inactive" selected={status === 'inactive'}>Inactief</option>
                </select>
              </div>

              {/* Search */}
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">Zoeken</label>
                <form action="/admin/locations" method="GET" class="flex gap-2">
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
              <div class="col-span-full bg-white rounded-lg shadow-md p-8 text-center">
                <i class="fas fa-map-marked-alt text-6xl text-gray-300 mb-4"></i>
                <p class="text-gray-500 mb-4">Geen locaties gevonden</p>
                <a
                  href="/admin/locations/nieuw"
                  class="inline-block px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Eerste Locatie Toevoegen
                </a>
              </div>
            ) : (
              locations.map((loc: any) => (
                <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition">
                  {/* Map Preview – always show OSM embed when address is known */}
                  {(() => {
                    const mapUrl = buildMapEmbedUrl(loc)
                    return mapUrl ? (
                      <div class="relative h-48 bg-gray-200 overflow-hidden">
                        <iframe
                          src={mapUrl}
                          width="100%"
                          height="100%"
                          style="border:0;display:block;"
                          loading="lazy"
                          referrerpolicy="no-referrer-when-downgrade"
                          title={`Kaart van ${loc.naam}`}
                        ></iframe>
                        {/* Clickable overlay so the card link still works */}
                        <a
                          href={loc.google_maps_url || `https://www.openstreetmap.org/search?query=${encodeURIComponent([loc.adres,loc.postcode,loc.stad].filter(Boolean).join(', '))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="absolute inset-0"
                          title="Bekijk op kaart"
                        ></a>
                      </div>
                    ) : (
                      <div class="h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex flex-col items-center justify-center gap-2">
                        <i class="fas fa-map-marker-alt text-4xl text-gray-400"></i>
                        <span class="text-xs text-gray-400">Geen adres beschikbaar</span>
                      </div>
                    )
                  })()}

                  {/* Content */}
                  <div class="p-6">
                    <div class="flex items-start justify-between mb-3">
                      <h3 class="text-lg font-bold text-gray-900">{loc.naam}</h3>
                      {!loc.is_actief && (
                        <span class="px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-600 rounded-full">
                          Inactief
                        </span>
                      )}
                    </div>

                    <div class="space-y-2 text-sm text-gray-600 mb-4">
                      <div class="flex items-start gap-2">
                        <i class="fas fa-map-marker-alt text-red-500 mt-0.5"></i>
                        <div>
                          <div>{loc.adres}</div>
                          {loc.postcode && loc.stad && (
                            <div>{loc.postcode} {loc.stad}</div>
                          )}
                          {loc.land && loc.land !== 'België' && (
                            <div>{loc.land}</div>
                          )}
                        </div>
                      </div>

                      {loc.google_maps_url && (
                        <div class="flex items-center gap-2">
                          <i class="fas fa-external-link-alt text-blue-500"></i>
                          <a
                            href={loc.google_maps_url}
                            target="_blank"
                            class="text-blue-600 hover:underline"
                          >
                            Bekijk op Google Maps
                          </a>
                        </div>
                      )}

                      {loc.notities && (
                        <div class="flex items-start gap-2 mt-3 p-2 bg-yellow-50 rounded">
                          <i class="fas fa-sticky-note text-yellow-600 mt-0.5"></i>
                          <div class="text-xs text-gray-700">{loc.notities}</div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div class="flex items-center justify-between pt-4 border-t">
                      <a
                        href={`/admin/locations/${loc.id}`}
                        class="text-animato-primary hover:text-animato-secondary font-medium"
                      >
                        <i class="fas fa-edit mr-1"></i>
                        Bewerken
                      </a>
                      <button
                        onclick={`openDeleteModal('/admin/locations/${loc.id}/delete')`}
                        class="text-red-600 hover:text-red-900 font-medium"
                      >
                        <i class="fas fa-trash mr-1"></i>
                        Verwijderen
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Stats */}
          <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Totaal Locaties</div>
              <div class="text-2xl font-bold text-gray-900">{locations.length}</div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Actief</div>
              <div class="text-2xl font-bold text-green-600">
                {locations.filter((l: any) => l.is_actief).length}
              </div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="text-sm text-gray-600">Met Google Maps</div>
              <div class="text-2xl font-bold text-blue-600">
                {locations.filter((l: any) => l.google_maps_url).length}
              </div>
            </div>
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

app.get('/admin/locations/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  return c.html(
    <Layout 
      title="Nieuwe Locatie"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' },
        { label: 'Locaties', href: '/admin/locations' },
        { label: 'Nieuw', href: '/admin/locations/nieuw' }
      ]}
    >
      {renderLocationForm(null)}
    </Layout>
  )
})

app.get('/admin/locations/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')

  const location = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM locations WHERE id = ?`,
    [id]
  )

  if (!location) {
    return c.redirect('/admin/locations')
  }

  return c.html(
    <Layout 
      title={`Bewerk Locatie: ${location.naam}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Activiteiten', href: '/admin/events' },
        { label: 'Locaties', href: '/admin/locations' },
        { label: 'Bewerken', href: `/admin/locations/${id}` }
      ]}
    >
      {renderLocationForm(location)}
    </Layout>
  )
})

// =====================================================
// SAVE LOCATION (CREATE/UPDATE)
// =====================================================

app.post('/admin/locations/save', async (c) => {
  const body = await c.req.parseBody()
  const {
    id, naam, adres, postcode, stad, land,
    google_maps_url, google_maps_embed,
    latitude, longitude, notities, is_actief
  } = body

  try {
    if (id) {
      // UPDATE
      await execute(
        c.env.DB,
        `UPDATE locations 
         SET naam = ?, adres = ?, postcode = ?, stad = ?, land = ?,
             google_maps_url = ?, google_maps_embed = ?, latitude = ?, longitude = ?,
             notities = ?, is_actief = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          naam, adres, postcode || null, stad || null, land || 'België',
          google_maps_url || null, google_maps_embed || null,
          latitude ? parseFloat(latitude as string) : null,
          longitude ? parseFloat(longitude as string) : null,
          notities || null, is_actief === 'on' ? 1 : 0, id
        ]
      )
    } else {
      // CREATE
      await execute(
        c.env.DB,
        `INSERT INTO locations 
         (naam, adres, postcode, stad, land, google_maps_url, google_maps_embed,
          latitude, longitude, notities, is_actief)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          naam, adres, postcode || null, stad || null, land || 'België',
          google_maps_url || null, google_maps_embed || null,
          latitude ? parseFloat(latitude as string) : null,
          longitude ? parseFloat(longitude as string) : null,
          notities || null, is_actief === 'on' ? 1 : 0
        ]
      )
    }

    return c.redirect('/admin/locations')
  } catch (error) {
    console.error('Error saving location:', error)
    return c.text('Error saving location', 500)
  }
})

// =====================================================
// DELETE LOCATION
// =====================================================

app.post('/admin/locations/:id/delete', async (c) => {
  const id = c.req.param('id')

  try {
    // Check if location is used by any events
    const usedBy = await queryOne<any>(
      c.env.DB,
      `SELECT COUNT(*) as count FROM events WHERE location_id = ?`,
      [id]
    )

    if (usedBy && usedBy.count > 0) {
      return c.json({ 
        success: false, 
        error: `Deze locatie wordt gebruikt door ${usedBy.count} event(s). Verwijder eerst deze events.` 
      }, 400)
    }

    await execute(
      c.env.DB,
      `DELETE FROM locations WHERE id = ?`,
      [id]
    )

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
          
          <form method="POST" action="/admin/locations/save" id="locationForm">
            {isEdit && <input type="hidden" name="id" value={location.id} />}

            {/* Basic Info */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-info-circle text-purple-600 mr-2"></i>
                Basis Informatie
              </h2>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Naam *
                </label>
                <input
                  type="text"
                  name="naam"
                  value={location?.naam || ''}
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijvoorbeeld: Repetitielokaal Koor"
                />
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Adres *
                </label>
                <input
                  type="text"
                  name="adres"
                  value={location?.adres || ''}
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Straat en huisnummer"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Postcode
                  </label>
                  <input
                    type="text"
                    name="postcode"
                    value={location?.postcode || ''}
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    placeholder="1000"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Stad
                  </label>
                  <input
                    type="text"
                    name="stad"
                    value={location?.stad || ''}
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                    placeholder="Brussel"
                  />
                </div>

                <div>
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
              </div>
            </div>

            {/* Google Maps Integration */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-map text-red-600 mr-2"></i>
                Google Maps Integratie
              </h2>

              <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div class="flex items-start gap-3">
                  <i class="fas fa-info-circle text-blue-600 text-lg mt-0.5"></i>
                  <div class="text-sm text-gray-700">
                    <p class="font-medium mb-2">Hoe vind je de Google Maps URL?</p>
                    <ol class="list-decimal list-inside space-y-1">
                      <li>Ga naar <a href="https://maps.google.com" target="_blank" class="text-blue-600 hover:underline">maps.google.com</a></li>
                      <li>Zoek je locatie</li>
                      <li>Klik op "Delen" en kopieer de link</li>
                      <li>Voor embed: klik op "Kaart insluiten" en kopieer de iframe src URL</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Google Maps URL (Share Link)
                </label>
                <input
                  type="url"
                  name="google_maps_url"
                  id="mapsUrlInput"
                  value={location?.google_maps_url || ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="https://goo.gl/maps/..."
                />
              </div>


            </div>

            {/* Additional Info */}
            <div class="mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                <i class="fas fa-sticky-note text-yellow-600 mr-2"></i>
                Extra Informatie
              </h2>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Notities
                </label>
                <textarea
                  name="notities"
                  rows={3}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijvoorbeeld: Toegangscode 1234, ingang aan achterkant, parkeren op straat..."
                >{location?.notities || ''}</textarea>
              </div>

              <label class="flex items-center">
                <input
                  type="checkbox"
                  name="is_actief"
                  checked={location?.is_actief !== false}
                  class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                />
                <span class="ml-2 text-gray-700">Locatie is actief (beschikbaar voor events)</span>
              </label>
            </div>

            {/* Submit Buttons */}
            <div class="flex items-center justify-between pt-6 border-t">
              <a
                href="/admin/locations"
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
