// Nieuws routes
// Overzicht en detail pagina's

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { optionalAuth } from '../middleware/auth'
import { queryOne, queryAll, paginate } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optional auth
app.use('*', optionalAuth)

// =====================================================
// NIEUWS OVERZICHT
// =====================================================

app.get('/nieuws', async (c) => {
  const user = c.get('user')
  const page = parseInt(c.req.query('page') || '1')
  const search = c.req.query('search') || ''

  // Build query
  let baseQuery = `
    SELECT p.id, p.titel, p.slug, p.excerpt, p.published_at, p.views,
           u.id as auteur_id, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam
    FROM posts p
    LEFT JOIN users u ON u.id = p.auteur_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.type = 'nieuws' 
      AND p.is_published = 1 
      AND p.zichtbaarheid = 'publiek'
  `

  const filters: any[] = []

  if (search) {
    baseQuery += ` AND (p.titel LIKE ? OR p.body LIKE ?)`
    const searchTerm = `%${search}%`
    filters.push(searchTerm, searchTerm)
  }

  baseQuery += ` ORDER BY p.published_at DESC`

  const countQuery = `
    SELECT COUNT(*) as total
    FROM posts p
    WHERE p.type = 'nieuws' 
      AND p.is_published = 1 
      AND p.zichtbaarheid = 'publiek'
    ${search ? ` AND (p.titel LIKE ? OR p.body LIKE ?)` : ''}
  `

  // Paginate
  const result = await paginate(
    c.env.DB,
    baseQuery,
    countQuery,
    { page, limit: 12, filters: search ? [filters[0], filters[1]] : [] }
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
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                {result.data.map((artikel: any) => (
                  <a 
                    href={`/nieuws/${artikel.slug}`}
                    class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden"
                  >
                    <div class="aspect-video bg-gradient-to-br from-animato-primary to-animato-secondary relative overflow-hidden">
                      <div class="absolute inset-0 flex items-center justify-center">
                        <i class="fas fa-newspaper text-white text-5xl opacity-50"></i>
                      </div>
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
       AND id != ?
     ORDER BY published_at DESC 
     LIMIT 3`,
    [artikel.id]
  )

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

          {/* Content */}
          <div 
            class="prose prose-lg max-w-none mb-12"
            dangerouslySetInnerHTML={{ __html: artikel.body }}
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

export default app
