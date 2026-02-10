// Karaoke Song Selection - Member Interface
// Members can browse songs and select their favorites for karaoke events

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Auth required
app.use('*', requireAuth)

// =====================================================
// KARAOKE EVENTS LIST (for members)
// =====================================================

app.get('/leden/karaoke', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Get open karaoke events
  const openEvents = await queryAll(c.env.DB, `
    SELECT 
      ke.*,
      e.titel,
      e.start_at,
      e.locatie,
      (SELECT COUNT(*) FROM karaoke_selections WHERE karaoke_event_id = ke.id AND user_id = ?) as my_selections
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    WHERE ke.status = 'open'
      AND (ke.selection_deadline IS NULL OR ke.selection_deadline >= datetime('now'))
    ORDER BY e.start_at ASC
  `, [user.id])

  return c.html(
    <Layout title="Karaoke" user={user}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4">
          
          <h1 class="text-3xl font-bold mb-8">
            <i class="fas fa-microphone text-animato-primary mr-3"></i>
            Karaoke Events
          </h1>

          {openEvents && openEvents.length > 0 ? (
            <div class="grid md:grid-cols-2 gap-6">
              {openEvents.map((event: any) => (
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h3 class="text-xl font-semibold text-gray-900 mb-2">{event.titel}</h3>
                  
                  <div class="space-y-2 text-sm text-gray-600 mb-4">
                    <div>
                      <i class="far fa-calendar mr-2"></i>
                      {new Date(event.start_at).toLocaleDateString('nl-NL', { 
                        weekday: 'long', 
                        day: 'numeric', 
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                    <div>
                      <i class="fas fa-map-marker-alt mr-2"></i>
                      {event.locatie}
                    </div>
                    {event.selection_deadline && (
                      <div class="text-orange-600 font-medium">
                        <i class="far fa-clock mr-2"></i>
                        Deadline: {new Date(event.selection_deadline).toLocaleDateString('nl-NL')}
                      </div>
                    )}
                  </div>

                  {event.intro_text && (
                    <p class="text-sm text-gray-700 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                      {event.intro_text}
                    </p>
                  )}

                  <div class="flex items-center justify-between pt-4 border-t border-gray-200">
                    <div class="text-sm">
                      {event.my_selections > 0 ? (
                        <span class="text-green-600 font-medium">
                          <i class="fas fa-check-circle mr-1"></i>
                          {event.my_selections}/{event.max_songs_per_member} songs gekozen
                        </span>
                      ) : (
                        <span class="text-gray-600">
                          <i class="fas fa-info-circle mr-1"></i>
                          Kies max. {event.max_songs_per_member} songs
                        </span>
                      )}
                    </div>
                    <a 
                      href={`/leden/karaoke/${event.id}/select`}
                      class="bg-animato-primary hover:bg-animato-primary-dark text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium inline-flex items-center"
                    >
                      {event.my_selections > 0 ? (
                        <>
                          <i class="fas fa-edit mr-2"></i>
                          Wijzig selectie
                        </>
                      ) : (
                        <>
                          <i class="fas fa-music mr-2"></i>
                          Songs kiezen
                        </>
                      )}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 text-center py-12">
              <i class="fas fa-calendar-times text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-lg font-medium text-gray-900 mb-2">Geen open karaoke events</h3>
              <p class="text-gray-600">Kom later terug wanneer er nieuwe karaoke avonden gepland zijn!</p>
            </div>
          )}

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// SONG SELECTION INTERFACE
// =====================================================

app.get('/leden/karaoke/:event_id/select', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = c.req.param('event_id')
  noCacheHeaders(c)

  const search = c.req.query('search') || ''
  const genre = c.req.query('genre') || 'all'
  const type = c.req.query('type') || 'all'

  // Get event details
  const event = await queryOne(c.env.DB, `
    SELECT ke.*, e.titel, e.start_at
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    WHERE ke.id = ?
  `, [eventId])

  if (!event || event.status !== 'open') {
    return c.redirect('/leden/karaoke?error=event_closed')
  }

  // Get my current selections
  const mySelections = await queryAll(c.env.DB, `
    SELECT ks.*, s.title, s.artist
    FROM karaoke_selections ks
    JOIN karaoke_songs s ON s.id = ks.song_id
    WHERE ks.karaoke_event_id = ? AND ks.user_id = ?
    ORDER BY ks.preference_order ASC
  `, [eventId, user.id])

  const selectedIds = mySelections.map((s: any) => s.song_id)

  // Build song query with filters
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
  if (type !== 'all') {
    conditions.push('type = ?')
    params.push(type)
  }

  const songs = await queryAll(c.env.DB, `
    SELECT *,
      CASE WHEN id IN (${selectedIds.join(',') || '0'}) THEN 1 ELSE 0 END as is_selected
    FROM karaoke_songs
    WHERE ${conditions.join(' AND ')}
    ORDER BY artist ASC, title ASC
    LIMIT 100
  `, params)

  const genres = await queryAll(c.env.DB, 'SELECT DISTINCT genre FROM karaoke_songs WHERE is_active = 1 AND genre IS NOT NULL ORDER BY genre', [])

  return c.html(
    <Layout title={`Song Selectie - ${event.titel}`} user={user}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4">
          
          <div class="mb-8">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900">
                  <i class="fas fa-music text-animato-primary mr-3"></i>
                  Kies je Songs
                </h1>
                <p class="text-gray-600 mt-2">{event.titel}</p>
              </div>
              <a 
                href="/leden/karaoke"
                class="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <i class="fas fa-arrow-left mr-2"></i>
                Terug
              </a>
            </div>
          </div>

          {/* My Selections */}
          {mySelections && mySelections.length > 0 && (
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h2 class="text-lg font-semibold text-gray-900 mb-4">
                <i class="fas fa-star text-yellow-400 mr-2"></i>
                Mijn Selectie ({mySelections.length}/{event.max_songs_per_member})
              </h2>
              <div class="space-y-2">
                {mySelections.map((sel: any, idx: number) => (
                  <div class="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                    <div class="flex items-center gap-3 flex-1">
                      <div class="w-8 h-8 bg-animato-primary text-white rounded-full flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div class="flex-1">
                        <div class="font-medium text-gray-900">{sel.title}</div>
                        <div class="text-sm text-gray-600">{sel.artist}</div>
                        {sel.notes && (
                          <div class="text-xs text-gray-500 mt-1">
                            <i class="fas fa-sticky-note mr-1"></i>
                            {sel.notes}
                          </div>
                        )}
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <a 
                        href={`/leden/karaoke/${eventId}/note/${sel.id}`}
                        class="text-blue-600 hover:text-blue-800 transition-colors px-2"
                        title="Notitie toevoegen"
                      >
                        <i class="fas fa-comment-dots"></i>
                      </a>
                      <a 
                        href={`/leden/karaoke/${eventId}/remove/${sel.id}`}
                        class="text-red-600 hover:text-red-800 transition-colors px-2"
                        title="Verwijderen"
                      >
                        <i class="fas fa-times-circle"></i>
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {event.allow_duets && (
                <div class="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <h3 class="font-semibold text-purple-900 mb-3">
                    <i class="fas fa-user-friends mr-2"></i>
                    Wil je een duet doen?
                  </h3>
                  <p class="text-sm text-purple-800 mb-3">
                    Voeg een notitie toe aan je song keuze met wie je graag samen wilt zingen, of geef aan dat je open staat voor suggesties van de organisatie.
                  </p>
                  <p class="text-xs text-purple-700">
                    <i class="fas fa-lightbulb mr-1"></i>
                    Tip: Klik op het notitie icoon <i class="fas fa-comment-dots mx-1"></i> naast je song keuze
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <form method="GET" class="grid md:grid-cols-4 gap-4">
              <div class="md:col-span-2">
                <input 
                  type="text" 
                  name="search" 
                  value={search}
                  placeholder="Zoek op titel of artiest..." 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                />
              </div>
              <div>
                <select 
                  name="genre" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all">Alle genres</option>
                  {genres?.map((g: any) => (
                    <option value={g.genre} selected={genre === g.genre}>{g.genre}</option>
                  ))}
                </select>
              </div>
              <div>
                <select 
                  name="type" 
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all">Alle types</option>
                  <option value="solo" selected={type === 'solo'}>Solo</option>
                  <option value="duet" selected={type === 'duet'}>Duet</option>
                  <option value="group" selected={type === 'group'}>Groep</option>
                </select>
              </div>
            </form>
          </div>

          {/* Songs Grid */}
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {songs?.map((song: any) => (
              <div class={`bg-white rounded-lg shadow-sm border p-4 transition-all ${
                song.is_selected ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-animato-primary'
              }`}>
                <div class="flex items-start justify-between mb-2">
                  <div class="flex-1 min-w-0">
                    <h3 class="font-medium text-gray-900 truncate">{song.title}</h3>
                    <p class="text-sm text-gray-600 truncate">{song.artist}</p>
                  </div>
                  {song.is_selected && (
                    <i class="fas fa-check-circle text-green-500 text-xl ml-2"></i>
                  )}
                </div>
                
                <div class="flex items-center gap-2 mb-3 text-xs">
                  <span class="px-2 py-1 bg-gray-100 text-gray-700 rounded">{song.genre || 'Onbekend'}</span>
                  {song.type === 'duet' && <span class="px-2 py-1 bg-purple-100 text-purple-700 rounded">Duet</span>}
                  {song.difficulty && (
                    <span class={`px-2 py-1 rounded ${
                      song.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                      song.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {song.difficulty === 'easy' ? 'Makkelijk' :
                       song.difficulty === 'medium' ? 'Gemiddeld' : 'Moeilijk'}
                    </span>
                  )}
                </div>

                {song.is_selected ? (
                  <button 
                    disabled
                    class="w-full px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed"
                  >
                    <i class="fas fa-check mr-2"></i>
                    Geselecteerd
                  </button>
                ) : mySelections.length >= event.max_songs_per_member ? (
                  <button 
                    disabled
                    class="w-full px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed text-sm"
                  >
                    Limiet bereikt
                  </button>
                ) : (
                  <a 
                    href={`/leden/karaoke/${eventId}/add/${song.id}`}
                    class="block w-full px-4 py-2 bg-animato-primary hover:bg-animato-primary-dark text-white text-center rounded-lg transition-colors"
                  >
                    <i class="fas fa-plus mr-2"></i>
                    Selecteren
                  </a>
                )}
              </div>
            ))}
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// ADD SONG TO SELECTION
// =====================================================

app.get('/leden/karaoke/:event_id/add/:song_id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = c.req.param('event_id')
  const songId = c.req.param('song_id')

  // Check if already at max
  const count = await queryOne(c.env.DB, `
    SELECT COUNT(*) as count FROM karaoke_selections 
    WHERE karaoke_event_id = ? AND user_id = ?
  `, [eventId, user.id])

  const event = await queryOne(c.env.DB, 'SELECT max_songs_per_member FROM karaoke_events WHERE id = ?', [eventId])

  if (count && count.count >= event?.max_songs_per_member) {
    return c.redirect(`/leden/karaoke/${eventId}/select?error=max_reached`)
  }

  // Add selection
  await execute(c.env.DB, `
    INSERT OR IGNORE INTO karaoke_selections (karaoke_event_id, user_id, song_id, preference_order)
    VALUES (?, ?, ?, ?)
  `, [eventId, user.id, songId, (count?.count || 0) + 1])

  // Update song popularity
  await execute(c.env.DB, `
    UPDATE karaoke_songs 
    SET popularity_score = popularity_score + 1 
    WHERE id = ?
  `, [songId])

  return c.redirect(`/leden/karaoke/${eventId}/select?success=added`)
})

// =====================================================
// REMOVE SONG FROM SELECTION
// =====================================================

app.get('/leden/karaoke/:event_id/remove/:selection_id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = c.req.param('event_id')
  const selectionId = c.req.param('selection_id')

  await execute(c.env.DB, `
    DELETE FROM karaoke_selections 
    WHERE id = ? AND user_id = ?
  `, [selectionId, user.id])

  return c.redirect(`/leden/karaoke/${eventId}/select?success=removed`)
})

// =====================================================
// ADD NOTE / DUET PARTNER
// =====================================================

app.get('/leden/karaoke/:event_id/note/:selection_id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = c.req.param('event_id')
  const selectionId = c.req.param('selection_id')
  noCacheHeaders(c)

  const selection = await queryOne(c.env.DB, `
    SELECT ks.*, s.title, s.artist
    FROM karaoke_selections ks
    JOIN karaoke_songs s ON s.id = ks.song_id
    WHERE ks.id = ? AND ks.user_id = ?
  `, [selectionId, user.id])

  if (!selection) {
    return c.redirect(`/leden/karaoke/${eventId}/select?error=not_found`)
  }

  const event = await queryOne(c.env.DB, `
    SELECT ke.*, e.titel
    FROM karaoke_events ke
    JOIN events e ON e.id = ke.event_id
    WHERE ke.id = ?
  `, [eventId])

  return c.html(
    <Layout title="Notitie Toevoegen" user={user}>
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-2xl mx-auto px-4">
          
          <h1 class="text-3xl font-bold mb-8">
            <i class="fas fa-comment-dots text-animato-primary mr-3"></i>
            Notitie Toevoegen
          </h1>

          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-2">{selection.title}</h2>
            <p class="text-sm text-gray-600">{selection.artist}</p>
          </div>

          <form method="POST" action={`/leden/karaoke/${eventId}/note/${selectionId}/save`} class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Jouw notitie of duet wens
              </label>
              <textarea 
                name="notes" 
                rows={4}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                placeholder="Bijv: 'Ik wil dit graag als duet zingen met Jan', of 'Ik zing liever de hoge partij', of 'Ik sta open voor duet suggesties'"
              >{selection.notes}</textarea>
              <p class="text-sm text-gray-500 mt-2">
                <i class="fas fa-info-circle mr-1"></i>
                Deze notitie is zichtbaar voor de organisatie om duets te kunnen matchen
              </p>
            </div>

            <div class="flex justify-end gap-3">
              <a 
                href={`/leden/karaoke/${eventId}/select`}
                class="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                Annuleren
              </a>
              <button 
                type="submit"
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-2 rounded-lg transition-colors"
              >
                <i class="fas fa-save mr-2"></i>
                Opslaan
              </button>
            </div>
          </form>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// SAVE NOTE (POST)
// =====================================================

app.post('/leden/karaoke/:event_id/note/:selection_id/save', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = c.req.param('event_id')
  const selectionId = c.req.param('selection_id')
  
  const formData = await c.req.formData()
  const notes = formData.get('notes')?.toString() || null

  await execute(c.env.DB, `
    UPDATE karaoke_selections 
    SET notes = ?
    WHERE id = ? AND user_id = ?
  `, [notes, selectionId, user.id])

  return c.redirect(`/leden/karaoke/${eventId}/select?success=note_saved`)
})

export default app
