// Admin Karaoke Management
// Song library management, event creation, member selections, and duet matching

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware - only admin and moderator
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// ADMIN KARAOKE DASHBOARD (Landing page)
// =====================================================

app.get('/admin/karaoke', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Get statistics
  const totalSongs = await queryOne(c.env.DB, 'SELECT COUNT(*) as count FROM karaoke_songs', [])
  const totalEvents = await queryOne(c.env.DB, 'SELECT COUNT(*) as count FROM karaoke_events', [])
  const openEvents = await queryOne(c.env.DB, "SELECT COUNT(*) as count FROM karaoke_events WHERE status = 'open'", [])
  const totalSelections = await queryOne(c.env.DB, 'SELECT COUNT(*) as count FROM karaoke_selections', [])
  
  // Recent events
  const recentEvents = await queryAll(c.env.DB, `
    SELECT 
      ke.*,
      e.titel,
      e.start_at,
      e.locatie,
      (SELECT COUNT(DISTINCT user_id) FROM karaoke_selections WHERE karaoke_event_id = ke.id) as members_selected,
      (SELECT COUNT(*) FROM karaoke_selections WHERE karaoke_event_id = ke.id) as total_selections
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    ORDER BY e.start_at DESC
    LIMIT 5
  `, [])

  // Top songs by popularity
  const topSongs = await queryAll(c.env.DB, `
    SELECT 
      ks.*,
      (SELECT COUNT(*) FROM karaoke_selections WHERE song_id = ks.id) as selection_count
    FROM karaoke_songs ks
    WHERE ks.is_active = 1
    ORDER BY ks.popularity_score DESC, selection_count DESC
    LIMIT 10
  `, [])

  return c.html(
    <Layout 
      title="Karaoke Beheer" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Karaoke', href: '/admin/karaoke' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900 flex items-center" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-microphone text-animato-primary mr-3"></i>
              Karaoke Beheer
            </h1>
            <p class="text-gray-600 mt-2">
              Beheer karaoke songs, events en leden-selecties
            </p>
          </div>

          {/* Quick Stats */}
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-600 text-sm">Totaal Songs</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">{totalSongs?.count || 0}</p>
                </div>
                <div class="bg-blue-100 p-3 rounded-full">
                  <i class="fas fa-music text-blue-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-600 text-sm">Karaoke Events</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">{totalEvents?.count || 0}</p>
                </div>
                <div class="bg-purple-100 p-3 rounded-full">
                  <i class="fas fa-calendar-alt text-purple-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-600 text-sm">Open Events</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">{openEvents?.count || 0}</p>
                </div>
                <div class="bg-green-100 p-3 rounded-full">
                  <i class="fas fa-door-open text-green-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-600 text-sm">Song Selecties</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">{totalSelections?.count || 0}</p>
                </div>
                <div class="bg-orange-100 p-3 rounded-full">
                  <i class="fas fa-star text-orange-600 text-xl"></i>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <a 
              href="/admin/karaoke/songs" 
              class="bg-white p-6 rounded-lg shadow-sm border-2 border-gray-200 hover:border-animato-primary transition-colors group"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-semibold text-gray-900 text-lg group-hover:text-animato-primary transition-colors">
                    <i class="fas fa-list-music mr-2"></i>
                    Song Bibliotheek
                  </h3>
                  <p class="text-gray-600 text-sm mt-1">Beheer alle karaoke songs</p>
                </div>
                <i class="fas fa-chevron-right text-gray-400 group-hover:text-animato-primary transition-colors"></i>
              </div>
            </a>

            <a 
              href="/admin/karaoke/events" 
              class="bg-white p-6 rounded-lg shadow-sm border-2 border-gray-200 hover:border-animato-primary transition-colors group"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-semibold text-gray-900 text-lg group-hover:text-animato-primary transition-colors">
                    <i class="fas fa-calendar-plus mr-2"></i>
                    Karaoke Events
                  </h3>
                  <p class="text-gray-600 text-sm mt-1">Organiseer karaoke avonden</p>
                </div>
                <i class="fas fa-chevron-right text-gray-400 group-hover:text-animato-primary transition-colors"></i>
              </div>
            </a>

            <a 
              href="/admin/karaoke/matching" 
              class="bg-white p-6 rounded-lg shadow-sm border-2 border-gray-200 hover:border-animato-primary transition-colors group"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-semibold text-gray-900 text-lg group-hover:text-animato-primary transition-colors">
                    <i class="fas fa-user-friends mr-2"></i>
                    Duet Matching
                  </h3>
                  <p class="text-gray-600 text-sm mt-1">Match leden voor duets</p>
                </div>
                <i class="fas fa-chevron-right text-gray-400 group-hover:text-animato-primary transition-colors"></i>
              </div>
            </a>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Events */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 class="text-xl font-semibold text-gray-900 mb-4">
                <i class="fas fa-calendar text-animato-primary mr-2"></i>
                Recente Events
              </h2>
              {recentEvents && recentEvents.length > 0 ? (
                <div class="space-y-3">
                  {recentEvents.map((event: any) => (
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div class="flex-1">
                        <h3 class="font-medium text-gray-900">{event.titel}</h3>
                        <div class="text-sm text-gray-600 mt-1">
                          <i class="far fa-calendar mr-1"></i>
                          {new Date(event.start_at).toLocaleDateString('nl-NL')}
                          <span class="mx-2">•</span>
                          {event.members_selected} leden ({event.total_selections} songs)
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class={`px-3 py-1 rounded-full text-xs font-medium ${
                          event.status === 'open' ? 'bg-green-100 text-green-800' :
                          event.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {event.status}
                        </span>
                        <a 
                          href={`/admin/karaoke/events/${event.id}`}
                          class="text-animato-primary hover:text-animato-primary-dark"
                        >
                          <i class="fas fa-chevron-right"></i>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p class="text-gray-500 text-center py-8">
                  <i class="fas fa-calendar-times text-4xl mb-2 block"></i>
                  Nog geen karaoke events aangemaakt
                </p>
              )}
            </div>

            {/* Top Songs */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 class="text-xl font-semibold text-gray-900 mb-4">
                <i class="fas fa-fire text-orange-500 mr-2"></i>
                Populairste Songs
              </h2>
              {topSongs && topSongs.length > 0 ? (
                <div class="space-y-2">
                  {topSongs.map((song: any, index: number) => (
                    <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <div class="flex items-center justify-center w-8 h-8 bg-animato-primary text-white rounded-full text-sm font-bold">
                        {index + 1}
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="font-medium text-gray-900 truncate">{song.title}</p>
                        <p class="text-sm text-gray-600 truncate">{song.artist}</p>
                      </div>
                      <div class="text-right">
                        <div class="text-sm font-medium text-gray-900">{song.selection_count || 0}×</div>
                        <div class="text-xs text-gray-500">gekozen</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p class="text-gray-500 text-center py-8">
                  <i class="fas fa-music text-4xl mb-2 block"></i>
                  Voeg songs toe aan de bibliotheek
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// SONGS LIST
// =====================================================

app.get('/admin/karaoke/songs', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const search = c.req.query('search') || ''
  const genre = c.req.query('genre') || 'all'
  const language = c.req.query('language') || 'all'
  const type = c.req.query('type') || 'all'
  const success = c.req.query('success')

  // Build query
  let conditions = ['is_active = 1']
  let params: any[] = []

  if (search) {
    conditions.push('(title LIKE ? OR artist LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }
  if (genre !== 'all') {
    conditions.push('genre = ?')
    params.push(genre)
  }
  if (language !== 'all') {
    conditions.push('language = ?')
    params.push(language)
  }
  if (type !== 'all') {
    conditions.push('type = ?')
    params.push(type)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const songs = await queryAll(c.env.DB, `
    SELECT 
      ks.*,
      (SELECT COUNT(*) FROM karaoke_selections WHERE song_id = ks.id) as times_selected
    FROM karaoke_songs ks
    ${whereClause}
    ORDER BY ks.artist ASC, ks.title ASC
    LIMIT 100
  `, params)

  // Get unique genres and languages for filters
  const genres = await queryAll(c.env.DB, 'SELECT DISTINCT genre FROM karaoke_songs WHERE genre IS NOT NULL AND genre != "" ORDER BY genre', [])
  const languages = await queryAll(c.env.DB, 'SELECT DISTINCT language FROM karaoke_songs WHERE language IS NOT NULL ORDER BY language', [])

  return c.html(
    <Layout 
      title="Song Bibliotheek" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Karaoke', href: '/admin/karaoke' },
        { label: 'Songs', href: '/admin/karaoke/songs' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-list-music text-animato-primary mr-3"></i>
                  Song Bibliotheek
                </h1>
                <p class="text-gray-600 mt-2">
                  {songs?.length || 0} songs in bibliotheek
                </p>
              </div>
              <div class="flex gap-3">
                <a 
                  href="/admin/karaoke/songs/bulk-import" 
                  class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
                >
                  <i class="fas fa-file-import mr-2"></i>
                  Bulk Import
                </a>
                <a 
                  href="/admin/karaoke/songs/nieuw" 
                  class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Song Toevoegen
                </a>
              </div>
            </div>
          </div>

          {/* Success Message */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              {success === 'created' && 'Song succesvol toegevoegd!'}
              {success === 'updated' && 'Song succesvol bijgewerkt!'}
              {success === 'deleted' && 'Song succesvol verwijderd!'}
            </div>
          )}

          {/* Filters */}
          <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
            <form method="GET" action="/admin/karaoke/songs" class="grid grid-cols-1 md:grid-cols-5 gap-4">
              
              {/* Search */}
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-search mr-1"></i>
                  Zoeken
                </label>
                <input 
                  type="text" 
                  name="search" 
                  value={search}
                  placeholder="Titel of artiest..." 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Genre */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-guitar mr-1"></i>
                  Genre
                </label>
                <select 
                  name="genre" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="all">Alle genres</option>
                  {genres?.map((g: any) => (
                    <option value={g.genre} selected={genre === g.genre}>
                      {g.genre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Language */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-language mr-1"></i>
                  Taal
                </label>
                <select 
                  name="language" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="all">Alle talen</option>
                  {languages?.map((l: any) => (
                    <option value={l.language} selected={language === l.language}>
                      {l.language === 'nl' ? '🇳🇱 Nederlands' :
                       l.language === 'en' ? '🇬🇧 Engels' :
                       l.language === 'fr' ? '🇫🇷 Frans' :
                       l.language === 'de' ? '🇩🇪 Duits' :
                       l.language}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-users mr-1"></i>
                  Type
                </label>
                <select 
                  name="type" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="all">Alle types</option>
                  <option value="solo" selected={type === 'solo'}>Solo</option>
                  <option value="duet" selected={type === 'duet'}>Duet</option>
                  <option value="group" selected={type === 'group'}>Groep</option>
                </select>
              </div>

              {/* Search Button */}
              <div class="md:col-span-5 flex justify-end gap-3">
                <a 
                  href="/admin/karaoke/songs"
                  class="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Reset
                </a>
                <button 
                  type="submit"
                  class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  <i class="fas fa-search mr-2"></i>
                  Zoeken
                </button>
              </div>
            </form>
          </div>

          {/* Songs Table */}
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {songs && songs.length > 0 ? (
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Titel
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Artiest
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Genre
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Populariteit
                      </th>
                      <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Acties
                      </th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    {songs.map((song: any) => (
                      <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4">
                          <div class="flex items-center">
                            <i class="fas fa-music text-gray-400 mr-3"></i>
                            <div>
                              <div class="text-sm font-medium text-gray-900">{song.title}</div>
                              {song.difficulty && (
                                <div class="text-xs text-gray-500 mt-1">
                                  {song.difficulty === 'easy' && '🟢 Makkelijk'}
                                  {song.difficulty === 'medium' && '🟡 Gemiddeld'}
                                  {song.difficulty === 'hard' && '🔴 Moeilijk'}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4">
                          <div class="text-sm text-gray-900">{song.artist}</div>
                        </td>
                        <td class="px-6 py-4">
                          <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                            {song.genre || 'Onbekend'}
                          </span>
                        </td>
                        <td class="px-6 py-4">
                          <span class={`px-2 py-1 text-xs font-medium rounded-full ${
                            song.type === 'solo' ? 'bg-blue-100 text-blue-800' :
                            song.type === 'duet' ? 'bg-purple-100 text-purple-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {song.type === 'solo' ? '👤 Solo' :
                             song.type === 'duet' ? '👥 Duet' :
                             '👨‍👩‍👧‍👦 Groep'}
                          </span>
                        </td>
                        <td class="px-6 py-4">
                          <div class="flex items-center gap-2">
                            <i class="fas fa-star text-yellow-400"></i>
                            <span class="text-sm font-medium text-gray-900">{song.times_selected || 0}×</span>
                          </div>
                        </td>
                        <td class="px-6 py-4 text-right text-sm font-medium">
                          <div class="flex items-center justify-end gap-2">
                            <a 
                              href={`/admin/karaoke/songs/${song.id}/edit`}
                              class="text-animato-primary hover:text-animato-primary-dark transition-colors"
                              title="Bewerken"
                            >
                              <i class="fas fa-edit"></i>
                            </a>
                            <button 
                              onclick={`if(confirm('Weet je zeker dat je deze song wilt verwijderen?')) { window.location.href='/admin/karaoke/songs/${song.id}/delete' }`}
                              class="text-red-600 hover:text-red-800 transition-colors"
                              title="Verwijderen"
                            >
                              <i class="fas fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div class="text-center py-12">
                <i class="fas fa-music text-gray-300 text-6xl mb-4"></i>
                <h3 class="text-lg font-medium text-gray-900 mb-2">Geen songs gevonden</h3>
                <p class="text-gray-600 mb-6">
                  {search ? 'Probeer een andere zoekterm' : 'Begin met het toevoegen van je eerste song'}
                </p>
                <a 
                  href="/admin/karaoke/songs/nieuw" 
                  class="inline-flex items-center bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Eerste Song Toevoegen
                </a>
              </div>
            )}
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CREATE SONG FORM
// =====================================================

app.get('/admin/karaoke/songs/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  return c.html(
    <Layout title="Nieuwe Song" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Karaoke', href: '/admin/karaoke' },
      { label: 'Songs', href: '/admin/karaoke/songs' },
      { label: 'Nieuw', href: '/admin/karaoke/songs/nieuw' }
    ]}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-3xl mx-auto px-4">
          <h1 class="text-3xl font-bold mb-8">
            <i class="fas fa-plus-circle text-animato-primary mr-3"></i>
            Nieuwe Song Toevoegen
          </h1>

          <form method="POST" action="/admin/karaoke/songs/create" class="bg-white p-8 rounded-lg shadow">
            
            <div class="grid md:grid-cols-2 gap-6 mb-6">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  name="title" 
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijv: Bohemian Rhapsody"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Artiest <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  name="artist" 
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijv: Queen"
                />
              </div>
            </div>

            <div class="grid md:grid-cols-3 gap-6 mb-6">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Genre
                </label>
                <select 
                  name="genre" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="">Selecteer genre</option>
                  <option value="Pop">Pop</option>
                  <option value="Rock">Rock</option>
                  <option value="Nederlands">Nederlands</option>
                  <option value="Dance">Dance</option>
                  <option value="Ballad">Ballad</option>
                  <option value="Country">Country</option>
                  <option value="R&B">R&B</option>
                  <option value="Musical">Musical</option>
                  <option value="Schlager">Schlager</option>
                  <option value="Disco">Disco</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Taal
                </label>
                <select 
                  name="language" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="nl">🇳🇱 Nederlands</option>
                  <option value="en">🇬🇧 Engels</option>
                  <option value="fr">🇫🇷 Frans</option>
                  <option value="de">🇩🇪 Duits</option>
                  <option value="es">🇪🇸 Spaans</option>
                  <option value="it">🇮🇹 Italiaans</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Type
                </label>
                <select 
                  name="type" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="solo">👤 Solo</option>
                  <option value="duet">👥 Duet</option>
                  <option value="group">👨‍👩‍👧‍👦 Groep</option>
                </select>
              </div>
            </div>

            <div class="grid md:grid-cols-2 gap-6 mb-6">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Moeilijkheid
                </label>
                <select 
                  name="difficulty" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="">Niet ingesteld</option>
                  <option value="easy">🟢 Makkelijk</option>
                  <option value="medium">🟡 Gemiddeld</option>
                  <option value="hard">🔴 Moeilijk</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Duur (seconden)
                </label>
                <input 
                  type="number" 
                  name="duration_seconds" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  placeholder="Bijv: 240"
                />
              </div>
            </div>

            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                YouTube URL
              </label>
              <input 
                type="url" 
                name="youtube_url" 
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                placeholder="https://youtube.com/watch?v=..."
              />
            </div>

            <div class="flex justify-end gap-3">
              <a 
                href="/admin/karaoke/songs" 
                class="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                Annuleren
              </a>
              <button 
                type="submit"
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                <i class="fas fa-save mr-2"></i>
                Song Opslaan
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CREATE SONG (POST)
// =====================================================

app.post('/admin/karaoke/songs/create', async (c) => {
  const formData = await c.req.formData()
  
  const title = formData.get('title')?.toString() || ''
  const artist = formData.get('artist')?.toString() || ''
  const genre = formData.get('genre')?.toString() || null
  const language = formData.get('language')?.toString() || 'nl'
  const type = formData.get('type')?.toString() || 'solo'
  const difficulty = formData.get('difficulty')?.toString() || null
  const duration = formData.get('duration_seconds')?.toString() || null
  const youtube_url = formData.get('youtube_url')?.toString() || null

  if (!title || !artist) {
    return c.redirect('/admin/karaoke/songs/nieuw?error=missing_fields')
  }

  await execute(c.env.DB, `
    INSERT INTO karaoke_songs (title, artist, genre, language, type, difficulty, duration_seconds, youtube_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [title, artist, genre, language, type, difficulty, duration ? parseInt(duration) : null, youtube_url])

  return c.redirect('/admin/karaoke/songs?success=created')
})

// =====================================================
// DELETE SONG
// =====================================================

app.get('/admin/karaoke/songs/:id/delete', async (c) => {
  const id = c.req.param('id')
  
  await execute(c.env.DB, 'UPDATE karaoke_songs SET is_active = 0 WHERE id = ?', [id])
  
  return c.redirect('/admin/karaoke/songs?success=deleted')
})

export default app
