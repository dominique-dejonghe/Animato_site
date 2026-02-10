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

// =====================================================
// BULK IMPORT (PLACEHOLDER)
// =====================================================

app.get('/admin/karaoke/songs/bulk-import', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  return c.html(
    <Layout title="Bulk Import" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Karaoke', href: '/admin/karaoke' },
      { label: 'Songs', href: '/admin/karaoke/songs' },
      { label: 'Bulk Import', href: '/admin/karaoke/songs/bulk-import' }
    ]}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-3xl mx-auto px-4">
          <h1 class="text-3xl font-bold mb-8">
            <i class="fas fa-file-import text-animato-primary mr-3"></i>
            Bulk Import Songs
          </h1>

          <div class="bg-white p-8 rounded-lg shadow">
            <div class="bg-blue-50 border border-blue-200 text-blue-800 p-6 rounded-lg mb-6">
              <h3 class="font-semibold mb-2">
                <i class="fas fa-info-circle mr-2"></i>
                Feature Coming Soon
              </h3>
              <p class="text-sm">
                Bulk import via CSV wordt binnenkort toegevoegd. Voor nu kun je songs handmatig toevoegen via het formulier.
              </p>
            </div>

            <div class="space-y-4">
              <h3 class="font-semibold text-gray-900">Verwachte CSV formaat:</h3>
              <div class="bg-gray-100 p-4 rounded-lg font-mono text-sm">
                title,artist,genre,language,type,difficulty<br/>
                "Brabant","Guus Meeuwis","Nederlands","nl","solo","easy"<br/>
                "Het is een nacht","Guus Meeuwis","Nederlands","nl","solo","easy"
              </div>
            </div>

            <div class="flex justify-between mt-8 pt-6 border-t">
              <a 
                href="/admin/karaoke/songs"
                class="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <i class="fas fa-arrow-left mr-2"></i>
                Terug naar Songs
              </a>
              <a 
                href="/admin/karaoke/songs/nieuw"
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-2 rounded-lg transition-colors"
              >
                <i class="fas fa-plus mr-2"></i>
                Song Handmatig Toevoegen
              </a>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// KARAOKE EVENTS LIST
// =====================================================

