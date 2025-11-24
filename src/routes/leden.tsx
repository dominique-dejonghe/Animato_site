// Ledenportaal routes
// Dashboard, Materiaal, Messageboard, Profiel

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware to all leden routes
app.use('*', requireAuth)

// =====================================================
// LEDENPORTAAL DASHBOARD
// =====================================================

app.get('/leden', async (c) => {
  const user = c.get('user') as SessionUser
  const welcome = c.req.query('welcome')

  // Get upcoming events for this user's stemgroep
  const upcomingEvents = await queryAll(
    c.env.DB,
    `SELECT id, type, titel, start_at, locatie, doelgroep
     FROM events
     WHERE start_at >= datetime('now')
       AND (doelgroep = 'all' OR doelgroep LIKE ?)
     ORDER BY start_at ASC
     LIMIT 5`,
    [`%${user.stemgroep || ''}%`]
  )

  // Get latest nieuws for members
  const nieuws = await queryAll(
    c.env.DB,
    `SELECT id, titel, slug, published_at
     FROM posts
     WHERE type = 'nieuws' 
       AND is_published = 1
       AND (zichtbaarheid = 'publiek' OR zichtbaarheid = 'leden')
     ORDER BY published_at DESC
     LIMIT 3`
  )

  // Get latest board posts
  const boardPosts = await queryAll(
    c.env.DB,
    `SELECT p.id, p.titel, p.slug, p.created_at, p.categorie, p.is_pinned,
            u.id as auteur_id, pr.voornaam as auteur_voornaam
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.type = 'board'
       AND p.is_published = 1
       AND (p.zichtbaarheid = 'leden' OR p.zichtbaarheid = ?)
     ORDER BY p.is_pinned DESC, p.created_at DESC
     LIMIT 5`,
    [user.stemgroep?.toLowerCase() || 'admin']
  )

  // Get latest materials for user's stemgroep
  const materials = await queryAll(
    c.env.DB,
    `SELECT m.id, m.titel, m.type, m.created_at,
            pi.titel as stuk_titel,
            w.titel as werk_titel, w.componist
     FROM materials m
     JOIN pieces pi ON pi.id = m.piece_id
     JOIN works w ON w.id = pi.work_id
     WHERE m.is_actief = 1
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen')
       AND (m.zichtbaar_voor = 'alle_leden' OR 
            (m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem'))
     ORDER BY m.created_at DESC
     LIMIT 5`,
    [user.stemgroep || 'SATB']
  )

  return c.html(
    <Layout title="Ledenportaal" user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Welcome message */}
          {welcome && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-6 mb-8 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 text-3xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-semibold text-green-800">
                    Welkom bij Animato, {user.voornaam}!
                  </h3>
                  <p class="text-green-700">
                    Je account is succesvol aangemaakt. Veel plezier in het ledenportaal!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div class="mb-8">
            <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              Welkom, {user.voornaam}!
            </h1>
            <p class="text-gray-600 text-lg">
              Je bent ingelogd als {user.role === 'admin' ? 'Administrator' : 
                                    user.role === 'moderator' ? 'Moderator' :
                                    user.role === 'stemleider' ? 'Stemleider' : 'Lid'}
              {user.stemgroep && ` • Stemgroep: ${
                user.stemgroep === 'S' ? 'Sopraan' :
                user.stemgroep === 'A' ? 'Alt' :
                user.stemgroep === 'T' ? 'Tenor' :
                'Bas'
              }`}
            </p>
          </div>

          {/* Quick actions */}
          <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
            <a
              href="/leden/materiaal"
              class="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center"
            >
              <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-3">
                <i class="fas fa-file-audio text-animato-primary text-2xl"></i>
              </div>
              <h3 class="font-semibold text-gray-900 mb-1">
                <i class="fas fa-music text-animato-primary mr-2"></i>
                Materiaal
              </h3>
              <p class="text-sm text-gray-600">Partituren & oefentracks</p>
            </a>

            <a
              href="/leden/board"
              class="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center"
            >
              <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-3">
                <i class="fas fa-comments text-animato-primary text-xl"></i>
              </div>
              <h3 class="font-semibold text-gray-900 mb-1">Messageboard</h3>
              <p class="text-sm text-gray-600">Berichten & discussies</p>
            </a>

            <a
              href="/leden/smoelenboek"
              class="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center"
            >
              <div class="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i class="fas fa-users text-pink-600 text-xl"></i>
              </div>
              <h3 class="font-semibold text-gray-900 mb-1">Onze Zangers</h3>
              <p class="text-sm text-gray-600">Leer je mede-leden kennen</p>
            </a>

            <a
              href="/leden/agenda"
              class="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center"
            >
              <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-3">
                <i class="far fa-calendar text-animato-primary text-xl"></i>
              </div>
              <h3 class="font-semibold text-gray-900 mb-1">Agenda</h3>
              <p class="text-sm text-gray-600">Repetities & concerten</p>
            </a>

            <a
              href="/leden/profiel"
              class="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center"
            >
              <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-3">
                <i class="fas fa-user text-animato-primary text-xl"></i>
              </div>
              <h3 class="font-semibold text-gray-900 mb-1">Profiel</h3>
              <p class="text-sm text-gray-600">Mijn gegevens</p>
            </a>
          </div>

          {/* Main content grid */}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left column - Events & News */}
            <div class="lg:col-span-2 space-y-8">
              {/* Upcoming events */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-2xl font-bold text-gray-900">
                    <i class="far fa-calendar mr-2 text-animato-primary"></i>
                    Aankomende Activiteiten
                  </h2>
                  <a href="/leden/agenda" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {upcomingEvents.length > 0 ? (
                  <div class="space-y-3">
                    {upcomingEvents.map((event: any) => (
                      <div class="border-l-4 border-animato-primary bg-gray-50 p-4 rounded">
                        <div class="flex items-start justify-between">
                          <div>
                            <span class={`inline-block px-2 py-1 rounded text-xs font-semibold mb-2 ${
                              event.type === 'concert' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {event.type === 'concert' ? 'Concert' : 'Repetitie'}
                            </span>
                            <h3 class="font-semibold text-gray-900">{event.titel}</h3>
                            <p class="text-sm text-gray-600 mt-1">
                              <i class="far fa-calendar mr-1"></i>
                              {new Date(event.start_at).toLocaleDateString('nl-BE', { 
                                weekday: 'short', 
                                day: 'numeric', 
                                month: 'short' 
                              })}
                              {' • '}
                              <i class="fas fa-map-marker-alt mr-1"></i>
                              {event.locatie}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-center py-8">
                    Geen aankomende activiteiten
                  </p>
                )}
              </div>

              {/* Latest news */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-2xl font-bold text-gray-900">
                    <i class="far fa-newspaper mr-2 text-animato-primary"></i>
                    Laatste Nieuws
                  </h2>
                  <a href="/nieuws" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {nieuws.length > 0 ? (
                  <div class="space-y-3">
                    {nieuws.map((item: any) => (
                      <a 
                        href={`/nieuws/${item.slug}`}
                        class="block border-b border-gray-200 pb-3 last:border-0 hover:bg-gray-50 p-2 rounded transition"
                      >
                        <div class="text-animato-primary text-xs mb-1">
                          {new Date(item.published_at).toLocaleDateString('nl-BE')}
                        </div>
                        <h3 class="font-semibold text-gray-900 hover:text-animato-primary">
                          {item.titel}
                        </h3>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-center py-8">
                    Geen nieuws beschikbaar
                  </p>
                )}
              </div>
            </div>

            {/* Right column - Board & Materials */}
            <div class="space-y-8">
              {/* Latest board posts */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-comments mr-2 text-animato-primary"></i>
                    Board
                  </h2>
                  <a href="/leden/board" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {boardPosts.length > 0 ? (
                  <div class="space-y-3">
                    {boardPosts.map((post: any) => (
                      <a 
                        href={`/leden/board/${post.id}`}
                        class="block bg-gray-50 p-3 rounded hover:bg-gray-100 transition"
                      >
                        {post.is_pinned && (
                          <i class="fas fa-thumbtack text-animato-primary text-xs mr-2"></i>
                        )}
                        <h4 class="font-semibold text-sm text-gray-900 line-clamp-1">
                          {post.titel}
                        </h4>
                        <p class="text-xs text-gray-600 mt-1">
                          {post.auteur_voornaam} • {new Date(post.created_at).toLocaleDateString('nl-BE')}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-sm text-center py-4">
                    Geen berichten
                  </p>
                )}
              </div>

              {/* Latest materials */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-file-music mr-2 text-animato-primary"></i>
                    Nieuw Materiaal
                  </h2>
                  <a href="/leden/materiaal" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {materials.length > 0 ? (
                  <div class="space-y-3">
                    {materials.map((mat: any) => (
                      <div class="bg-gray-50 p-3 rounded">
                        <div class="flex items-center justify-between mb-1">
                          <span class={`text-xs font-semibold ${
                            mat.type === 'pdf' ? 'text-red-600' :
                            mat.type === 'audio' ? 'text-green-600' :
                            'text-blue-600'
                          }`}>
                            <i class={`fas ${
                              mat.type === 'pdf' ? 'fa-file-pdf' :
                              mat.type === 'audio' ? 'fa-file-audio' :
                              'fa-file-archive'
                            } mr-1`}></i>
                            {mat.type.toUpperCase()}
                          </span>
                          <span class="text-xs text-gray-500">
                            {new Date(mat.created_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <h4 class="font-semibold text-sm text-gray-900 line-clamp-1">
                          {mat.titel}
                        </h4>
                        <p class="text-xs text-gray-600 mt-1">
                          {mat.werk_titel} - {mat.stuk_titel}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-sm text-center py-4">
                    Geen nieuw materiaal
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// MESSAGEBOARD OVERZICHT
// =====================================================

app.get('/leden/board', async (c) => {
  const user = c.get('user') as SessionUser
  const categorie = c.req.query('cat') || 'all'
  const search = c.req.query('search') || ''

  // Build query
  let query = `
    SELECT p.id, p.titel, p.slug, p.created_at, p.categorie, p.is_pinned, p.views,
           u.id as auteur_id, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam,
           (SELECT COUNT(*) FROM post_replies WHERE post_id = p.id AND is_deleted = 0) as reply_count
    FROM posts p
    LEFT JOIN users u ON u.id = p.auteur_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.type = 'board' 
      AND p.is_published = 1
      AND (p.zichtbaarheid = 'leden' OR p.zichtbaarheid = ?)
  `

  const filters: any[] = [user.stemgroep?.toLowerCase() || 'algemeen']

  if (categorie !== 'all') {
    query += ` AND p.categorie = ?`
    filters.push(categorie)
  }

  if (search) {
    query += ` AND (p.titel LIKE ? OR p.body LIKE ?)`
    const searchTerm = `%${search}%`
    filters.push(searchTerm, searchTerm)
  }

  query += ` ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 50`

  const threads = await queryAll(c.env.DB, query, filters)

  return c.html(
    <Layout title="Messageboard" user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                Messageboard
              </h1>
              <p class="text-gray-600">
                Communiceer met andere koorleden
              </p>
            </div>
            <a href="/leden" class="text-animato-primary hover:underline">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar dashboard
            </a>
          </div>

          {/* Search & Filter */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-8">
            <div class="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <form method="GET" class="flex-1">
                <input type="hidden" name="cat" value={categorie} />
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                  </div>
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek in berichten..."
                    class="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </form>

              {/* Category filter */}
              <div class="flex flex-wrap gap-2">
                <a
                  href="/leden/board?cat=all"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'all'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Alle
                </a>
                <a
                  href="/leden/board?cat=algemeen"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'algemeen'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Algemeen
                </a>
                <a
                  href="/leden/board?cat=sopraan"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'sopraan'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Sopraan
                </a>
                <a
                  href="/leden/board?cat=alt"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'alt'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Alt
                </a>
                <a
                  href="/leden/board?cat=tenor"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'tenor'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Tenor
                </a>
                <a
                  href="/leden/board?cat=bas"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'bas'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Bas
                </a>
                <a
                  href="/leden/board?cat=bestuur"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'bestuur'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Bestuur
                </a>
              </div>
            </div>
          </div>

          {/* Threads list */}
          {threads.length > 0 ? (
            <div class="space-y-4">
              {threads.map((thread: any) => (
                <a
                  href={`/leden/board/${thread.id}`}
                  class="block bg-white rounded-lg shadow-md hover:shadow-lg transition p-6"
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        {thread.is_pinned && (
                          <i class="fas fa-thumbtack text-animato-primary"></i>
                        )}
                        <span class={`px-3 py-1 rounded-full text-xs font-semibold ${
                          thread.categorie === 'algemeen' ? 'bg-gray-100 text-gray-800' :
                          thread.categorie === 'sopraan' ? 'bg-pink-100 text-pink-800' :
                          thread.categorie === 'alt' ? 'bg-purple-100 text-purple-800' :
                          thread.categorie === 'tenor' ? 'bg-blue-100 text-blue-800' :
                          thread.categorie === 'bas' ? 'bg-green-100 text-green-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {thread.categorie.charAt(0).toUpperCase() + thread.categorie.slice(1)}
                        </span>
                      </div>
                      <h3 class="text-xl font-bold text-gray-900 mb-2 hover:text-animato-primary">
                        {thread.titel}
                      </h3>
                      <div class="flex items-center text-sm text-gray-600 gap-4">
                        <span>
                          <i class="far fa-user mr-1"></i>
                          {thread.auteur_voornaam} {thread.auteur_achternaam}
                        </span>
                        <span>
                          <i class="far fa-calendar mr-1"></i>
                          {new Date(thread.created_at).toLocaleDateString('nl-BE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                        <span>
                          <i class="far fa-comment mr-1"></i>
                          {thread.reply_count} reacties
                        </span>
                        <span>
                          <i class="far fa-eye mr-1"></i>
                          {thread.views} views
                        </span>
                      </div>
                    </div>
                    <i class="fas fa-chevron-right text-gray-400 ml-4"></i>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-comments text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">
                Geen berichten gevonden
              </h3>
              <p class="text-gray-600">
                {search ? 'Probeer een andere zoekopdracht' : 'Nog geen berichten in deze categorie'}
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// MESSAGEBOARD THREAD DETAIL
// =====================================================

app.get('/leden/board/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const threadId = c.req.param('id')

  // Get thread
  const thread = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.id = ? AND p.type = 'board'`,
    [threadId]
  )

  if (!thread) {
    return c.notFound()
  }

  // Check visibility
  if (thread.zichtbaarheid !== 'leden' && thread.zichtbaarheid !== user.stemgroep?.toLowerCase()) {
    return c.json({ error: 'Geen toegang tot dit bericht' }, 403)
  }

  // Increment views
  await c.env.DB.prepare(
    'UPDATE posts SET views = views + 1 WHERE id = ?'
  ).bind(threadId).run()

  // Get replies
  const replies = await queryAll<any>(
    c.env.DB,
    `SELECT r.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM post_replies r
     LEFT JOIN users u ON u.id = r.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE r.post_id = ? AND r.is_deleted = 0
     ORDER BY r.created_at ASC`,
    [threadId]
  )

  return c.html(
    <Layout title={thread.titel} user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back button */}
          <a href="/leden/board" class="inline-flex items-center text-animato-primary hover:underline mb-6">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar messageboard
          </a>

          {/* Thread */}
          <div class="bg-white rounded-lg shadow-md p-8 mb-6">
            <div class="flex items-center gap-3 mb-4">
              {thread.is_pinned && (
                <i class="fas fa-thumbtack text-animato-primary"></i>
              )}
              <span class={`px-3 py-1 rounded-full text-xs font-semibold ${
                thread.categorie === 'algemeen' ? 'bg-gray-100 text-gray-800' :
                thread.categorie === 'sopraan' ? 'bg-pink-100 text-pink-800' :
                thread.categorie === 'alt' ? 'bg-purple-100 text-purple-800' :
                thread.categorie === 'tenor' ? 'bg-blue-100 text-blue-800' :
                thread.categorie === 'bas' ? 'bg-green-100 text-green-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {thread.categorie.charAt(0).toUpperCase() + thread.categorie.slice(1)}
              </span>
            </div>

            <h1 class="text-3xl font-bold text-gray-900 mb-4">
              {thread.titel}
            </h1>

            <div class="flex items-center text-sm text-gray-600 gap-4 mb-6 pb-6 border-b">
              <div class="flex items-center">
                <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-2">
                  <i class="fas fa-user text-animato-primary"></i>
                </div>
                <div>
                  <div class="font-medium text-gray-900">
                    {thread.auteur_voornaam} {thread.auteur_achternaam}
                  </div>
                  <div class="text-xs">
                    {new Date(thread.created_at).toLocaleDateString('nl-BE', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </div>
                </div>
              </div>
              <span class="text-gray-300">•</span>
              <span>
                <i class="far fa-eye mr-1"></i>
                {thread.views + 1} views
              </span>
            </div>

            <div 
              class="prose prose-lg max-w-none"
              dangerouslySetInnerHTML={{ __html: thread.body }}
            />
          </div>

          {/* Replies */}
          <div class="space-y-4">
            <h2 class="text-2xl font-bold text-gray-900">
              {replies.length} Reacties
            </h2>

            {replies.map((reply: any) => (
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-start gap-4">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-user text-animato-primary"></i>
                  </div>
                  <div class="flex-1">
                    <div class="flex items-center justify-between mb-2">
                      <div>
                        <div class="font-semibold text-gray-900">
                          {reply.auteur_voornaam} {reply.auteur_achternaam}
                        </div>
                        <div class="text-xs text-gray-600">
                          {new Date(reply.created_at).toLocaleDateString('nl-BE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                    <div class="prose" dangerouslySetInnerHTML={{ __html: reply.body }} />
                  </div>
                </div>
              </div>
            ))}

            {/* Reply form placeholder */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                Plaats een reactie
              </h3>
              <div class="bg-gray-50 rounded-lg p-8 text-center">
                <i class="fas fa-comment-dots text-gray-300 text-4xl mb-3"></i>
                <p class="text-gray-600">
                  Reactiefunctionaliteit komt binnenkort beschikbaar!
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// PROFIEL BEWERKEN
// =====================================================

app.get('/leden/profiel', async (c) => {
  const user = c.get('user') as SessionUser
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get full profile
  const profile = await queryOne<any>(
    c.env.DB,
    `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
            p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
            p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
            p.favoriete_werk, p.instrument, p.jaren_in_koor,
            p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [user.id]
  )

  // If no profile exists, create one
  if (!profile || !profile.voornaam) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO profiles (user_id, voornaam, achternaam, smoelenboek_zichtbaar, toon_email, toon_telefoon)
         VALUES (?, ?, ?, 1, 1, 0)`
      ).bind(user.id, user.voornaam || 'Nieuwe', user.achternaam || 'Gebruiker').run()
      
      // Retry fetching the profile
      const newProfile = await queryOne<any>(
        c.env.DB,
        `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
                p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
                p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
                p.favoriete_werk, p.instrument, p.jaren_in_koor,
                p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = ?`,
        [user.id]
      )
      
      if (newProfile) {
        // Use the newly created profile
        Object.assign(profile || {}, newProfile)
      }
    } catch (error) {
      console.error('Failed to create profile:', error)
      return c.redirect('/leden?error=profile_creation_failed')
    }
  }

  return c.html(
    <Layout 
      title="Mijn Profiel" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Mijn Profiel', href: '/leden/profiel' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-user-circle text-animato-primary mr-3"></i>
              Mijn Profiel
            </h1>
            <p class="mt-2 text-gray-600">
              Beheer je persoonlijke gegevens en voorkeuren
            </p>
          </div>

          {/* Success/Error Messages */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 mr-3"></i>
                <div class="text-sm text-green-800">
                  {success === 'profile' && 'Je profiel is succesvol bijgewerkt'}
                  {success === 'password' && 'Je wachtwoord is succesvol gewijzigd'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
                <div class="text-sm text-red-800">
                  {error === 'invalid_password' && 'Huidig wachtwoord is onjuist'}
                  {error === 'password_mismatch' && 'Nieuwe wachtwoorden komen niet overeen'}
                  {error === 'password_too_short' && 'Wachtwoord moet minimaal 8 tekens lang zijn'}
                  {error === 'update_failed' && 'Er is iets misgegaan bij het bijwerken'}
                  {error === 'profile_not_found' && 'Profiel niet gevonden'}
                </div>
              </div>
            </div>
          )}

          {/* Profile Info Card */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="flex items-center mb-6 pb-6 border-b border-gray-200">
              <div class="w-20 h-20 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                {profile.profielfoto_url ? (
                  <img 
                    src={profile.profielfoto_url} 
                    alt={`${profile.voornaam} ${profile.achternaam}`}
                    class="w-full h-full object-cover"
                  />
                ) : (
                  <span>{profile.voornaam?.charAt(0) || 'U'}{profile.achternaam?.charAt(0) || ''}</span>
                )}
              </div>
              <div class="ml-6">
                <h2 class="text-2xl font-bold text-gray-900">
                  {profile.voornaam} {profile.achternaam}
                </h2>
                <div class="flex items-center gap-4 mt-2 text-sm text-gray-600">
                  <span>
                    <i class="fas fa-music mr-1 text-animato-primary"></i>
                    {profile.stemgroep === 'S' && 'Sopraan'}
                    {profile.stemgroep === 'A' && 'Alt'}
                    {profile.stemgroep === 'T' && 'Tenor'}
                    {profile.stemgroep === 'B' && 'Bas'}
                    {!profile.stemgroep && 'Geen stemgroep'}
                  </span>
                  <span>
                    <i class="fas fa-shield-alt mr-1 text-animato-accent"></i>
                    {profile.role === 'admin' && 'Beheerder'}
                    {profile.role === 'moderator' && 'Moderator'}
                    {profile.role === 'stemleider' && 'Stemleider'}
                    {profile.role === 'lid' && 'Lid'}
                    {profile.role === 'bezoeker' && 'Bezoeker'}
                  </span>
                  <span>
                    <i class="fas fa-calendar mr-1 text-gray-400"></i>
                    Lid sinds {new Date(profile.created_at).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit Profile Form */}
            <form action="/api/leden/profiel" method="POST" class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label for="voornaam" class="block text-sm font-medium text-gray-700 mb-1">
                    Voornaam *
                  </label>
                  <input
                    type="text"
                    id="voornaam"
                    name="voornaam"
                    value={profile.voornaam || ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="achternaam" class="block text-sm font-medium text-gray-700 mb-1">
                    Achternaam *
                  </label>
                  <input
                    type="text"
                    id="achternaam"
                    name="achternaam"
                    value={profile.achternaam || ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Profielfoto
                </label>
                <div class="flex items-start gap-4">
                  <div class="flex-1 space-y-3">
                    {/* File Upload - Simple approach with file reader */}
                    <div>
                      <label 
                        for="foto-upload" 
                        class="cursor-pointer inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                      >
                        <i class="fas fa-upload mr-2"></i>
                        Upload foto
                      </label>
                      <input
                        type="file"
                        id="foto-upload"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        class="hidden"
                      />
                      <span class="ml-3 text-xs text-gray-500">
                        of
                      </span>
                    </div>
                    
                    {/* URL Input */}
                    <div>
                      <input
                        type="url"
                        id="profielfoto_url"
                        name="profielfoto_url"
                        value={profile.profielfoto_url || ''}
                        placeholder="https://example.com/mijn-foto.jpg"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <p class="mt-1 text-xs text-gray-500">
                        Plak een foto URL of upload een bestand (max 5MB). Ondersteunt JPG, PNG, GIF, WEBP.
                      </p>
                      <script dangerouslySetInnerHTML={{
                        __html: `
                          (function() {
                            const urlInput = document.getElementById('profielfoto_url');
                            if (!urlInput) return;
                            
                            urlInput.addEventListener('input', function(e) {
                              const preview = document.getElementById('foto-preview');
                              const placeholder = document.getElementById('foto-placeholder');
                              if (e.target.value) {
                                preview.src = e.target.value;
                                preview.classList.remove('hidden');
                                if (placeholder) placeholder.classList.add('hidden');
                              } else {
                                preview.classList.add('hidden');
                                if (placeholder) placeholder.classList.remove('hidden');
                              }
                            });
                          })();
                        `
                      }}></script>
                    </div>
                  </div>
                  
                  {/* Preview */}
                  <div class="w-24 h-24 border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
                    {profile.profielfoto_url ? (
                      <>
                        <img 
                          id="foto-preview"
                          src={profile.profielfoto_url} 
                          alt="Foto preview" 
                          class="w-full h-full object-cover"
                        />
                        <div id="foto-placeholder" class="hidden text-gray-400 text-center p-2">
                          <i class="fas fa-image text-2xl"></i>
                          <p class="text-xs mt-1">Preview</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <img 
                          id="foto-preview"
                          src="" 
                          alt="Foto preview" 
                          class="w-full h-full object-cover hidden"
                        />
                        <div id="foto-placeholder" class="text-gray-400 text-center p-2">
                          <i class="fas fa-image text-2xl"></i>
                          <p class="text-xs mt-1">Preview</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                  Email adres
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={profile.email}
                  disabled
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Email adres kan niet worden gewijzigd. Neem contact op met de beheerder als dit nodig is.
                </p>
              </div>

              <div>
                <label for="telefoon" class="block text-sm font-medium text-gray-700 mb-1">
                  Telefoonnummer
                </label>
                <input
                  type="tel"
                  id="telefoon"
                  name="telefoon"
                  value={profile.telefoon || ''}
                  placeholder="+32 123 45 67 89"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="stemgroep" class="block text-sm font-medium text-gray-700 mb-1">
                  Stemgroep *
                </label>
                <select
                  id="stemgroep"
                  name="stemgroep"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="">-- Kies je stemgroep --</option>
                  <option value="S" selected={profile.stemgroep === 'S'}>Sopraan</option>
                  <option value="A" selected={profile.stemgroep === 'A'}>Alt</option>
                  <option value="T" selected={profile.stemgroep === 'T'}>Tenor</option>
                  <option value="B" selected={profile.stemgroep === 'B'}>Bas</option>
                </select>
                <p class="mt-1 text-xs text-gray-500">
                  <i class="fas fa-music mr-1 text-animato-primary"></i>
                  Je zangroep bepaalt welk materiaal en events je ziet
                </p>
              </div>

              <div>
                <label for="adres" class="block text-sm font-medium text-gray-700 mb-1">
                  Adres
                </label>
                <textarea
                  id="adres"
                  name="adres"
                  rows={2}
                  placeholder="Straat 123, 1000 Brussel"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{profile.adres || ''}</textarea>
              </div>

              <div>
                <label for="bio" class="block text-sm font-medium text-gray-700 mb-1">
                  Bio
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  rows={3}
                  placeholder="Vertel iets over jezelf..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{profile.bio || ''}</textarea>
                <p class="mt-1 text-xs text-gray-500">
                  Optioneel - wordt getoond op je ledenprofiel
                </p>
              </div>

              <div>
                <label for="muzikale_ervaring" class="block text-sm font-medium text-gray-700 mb-1">
                  Muzikale ervaring
                </label>
                <textarea
                  id="muzikale_ervaring"
                  name="muzikale_ervaring"
                  rows={3}
                  placeholder="Eerdere koorervaring, instrumenten, opleidingen..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{profile.muzikale_ervaring || ''}</textarea>
              </div>

              {/* Smoelenboek Fields */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-heart text-red-500 mr-2"></i>
                  Muzikale Voorkeuren (Smoelenboek)
                </h3>
                <p class="text-sm text-gray-600 mb-4">
                  Deze informatie wordt getoond in het smoelenboek zodat andere leden je beter leren kennen.
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="favoriete_genre" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete genre
                    </label>
                    <input
                      type="text"
                      id="favoriete_genre"
                      name="favoriete_genre"
                      value={String(profile.favoriete_genre || '')}
                      placeholder="Bijv. Barok, Romantiek, Jazz..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="favoriete_componist" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete componist
                    </label>
                    <input
                      type="text"
                      id="favoriete_componist"
                      name="favoriete_componist"
                      value={String(profile.favoriete_componist || '')}
                      placeholder="Bijv. J.S. Bach, Mozart..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="favoriete_werk" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete muziekwerk
                    </label>
                    <input
                      type="text"
                      id="favoriete_werk"
                      name="favoriete_werk"
                      value={String(profile.favoriete_werk || '')}
                      placeholder="Bijv. Requiem van Fauré..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="instrument" class="block text-sm font-medium text-gray-700 mb-1">
                      Instrument (optioneel)
                    </label>
                    <input
                      type="text"
                      id="instrument"
                      name="instrument"
                      value={String(profile.instrument || '')}
                      placeholder="Bijv. Piano, Gitaar..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="jaren_in_koor" class="block text-sm font-medium text-gray-700 mb-1">
                      Jaren in dit koor
                    </label>
                    <input
                      type="number"
                      id="jaren_in_koor"
                      name="jaren_in_koor"
                      value={profile.jaren_in_koor || 0}
                      min="0"
                      max="100"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="zanger_type" class="block text-sm font-medium text-gray-700 mb-1">
                      Soort zanger
                    </label>
                    <select
                      id="zanger_type"
                      name="zanger_type"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="amateur" selected={profile.zanger_type === 'amateur'}>Amateur</option>
                      <option value="semi-professioneel" selected={profile.zanger_type === 'semi-professioneel'}>Semi-professioneel</option>
                      <option value="professioneel" selected={profile.zanger_type === 'professioneel'}>Professioneel</option>
                      <option value="student" selected={profile.zanger_type === 'student'}>Student</option>
                    </select>
                  </div>
                </div>

                {/* Hidden fields - Privacy settings always enabled */}
                <input type="hidden" name="smoelenboek_zichtbaar" value="1" />
                <input type="hidden" name="toon_email" value="1" />
                <input type="hidden" name="toon_telefoon" value="1" />
              </div>

              <div class="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <a
                  href="/leden"
                  class="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Annuleren
                </a>
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition-colors"
                >
                  <i class="fas fa-save mr-2"></i>
                  Profiel Opslaan
                </button>
              </div>
            </form>
            

            {/* Photo Upload Script */}
            <script dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  const fileInput = document.getElementById('foto-upload');
                  if (!fileInput) return;
                  
                  fileInput.addEventListener('change', function(e) {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    // Check file size (max 5MB)
                    if (file.size > 5 * 1024 * 1024) {
                      alert('Bestand is te groot. Maximum 5MB toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    // Check file type
                    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    if (!allowedTypes.includes(file.type)) {
                      alert('Ongeldig bestandstype. Alleen JPG, PNG, GIF en WEBP zijn toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    // Show uploading state
                    const uploadBtn = document.querySelector('label[for="foto-upload"]');
                    const originalText = uploadBtn?.innerHTML;
                    if (uploadBtn) {
                      uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Bezig...';
                    }
                    
                    // Use FileReader to convert to data URL
                    const reader = new FileReader();
                    reader.onload = function(event) {
                      const dataUrl = event.target.result;
                      
                      // Update URL input with data URL
                      const urlInput = document.getElementById('profielfoto_url');
                      if (urlInput && dataUrl) {
                        urlInput.value = dataUrl;
                        
                        // Update preview
                        const preview = document.getElementById('foto-preview');
                        const placeholder = document.getElementById('foto-placeholder');
                        if (preview) {
                          preview.src = dataUrl;
                          preview.classList.remove('hidden');
                          if (placeholder) placeholder.classList.add('hidden');
                        }
                      }
                      
                      // Show success
                      if (uploadBtn && originalText) {
                        uploadBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Geladen!';
                        setTimeout(function() {
                          uploadBtn.innerHTML = originalText;
                        }, 2000);
                      }
                    };
                    
                    reader.onerror = function() {
                      alert('Fout bij het laden van de foto. Probeer het opnieuw.');
                      if (uploadBtn && originalText) {
                        uploadBtn.innerHTML = originalText;
                      }
                    };
                    
                    reader.readAsDataURL(file);
                  });
                })();
              `
            }}></script>
          </div>

          {/* Change Password Card */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-lock text-animato-accent mr-2"></i>
              Wachtwoord wijzigen
            </h3>
            
            <form action="/api/leden/profiel/wachtwoord" method="POST" class="space-y-4">
              <div>
                <label for="current_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Huidig wachtwoord *
                </label>
                <input
                  type="password"
                  id="current_password"
                  name="current_password"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="new_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Nieuw wachtwoord *
                </label>
                <input
                  type="password"
                  id="new_password"
                  name="new_password"
                  required
                  minlength={8}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Minimaal 8 tekens
                </p>
              </div>

              <div>
                <label for="confirm_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Bevestig nieuw wachtwoord *
                </label>
                <input
                  type="password"
                  id="confirm_password"
                  name="confirm_password"
                  required
                  minlength={8}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div class="flex justify-end pt-4">
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-accent text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <i class="fas fa-key mr-2"></i>
                  Wachtwoord Wijzigen
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// PROFIEL BEWERKEN API - Update Profile
// =====================================================


// =====================================================
// PROFIEL BEWERKEN API - Change Password
// =====================================================

app.post('/api/leden/profiel/wachtwoord', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const { current_password, new_password, confirm_password } = body

    // Validation
    if (!current_password || !new_password || !confirm_password) {
      return c.redirect('/leden/profiel?error=required_fields')
    }

    if (new_password !== confirm_password) {
      return c.redirect('/leden/profiel?error=password_mismatch')
    }

    if ((new_password as string).length < 8) {
      return c.redirect('/leden/profiel?error=password_too_short')
    }

    // Get current password hash
    const userRecord = await queryOne<any>(
      c.env.DB,
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    )

    if (!userRecord) {
      return c.redirect('/leden/profiel?error=user_not_found')
    }

    // Verify current password
    const { verifyPassword } = await import('../utils/auth')
    const isValid = await verifyPassword(current_password as string, userRecord.password_hash)

    if (!isValid) {
      return c.redirect('/leden/profiel?error=invalid_password')
    }

    // Hash new password
    const { hashPassword } = await import('../utils/auth')
    const newHash = await hashPassword(new_password as string)

    // Update password
    const result = await c.env.DB.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).bind(newHash, user.id).run()

    if (!result.success) {
      return c.redirect('/leden/profiel?error=update_failed')
    }

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'password_change', 'user', ?, ?)`
    ).bind(
      user.id,
      user.id,
      JSON.stringify({ method: 'self_service' })
    ).run()

    return c.redirect('/leden/profiel?success=password')
  } catch (error) {
    console.error('Password change error:', error)
    return c.redirect('/leden/profiel?error=update_failed')
  }
})

// =====================================================
// MATERIAAL OVERZICHT
// =====================================================

app.get('/leden/materiaal', async (c) => {
  const user = c.get('user') as SessionUser
  const filter = c.req.query('stem') || 'all'

  // Get all works with pieces and materials
  const works = await queryAll(
    c.env.DB,
    `SELECT DISTINCT w.id, w.componist, w.titel, w.beschrijving, w.genre
     FROM works w
     JOIN pieces p ON p.work_id = w.id
     JOIN materials m ON m.piece_id = p.id
     WHERE m.is_actief = 1
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen' OR ? = 'all')
       AND (m.zichtbaar_voor = 'alle_leden' OR 
            ((m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem') AND m.stem = ?))
     ORDER BY w.componist, w.titel`,
    [user.stemgroep, filter, user.stemgroep]
  )

  // For each work, get pieces with materials
  const worksWithMaterials = await Promise.all(
    works.map(async (work: any) => {
      const pieces = await queryAll(
        c.env.DB,
        `SELECT p.id, p.titel, p.nummer, p.moeilijkheidsgraad
         FROM pieces p
         WHERE p.work_id = ?
         ORDER BY p.nummer`,
        [work.id]
      )

      const piecesWithMaterials = await Promise.all(
        pieces.map(async (piece: any) => {
          const materials = await queryAll(
            c.env.DB,
            `SELECT m.*
             FROM materials m
             WHERE m.piece_id = ? 
               AND m.is_actief = 1
               AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen' OR ? = 'all')
               AND (m.zichtbaar_voor = 'alle_leden' OR 
                    ((m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem') AND m.stem = ?))
             ORDER BY 
               CASE m.type 
                 WHEN 'pdf' THEN 1 
                 WHEN 'audio' THEN 2 
                 WHEN 'video' THEN 3 
                 ELSE 4 
               END,
               m.stem, m.versie DESC`,
            [piece.id, user.stemgroep, filter, user.stemgroep]
          )
          return { ...piece, materials }
        })
      )

      return { ...work, pieces: piecesWithMaterials }
    })
  )

  return c.html(
    <Layout title="Materiaal" user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                Partituren & Oefenmateriaal
              </h1>
              <p class="text-gray-600">
                Download partituren en oefentracks voor jouw stemgroep
              </p>
            </div>
            <a href="/leden" class="text-animato-primary hover:underline">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar dashboard
            </a>
          </div>

          {/* Filter tabs */}
          <div class="bg-white rounded-lg shadow-md p-4 mb-8">
            <div class="flex items-center space-x-2">
              <span class="text-sm font-medium text-gray-700 mr-4">Filter:</span>
              <a
                href="/leden/materiaal?stem=all"
                class={`px-4 py-2 rounded-lg font-semibold transition ${
                  filter === 'all'
                    ? 'bg-animato-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Alles
              </a>
              <a
                href={`/leden/materiaal?stem=${user.stemgroep}`}
                class={`px-4 py-2 rounded-lg font-semibold transition ${
                  filter === user.stemgroep
                    ? 'bg-animato-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Mijn stem ({user.stemgroep === 'S' ? 'Sopraan' : user.stemgroep === 'A' ? 'Alt' : user.stemgroep === 'T' ? 'Tenor' : 'Bas'})
              </a>
              <a
                href="/leden/materiaal?stem=SATB"
                class={`px-4 py-2 rounded-lg font-semibold transition ${
                  filter === 'SATB'
                    ? 'bg-animato-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                SATB (Alle stemmen)
              </a>
            </div>
          </div>

          {/* Works list */}
          {worksWithMaterials.length > 0 ? (
            <div class="space-y-8">
              {worksWithMaterials.map((work: any) => (
                <div class="bg-white rounded-lg shadow-md overflow-hidden">
                  {/* Work header */}
                  <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white p-6">
                    <a href={`/leden/werk/${work.id}`} class="block hover:opacity-90 transition">
                      <h2 class="text-2xl font-bold mb-1 flex items-center" style="font-family: 'Playfair Display', serif;">
                        {work.titel}
                        <i class="fas fa-external-link-alt ml-3 text-lg opacity-75"></i>
                      </h2>
                    </a>
                    <p class="text-gray-100">
                      <i class="fas fa-user-edit mr-2"></i>
                      {work.componist}
                      {work.genre && (
                        <span class="ml-4">
                          <i class="fas fa-tag mr-2"></i>
                          {work.genre}
                        </span>
                      )}
                    </p>
                    {work.beschrijving && (
                      <p class="text-sm text-gray-200 mt-2 whitespace-pre-line">{work.beschrijving}</p>
                    )}
                  </div>

                  {/* Pieces */}
                  <div class="p-6">
                    {work.pieces.map((piece: any) => (
                      <div class="mb-6 last:mb-0">
                        <div class="flex items-center justify-between mb-3">
                          <div>
                            <h3 class="text-lg font-bold text-gray-900">
                              {piece.nummer && `${piece.nummer}. `}
                              {piece.titel}
                            </h3>
                            {piece.moeilijkheidsgraad && (
                              <span class={`inline-block px-2 py-1 rounded text-xs font-semibold mt-1 ${
                                piece.moeilijkheidsgraad === 'beginner' ? 'bg-green-100 text-green-800' :
                                piece.moeilijkheidsgraad === 'gemiddeld' ? 'bg-yellow-100 text-yellow-800' :
                                piece.moeilijkheidsgraad === 'gevorderd' ? 'bg-orange-100 text-orange-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {piece.moeilijkheidsgraad.charAt(0).toUpperCase() + piece.moeilijkheidsgraad.slice(1)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Materials */}
                        {piece.materials.length > 0 ? (
                          <div class="space-y-3">
                            {piece.materials.map((material: any) => (
                                // File Download or External Link
                                <a
                                  href={material.url}
                                  download={material.type !== 'link'}
                                  target="_blank"
                                  class="flex items-center justify-between bg-gray-50 hover:bg-gray-100 p-4 rounded-lg border border-gray-200 transition group"
                                >
                                  <div class="flex items-center flex-1 min-w-0">
                                    <div class={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${
                                      material.type === 'pdf' ? 'bg-red-100' :
                                      material.type === 'audio' ? 'bg-green-100' :
                                      material.type === 'video' ? 'bg-blue-100' :
                                      material.type === 'link' ? 'bg-purple-100' :
                                      'bg-gray-100'
                                    }`}>
                                      <i class={`fas ${
                                        material.type === 'pdf' ? 'fa-file-pdf text-red-600' :
                                        material.type === 'audio' ? 'fa-file-audio text-green-600' :
                                        material.type === 'video' ? 'fa-file-video text-blue-600' :
                                        material.type === 'link' ? 'fa-link text-purple-600' :
                                        'fa-file-archive text-gray-600'
                                      }`}></i>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                      <div class="font-semibold text-gray-900 truncate group-hover:text-animato-primary">
                                        {material.titel}
                                      </div>
                                      <div class="text-xs text-gray-600">
                                        <span class="font-semibold">{
                                          material.stem === 'S' ? 'Sopraan' :
                                          material.stem === 'A' ? 'Alt' :
                                          material.stem === 'T' ? 'Tenor' :
                                          material.stem === 'B' ? 'Bas' :
                                          material.stem === 'SATB' ? 'Alle stemmen' :
                                          material.stem
                                        }</span>
                                        {material.versie > 1 && ` • v${material.versie}`}
                                        {material.grootte_bytes && ` • ${(material.grootte_bytes / 1024 / 1024).toFixed(1)} MB`}
                                      </div>
                                    </div>
                                  </div>
                                  <i class={`fas ${material.type === 'link' ? 'fa-external-link-alt' : 'fa-download'} text-animato-primary ml-3`}></i>
                                </a>
                            ))}
                          </div>
                        ) : (
                          <p class="text-gray-500 text-sm italic">
                            Nog geen materiaal beschikbaar voor dit stuk
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-folder-open text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">
                Geen materiaal beschikbaar
              </h3>
              <p class="text-gray-600">
                Er is momenteel geen materiaal beschikbaar voor jouw stemgroep.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// WERK DETAIL (WORK DETAIL)
// =====================================================

app.get('/leden/werk/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const werkId = c.req.param('id')

  // Get work with all pieces and materials
  const work = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM works WHERE id = ?`,
    [werkId]
  )

  if (!work) {
    return c.redirect('/leden/materiaal?error=not_found')
  }

  // Get all pieces for this work
  const pieces = await queryAll(
    c.env.DB,
    `SELECT * FROM pieces WHERE work_id = ? ORDER BY nummer`,
    [werkId]
  )

  // For each piece, get materials visible to this user
  const piecesWithMaterials = await Promise.all(
    pieces.map(async (piece: any) => {
      const materials = await queryAll(
        c.env.DB,
        `SELECT m.*
         FROM materials m
         WHERE m.piece_id = ? 
           AND m.is_actief = 1
           AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen')
           AND (m.zichtbaar_voor = 'alle_leden' OR 
                ((m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem') AND m.stem = ?))
         ORDER BY 
           CASE m.type 
             WHEN 'pdf' THEN 1 
             WHEN 'audio' THEN 2 
             WHEN 'video' THEN 3 
             ELSE 4 
           END,
           m.stem, m.versie DESC`,
        [piece.id, user.stemgroep, user.stemgroep]
      )
      return { ...piece, materials }
    })
  )

  return c.html(
    <Layout 
      title={`${work.titel} - ${work.componist}`}
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Materiaal', href: '/leden/materiaal' },
        { label: work.titel, href: `/leden/werk/${werkId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Back button */}
          <div class="mb-6">
            <a 
              href="/leden/materiaal"
              class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
            >
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar materiaal
            </a>
          </div>

          {/* Work header */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden mb-8">
            <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white p-8">
              <h1 class="text-4xl font-bold mb-3" style="font-family: 'Playfair Display', serif;">
                {work.titel}
              </h1>
              <div class="flex flex-wrap items-center gap-4 text-lg">
                <div class="flex items-center">
                  <i class="fas fa-user-edit mr-2"></i>
                  {work.componist}
                </div>
                {work.genre && (
                  <div class="flex items-center">
                    <i class="fas fa-tag mr-2"></i>
                    {work.genre}
                  </div>
                )}
                {work.jaar && (
                  <div class="flex items-center">
                    <i class="fas fa-calendar mr-2"></i>
                    {work.jaar}
                  </div>
                )}
              </div>
              {work.beschrijving && (
                <p class="text-gray-100 mt-4 text-base whitespace-pre-line">{work.beschrijving}</p>
              )}
            </div>

            {/* Pieces and Materials */}
            <div class="p-8">
              {piecesWithMaterials.length > 0 ? (
                <div class="space-y-8">
                  {piecesWithMaterials.map((piece: any, index: number) => (
                    <div class={`${index > 0 ? 'pt-8 border-t border-gray-200' : ''}`}>
                      {/* Piece header */}
                      <div class="mb-4">
                        <h2 class="text-2xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                          {piece.nummer && `${piece.nummer}. `}
                          {piece.titel}
                        </h2>
                        {piece.moeilijkheidsgraad && (
                          <span class={`inline-block px-3 py-1 rounded-full text-sm font-semibold mt-2 ${
                            piece.moeilijkheidsgraad === 'beginner' ? 'bg-green-100 text-green-800' :
                            piece.moeilijkheidsgraad === 'gemiddeld' ? 'bg-yellow-100 text-yellow-800' :
                            piece.moeilijkheidsgraad === 'gevorderd' ? 'bg-orange-100 text-orange-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            <i class="fas fa-signal mr-1"></i>
                            {piece.moeilijkheidsgraad.charAt(0).toUpperCase() + piece.moeilijkheidsgraad.slice(1)}
                          </span>
                        )}
                      </div>

                      {/* Materials list */}
                      {piece.materials.length > 0 ? (
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {piece.materials.map((material: any) => (
                            <a
                              href={material.url}
                              download={material.type !== 'link'}
                              target="_blank"
                              class="flex items-center justify-between bg-gray-50 hover:bg-gray-100 p-4 rounded-lg border border-gray-200 transition group"
                            >
                              <div class="flex items-center flex-1 min-w-0">
                                <div class={`w-12 h-12 rounded-lg flex items-center justify-center mr-4 ${
                                  material.type === 'pdf' ? 'bg-red-100' :
                                  material.type === 'audio' ? 'bg-green-100' :
                                  material.type === 'video' ? 'bg-blue-100' :
                                  material.type === 'link' ? 'bg-purple-100' :
                                  'bg-gray-100'
                                }`}>
                                  <i class={`fas text-xl ${
                                    material.type === 'pdf' ? 'fa-file-pdf text-red-600' :
                                    material.type === 'audio' ? 'fa-file-audio text-green-600' :
                                    material.type === 'video' ? 'fa-file-video text-blue-600' :
                                    material.type === 'link' ? 'fa-link text-purple-600' :
                                    'fa-file-archive text-gray-600'
                                  }`}></i>
                                </div>
                                <div class="flex-1 min-w-0">
                                  <div class="font-semibold text-gray-900 truncate group-hover:text-animato-primary">
                                    {material.titel}
                                  </div>
                                  <div class="text-sm text-gray-600 flex items-center gap-2 mt-1">
                                    <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      material.stem === 'S' ? 'bg-pink-100 text-pink-800' :
                                      material.stem === 'A' ? 'bg-purple-100 text-purple-800' :
                                      material.stem === 'T' ? 'bg-blue-100 text-blue-800' :
                                      material.stem === 'B' ? 'bg-indigo-100 text-indigo-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {material.stem === 'S' ? 'Sopraan' :
                                       material.stem === 'A' ? 'Alt' :
                                       material.stem === 'T' ? 'Tenor' :
                                       material.stem === 'B' ? 'Bas' :
                                       material.stem === 'SATB' ? 'Alle stemmen' :
                                       material.stem}
                                    </span>
                                    {material.versie > 1 && <span>• v{material.versie}</span>}
                                    {material.grootte_bytes && <span>• {(material.grootte_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                                  </div>
                                </div>
                              </div>
                              <i class={`fas ${material.type === 'link' ? 'fa-external-link-alt' : 'fa-download'} text-animato-primary text-xl ml-4`}></i>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p class="text-gray-500 italic text-center py-8 bg-gray-50 rounded-lg">
                          Geen materiaal beschikbaar voor dit stuk
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div class="text-center py-12">
                  <i class="fas fa-music text-gray-300 text-6xl mb-4"></i>
                  <p class="text-gray-500 text-lg">
                    Nog geen stukken toegevoegd aan dit werk
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// SMOELENBOEK (MEMBER DIRECTORY)
// =====================================================

app.get('/leden/smoelenboek', async (c) => {
  const user = c.get('user') as SessionUser
  const stemgroep = c.req.query('stemgroep') || 'all'
  const view = c.req.query('view') || 'tiles' // tiles or list
  const search = c.req.query('search') || ''

  // First, get ALL members for accurate counts (without stemgroep filter)
  let countQuery = `
    SELECT u.id, u.stemgroep
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.status IN ('actief', 'proeflid') AND u.role IN ('lid', 'stemleider', 'moderator', 'admin')
      AND p.smoelenboek_zichtbaar = 1
  `
  const allMembers = await queryAll(c.env.DB, countQuery, [])
  
  // Calculate accurate counts from all members
  const counts = {
    'Sopraan': allMembers.filter((m: any) => m.stemgroep === 'S').length,
    'Alt': allMembers.filter((m: any) => m.stemgroep === 'A').length,
    'Tenor': allMembers.filter((m: any) => m.stemgroep === 'T').length,
    'Bas': allMembers.filter((m: any) => m.stemgroep === 'B').length
  }
  const totalCount = allMembers.length

  // Now get the filtered members for display with their full profile data
  let query = `
    SELECT u.id, u.email, u.stemgroep, u.role,
           p.voornaam, p.achternaam, p.telefoon, p.bio, p.muzikale_ervaring, 
           p.foto_url, p.favoriete_genre, p.favoriete_componist, p.favoriete_werk,
           p.instrument, p.jaren_in_koor, p.zanger_type, p.smoelenboek_zichtbaar, p.toon_telefoon, p.toon_email
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.status IN ('actief', 'proeflid') AND u.role IN ('lid', 'stemleider', 'moderator', 'admin')
      AND p.smoelenboek_zichtbaar = 1
  `
  const params: any[] = []

  // Search filter
  if (search) {
    query += ` AND (p.voornaam LIKE ? OR p.achternaam LIKE ? OR p.favoriete_genre LIKE ? OR p.favoriete_componist LIKE ?)`
    const searchTerm = `%${search}%`
    params.push(searchTerm, searchTerm, searchTerm, searchTerm)
  }

  if (stemgroep !== 'all') {
    query += ` AND u.stemgroep = ?`
    params.push(stemgroep)
  }

  // Sort alphabetically by first name
  query += ` ORDER BY p.voornaam, p.achternaam`

  const members = await queryAll(c.env.DB, query, params)

  // Map stemgroep codes to full names
  const stemgroepMap: Record<string, string> = {
    'S': 'Sopraan',
    'A': 'Alt',
    'T': 'Tenor',
    'B': 'Bas'
  }
  
  // Group by stemgroep with proper mapping
  const grouped = members.reduce((acc: any, member: any) => {
    const stemCode = member.stemgroep || 'overig'
    const stemName = stemgroepMap[stemCode] || 'Overig'
    if (!acc[stemName]) acc[stemName] = []
    acc[stemName].push(member)
    return acc
  }, {})

  return c.html(
    <Layout 
      title="Onze Zangers" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Onze Zangers', href: '/leden/smoelenboek' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header with Search and View Toggle */}
          <div class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-users text-pink-600 mr-3"></i>
                Onze Zangers
              </h1>
              <p class="mt-2 text-gray-600">
                Ontmoet je mede-koorleden en leer elkaar kennen
              </p>
            </div>
            
            {/* View Toggle */}
            <div class="flex items-center gap-2">
              <a
                href={`/leden/smoelenboek?view=tiles&stemgroep=${stemgroep}${search ? `&search=${search}` : ''}`}
                class={`px-4 py-2 rounded-lg transition ${
                  view === 'tiles'
                    ? 'bg-animato-primary text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                }`}
              >
                <i class="fas fa-th mr-2"></i>
                Tiles
              </a>
              <a
                href={`/leden/smoelenboek?view=list&stemgroep=${stemgroep}${search ? `&search=${search}` : ''}`}
                class={`px-4 py-2 rounded-lg transition ${
                  view === 'list'
                    ? 'bg-animato-primary text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                }`}
              >
                <i class="fas fa-list mr-2"></i>
                Lijst
              </a>
            </div>
          </div>

          {/* Search Bar */}
          <div class="bg-white rounded-lg shadow-md p-4 mb-6">
            <form action="/leden/smoelenboek" method="GET" class="flex flex-col md:flex-row gap-4">
              <input 
                type="hidden" 
                name="view" 
                value={view}
              />
              <input 
                type="hidden" 
                name="stemgroep" 
                value={stemgroep}
              />
              <div class="flex-1">
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                  </div>
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek op naam, genre, componist..."
                    class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>
              <button
                type="submit"
                class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
              >
                <i class="fas fa-search mr-2"></i>
                Zoeken
              </button>
              {search && (
                <a
                  href={`/leden/smoelenboek?view=${view}&stemgroep=${stemgroep}`}
                  class="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  <i class="fas fa-times mr-2"></i>
                  Wissen
                </a>
              )}
            </form>
          </div>

          {/* Filter Tabs */}
          <div class="bg-white rounded-lg shadow-md mb-6">
            <div class="border-b border-gray-200">
              <nav class="flex -mb-px overflow-x-auto">
                <a
                  href={`/leden/smoelenboek?stemgroep=all&view=${view}${search ? `&search=${search}` : ''}`}
                  class={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                    stemgroep === 'all'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-users mr-2"></i>
                  Alle Leden ({totalCount})
                </a>
                <a
                  href={`/leden/smoelenboek?stemgroep=S&view=${view}${search ? `&search=${search}` : ''}`}
                  class={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                    stemgroep === 'S'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-music mr-2"></i>
                  Sopraan ({counts.Sopraan})
                </a>
                <a
                  href={`/leden/smoelenboek?stemgroep=A&view=${view}${search ? `&search=${search}` : ''}`}
                  class={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                    stemgroep === 'A'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-music mr-2"></i>
                  Alt ({counts.Alt})
                </a>
                <a
                  href={`/leden/smoelenboek?stemgroep=T&view=${view}${search ? `&search=${search}` : ''}`}
                  class={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                    stemgroep === 'T'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-music mr-2"></i>
                  Tenor ({counts.Tenor})
                </a>
                <a
                  href={`/leden/smoelenboek?stemgroep=B&view=${view}${search ? `&search=${search}` : ''}`}
                  class={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                    stemgroep === 'B'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-music mr-2"></i>
                  Bas ({counts.Bas})
                </a>
              </nav>
            </div>
          </div>

          {/* Members Display */}
          {Object.keys(grouped).length > 0 ? (
            Object.keys(grouped).sort((a, b) => {
              // Custom sort order: Sopraan, Alt, Tenor, Bas, Overige
              const order = ['Sopraan', 'Alt', 'Tenor', 'Bas', 'Overige']
              const indexA = order.indexOf(a)
              const indexB = order.indexOf(b)
              // If both found, use order array
              if (indexA !== -1 && indexB !== -1) return indexA - indexB
              // If only A found, put it first
              if (indexA !== -1) return -1
              // If only B found, put it first
              if (indexB !== -1) return 1
              // Otherwise alphabetical
              return a.localeCompare(b)
            }).map((stem) => (
              <div class="mb-8">
                {stemgroep === 'all' && (
                  <h2 class="text-2xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-music text-animato-primary mr-2"></i>
                    {stem}
                  </h2>
                )}
                
                {/* Tiles View */}
                {view === 'tiles' && (
                  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {grouped[stem].map((member: any) => (
                    <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition">
                      
                      {/* Profile Header with Photo */}
                      <div class="relative">
                        {/* Cover gradient */}
                        <div class="h-24 bg-gradient-to-r from-animato-primary to-animato-secondary"></div>
                        
                        {/* Profile Photo */}
                        <div class="absolute -bottom-12 left-6">
                          <div class="w-24 h-24 rounded-full border-4 border-white shadow-lg overflow-hidden bg-gray-200">
                            {member.foto_url ? (
                              <img 
                                src={member.foto_url} 
                                alt={`${member.voornaam} ${member.achternaam}`}
                                class="w-full h-full object-cover"
                              />
                            ) : (
                              <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary text-white text-2xl font-bold">
                                {member.voornaam?.charAt(0) || 'U'}{member.achternaam?.charAt(0) || ''}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Role Badge */}
                        {(member.role === 'stemleider' || member.role === 'moderator' || member.role === 'admin') && (
                          <div class="absolute top-3 right-3">
                            <span class="px-3 py-1 bg-white/90 backdrop-blur-sm text-animato-primary rounded-full text-xs font-semibold shadow-lg">
                              <i class="fas fa-star mr-1"></i>
                              {member.role === 'stemleider' && 'Stemleider'}
                              {member.role === 'moderator' && 'Moderator'}
                              {member.role === 'admin' && 'Admin'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Member Info */}
                      <div class="pt-14 px-6 pb-6">
                        {/* Name and Voice */}
                        <div class="mb-3">
                          <h3 class="text-xl font-bold text-gray-900">
                            {member.voornaam} {member.achternaam}
                          </h3>
                          <div class="flex items-center gap-2 mt-1">
                            <span class="inline-flex items-center px-2 py-1 bg-animato-primary/10 text-animato-primary rounded text-xs font-semibold">
                              <i class="fas fa-music mr-1"></i>
                              {stemgroepMap[member.stemgroep] || 'Lid'}
                            </span>
                            {member.jaren_in_koor > 0 && (
                              <span class="text-xs text-gray-500">
                                • {member.jaren_in_koor} {member.jaren_in_koor === 1 ? 'jaar' : 'jaar'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Bio */}
                        {member.bio && (
                          <p class="text-sm text-gray-600 mb-4 leading-relaxed whitespace-pre-line">
                            {member.bio}
                          </p>
                        )}

                        {/* Musical Preferences */}
                        <div class="space-y-2 mb-4">
                          {member.favoriete_genre && (
                            <div class="flex items-start text-sm">
                              <i class="fas fa-heart text-red-500 mt-0.5 mr-2 flex-shrink-0"></i>
                              <div>
                                <span class="text-gray-500">Genre:</span>
                                <span class="text-gray-700 font-medium ml-1">{member.favoriete_genre}</span>
                              </div>
                            </div>
                          )}
                          {member.favoriete_componist && (
                            <div class="flex items-start text-sm">
                              <i class="fas fa-user-music text-purple-500 mt-0.5 mr-2 flex-shrink-0"></i>
                              <div>
                                <span class="text-gray-500">Componist:</span>
                                <span class="text-gray-700 font-medium ml-1">{member.favoriete_componist}</span>
                              </div>
                            </div>
                          )}
                          {member.favoriete_werk && (
                            <div class="flex items-start text-sm">
                              <i class="fas fa-star text-amber-500 mt-0.5 mr-2 flex-shrink-0"></i>
                              <div>
                                <span class="text-gray-500">Favoriet werk:</span>
                                <span class="text-gray-700 font-medium ml-1">{member.favoriete_werk}</span>
                              </div>
                            </div>
                          )}
                          {member.instrument && (
                            <div class="flex items-start text-sm">
                              <i class="fas fa-guitar text-green-500 mt-0.5 mr-2 flex-shrink-0"></i>
                              <div>
                                <span class="text-gray-500">Instrument:</span>
                                <span class="text-gray-700 font-medium ml-1">{member.instrument}</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Contact Info */}
                        <div class="pt-4 border-t border-gray-200 space-y-2">
                          {member.toon_email && member.email && (
                            <a 
                              href={`mailto:${member.email}`} 
                              class="flex items-center text-sm text-animato-primary hover:text-animato-secondary transition"
                            >
                              <i class="fas fa-envelope w-5"></i>
                              <span class="truncate">Stuur email</span>
                            </a>
                          )}
                          {member.toon_telefoon && member.telefoon && (
                            <div class="flex items-center text-sm text-gray-600">
                              <i class="fas fa-phone w-5"></i>
                              <span>{member.telefoon}</span>
                            </div>
                          )}
                          
                          {/* Edit Button (only for own profile) */}
                          {member.id === user.id && (
                            <a 
                              href="/leden/profiel" 
                              class="flex items-center text-sm text-amber-600 hover:text-amber-700 transition font-semibold"
                            >
                              <i class="fas fa-edit w-5"></i>
                              <span>Bewerk profiel</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  </div>
                )}

                {/* List View */}
                {view === 'list' && (
                  <div class="bg-white rounded-lg shadow-md overflow-hidden">
                    <div class="overflow-x-auto">
                      <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Naam</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stemgroep</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Genre</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Componist</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jaren</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                          </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                          {grouped[stem].map((member: any) => (
                            <tr class="hover:bg-gray-50 transition">
                              <td class="px-6 py-4 whitespace-nowrap">
                                <div class="flex items-center">
                                  <div class="flex-shrink-0 h-10 w-10">
                                    {member.foto_url ? (
                                      <img 
                                        src={member.foto_url} 
                                        alt={`${member.voornaam} ${member.achternaam}`}
                                        class="h-10 w-10 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div class="h-10 w-10 rounded-full bg-gradient-to-br from-animato-primary to-animato-secondary flex items-center justify-center text-white text-sm font-bold">
                                        {member.voornaam?.charAt(0)}{member.achternaam?.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                  <div class="ml-4">
                                    <div class="text-sm font-medium text-gray-900">
                                      {member.voornaam} {member.achternaam}
                                      {member.id === user.id && (
                                        <a href="/leden/profiel" class="ml-2 text-amber-600 hover:text-amber-700">
                                          <i class="fas fa-edit text-xs"></i>
                                        </a>
                                      )}
                                    </div>
                                    {(member.role === 'stemleider' || member.role === 'moderator' || member.role === 'admin') && (
                                      <div class="text-xs text-animato-primary">
                                        <i class="fas fa-star mr-1"></i>
                                        {member.role === 'stemleider' && 'Stemleider'}
                                        {member.role === 'moderator' && 'Moderator'}
                                        {member.role === 'admin' && 'Admin'}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td class="px-6 py-4 whitespace-nowrap">
                                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-animato-primary/10 text-animato-primary">
                                  {stem}
                                </span>
                              </td>
                              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {member.favoriete_genre || '-'}
                              </td>
                              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {member.favoriete_componist || '-'}
                              </td>
                              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {member.jaren_in_koor || 0}
                              </td>
                              <td class="px-6 py-4 whitespace-nowrap text-sm">
                                <div class="flex items-center space-x-2">
                                  {member.toon_email && member.email && (
                                    <a 
                                      href={`mailto:${member.email}`}
                                      class="text-animato-primary hover:text-animato-secondary"
                                      title="Stuur email"
                                    >
                                      <i class="fas fa-envelope"></i>
                                    </a>
                                  )}
                                  {member.toon_telefoon && member.telefoon && (
                                    <span class="text-gray-600" title={member.telefoon}>
                                      <i class="fas fa-phone"></i>
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-users text-gray-300 text-5xl mb-4"></i>
              <p class="text-gray-600 text-lg">
                Geen leden gevonden
              </p>
            </div>
          )}

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// AGENDA (MEMBER VIEW)
// =====================================================

app.get('/leden/agenda', async (c) => {
  const user = c.get('user') as SessionUser
  const type = c.req.query('type') || 'all'
  const view = c.req.query('view') || 'list'
  const dateParam = c.req.query('date') || new Date().toISOString().split('T')[0]

  // Parse date for calendar view
  const currentDate = new Date(dateParam)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Calculate month range for calendar view
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  // Get events visible to this user's stemgroep
  let query = `
    SELECT id, type, titel, slug, start_at, end_at, locatie, doelgroep, beschrijving
    FROM events
    WHERE (doelgroep = 'all' OR doelgroep LIKE ?)
  `
  const params: any[] = [`%${user.stemgroep}%`]

  if (view === 'list') {
    query += ` AND start_at >= datetime('now')`
  } else {
    query += ` AND DATE(start_at) >= DATE(?) AND DATE(start_at) <= DATE(?)`
    params.push(monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0])
  }

  if (type !== 'all') {
    query += ` AND type = ?`
    params.push(type)
  }

  query += ` ORDER BY start_at ASC`

  const events = await queryAll(c.env.DB, query, params)

  // Get counts
  const allCount = await queryOne<any>(c.env.DB, 
    `SELECT COUNT(*) as count FROM events WHERE start_at >= datetime('now') AND (doelgroep = 'all' OR doelgroep LIKE ?)`,
    [`%${user.stemgroep}%`]
  )
  const repetitieCount = await queryOne<any>(c.env.DB,
    `SELECT COUNT(*) as count FROM events WHERE start_at >= datetime('now') AND type = 'repetitie' AND (doelgroep = 'all' OR doelgroep LIKE ?)`,
    [`%${user.stemgroep}%`]
  )
  const concertCount = await queryOne<any>(c.env.DB,
    `SELECT COUNT(*) as count FROM events WHERE start_at >= datetime('now') AND type = 'concert' AND (doelgroep = 'all' OR doelgroep LIKE ?)`,
    [`%${user.stemgroep}%`]
  )

  return c.html(
    <Layout 
      title="Agenda" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Agenda', href: '/leden/agenda' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-6">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-calendar text-purple-600 mr-3"></i>
              Agenda
            </h1>
            <p class="mt-2 text-gray-600">
              Aankomende repetities en concerten
            </p>
          </div>

          {/* View Toggle */}
          <div class="flex justify-center mb-6">
            <div class="inline-flex rounded-lg shadow-sm bg-white" role="group">
              <a
                href={`/leden/agenda?view=list&type=${type}`}
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
                href={`/leden/agenda?view=calendar&type=${type}&date=${dateParam}`}
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

          {/* Filter Tabs */}
          <div class="bg-white rounded-lg shadow-md mb-6">
            <div class="border-b border-gray-200">
              <nav class="flex -mb-px">
                <a
                  href="/leden/agenda?type=all"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    type === 'all'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Alle Events ({allCount?.count || 0})
                </a>
                <a
                  href="/leden/agenda?type=repetitie"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    type === 'repetitie'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Repetities ({repetitieCount?.count || 0})
                </a>
                <a
                  href="/leden/agenda?type=concert"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    type === 'concert'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Concerten ({concertCount?.count || 0})
                </a>
              </nav>
            </div>
          </div>

          {/* Events List */}
          {view === 'list' && events.length > 0 ? (
            <div class="space-y-4">
              {events.map((event: any) => {
                const startDate = new Date(event.start_at)
                const endDate = event.end_at ? new Date(event.end_at) : null
                
                const typeColors: Record<string, string> = {
                  'repetitie': 'bg-green-100 text-green-800',
                  'concert': 'bg-red-100 text-red-800',
                  'uitstap': 'bg-blue-100 text-blue-800'
                }

                return (
                  <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
                    <div class="flex items-start gap-4">
                      {/* Date Block */}
                      <div class="flex-shrink-0 text-center bg-animato-primary text-white rounded-lg p-3 w-20">
                        <div class="text-2xl font-bold">
                          {startDate.getDate()}
                        </div>
                        <div class="text-sm uppercase">
                          {startDate.toLocaleDateString('nl-NL', { month: 'short' })}
                        </div>
                      </div>

                      {/* Event Info */}
                      <div class="flex-1">
                        <div class="flex items-start justify-between mb-2">
                          <h3 class="text-xl font-bold text-gray-900">
                            {event.titel}
                          </h3>
                          <span class={`px-3 py-1 text-xs font-semibold rounded-full ${typeColors[event.type] || 'bg-gray-100 text-gray-800'}`}>
                            {event.type === 'repetitie' && 'Repetitie'}
                            {event.type === 'concert' && 'Concert'}
                            {event.type === 'uitstap' && 'Uitstap'}
                          </span>
                        </div>

                        <div class="space-y-2 text-sm text-gray-600">
                          <div class="flex items-center">
                            <i class="fas fa-clock w-5 mr-2 text-animato-primary"></i>
                            <span>
                              {startDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                              {endDate && ` - ${endDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`}
                            </span>
                          </div>

                          {event.locatie && (
                            <div class="flex items-center">
                              <i class="fas fa-map-marker-alt w-5 mr-2 text-animato-primary"></i>
                              <span>{event.locatie}</span>
                            </div>
                          )}

                          {event.doelgroep && event.doelgroep !== 'all' && (
                            <div class="flex items-center">
                              <i class="fas fa-users w-5 mr-2 text-animato-primary"></i>
                              <span class="capitalize">{event.doelgroep}</span>
                            </div>
                          )}
                        </div>

                        {event.beschrijving && (
                          <p class="mt-3 text-gray-700">
                            {event.beschrijving}
                          </p>
                        )}

                        {/* Actions */}
                        <div class="mt-4 flex gap-2">
                          <button
                            onclick={`showCalendarModal('${event.id}', '${event.titel.replace(/'/g, "\\'")}', '${event.start_at.split('T')[0]}', '${new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}', '${endDate ? endDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '23:59'}', '${event.locatie?.replace(/'/g, "\\'") || ''}', '${event.slug || event.id}')`}
                            class="inline-flex items-center px-4 py-2 bg-animato-primary text-white text-sm rounded-lg hover:bg-animato-secondary transition"
                          >
                            <i class="far fa-calendar-plus mr-2"></i>
                            Toevoegen aan agenda
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : view === 'list' ? (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-calendar-times text-gray-300 text-5xl mb-4"></i>
              <p class="text-gray-600 text-lg">
                Geen aankomende events gevonden
              </p>
            </div>
          ) : null}

          {/* CALENDAR VIEW */}
          {view === 'calendar' && (
            <div>
              {/* Calendar Navigation */}
              <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex items-center justify-between">
                  <a
                    href={`/leden/agenda?view=calendar&type=${type}&date=${new Date(year, month - 1, 1).toISOString().split('T')[0]}`}
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  >
                    <i class="fas fa-chevron-left mr-2"></i>
                    Vorige maand
                  </a>
                  <h2 class="text-2xl font-bold text-gray-900">
                    {new Date(year, month).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })}
                  </h2>
                  <a
                    href={`/leden/agenda?view=calendar&type=${type}&date=${new Date(year, month + 1, 1).toISOString().split('T')[0]}`}
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  >
                    Volgende maand
                    <i class="fas fa-chevron-right ml-2"></i>
                  </a>
                </div>
              </div>

              {/* Calendar Grid */}
              <div class="bg-white rounded-lg shadow-md overflow-hidden">
                {renderLedenCalendarGrid(events, year, month)}
              </div>
            </div>
          )}

        </div>

        {/* Calendar Modal */}
        <div id="calendar-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between mb-6">
              <h3 class="text-2xl font-bold text-gray-900">Toevoegen aan agenda</h3>
              <button onclick="closeCalendarModal()" class="text-gray-400 hover:text-gray-600 text-2xl">
                <i class="fas fa-times"></i>
              </button>
            </div>

            {/* Event Details */}
            <div class="mb-6 space-y-3">
              <div class="flex items-start gap-3">
                <i class="fas fa-music text-animato-primary mt-1"></i>
                <div>
                  <p class="text-sm text-gray-500">Evenement</p>
                  <p id="modal-title" class="font-semibold text-gray-900"></p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <i class="far fa-calendar text-animato-primary mt-1"></i>
                <div>
                  <p class="text-sm text-gray-500">Datum & Tijd</p>
                  <p id="modal-datetime" class="font-semibold text-gray-900"></p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <i class="fas fa-map-marker-alt text-animato-primary mt-1"></i>
                <div>
                  <p class="text-sm text-gray-500">Locatie</p>
                  <p id="modal-location" class="font-semibold text-gray-900"></p>
                </div>
              </div>
            </div>

            {/* Export Options */}
            <div class="space-y-3">
              <a id="google-calendar-link" href="#" target="_blank" rel="noopener noreferrer" 
                class="flex items-center justify-between w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition group">
                <div class="flex items-center gap-3">
                  <i class="fab fa-google text-2xl text-blue-600"></i>
                  <span class="font-medium text-gray-900">Google Calendar</span>
                </div>
                <i class="fas fa-external-link-alt text-gray-400 group-hover:text-blue-600"></i>
              </a>

              <a id="outlook-calendar-link" href="#" target="_blank" rel="noopener noreferrer"
                class="flex items-center justify-between w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition group">
                <div class="flex items-center gap-3">
                  <i class="fas fa-calendar text-2xl text-blue-700"></i>
                  <span class="font-medium text-gray-900">Outlook Calendar</span>
                </div>
                <i class="fas fa-external-link-alt text-gray-400 group-hover:text-blue-600"></i>
              </a>

              <a id="office365-calendar-link" href="#" target="_blank" rel="noopener noreferrer"
                class="flex items-center justify-between w-full px-4 py-3 bg-orange-50 hover:bg-orange-100 rounded-lg transition group">
                <div class="flex items-center gap-3">
                  <i class="fab fa-microsoft text-2xl text-orange-600"></i>
                  <span class="font-medium text-gray-900">Office 365</span>
                </div>
                <i class="fas fa-external-link-alt text-gray-400 group-hover:text-orange-600"></i>
              </a>

              <a id="ics-download-link" href="#" download
                class="flex items-center justify-between w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition group">
                <div class="flex items-center gap-3">
                  <i class="fas fa-download text-2xl text-gray-600"></i>
                  <span class="font-medium text-gray-900">Download ICS bestand</span>
                </div>
                <i class="fas fa-arrow-down text-gray-400 group-hover:text-gray-600"></i>
              </a>
            </div>
          </div>
        </div>

        {/* Calendar Modal JavaScript */}
        <script dangerouslySetInnerHTML={{__html: `
          let currentEvent = null;

          function showCalendarModal(id, title, date, startTime, endTime, location, slug) {
            currentEvent = { id, title, date, startTime, endTime, location, slug };
            
            // Update modal content
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-datetime').textContent = date + ' | ' + startTime + ' - ' + endTime;
            document.getElementById('modal-location').textContent = location || 'Locatie onbekend';
            
            // Format dates for calendar links
            const startDateTime = new Date(date + 'T' + startTime);
            const endDateTime = new Date(date + 'T' + endTime);
            
            // Google Calendar format: YYYYMMDDTHHMMSS
            const formatGoogleDate = (date) => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hours = String(date.getHours()).padStart(2, '0');
              const minutes = String(date.getMinutes()).padStart(2, '0');
              return year + month + day + 'T' + hours + minutes + '00';
            };
            
            const googleStart = formatGoogleDate(startDateTime);
            const googleEnd = formatGoogleDate(endDateTime);
            const details = encodeURIComponent('Concert door Animato Iutum');
            const eventLocation = encodeURIComponent(location || '');
            const eventTitle = encodeURIComponent(title);
            
            // Google Calendar URL
            const googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + eventTitle + '&dates=' + googleStart + '/' + googleEnd + '&details=' + details + '&location=' + eventLocation;
            document.getElementById('google-calendar-link').href = googleUrl;
            
            // Outlook/Office 365 URL (same format)
            const outlookUrl = 'https://outlook.live.com/calendar/0/deeplink/compose?subject=' + eventTitle + '&startdt=' + startDateTime.toISOString() + '&enddt=' + endDateTime.toISOString() + '&body=' + details + '&location=' + eventLocation;
            document.getElementById('outlook-calendar-link').href = outlookUrl;
            document.getElementById('office365-calendar-link').href = 'https://outlook.office.com/calendar/0/deeplink/compose?subject=' + eventTitle + '&startdt=' + startDateTime.toISOString() + '&enddt=' + endDateTime.toISOString() + '&body=' + details + '&location=' + eventLocation;
            
            // ICS download
            document.getElementById('ics-download-link').href = '/api/events/' + slug + '/ics';
            document.getElementById('ics-download-link').download = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.ics';
            
            // Show modal
            document.getElementById('calendar-modal').classList.remove('hidden');
            document.body.style.overflow = 'hidden';
          }

          function closeCalendarModal() {
            document.getElementById('calendar-modal').classList.add('hidden');
            document.body.style.overflow = '';
            currentEvent = null;
          }

          // Close on backdrop click
          document.getElementById('calendar-modal')?.addEventListener('click', function(e) {
            if (e.target === this) {
              closeCalendarModal();
            }
          });

          // Close on ESC key
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !document.getElementById('calendar-modal').classList.contains('hidden')) {
              closeCalendarModal();
            }
          });
        `}} />

      </div>
    </Layout>
  )
})

// =====================================================
// API ROUTES - Profile Updates
// =====================================================

// Update profile
app.post('/api/leden/profiel', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()

  const {
    voornaam, achternaam, telefoon, adres, bio, muzikale_ervaring,
    profielfoto_url, favoriete_genre, favoriete_componist, favoriete_werk,
    instrument, jaren_in_koor, zanger_type, smoelenboek_zichtbaar, toon_email, toon_telefoon,
    stemgroep
  } = body

  try {
    // Update user stemgroep in users table
    if (stemgroep && ['S', 'A', 'T', 'B'].includes(String(stemgroep))) {
      await c.env.DB.prepare(
        `UPDATE users SET stemgroep = ? WHERE id = ?`
      ).bind(stemgroep, user.id).run()
    }

    // Update profile in profiles table
    const result = await c.env.DB.prepare(
      `UPDATE profiles 
       SET voornaam = ?, achternaam = ?, telefoon = ?, adres = ?, bio = ?, muzikale_ervaring = ?, 
           foto_url = ?, favoriete_genre = ?, favoriete_componist = ?, favoriete_werk = ?,
           instrument = ?, jaren_in_koor = ?, zanger_type = ?, smoelenboek_zichtbaar = ?, toon_email = ?, toon_telefoon = ?
       WHERE user_id = ?`
    ).bind(
      voornaam,
      achternaam,
      telefoon && telefoon !== '' ? telefoon : null,
      adres && adres !== '' ? adres : null,
      bio && bio !== '' ? bio : null,
      muzikale_ervaring && muzikale_ervaring !== '' ? muzikale_ervaring : null,
      profielfoto_url && profielfoto_url !== '' ? profielfoto_url : null,
      favoriete_genre && favoriete_genre !== '' ? favoriete_genre : null,
      favoriete_componist && favoriete_componist !== '' ? favoriete_componist : null,
      favoriete_werk && favoriete_werk !== '' ? favoriete_werk : null,
      instrument && instrument !== '' ? instrument : null,
      jaren_in_koor ? parseInt(String(jaren_in_koor)) : 0,
      zanger_type || 'amateur',
      smoelenboek_zichtbaar === '1' ? 1 : 0,
      toon_email === '1' ? 1 : 0,
      toon_telefoon === '1' ? 1 : 0,
      user.id
    ).run()

    if (!result.success) {
      return c.redirect('/leden/profiel?error=update_failed')
    }

    return c.redirect('/leden/profiel?success=profile')
  } catch (error: any) {
    console.error('Profile update error:', error)
    return c.redirect('/leden/profiel?error=update_failed')
  }
})

// =====================================================
// API ROUTES - File Upload
// =====================================================

// Upload profile photo
app.post('/api/upload/foto', async (c) => {
  const user = c.get('user') as SessionUser
  
  try {
    const body = await c.req.parseBody()
    const file = body.file as File
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400)
    }
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Only JPG, PNG, GIF, WEBP allowed.' }, 400)
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'File too large. Maximum 5MB allowed.' }, 400)
    }
    
    // Generate unique filename
    const timestamp = Date.now()
    const extension = file.name.split('.').pop() || 'jpg'
    const filename = `profile-${user.id}-${timestamp}.${extension}`
    
    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Upload to GenSpark blob storage API
    // Note: In production, you would use Cloudflare R2 or similar
    // For now, we'll create a data URL as fallback
    const base64 = btoa(String.fromCharCode(...uint8Array))
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // TODO: Replace with actual blob storage upload
    // For development, we'll use the data URL directly
    // In production, upload to R2 or external service and return the URL
    
    return c.json({ 
      url: dataUrl,
      filename: filename,
      size: file.size,
      type: file.type
    })
    
  } catch (error: any) {
    console.error('Upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// =====================================================
// HELPER: RENDER CALENDAR GRID FOR LEDEN
// =====================================================

function renderLedenCalendarGrid(events: any[], year: number, month: number) {
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
    
    currentWeek.push({ day, date: dateStr, events: dayEvents })

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
            <div class={`min-h-[100px] p-2 rounded-lg border ${
              cell ? 'bg-white hover:bg-gray-50' : 'bg-gray-50'
            }`}>
              {cell && (
                <div>
                  <div class="text-right text-sm font-semibold text-gray-700 mb-1">
                    {cell.day}
                  </div>
                  <div class="space-y-1">
                    {cell.events.slice(0, 2).map((event: any) => (
                      <a
                        href={event.slug ? `/agenda/${event.slug}` : '#'}
                        class={`block text-xs p-1 rounded truncate hover:opacity-80 transition ${
                          event.type === 'concert' ? 'bg-yellow-100 text-yellow-800' :
                          event.type === 'repetitie' ? 'bg-blue-100 text-blue-800' :
                          event.type === 'activiteit' ? 'bg-green-100 text-green-800' :
                          event.type === 'workshop' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}
                        title={`${event.titel} - ${new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`}
                      >
                        {new Date(event.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} {event.titel}
                      </a>
                    ))}
                    {cell.events.length > 2 && (
                      <div class="text-xs text-gray-500 text-center">
                        +{cell.events.length - 2} meer
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
