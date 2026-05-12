// Nieuws routes
// Overzicht en detail pagina's

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { optionalAuth } from '../middleware/auth'
import { queryOne, queryAll, paginate } from '../utils/db'
import { processBodyLinks } from '../utils/text'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optional auth
app.use('*', optionalAuth)

// =====================================================
// NIEUWS OVERZICHT
// =====================================================

app.get('/nieuws', async (c) => {
  const user = c.get('user') as any
  const page = parseInt(c.req.query('page') || '1')
  const search = c.req.query('search') || ''
  const archief = c.req.query('archief') === '1'
  const maandenRecent = 6 // Berichten ouder dan 6 maanden zijn "archief"

  // Bouw zichtbaarheidsfilter op basis van gebruikersrol
  // - niet ingelogd: enkel 'publiek'
  // - lid: 'publiek' + 'leden' + eigen stemgroep (sopraan/alt/tenor/bas)
  // - bestuur/admin: alles
  const visibilityValues: string[] = ['publiek']
  if (user) {
    visibilityValues.push('leden')
    const stem = (user.stemgroep || '').toLowerCase()
    if (['sopraan', 'alt', 'tenor', 'bas'].includes(stem)) {
      visibilityValues.push(stem)
    }
    if (user.role === 'admin' || user.role === 'bestuur') {
      visibilityValues.push('bestuur')
    }
  }
  const visibilityPlaceholders = visibilityValues.map(() => '?').join(',')
  const visibilityCondition = `p.zichtbaarheid IN (${visibilityPlaceholders})`
  // Voor count-query (geen alias):
  const visibilityConditionNoAlias = `zichtbaarheid IN (${visibilityPlaceholders})`

  // Build query
  let baseQuery = `
    SELECT p.id, p.titel, p.slug, p.excerpt, p.published_at, p.views, p.cover_image, p.zichtbaarheid,
           u.id as auteur_id, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam
    FROM posts p
    LEFT JOIN users u ON u.id = p.auteur_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.type = 'nieuws' 
      AND p.is_published = 1 
      AND ${visibilityCondition}
      AND (p.verloopt_op IS NULL OR p.verloopt_op >= DATE('now'))
  `

  const filters: any[] = [...visibilityValues]

  // Archive filter (#69)
  if (archief) {
    baseQuery += ` AND p.published_at < datetime('now', '-${maandenRecent} months')`
  } else {
    baseQuery += ` AND p.published_at >= datetime('now', '-${maandenRecent} months')`
  }

  if (search) {
    baseQuery += ` AND (p.titel LIKE ? OR p.body LIKE ?)`
    const searchTerm = `%${search}%`
    filters.push(searchTerm, searchTerm)
  }

  baseQuery += ` ORDER BY p.published_at DESC`

  const archiveCondition = archief 
    ? `AND p.published_at < datetime('now', '-${maandenRecent} months')`
    : `AND p.published_at >= datetime('now', '-${maandenRecent} months')`

  const countQuery = `
    SELECT COUNT(*) as total
    FROM posts p
    WHERE p.type = 'nieuws' 
      AND p.is_published = 1 
      AND p.${visibilityConditionNoAlias}
      AND (p.verloopt_op IS NULL OR p.verloopt_op >= DATE('now'))
    ${archiveCondition}
    ${search ? ` AND (p.titel LIKE ? OR p.body LIKE ?)` : ''}
  `

  // Beide queries gebruiken exact dezelfde filterlijst (visibility + evt. search)
  const result = await paginate(
    c.env.DB,
    baseQuery,
    countQuery,
    { page, limit: 12, filters }
  )

  return c.html(
    <Layout title="Nieuws" user={user} currentPath="/nieuws">
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="text-center mb-12">
            <h1 class="text-5xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Nieuws & Updates
            </h1>
            <p class="text-gray-600 text-lg max-w-2xl mx-auto">
              Blijf op de hoogte van alle activiteiten en updates van Gemengd Koor Animato
            </p>
          </div>

          {/* Archive toggle (#69) */}
          <div class="flex justify-center gap-3 mb-8">
            <a href="/nieuws" class={`px-5 py-2 rounded-full font-medium transition ${!archief ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <i class="fas fa-newspaper mr-2"></i> Recent
            </a>
            <a href="/nieuws?archief=1" class={`px-5 py-2 rounded-full font-medium transition ${archief ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <i class="fas fa-archive mr-2"></i> Archief
            </a>
          </div>

          {/* Search bar */}
          <div class="max-w-2xl mx-auto mb-12">
            <form method="GET" action="/nieuws" class="flex gap-2">
              <div class="flex-1 relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i class="fas fa-search text-gray-400"></i>
                </div>
                <input
                  type="text"
                  name="search"
                  value={search}
                  placeholder="Zoek in nieuws..."
                  class="pl-10 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                class="bg-animato-primary hover:bg-animato-secondary text-white px-6 py-3 rounded-lg font-semibold transition"
              >
                Zoeken
              </button>
            </form>
          </div>

          {/* Results info */}
          {search && (
            <div class="mb-6 text-center text-gray-600">
              {result.pagination.total} resultaten voor "{search}"
              <a href="/nieuws" class="ml-4 text-animato-primary hover:underline">
                <i class="fas fa-times mr-1"></i>
                Wis zoekopdracht
              </a>
            </div>
          )}

          {/* Articles grid */}
          {result.data.length > 0 ? (
            <>
              <div class={`grid gap-6 mb-12 ${result.data.length > 6 ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8'}`}>
                {result.data.map((artikel: any) => (
                  <a 
                    href={`/nieuws/${artikel.slug}`}
                    class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden"
                  >
                    <div class="aspect-video bg-gradient-to-br from-animato-primary to-animato-secondary relative overflow-hidden">
                      {artikel.cover_image ? (
                        <img src={artikel.cover_image} alt={artikel.titel} class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                      ) : (
                        <div class="absolute inset-0 flex items-center justify-center">
                          <i class="fas fa-newspaper text-white text-5xl opacity-50"></i>
                        </div>
                      )}
                      {/* Zichtbaarheid-badge */}
                      {artikel.zichtbaarheid && artikel.zichtbaarheid !== 'publiek' && (
                        <div class="absolute top-2 right-2">
                          {artikel.zichtbaarheid === 'leden' && (
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 shadow-sm">
                              <i class="fas fa-lock mr-1"></i> Leden
                            </span>
                          )}
                          {artikel.zichtbaarheid === 'bestuur' && (
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 shadow-sm">
                              <i class="fas fa-shield-alt mr-1"></i> Bestuur
                            </span>
                          )}
                          {['sopraan','alt','tenor','bas'].includes(artikel.zichtbaarheid) && (
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shadow-sm capitalize">
                              <i class="fas fa-music mr-1"></i> {artikel.zichtbaarheid}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div class="p-6">
                      <div class="flex items-center text-sm text-gray-500 mb-3">
                        <i class="far fa-calendar mr-2"></i>
                        {new Date(artikel.published_at).toLocaleDateString('nl-BE', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        })}
                        <span class="mx-2">•</span>
                        <i class="far fa-eye mr-1"></i>
                        {artikel.views} views
                      </div>
                      <h2 class="text-xl font-bold text-gray-900 mb-3 group-hover:text-animato-primary transition line-clamp-2">
                        {artikel.titel}
                      </h2>
                      <p class="text-gray-600 mb-4 line-clamp-3">
                        {artikel.excerpt || 'Lees meer...'}
                      </p>
                      <div class="flex items-center justify-between">
                        <span class="inline-flex items-center text-animato-primary font-semibold group-hover:underline">
                          Lees meer
                          <i class="fas fa-arrow-right ml-2"></i>
                        </span>
                        {artikel.auteur_voornaam && (
                          <span class="text-sm text-gray-500">
                            Door {artikel.auteur_voornaam}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              {/* Pagination */}
              {result.pagination.totalPages > 1 && (
                <div class="flex justify-center items-center space-x-2">
                  {result.pagination.hasPrev && (
                    <a
                      href={`/nieuws?page=${page - 1}${search ? `&search=${search}` : ''}`}
                      class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      <i class="fas fa-chevron-left"></i>
                    </a>
                  )}

                  {Array.from({ length: result.pagination.totalPages }, (_, i) => i + 1).map(p => (
                    <a
                      href={`/nieuws?page=${p}${search ? `&search=${search}` : ''}`}
                      class={`px-4 py-2 rounded-lg transition ${
                        p === page
                          ? 'bg-animato-primary text-white'
                          : 'border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </a>
                  ))}

                  {result.pagination.hasNext && (
                    <a
                      href={`/nieuws?page=${page + 1}${search ? `&search=${search}` : ''}`}
                      class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      <i class="fas fa-chevron-right"></i>
                    </a>
                  )}
                </div>
              )}
            </>
          ) : (
            <div class="text-center py-16">
              <i class="fas fa-inbox text-gray-300 text-6xl mb-4"></i>
              <p class="text-xl text-gray-600">
                {search ? 'Geen resultaten gevonden' : 'Nog geen nieuws beschikbaar'}
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// NIEUWS DETAIL
// =====================================================

app.get('/nieuws/:slug', async (c) => {
  const user = c.get('user')
  const slug = c.req.param('slug')

  // Get article
  const artikel = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.slug = ? AND p.type = 'nieuws' AND p.is_published = 1`,
    [slug]
  )

  if (!artikel) {
    // Slug bestaat misschien onder een ander type (board/posts) — oude WhatsApp-links blijven dan werken via /posts/:slug
    const otherTypePost = await queryOne<any>(
      c.env.DB,
      `SELECT id, type FROM posts WHERE slug = ? AND is_published = 1 LIMIT 1`,
      [slug]
    )
    if (otherTypePost && otherTypePost.type !== 'nieuws') {
      return c.redirect(`/posts/${slug}`, 301)
    }
    return c.notFound()
  }

  // Check visibility
  if (artikel.zichtbaarheid !== 'publiek' && !user) {
    return c.redirect('/login?error=unauthorized')
  }

  // Increment views
  await c.env.DB.prepare(
    'UPDATE posts SET views = views + 1 WHERE id = ?'
  ).bind(artikel.id).run()

  // Get related articles
  const gerelateerd = await queryAll<any>(
    c.env.DB,
    `SELECT id, titel, slug, published_at 
     FROM posts 
     WHERE type = 'nieuws' 
       AND is_published = 1 
       AND zichtbaarheid = 'publiek'
       AND (verloopt_op IS NULL OR verloopt_op >= DATE('now'))
       AND id != ?
     ORDER BY published_at DESC 
     LIMIT 3`,
    [artikel.id]
  )

  // Reacties — alleen voor ingelogde gebruikers laden
  // Joint met profile zodat we de schrijver-naam en foto kunnen tonen
  const comments = user ? await queryAll<any>(
    c.env.DB,
    `SELECT c.id, c.body, c.created_at, c.user_id,
            p.voornaam, p.achternaam, p.foto_url
     FROM post_comments c
     LEFT JOIN profiles p ON p.user_id = c.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC`,
    [artikel.id]
  ) : []

  // Voor publieke bezoekers: enkel het aantal reacties tonen (teaser, lokt login uit)
  const commentCount = !user ? await queryOne<any>(
    c.env.DB,
    `SELECT COUNT(*) as n FROM post_comments WHERE post_id = ?`,
    [artikel.id]
  ) : null

  return c.html(
    <Layout 
      title={artikel.titel} 
      description={artikel.excerpt}
      user={user}
    >
      <article class="py-12">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header class="mb-8">
            <div class="text-center mb-6">
              <div class="text-animato-primary text-sm font-semibold mb-2">
                {new Date(artikel.published_at).toLocaleDateString('nl-BE', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </div>
              <h1 class="text-4xl md:text-5xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                {artikel.titel}
              </h1>
              {artikel.excerpt && (
                <p class="text-xl text-gray-600 leading-relaxed">
                  {artikel.excerpt}
                </p>
              )}
            </div>

            <div class="flex items-center justify-center space-x-4 text-sm text-gray-500">
              {artikel.auteur_voornaam && (
                <div class="flex items-center">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-2">
                    <i class="fas fa-user text-animato-primary"></i>
                  </div>
                  <div>
                    <div class="font-medium text-gray-900">
                      {artikel.auteur_voornaam} {artikel.auteur_achternaam}
                    </div>
                    <div class="text-xs">Auteur</div>
                  </div>
                </div>
              )}
              <span>•</span>
              <div>
                <i class="far fa-eye mr-1"></i>
                {artikel.views + 1} views
              </div>
            </div>
          </header>

          {/* Content — interne links open in zelfde tab, externe in nieuw tabblad (#90) */}
          <div 
            class="prose prose-lg max-w-none mb-12"
            dangerouslySetInnerHTML={{ __html: processBodyLinks(artikel.body, [
              new URL(c.req.url).hostname,
              'animato-live.pages.dev',
              'animato.be',
              'www.animato.be'
            ]) }}
          />

          {/* Share buttons */}
          <div class="border-t border-b border-gray-200 py-6 mb-12">
            <div class="flex items-center justify-center space-x-4">
              <span class="text-gray-600 font-medium">Deel dit artikel:</span>
              <a href="#" class="text-gray-600 hover:text-animato-primary transition">
                <i class="fab fa-facebook text-xl"></i>
              </a>
              <a href="#" class="text-gray-600 hover:text-animato-primary transition">
                <i class="fab fa-twitter text-xl"></i>
              </a>
              <a href="#" class="text-gray-600 hover:text-animato-primary transition">
                <i class="fab fa-linkedin text-xl"></i>
              </a>
              <a href="#" class="text-gray-600 hover:text-animato-primary transition">
                <i class="fas fa-envelope text-xl"></i>
              </a>
            </div>
          </div>

          {/* =================================================== */}
          {/* REACTIES — leden kunnen reageren op nieuws          */}
          {/* =================================================== */}
          <section id="reacties" class="mb-12 bg-gray-50 rounded-xl p-6 sm:p-8 border border-gray-200">
            <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-comments text-animato-primary mr-3"></i>
              Reacties
              {user && comments.length > 0 && (
                <span class="ml-2 text-base font-medium text-gray-500">({comments.length})</span>
              )}
            </h2>

            {!user ? (
              <div class="bg-white border border-gray-200 rounded-lg p-6 text-center">
                <i class="fas fa-lock text-gray-400 text-3xl mb-3"></i>
                <p class="text-gray-700 mb-2">
                  Reacties zijn enkel zichtbaar en plaatsbaar voor <strong>ingelogde leden</strong>.
                </p>
                {commentCount && commentCount.n > 0 && (
                  <p class="text-sm text-gray-500 mb-4">
                    Er {commentCount.n === 1 ? 'is' : 'zijn'} al {commentCount.n} reactie{commentCount.n === 1 ? '' : 's'} op dit bericht.
                  </p>
                )}
                <a href={`/login?redirect=${encodeURIComponent('/nieuws/' + artikel.slug + '#reacties')}`}
                   class="inline-flex items-center bg-animato-primary hover:bg-animato-secondary text-white px-5 py-2 rounded-lg font-semibold transition">
                  <i class="fas fa-sign-in-alt mr-2"></i> Inloggen om te reageren
                </a>
              </div>
            ) : (
              <>
                {/* Bestaande reacties */}
                {comments.length === 0 ? (
                  <p class="text-gray-500 italic mb-6 text-center py-4">
                    Nog geen reacties — wees de eerste!
                  </p>
                ) : (
                  <ul class="space-y-4 mb-6">
                    {comments.map((cm: any) => {
                      const naam = `${cm.voornaam || ''} ${cm.achternaam || ''}`.trim() || 'Lid'
                      const initialen = (cm.voornaam?.[0] || '?') + (cm.achternaam?.[0] || '')
                      const canDelete = user.id === cm.user_id || user.role === 'admin' || user.role === 'moderator'
                      const dt = new Date((cm.created_at || '').replace(' ', 'T') + 'Z')
                      const dtStr = dt.toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      return (
                        <li class="bg-white border border-gray-200 rounded-lg p-4 flex gap-3">
                          {cm.foto_url ? (
                            <img src={cm.foto_url} alt={naam}
                                 class="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                          ) : (
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-animato-primary to-animato-secondary text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                              {initialen}
                            </div>
                          )}
                          <div class="flex-1 min-w-0">
                            <div class="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                              <span class="font-semibold text-gray-900">{naam}</span>
                              <span class="text-xs text-gray-400">{dtStr}</span>
                            </div>
                            <p class="text-gray-700 whitespace-pre-wrap break-words">{cm.body}</p>
                            {canDelete && (
                              <form method="POST" action={`/nieuws/${artikel.slug}/reactie/${cm.id}/delete`}
                                    onsubmit="return confirm('Reactie verwijderen?')"
                                    class="inline-block mt-2">
                                <button type="submit" class="text-xs text-red-500 hover:text-red-700 hover:underline">
                                  <i class="fas fa-trash-alt mr-1"></i> Verwijderen
                                </button>
                              </form>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* Reactie toevoegen */}
                <form method="POST" action={`/nieuws/${artikel.slug}/reactie`}
                      class="bg-white border border-gray-200 rounded-lg p-4">
                  <label for="comment-body" class="block text-sm font-semibold text-gray-700 mb-2">
                    Plaats een reactie
                  </label>
                  <textarea id="comment-body" name="body" required rows={3} maxlength={2000}
                            placeholder="Schrijf hier je reactie..."
                            class="w-full border-gray-300 rounded-lg p-3 border focus:ring-animato-primary focus:border-animato-primary text-sm"></textarea>
                  <div class="flex items-center justify-between mt-3 flex-wrap gap-2">
                    <p class="text-xs text-gray-400">
                      <i class="fas fa-info-circle mr-1"></i>
                      Je naam en foto worden bij de reactie getoond.
                    </p>
                    <button type="submit"
                            class="inline-flex items-center bg-animato-primary hover:bg-animato-secondary text-white px-4 py-2 rounded-lg font-semibold text-sm transition">
                      <i class="fas fa-paper-plane mr-2"></i> Plaatsen
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>

          {/* Related articles */}
          {gerelateerd.length > 0 && (
            <div>
              <h2 class="text-2xl font-bold text-gray-900 mb-6">
                Gerelateerde artikelen
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                {gerelateerd.map((item: any) => (
                  <a 
                    href={`/nieuws/${item.slug}`}
                    class="group bg-white border border-gray-200 rounded-lg p-4 hover:border-animato-primary transition"
                  >
                    <div class="text-animato-primary text-sm mb-2">
                      {new Date(item.published_at).toLocaleDateString('nl-BE')}
                    </div>
                    <h3 class="font-semibold text-gray-900 group-hover:text-animato-primary transition line-clamp-2">
                      {item.titel}
                    </h3>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Back button */}
          <div class="mt-12 text-center">
            <a 
              href="/nieuws"
              class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
            >
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar nieuws overzicht
            </a>
          </div>
        </div>
      </article>
    </Layout>
  )
})

// =====================================================
// REACTIES — plaatsen en verwijderen
// =====================================================

// Plaats een reactie op een nieuwsbericht
app.post('/nieuws/:slug/reactie', async (c) => {
  const user = c.get('user') as any
  const slug = c.req.param('slug')

  if (!user) {
    return c.redirect(`/login?redirect=${encodeURIComponent('/nieuws/' + slug + '#reacties')}`)
  }

  const body = await c.req.parseBody()
  const raw = String(body.body || '').trim()

  if (!raw || raw.length < 1) {
    return c.redirect(`/nieuws/${slug}#reacties`)
  }
  // Hard cap zoals in de UI (max 2000 tekens)
  const safeBody = raw.length > 2000 ? raw.substring(0, 2000) : raw

  // Bestaat het artikel?
  const post = await queryOne<any>(
    c.env.DB,
    `SELECT id FROM posts WHERE slug = ? AND type = 'nieuws' AND is_published = 1 LIMIT 1`,
    [slug]
  )
  if (!post) return c.notFound()

  try {
    await c.env.DB.prepare(
      `INSERT INTO post_comments (post_id, user_id, body) VALUES (?, ?, ?)`
    ).bind(post.id, user.id, safeBody).run()
  } catch (e: any) {
    console.warn('Comment insert failed:', e?.message)
  }

  return c.redirect(`/nieuws/${slug}#reacties`)
})

// Verwijder een reactie (eigenaar of admin/moderator)
app.post('/nieuws/:slug/reactie/:id/delete', async (c) => {
  const user = c.get('user') as any
  const slug = c.req.param('slug')
  const commentId = c.req.param('id')

  if (!user) {
    return c.redirect(`/login?redirect=${encodeURIComponent('/nieuws/' + slug + '#reacties')}`)
  }

  // Eigenaarscheck — admins/moderators mogen alles verwijderen
  const comment = await queryOne<any>(
    c.env.DB,
    `SELECT user_id FROM post_comments WHERE id = ? LIMIT 1`,
    [commentId]
  )
  if (!comment) return c.redirect(`/nieuws/${slug}#reacties`)

  const isOwner = comment.user_id === user.id
  const isAdmin = user.role === 'admin' || user.role === 'moderator'

  if (!isOwner && !isAdmin) {
    return c.redirect(`/nieuws/${slug}#reacties`)
  }

  try {
    await c.env.DB.prepare(`DELETE FROM post_comments WHERE id = ?`).bind(commentId).run()
  } catch (e: any) {
    console.warn('Comment delete failed:', e?.message)
  }

  return c.redirect(`/nieuws/${slug}#reacties`)
})

// =====================================================
// UNIVERSAL POST DETAIL — werkt voor alle post-types
// (nieuws, board, posts, ...) zodat WhatsApp-share-links
// (/posts/:slug, /berichten/:slug) altijd werken.
// =====================================================

const postDetailHandler = async (c: any) => {
  const user = c.get('user')
  const slug = c.req.param('slug')

  // Look up post by slug, ongeacht type
  const post = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.slug = ? AND p.is_published = 1`,
    [slug]
  )

  if (!post) return c.notFound()

  // Voor type='nieuws': stuur door naar de bestaande nieuws-pagina
  if (post.type === 'nieuws') {
    return c.redirect(`/nieuws/${slug}`, 301)
  }

  // Visibility check — public_share=1 omzeilt de leden/bestuur-restrictie
  // (admin heeft expliciet aangevinkt: "🔓 Maak deze post publiek deelbaar via WhatsApp")
  const isPubliclyShared = post.public_share === 1
  if (!isPubliclyShared) {
    if (post.zichtbaarheid === 'leden' && !user) {
      return c.redirect(`/login?redirect=${encodeURIComponent(c.req.path)}`)
    }
    // Bestuur-only posts (board) — public_share telt hier ook,
    // dus alleen blokkeren als public_share UIT staat.
    if (post.zichtbaarheid === 'bestuur' && (!user || (user.role !== 'admin' && user.role !== 'bestuur'))) {
      return c.redirect(`/login?redirect=${encodeURIComponent(c.req.path)}&error=unauthorized`)
    }
  }

  // Increment views
  await c.env.DB.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(post.id).run()

  const auteurNaam = post.auteur_voornaam ? `${post.auteur_voornaam} ${post.auteur_achternaam || ''}`.trim() : 'Animato'
  const dateStr = post.published_at
    ? new Date(post.published_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  // Visibility badge — public_share toont expliciet de "publiek deelbaar"-status
  const visBadge = isPubliclyShared
    ? { label: 'Publiek deelbaar', cls: 'bg-green-100 text-green-800', icon: 'fa-share-alt' }
    : post.zichtbaarheid === 'leden' ? { label: 'Alleen voor leden', cls: 'bg-blue-100 text-blue-800', icon: 'fa-lock' }
    : post.zichtbaarheid === 'bestuur' ? { label: 'Bestuur intern', cls: 'bg-purple-100 text-purple-800', icon: 'fa-shield' }
    : { label: 'Publiek', cls: 'bg-green-100 text-green-800', icon: 'fa-globe' }

  // Type label
  const typeLabel: Record<string, string> = {
    board: 'Bestuursbericht',
    posts: 'Bericht',
    nieuws: 'Nieuws',
    repetitie: 'Repetitie',
    concert: 'Concert',
  }
  const typeName = typeLabel[post.type] || 'Bericht'

  return c.html(
    <Layout title={post.titel} description={post.excerpt} user={user}>
      <article class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="bg-white rounded-xl shadow-md overflow-hidden">
            {post.cover_image && (
              <img src={post.cover_image} alt={post.titel} class="w-full h-64 object-cover" />
            )}
            <div class="p-6 sm:p-10">
              {/* Header meta */}
              <div class="flex flex-wrap items-center gap-2 mb-4 text-xs">
                <span class={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold ${visBadge.cls}`}>
                  <i class={`fas ${visBadge.icon} mr-1.5`}></i>{visBadge.label}
                </span>
                <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
                  <i class="fas fa-tag mr-1.5"></i>{typeName}
                </span>
                {post.is_pinned === 1 && (
                  <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">
                    <i class="fas fa-thumbtack mr-1.5"></i>Vastgepind
                  </span>
                )}
              </div>

              <h1 class="text-3xl md:text-4xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                {post.titel}
              </h1>

              <div class="flex items-center gap-3 mb-6 text-sm text-gray-600 border-b border-gray-200 pb-4">
                {post.auteur_foto ? (
                  <img src={post.auteur_foto} alt={auteurNaam} class="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div class="w-10 h-10 rounded-full bg-animato-primary text-white flex items-center justify-center font-bold">
                    {auteurNaam.charAt(0)}
                  </div>
                )}
                <div>
                  <div class="font-semibold text-gray-800">{auteurNaam}</div>
                  {dateStr && <div class="text-xs text-gray-500">{dateStr}</div>}
                </div>
                <div class="ml-auto text-xs text-gray-400">
                  <i class="fas fa-eye mr-1"></i>{(post.views || 0) + 1} weergaven
                </div>
              </div>

              {post.excerpt && (
                <p class="text-lg text-gray-700 leading-relaxed mb-6 italic">
                  {post.excerpt}
                </p>
              )}

              <div
                class="prose prose-lg max-w-none text-gray-800 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: processBodyLinks(post.body || '') }}
              />

              {/* Footer actions */}
              <div class="mt-10 pt-6 border-t border-gray-200 flex flex-wrap items-center gap-3">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${post.titel} — https://animato-live.pages.dev/posts/${post.slug}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition"
                >
                  <i class="fab fa-whatsapp mr-2"></i>Deel via WhatsApp
                </a>
                <a href={user ? '/dashboard' : '/'} class="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition">
                  <i class="fas fa-arrow-left mr-2"></i>{user ? 'Naar dashboard' : 'Terug naar home'}
                </a>
              </div>
            </div>
          </div>
        </div>
      </article>
    </Layout>
  )
}

app.get('/posts/:slug', postDetailHandler)
app.get('/berichten/:slug', postDetailHandler)

export default app