app.get('/admin/karaoke/events', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const filter = c.req.query('filter') || 'all'
  const success = c.req.query('success')

  // Get all karaoke events with main event details
  let query = `
    SELECT 
      ke.*,
      e.titel,
      e.start_at,
      e.end_at,
      e.locatie,
      e.is_publiek,
      (SELECT COUNT(DISTINCT user_id) FROM karaoke_selections WHERE karaoke_event_id = ke.id) as members_selected,
      (SELECT COUNT(*) FROM karaoke_selections WHERE karaoke_event_id = ke.id) as total_selections,
      (SELECT COUNT(*) FROM karaoke_song_requests WHERE karaoke_event_id = ke.id AND status = 'pending') as pending_requests
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    WHERE ke.status ${
      filter === 'open' ? "= 'open'" :
      filter === 'closed' ? "= 'closed'" :
      filter === 'completed' ? "= 'completed'" :
      "IN ('open', 'closed', 'completed')"
    }
    ORDER BY e.start_at DESC
  `

  const events = await queryAll(c.env.DB, query, [])

  return c.html(
    <Layout title="Karaoke Events" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Karaoke', href: '/admin/karaoke' },
      { label: 'Events', href: '/admin/karaoke/events' }
    ]}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4">
          
          <div class="mb-8">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-calendar-alt text-animato-primary mr-3"></i>
                  Karaoke Events
                </h1>
                <p class="text-gray-600 mt-2">Beheer karaoke avonden en leden selecties</p>
              </div>
              <a 
                href="/admin/karaoke/events/nieuw" 
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
              >
                <i class="fas fa-plus mr-2"></i>
                Nieuw Karaoke Event
              </a>
            </div>
          </div>

          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              {success === 'created' && 'Karaoke event succesvol aangemaakt!'}
              {success === 'updated' && 'Karaoke event succesvol bijgewerkt!'}
            </div>
          )}

          {/* Filter Tabs */}
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
            <div class="flex border-b border-gray-200">
              <a 
                href="/admin/karaoke/events?filter=all"
                class={`px-6 py-3 text-sm font-medium transition-colors ${
                  filter === 'all' 
                    ? 'text-animato-primary border-b-2 border-animato-primary' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Alle Events
              </a>
              <a 
                href="/admin/karaoke/events?filter=open"
                class={`px-6 py-3 text-sm font-medium transition-colors ${
                  filter === 'open' 
                    ? 'text-animato-primary border-b-2 border-animato-primary' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i class="fas fa-door-open mr-1"></i>
                Open
              </a>
              <a 
                href="/admin/karaoke/events?filter=closed"
                class={`px-6 py-3 text-sm font-medium transition-colors ${
                  filter === 'closed' 
                    ? 'text-animato-primary border-b-2 border-animato-primary' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i class="fas fa-door-closed mr-1"></i>
                Gesloten
              </a>
              <a 
                href="/admin/karaoke/events?filter=completed"
                class={`px-6 py-3 text-sm font-medium transition-colors ${
                  filter === 'completed' 
                    ? 'text-animato-primary border-b-2 border-animato-primary' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i class="fas fa-check-circle mr-1"></i>
                Voltooid
              </a>
            </div>
          </div>

          {/* Events List */}
          {events && events.length > 0 ? (
            <div class="space-y-4">
              {events.map((event: any) => (
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        <h3 class="text-xl font-semibold text-gray-900">{event.titel}</h3>
                        <span class={`px-3 py-1 rounded-full text-xs font-medium ${
                          event.status === 'open' ? 'bg-green-100 text-green-800' :
                          event.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {event.status === 'open' ? 'Open voor selecties' :
                           event.status === 'closed' ? 'Selecties gesloten' :
                           'Voltooid'}
                        </span>
                      </div>
                      
                      <div class="grid md:grid-cols-2 gap-4 mt-4 text-sm text-gray-600">
                        <div>
                          <i class="far fa-calendar mr-2"></i>
                          {new Date(event.start_at).toLocaleDateString('nl-NL', { 
                            weekday: 'long', 
                            day: 'numeric', 
                            month: 'long', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                        <div>
                          <i class="fas fa-map-marker-alt mr-2"></i>
                          {event.locatie}
                        </div>
                        <div>
                          <i class="fas fa-users mr-2"></i>
                          {event.members_selected} leden hebben gekozen
                        </div>
                        <div>
                          <i class="fas fa-music mr-2"></i>
                          {event.total_selections} songs geselecteerd
                        </div>
                        {event.selection_deadline && (
                          <div>
                            <i class="far fa-clock mr-2"></i>
                            Deadline: {new Date(event.selection_deadline).toLocaleDateString('nl-NL')}
                          </div>
                        )}
                        {event.pending_requests > 0 && (
                          <div class="text-orange-600 font-medium">
                            <i class="fas fa-exclamation-circle mr-2"></i>
                            {event.pending_requests} song verzoeken in afwachting
                          </div>
                        )}
                      </div>

                      <div class="mt-4 text-sm text-gray-600">
                        <div class="flex items-center gap-2">
                          <span class={event.allow_duets ? 'text-green-600' : 'text-gray-400'}>
                            <i class={`fas ${event.allow_duets ? 'fa-check-circle' : 'fa-times-circle'} mr-1`}></i>
                            Duets {event.allow_duets ? 'toegestaan' : 'niet toegestaan'}
                          </span>
                          <span class="mx-2">•</span>
                          <span>Max {event.max_songs_per_member} songs per lid</span>
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 ml-4">
                      <a 
                        href={`/admin/karaoke/events/${event.id}`}
                        class="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                      >
                        <i class="fas fa-eye mr-2"></i>
                        Bekijken
                      </a>
                      <a 
                        href={`/admin/karaoke/matching?event=${event.id}`}
                        class="px-4 py-2 text-sm bg-animato-primary hover:bg-animato-primary-dark text-white rounded-lg transition-colors"
                      >
                        <i class="fas fa-user-friends mr-2"></i>
                        Matching
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 text-center py-12">
              <i class="fas fa-calendar-times text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-lg font-medium text-gray-900 mb-2">Geen karaoke events gevonden</h3>
              <p class="text-gray-600 mb-6">
                {filter !== 'all' ? 'Probeer een ander filter' : 'Maak je eerste karaoke event aan'}
              </p>
              <a 
                href="/admin/karaoke/events/nieuw" 
                class="inline-flex items-center bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                <i class="fas fa-plus mr-2"></i>
                Eerste Karaoke Event Aanmaken
              </a>
            </div>
          )}

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CREATE KARAOKE EVENT FORM
// =====================================================

app.get('/admin/karaoke/events/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Get upcoming regular events that don't have karaoke yet
  const availableEvents = await queryAll(c.env.DB, `
    SELECT e.id, e.titel, e.start_at, e.locatie, e.type
    FROM events e
    LEFT JOIN karaoke_events ke ON ke.event_id = e.id
    WHERE ke.id IS NULL
      AND e.start_at >= datetime('now')
      AND e.type IN ('concert', 'ander')
    ORDER BY e.start_at ASC
    LIMIT 20
  `, [])

  return c.html(
    <Layout title="Nieuw Karaoke Event" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Karaoke', href: '/admin/karaoke' },
      { label: 'Events', href: '/admin/karaoke/events' },
      { label: 'Nieuw', href: '/admin/karaoke/events/nieuw' }
    ]}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-3xl mx-auto px-4">
          <h1 class="text-3xl font-bold mb-8">
            <i class="fas fa-calendar-plus text-animato-primary mr-3"></i>
            Nieuw Karaoke Event
          </h1>

          <form method="POST" action="/admin/karaoke/events/create" class="bg-white p-8 rounded-lg shadow space-y-6">
            
            <div class="border-b border-gray-200 pb-6">
              <h2 class="text-lg font-semibold text-gray-900 mb-4">Koppel aan Event</h2>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Selecteer bestaand event <span class="text-red-500">*</span>
                </label>
                {availableEvents && availableEvents.length > 0 ? (
                  <select 
                    name="event_id" 
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  >
                    <option value="">Kies een event...</option>
                    {availableEvents.map((evt: any) => (
                      <option value={evt.id}>
                        {evt.titel} - {new Date(evt.start_at).toLocaleDateString('nl-NL')} ({evt.locatie})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div class="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    Geen beschikbare events. <a href="/admin/events/nieuw" class="underline">Maak eerst een event aan</a>.
                  </div>
                )}
                <p class="text-sm text-gray-500 mt-2">
                  Of <a href="/admin/events/nieuw" class="text-animato-primary hover:underline">maak een nieuw event aan</a> en kom daarna terug.
                </p>
              </div>
            </div>

            <div class="border-b border-gray-200 pb-6">
              <h2 class="text-lg font-semibold text-gray-900 mb-4">Karaoke Instellingen</h2>
              
              <div class="grid md:grid-cols-2 gap-6">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Max songs per lid
                  </label>
                  <input 
                    type="number" 
                    name="max_songs_per_member" 
                    value="3"
                    min="1"
                    max="10"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Selectie deadline
                  </label>
                  <input 
                    type="datetime-local" 
                    name="selection_deadline" 
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                  />
                </div>
              </div>

              <div class="mt-6 space-y-3">
                <label class="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    name="allow_duets" 
                    value="1"
                    checked
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="text-sm font-medium text-gray-700">Duets toestaan</span>
                </label>

                <label class="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    name="allow_song_requests" 
                    value="1"
                    checked
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                  />
                  <span class="text-sm font-medium text-gray-700">Leden mogen songs aanvragen (niet in bibliotheek)</span>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Introductie tekst voor leden
              </label>
              <textarea 
                name="intro_text" 
                rows={4}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                placeholder="Welkom bij onze karaoke avond! Kies je favoriete songs..."
              ></textarea>
            </div>

            <div class="flex justify-end gap-3 pt-6 border-t border-gray-200">
              <a 
                href="/admin/karaoke/events" 
                class="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                Annuleren
              </a>
              <button 
                type="submit"
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                <i class="fas fa-save mr-2"></i>
                Karaoke Event Aanmaken
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CREATE KARAOKE EVENT (POST)
// =====================================================

app.post('/admin/karaoke/events/create', async (c) => {
  const formData = await c.req.formData()
  
  const event_id = formData.get('event_id')?.toString()
  const max_songs = parseInt(formData.get('max_songs_per_member')?.toString() || '3')
  const allow_duets = formData.get('allow_duets') === '1' ? 1 : 0
  const allow_requests = formData.get('allow_song_requests') === '1' ? 1 : 0
  const deadline = formData.get('selection_deadline')?.toString() || null
  const intro = formData.get('intro_text')?.toString() || null

  if (!event_id) {
    return c.redirect('/admin/karaoke/events/nieuw?error=missing_event')
  }

  await execute(c.env.DB, `
    INSERT INTO karaoke_events (event_id, max_songs_per_member, allow_duets, allow_song_requests, selection_deadline, intro_text, status)
    VALUES (?, ?, ?, ?, ?, ?, 'open')
  `, [event_id, max_songs, allow_duets, allow_requests, deadline, intro])

  return c.redirect('/admin/karaoke/events?success=created')
})

// =====================================================
// DUET MATCHING DASHBOARD
// =====================================================

app.get('/admin/karaoke/matching', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const eventId = c.req.query('event')

  // Get event if specified
  let event = null
  if (eventId) {
    event = await queryOne(c.env.DB, `
      SELECT ke.*, e.titel 
      FROM karaoke_events ke
      JOIN events e ON e.id = ke.event_id
      WHERE ke.id = ?
    `, [eventId])
  }

  // Get all events for dropdown
  const allEvents = await queryAll(c.env.DB, `
    SELECT ke.id, e.titel, e.start_at
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    ORDER BY e.start_at DESC
    LIMIT 20
  `, [])

  // Get popular songs for selected event
  const popularSongs = eventId ? await queryAll(c.env.DB, `
    SELECT 
      s.id, s.title, s.artist, s.type,
      COUNT(DISTINCT ks.user_id) as selection_count,
      GROUP_CONCAT(p.voornaam || ' ' || p.achternaam, ', ') as selected_by
    FROM karaoke_selections ks
    JOIN karaoke_songs s ON s.id = ks.song_id
    JOIN users u ON u.id = ks.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE ks.karaoke_event_id = ?
    GROUP BY s.id
    ORDER BY selection_count DESC, s.title ASC
  `, [eventId]) : []

  // Get duet suggestions (songs chosen by 2 people)
  const duetSuggestions = eventId ? await queryAll(c.env.DB, `
    SELECT 
      s.id, s.title, s.artist,
      u1.id as user1_id, p1.voornaam || ' ' || p1.achternaam as user1_name,
      u2.id as user2_id, p2.voornaam || ' ' || p2.achternaam as user2_name
    FROM karaoke_selections ks1
    JOIN karaoke_selections ks2 ON ks1.song_id = ks2.song_id AND ks1.user_id < ks2.user_id
    JOIN karaoke_songs s ON s.id = ks1.song_id
    JOIN users u1 ON u1.id = ks1.user_id
    JOIN profiles p1 ON p1.user_id = u1.id
    JOIN users u2 ON u2.id = ks2.user_id
    JOIN profiles p2 ON p2.user_id = u2.id
    WHERE ks1.karaoke_event_id = ?
      AND (s.type = 'duet' OR s.type = 'solo')
    ORDER BY s.title ASC
  `, [eventId]) : []

  // Get member participation stats
  const memberStats = eventId ? await queryAll(c.env.DB, `
    SELECT 
      u.id,
      p.voornaam || ' ' || p.achternaam as name,
      u.stemgroep,
      COUNT(ks.id) as song_count,
      GROUP_CONCAT(s.title, ' | ') as songs
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN karaoke_selections ks ON ks.user_id = u.id AND ks.karaoke_event_id = ?
    LEFT JOIN karaoke_songs s ON s.id = ks.song_id
    WHERE u.status = 'actief'
    GROUP BY u.id
    HAVING song_count > 0
    ORDER BY song_count DESC, name ASC
  `, [eventId]) : []

  return c.html(
    <Layout title="Duet Matching" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Karaoke', href: '/admin/karaoke' },
      { label: 'Matching', href: '/admin/karaoke/matching' }
    ]}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4">
          
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900 mb-4">
              <i class="fas fa-user-friends text-animato-primary mr-3"></i>
              Duet Matching & Statistics
            </h1>
            
            {/* Event Selector */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <form method="GET" class="flex items-center gap-4">
                <label class="text-sm font-medium text-gray-700">Selecteer event:</label>
                <select 
                  name="event" 
                  onchange="this.form.submit()"
                  class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="">Kies een event...</option>
                  {allEvents?.map((evt: any) => (
                    <option value={evt.id} selected={eventId === evt.id.toString()}>
                      {evt.titel} - {new Date(evt.start_at).toLocaleDateString('nl-NL')}
                    </option>
                  ))}
                </select>
              </form>
            </div>
          </div>

          {!eventId ? (
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 text-center py-12">
              <i class="fas fa-arrow-up text-gray-300 text-6xl mb-4"></i>
              <p class="text-gray-600">Selecteer een event om matching data te zien</p>
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div class="grid md:grid-cols-3 gap-6 mb-8">
                <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div class="text-3xl font-bold text-gray-900">{memberStats?.length || 0}</div>
                  <div class="text-gray-600">Leden hebben gekozen</div>
                </div>
                <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div class="text-3xl font-bold text-gray-900">{popularSongs?.length || 0}</div>
                  <div class="text-gray-600">Unieke songs gekozen</div>
                </div>
                <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div class="text-3xl font-bold text-gray-900">{duetSuggestions?.length || 0}</div>
                  <div class="text-gray-600">Mogelijke duets</div>
                </div>
              </div>

              <div class="grid lg:grid-cols-2 gap-6 mb-8">
                {/* Duet Suggestions */}
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h2 class="text-xl font-semibold text-gray-900 mb-4">
                    <i class="fas fa-heart text-red-500 mr-2"></i>
                    Automatische Duet Matches
                  </h2>
                  {duetSuggestions && duetSuggestions.length > 0 ? (
                    <div class="space-y-3">
                      {duetSuggestions.map((duet: any) => (
                        <div class="p-4 bg-purple-50 rounded-lg border border-purple-100">
                          <div class="font-medium text-gray-900 mb-2">
                            <i class="fas fa-music mr-2 text-purple-600"></i>
                            {duet.title}
                          </div>
                          <div class="text-sm text-gray-600 mb-2">{duet.artist}</div>
                          <div class="flex items-center gap-2 text-sm">
                            <span class="px-3 py-1 bg-white rounded-full border border-purple-200">
                              {duet.user1_name}
                            </span>
                            <i class="fas fa-plus text-purple-400"></i>
                            <span class="px-3 py-1 bg-white rounded-full border border-purple-200">
                              {duet.user2_name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p class="text-gray-500 text-center py-8">Geen overlappende keuzes gevonden</p>
                  )}
                </div>

                {/* Popular Songs */}
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h2 class="text-xl font-semibold text-gray-900 mb-4">
                    <i class="fas fa-fire text-orange-500 mr-2"></i>
                    Populairste Songs
                  </h2>
                  {popularSongs && popularSongs.length > 0 ? (
                    <div class="space-y-2">
                      {popularSongs.slice(0, 10).map((song: any, idx: number) => (
                        <div class="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors">
                          <div class="w-8 h-8 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center font-bold text-sm">
                            {idx + 1}
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="font-medium text-gray-900 truncate">{song.title}</div>
                            <div class="text-sm text-gray-600 truncate">{song.artist}</div>
                          </div>
                          <div class="text-right">
                            <div class="text-lg font-bold text-gray-900">{song.selection_count}×</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p class="text-gray-500 text-center py-8">Nog geen songs gekozen</p>
                  )}
                </div>
              </div>

              {/* Member Participation */}
              <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 class="text-xl font-semibold text-gray-900 mb-4">
                  <i class="fas fa-users text-animato-primary mr-2"></i>
                  Leden Participatie
                </h2>
                {memberStats && memberStats.length > 0 ? (
                  <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Naam</th>
                          <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stemgroep</th>
                          <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Songs</th>
                          <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aantal</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-200">
                        {memberStats.map((member: any) => (
                          <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3 text-sm text-gray-900">{member.name}</td>
                            <td class="px-4 py-3">
                              <span class={`px-2 py-1 text-xs font-medium rounded-full ${
                                member.stemgroep === 'S' ? 'bg-pink-100 text-pink-800' :
                                member.stemgroep === 'A' ? 'bg-purple-100 text-purple-800' :
                                member.stemgroep === 'T' ? 'bg-blue-100 text-blue-800' :
                                'bg-green-100 text-green-800'
                              }`}>
                                {member.stemgroep || 'N/A'}
                              </span>
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-600 truncate max-w-md">
                              {member.songs?.split(' | ').slice(0, 3).join(', ')}
                              {member.songs?.split(' | ').length > 3 && '...'}
                            </td>
                            <td class="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                              {member.song_count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p class="text-gray-500 text-center py-8">Nog geen selecties</p>
                )}
              </div>

              {/* Export Options */}
              <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
                <h2 class="text-xl font-semibold text-gray-900 mb-4">
                  <i class="fas fa-download text-animato-primary mr-2"></i>
                  Export Setlist
                </h2>
                <div class="flex gap-3">
                  <button 
                    onclick={`window.print()`}
                    class="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                  >
                    <i class="fas fa-print mr-2"></i>
                    Printen
                  </button>
                  <a 
                    href={`/admin/karaoke/export/${eventId}`}
                    class="px-6 py-2 bg-animato-primary hover:bg-animato-primary-dark text-white rounded-lg transition-colors"
                  >
                    <i class="fas fa-file-csv mr-2"></i>
                    Export naar CSV
                  </a>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </Layout>
  )
})

export default app
