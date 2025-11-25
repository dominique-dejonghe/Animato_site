// Admin Console routes
// Dashboard, Member Management, Content Management, File Management

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
// ADMIN DASHBOARD
// =====================================================

app.get('/admin', async (c) => {
  const user = c.get('user') as SessionUser

  // Disable caching for admin pages
  noCacheHeaders(c)

  // Get statistics
  const stats = {
    total_leden: await queryOne<any>(c.env.DB, 
      `SELECT COUNT(*) as count FROM users WHERE role IN ('lid', 'stemleider')`
    ),
    total_posts: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM posts WHERE is_published = 1`
    ),
    total_events: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM events WHERE start_at > datetime('now')`
    ),
    total_albums: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM albums WHERE is_publiek = 1`
    ),
    total_materials: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM materials WHERE is_actief = 1`
    ),
    total_locations: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM locations WHERE is_actief = 1`
    ),
    total_polls: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM polls WHERE status IN ('open', 'concept')`
    ),
    total_proposals_pending: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM member_proposals WHERE status = 'pending'`
    ),
  }

  // Get recent activity from audit logs
  const recentActivity = await queryAll(
    c.env.DB,
    `SELECT a.*, u.email, p.voornaam, p.achternaam
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     ORDER BY a.created_at DESC
     LIMIT 10`
  )

  // Get stemgroep breakdown
  const stemgroepStats = await queryAll(
    c.env.DB,
    `SELECT stemgroep, COUNT(*) as count
     FROM users
     WHERE role = 'lid' AND status = 'actief'
     GROUP BY stemgroep`
  )

  return c.html(
    <Layout 
      title="Admin Dashboard" 
      user={user}
      breadcrumbs={[{ label: 'Admin', href: '/admin' }]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-shield-alt text-animato-accent mr-3"></i>
                  Admin Dashboard
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer je koorwebsite en ledenportaal
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-home mr-2"></i>
                  Naar Website
                </a>
                <a href="/leden" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-users mr-2"></i>
                  Ledenportaal
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Stats Cards */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-6 mb-8">
            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Actieve Leden</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_leden?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-animato-primary/10 rounded-lg flex items-center justify-center">
                  <i class="fas fa-users text-animato-primary text-xl"></i>
                </div>
              </div>
              <a href="/admin/leden" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Bekijk alle leden <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Gepubliceerde Posts</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_posts?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-newspaper text-green-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/content" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer content <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Aankomende Events</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_events?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-calendar text-purple-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/events" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer events <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Foto Albums</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_albums?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-images text-pink-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/fotoboek" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer fotoboek <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Actieve Materialen</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_materials?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-file-audio text-amber-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/bestanden" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer bestanden <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Actieve Locaties</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_locations?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-map-marker-alt text-red-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/locaties" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer locaties <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Actieve Polls</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_polls?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-poll text-green-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/polls" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beheer polls <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Voorstellen</p>
                  <p class="text-3xl font-bold text-gray-900">{stats.total_proposals_pending?.count || 0}</p>
                </div>
                <div class="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-lightbulb text-yellow-600 text-xl"></i>
                </div>
              </div>
              <a href="/admin/voorstellen" class="mt-4 text-sm text-animato-primary hover:underline inline-flex items-center">
                Beoordeel voorstellen <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6 border-2 border-animato-accent">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Gebruikers Activiteit</p>
                  <p class="text-3xl font-bold text-gray-900">
                    <i class="fas fa-chart-line text-animato-accent"></i>
                  </p>
                </div>
                <div class="w-12 h-12 bg-animato-accent bg-opacity-10 rounded-lg flex items-center justify-center">
                  <i class="fas fa-users text-animato-accent text-xl"></i>
                </div>
              </div>
              <a href="/admin/activity" class="mt-4 text-sm text-animato-accent hover:underline inline-flex items-center font-semibold">
                Bekijk login activiteit <i class="fas fa-arrow-right ml-1 text-xs"></i>
              </a>
            </div>
          </div>

          {/* Quick Actions */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-bolt text-animato-accent mr-2"></i>
              Snelle Acties
            </h2>
            <div class="grid grid-cols-2 md:grid-cols-6 gap-4">
              <a href="/admin/leden/nieuw" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-user-plus text-2xl text-animato-primary mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Nieuw Lid</span>
              </a>
              <a href="/admin/content/nieuw?type=nieuws" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-plus-circle text-2xl text-green-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Nieuws Post</span>
              </a>
              <a href="/admin/events/nieuw" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-calendar-plus text-2xl text-purple-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Nieuw Event</span>
              </a>
              <a href="/admin/locaties/nieuw" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-map-marker-alt text-2xl text-red-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Nieuwe Locatie</span>
              </a>
              <a href="/admin/fotoboek" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-images text-2xl text-pink-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Fotoboek</span>
              </a>
              <a href="/admin/activity" class="flex flex-col items-center p-4 border-2 border-animato-accent rounded-lg hover:bg-animato-accent hover:bg-opacity-10 transition">
                <i class="fas fa-chart-line text-2xl text-animato-accent mb-2"></i>
                <span class="text-sm font-medium text-animato-accent font-semibold">Activiteit</span>
              </a>
              <a href="/admin/bestanden/nieuw" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-upload text-2xl text-amber-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Upload Bestand</span>
              </a>
              <a href="/admin/tickets" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-ticket-alt text-2xl text-purple-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Ticketing</span>
              </a>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Stemgroep Breakdown */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-music text-animato-primary mr-2"></i>
                Leden per Stemgroep
              </h2>
              <div class="space-y-3">
                {stemgroepStats.map((stat: any) => {
                  const total = stemgroepStats.reduce((sum: number, s: any) => sum + s.count, 0)
                  const percentage = total > 0 ? Math.round((stat.count / total) * 100) : 0
                  
                  const labels: Record<string, string> = {
                    'sopraan': 'Sopraan',
                    'alt': 'Alt',
                    'tenor': 'Tenor',
                    'bas': 'Bas'
                  }
                  
                  return (
                    <div>
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium text-gray-700">{labels[stat.stemgroep] || stat.stemgroep}</span>
                        <span class="text-sm text-gray-600">{stat.count} leden ({percentage}%)</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          class="bg-animato-primary h-2 rounded-full" 
                          style={`width: ${percentage}%`}
                        ></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Recent Activity */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-history text-animato-secondary mr-2"></i>
                Recente Activiteit
              </h2>
              <div class="space-y-3">
                {recentActivity.length > 0 ? (
                  recentActivity.map((activity: any) => {
                    const actionLabels: Record<string, string> = {
                      'user_login': 'ingelogd',
                      'user_register': 'geregistreerd',
                      'profile_update': 'profiel bijgewerkt',
                      'password_change': 'wachtwoord gewijzigd',
                      'post_create': 'post aangemaakt',
                      'post_update': 'post bijgewerkt',
                      'post_delete': 'post verwijderd',
                      'event_create': 'event aangemaakt',
                      'event_update': 'event bijgewerkt'
                    }
                    
                    const actionLabel = actionLabels[activity.actie] || activity.actie
                    const userName = activity.voornaam && activity.achternaam 
                      ? `${activity.voornaam} ${activity.achternaam}`
                      : activity.email
                    
                    const timeAgo = new Date(activity.created_at).toLocaleDateString('nl-NL', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                    
                    return (
                      <div class="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                        <div class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <i class="fas fa-user text-gray-500 text-sm"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm text-gray-900">
                            <span class="font-medium">{userName}</span> {actionLabel}
                          </p>
                          <p class="text-xs text-gray-500 mt-0.5">{timeAgo}</p>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p class="text-sm text-gray-500 text-center py-4">Geen recente activiteit</p>
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
// MEMBER MANAGEMENT - Overview
// =====================================================

app.get('/admin/leden', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''
  const role = c.req.query('role') || 'all'
  const stemgroep = c.req.query('stemgroep') || 'all'
  const status = c.req.query('status') || 'all'

  // Build query
  let query = `
    SELECT u.id, u.email, u.role, u.stemgroep, u.status, u.created_at, u.last_login_at,
           p.voornaam, p.achternaam, p.telefoon
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE 1=1
  `
  const params: any[] = []

  // Search filter
  if (search) {
    query += ` AND (u.email LIKE ? OR p.voornaam LIKE ? OR p.achternaam LIKE ?)`
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  // Role filter
  if (role !== 'all') {
    query += ` AND u.role = ?`
    params.push(role)
  }

  // Stemgroep filter
  if (stemgroep !== 'all') {
    query += ` AND u.stemgroep = ?`
    params.push(stemgroep)
  }

  // Status filter
  if (status !== 'all') {
    query += ` AND u.status = ?`
    params.push(status)
  }

  query += ` ORDER BY p.achternaam ASC, p.voornaam ASC`

  const leden = await queryAll(c.env.DB, query, params)

  // Get counts for filters
  const counts = {
    all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users`),
    admin: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`),
    moderator: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'moderator'`),
    stemleider: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'stemleider'`),
    lid: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'lid'`),
    actief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'actief'`),
    inactief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'inactief'`),
  }

  return c.html(
    <Layout 
      title="Ledenbeheer" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Leden', href: '/admin/leden' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-users text-animato-primary mr-3"></i>
                  Ledenbeheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer koorleden, rollen en stemgroepen
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
                <a href="/admin/leden/nieuw" class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition">
                  <i class="fas fa-user-plus mr-2"></i>
                  Nieuw Lid
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Stats Bar */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <div class="text-center">
                <p class="text-2xl font-bold text-gray-900">{counts.all?.count || 0}</p>
                <p class="text-sm text-gray-600">Totaal</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-animato-primary">{counts.lid?.count || 0}</p>
                <p class="text-sm text-gray-600">Leden</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-purple-600">{counts.stemleider?.count || 0}</p>
                <p class="text-sm text-gray-600">Stemleiders</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-amber-600">{counts.moderator?.count || 0}</p>
                <p class="text-sm text-gray-600">Moderators</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-red-600">{counts.admin?.count || 0}</p>
                <p class="text-sm text-gray-600">Admins</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-green-600">{counts.actief?.count || 0}</p>
                <p class="text-sm text-gray-600">Actief</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-gray-400">{counts.inactief?.count || 0}</p>
                <p class="text-sm text-gray-600">Inactief</p>
              </div>
            </div>
          </div>

          {/* Filters & Search */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <form method="GET" action="/admin/leden" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Zoeken</label>
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Naam of email..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Rol</label>
                  <select
                    name="role"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={role === 'all'}>Alle rollen</option>
                    <option value="lid" selected={role === 'lid'}>Lid</option>
                    <option value="stemleider" selected={role === 'stemleider'}>Stemleider</option>
                    <option value="moderator" selected={role === 'moderator'}>Moderator</option>
                    <option value="admin" selected={role === 'admin'}>Admin</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Stemgroep</label>
                  <select
                    name="stemgroep"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={stemgroep === 'all'}>Alle stemmen</option>
                    <option value="S" selected={stemgroep === 'S'}>Sopraan (S)</option>
                    <option value="A" selected={stemgroep === 'A'}>Alt (A)</option>
                    <option value="T" selected={stemgroep === 'T'}>Tenor (T)</option>
                    <option value="B" selected={stemgroep === 'B'}>Bas (B)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    name="status"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={status === 'all'}>Alle statussen</option>
                    <option value="actief" selected={status === 'actief'}>Actief</option>
                    <option value="inactief" selected={status === 'inactief'}>Inactief</option>
                  </select>
                </div>
              </div>
              <div class="flex justify-between items-center">
                <p class="text-sm text-gray-600">
                  {leden.length} {leden.length === 1 ? 'lid' : 'leden'} gevonden
                </p>
                <div class="flex gap-2">
                  <a href="/admin/leden" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                    Reset
                  </a>
                  <button
                    type="submit"
                    class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                  >
                    <i class="fas fa-search mr-2"></i>
                    Zoeken
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Members Table */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Naam
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Stemgroep
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rol
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Laatste Login
                    </th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acties
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {leden.length > 0 ? (
                    leden.map((lid: any) => {
                      const roleLabels: Record<string, string> = {
                        'admin': 'Admin',
                        'moderator': 'Moderator',
                        'stemleider': 'Stemleider',
                        'lid': 'Lid',
                        'bezoeker': 'Bezoeker'
                      }
                      
                      const stemgroepLabels: Record<string, string> = {
                        'S': 'Sopraan',
                        'A': 'Alt',
                        'T': 'Tenor',
                        'B': 'Bas'
                      }
                      
                      const roleColors: Record<string, string> = {
                        'admin': 'bg-red-100 text-red-800',
                        'moderator': 'bg-amber-100 text-amber-800',
                        'stemleider': 'bg-purple-100 text-purple-800',
                        'lid': 'bg-blue-100 text-blue-800',
                        'bezoeker': 'bg-gray-100 text-gray-800'
                      }
                      
                      const lastLogin = lid.last_login_at 
                        ? new Date(lid.last_login_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Nooit'
                      
                      return (
                        <tr class="hover:bg-gray-50 transition">
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="flex items-center">
                              <div class="w-10 h-10 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white font-bold text-sm mr-3">
                                {lid.voornaam?.charAt(0) || 'U'}{lid.achternaam?.charAt(0) || ''}
                              </div>
                              <div>
                                <div class="text-sm font-medium text-gray-900">
                                  {lid.voornaam} {lid.achternaam}
                                </div>
                                {lid.telefoon && (
                                  <div class="text-xs text-gray-500">
                                    <i class="fas fa-phone mr-1"></i>
                                    {lid.telefoon}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-900">{lid.email}</div>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-900">
                              {lid.stemgroep ? (
                                <>
                                  <i class="fas fa-music text-animato-primary mr-1"></i>
                                  {stemgroepLabels[lid.stemgroep] || lid.stemgroep}
                                </>
                              ) : (
                                <span class="text-gray-400">-</span>
                              )}
                            </div>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <span class={`px-2 py-1 text-xs font-semibold rounded-full ${roleColors[lid.role] || 'bg-gray-100 text-gray-800'}`}>
                              {roleLabels[lid.role] || lid.role}
                            </span>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            {lid.status === 'actief' ? (
                              <span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                <i class="fas fa-check-circle mr-1"></i>
                                Actief
                              </span>
                            ) : (
                              <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                <i class="fas fa-times-circle mr-1"></i>
                                Inactief
                              </span>
                            )}
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {lastLogin}
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <a href={`/admin/leden/${lid.id}`} class="text-animato-primary hover:text-animato-secondary mr-3">
                              <i class="fas fa-edit"></i>
                            </a>
                            <button
                              onclick={`if(confirm('Weet je zeker dat je ${lid.voornaam} ${lid.achternaam} wilt verwijderen?')) { window.location.href='/api/admin/leden/${lid.id}/delete' }`}
                              class="text-red-600 hover:text-red-900"
                            >
                              <i class="fas fa-trash"></i>
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                        <i class="fas fa-users text-4xl mb-3 block text-gray-300"></i>
                        <p class="text-lg">Geen leden gevonden</p>
                        <p class="text-sm mt-1">Pas je zoekfilters aan of voeg een nieuw lid toe</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// NEW MEMBER PAGE
// =====================================================

app.get('/admin/leden/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  const error = c.req.query('error')
  
  return c.html(
    <Layout 
      title="Nieuw Lid Toevoegen"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Leden', href: '/admin/leden' },
        { label: 'Nieuw Lid', href: '/admin/leden/nieuw' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-user-plus text-animato-primary mr-3"></i>
                  Nieuw Lid Toevoegen
                </h1>
                <p class="mt-2 text-gray-600">
                  Vul onderstaande gegevens in om een nieuw lid aan te maken
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin/leden" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug naar Leden
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Error Messages */}
          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              <i class="fas fa-exclamation-circle mr-3"></i>
              {error === 'required_fields' && 'Niet alle verplichte velden zijn ingevuld.'}
              {error === 'passwords_dont_match' && 'Wachtwoorden komen niet overeen.'}
              {error === 'password_too_short' && 'Wachtwoord moet minimaal 8 karakters lang zijn.'}
              {error === 'email_exists' && 'Dit e-mailadres bestaat al in het systeem.'}
              {error === 'create_failed' && 'Er is een fout opgetreden bij het aanmaken van het lid. Probeer opnieuw.'}
            </div>
          )}

          {/* Create Form */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <form action="/api/admin/leden/create" method="POST" class="space-y-6">

              {/* Personal Information */}
              <div>
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-user text-animato-primary mr-2"></i>
                  Persoonlijke Informatie
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Voornaam *
                    </label>
                    <input
                      type="text"
                      name="voornaam"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Achternaam *
                    </label>
                    <input
                      type="text"
                      name="achternaam"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="email"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Telefoon
                    </label>
                    <input
                      type="tel"
                      name="telefoon"
                      placeholder="+32 123 45 67 89"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div class="mt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Adres
                  </label>
                  <textarea
                    name="adres"
                    rows={2}
                    placeholder="Straat 123, 1000 Brussel"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                </div>
              </div>

              {/* Role & Permissions */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-shield-alt text-animato-accent mr-2"></i>
                  Rol & Rechten
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Rol *
                    </label>
                    <select
                      name="role"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="bezoeker">Bezoeker</option>
                      <option value="lid" selected>Lid</option>
                      <option value="stemleider">Stemleider</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Stemgroep
                    </label>
                    <select
                      name="stemgroep"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="">Geen stemgroep</option>
                      <option value="S">Sopraan (S)</option>
                      <option value="A">Alt (A)</option>
                      <option value="T">Tenor (T)</option>
                      <option value="B">Bas (B)</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Status *
                    </label>
                    <select
                      name="status"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="actief" selected>Actief</option>
                      <option value="inactief">Inactief</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Password */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-key text-purple-600 mr-2"></i>
                  Wachtwoord
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Wachtwoord *
                    </label>
                    <input
                      type="password"
                      name="password"
                      required
                      minlength="8"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                    <p class="text-xs text-gray-500 mt-1">Minimaal 8 karakters</p>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Wachtwoord Bevestigen *
                    </label>
                    <input
                      type="password"
                      name="password_confirm"
                      required
                      minlength="8"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Musical Experience */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-music text-animato-primary mr-2"></i>
                  Muzikale Informatie (optioneel)
                </h3>
                
                <div class="mb-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Bio
                  </label>
                  <textarea
                    name="bio"
                    rows={3}
                    placeholder="Korte beschrijving..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Muzikale Ervaring
                  </label>
                  <textarea
                    name="muzikale_ervaring"
                    rows={3}
                    placeholder="Eerdere koorervaring, instrumenten, opleidingen..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                </div>
              </div>

              {/* Action Buttons */}
              <div class="flex justify-between items-center pt-6 border-t border-gray-200">
                <a
                  href="/admin/leden"
                  class="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                >
                  <i class="fas fa-times mr-2"></i>
                  Annuleren
                </a>
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-save mr-2"></i>
                  Lid Aanmaken
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
// MEMBER EDIT PAGE
// =====================================================

app.get('/admin/leden/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get member details
  const member = await queryOne<any>(
    c.env.DB,
    `SELECT u.*, p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  )

  if (!member) {
    return c.redirect('/admin/leden?error=not_found')
  }

  return c.html(
    <Layout 
      title={`Bewerk ${member.voornaam} ${member.achternaam}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Leden', href: '/admin/leden' },
        { label: `${member.voornaam} ${member.achternaam}`, href: `/admin/leden/${userId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-user-edit text-animato-primary mr-3"></i>
                  Bewerk Lid
                </h1>
                <p class="mt-2 text-gray-600">
                  {member.voornaam} {member.achternaam} ({member.email})
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin/leden" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug naar Leden
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Success/Error Messages */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 mr-3"></i>
                <div class="text-sm text-green-800">
                  Lid succesvol bijgewerkt
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
                <div class="text-sm text-red-800">
                  {error === 'update_failed' && 'Er is iets misgegaan bij het bijwerken'}
                  {error === 'not_found' && 'Lid niet gevonden'}
                </div>
              </div>
            </div>
          )}

          {/* Profile Card */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="flex items-center mb-6 pb-6 border-b border-gray-200">
              <div class="w-20 h-20 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {member.voornaam?.charAt(0) || 'U'}{member.achternaam?.charAt(0) || ''}
              </div>
              <div class="ml-6">
                <h2 class="text-2xl font-bold text-gray-900">
                  {member.voornaam} {member.achternaam}
                </h2>
                <div class="flex items-center gap-4 mt-2 text-sm">
                  <span class={`px-2 py-1 rounded-full text-xs font-semibold ${
                    member.status === 'actief' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {member.status === 'actief' ? 'Actief' : 'Inactief'}
                  </span>
                  <span class="text-gray-600">
                    Lid sinds {new Date(member.created_at).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit Form */}
            <form action="/api/admin/leden/update" method="POST" class="space-y-6">
              <input type="hidden" name="user_id" value={member.id} />

              {/* Personal Information */}
              <div>
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-user text-animato-primary mr-2"></i>
                  Persoonlijke Informatie
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Voornaam *
                    </label>
                    <input
                      type="text"
                      name="voornaam"
                      value={member.voornaam || ''}
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Achternaam *
                    </label>
                    <input
                      type="text"
                      name="achternaam"
                      value={member.achternaam || ''}
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={member.email}
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Telefoon
                    </label>
                    <input
                      type="tel"
                      name="telefoon"
                      value={member.telefoon || ''}
                      placeholder="+32 123 45 67 89"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div class="mt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Adres
                  </label>
                  <textarea
                    name="adres"
                    rows={2}
                    placeholder="Straat 123, 1000 Brussel"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >{member.adres || ''}</textarea>
                </div>
              </div>

              {/* Role & Permissions */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-shield-alt text-animato-accent mr-2"></i>
                  Rol & Rechten
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Rol *
                    </label>
                    <select
                      name="role"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="bezoeker" selected={member.role === 'bezoeker'}>Bezoeker</option>
                      <option value="lid" selected={member.role === 'lid'}>Lid</option>
                      <option value="stemleider" selected={member.role === 'stemleider'}>Stemleider</option>
                      <option value="moderator" selected={member.role === 'moderator'}>Moderator</option>
                      <option value="admin" selected={member.role === 'admin'}>Admin</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Stemgroep
                    </label>
                    <select
                      name="stemgroep"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="" selected={!member.stemgroep}>Geen stemgroep</option>
                      <option value="S" selected={member.stemgroep === 'S'}>Sopraan (S)</option>
                      <option value="A" selected={member.stemgroep === 'A'}>Alt (A)</option>
                      <option value="T" selected={member.stemgroep === 'T'}>Tenor (T)</option>
                      <option value="B" selected={member.stemgroep === 'B'}>Bas (B)</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Status *
                    </label>
                    <select
                      name="status"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="actief" selected={member.status === 'actief'}>Actief</option>
                      <option value="inactief" selected={member.status === 'inactief'}>Inactief</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Musical Experience */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-music text-animato-primary mr-2"></i>
                  Muzikale Informatie
                </h3>
                
                <div class="mb-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Bio
                  </label>
                  <textarea
                    name="bio"
                    rows={3}
                    placeholder="Korte beschrijving..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >{member.bio || ''}</textarea>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Muzikale Ervaring
                  </label>
                  <textarea
                    name="muzikale_ervaring"
                    rows={3}
                    placeholder="Eerdere koorervaring, instrumenten, opleidingen..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >{member.muzikale_ervaring || ''}</textarea>
                </div>
              </div>

              {/* Action Buttons */}
              <div class="flex justify-between items-center pt-6 border-t border-gray-200">
                <button
                  type="button"
                  onclick={`if(confirm('Weet je zeker dat je ${member.voornaam} ${member.achternaam} wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.')) { window.location.href='/api/admin/leden/${member.id}/delete' }`}
                  class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  <i class="fas fa-trash mr-2"></i>
                  Verwijder Lid
                </button>
                <div class="flex gap-3">
                  <a
                    href="/admin/leden"
                    class="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    Annuleren
                  </a>
                  <button
                    type="submit"
                    class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                  >
                    <i class="fas fa-save mr-2"></i>
                    Opslaan
                  </button>
                </div>
              </div>
            </form>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// MEMBER CREATE API
// =====================================================

app.post('/api/admin/leden/create', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const {
      voornaam,
      achternaam,
      email,
      telefoon,
      adres,
      role,
      stemgroep,
      status,
      password,
      password_confirm,
      bio,
      muzikale_ervaring
    } = body

    // Validation
    if (!voornaam || !achternaam || !email || !role || !status || !password) {
      return c.redirect('/admin/leden/nieuw?error=required_fields')
    }

    // Password validation
    if (password !== password_confirm) {
      return c.redirect('/admin/leden/nieuw?error=passwords_dont_match')
    }

    if ((password as string).length < 8) {
      return c.redirect('/admin/leden/nieuw?error=password_too_short')
    }

    // Check if email already exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first()

    if (existingUser) {
      return c.redirect('/admin/leden/nieuw?error=email_exists')
    }

    // Hash password using PBKDF2
    const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    const encoder = new TextEncoder()
    const passwordData = encoder.encode(password as string)
    const saltData = encoder.encode(salt)
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits']
    )
    
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltData,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    )
    
    const hashArray = Array.from(new Uint8Array(derivedBits))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    const password_hash = `${salt}:${hashHex}`

    // Insert user
    const userResult = await c.env.DB.prepare(
      `INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(email, password_hash, role, stemgroep || null, status).run()

    const newUserId = userResult.meta.last_row_id

    // Insert profile
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, adres, bio, muzikale_ervaring)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(newUserId, voornaam, achternaam, telefoon || null, adres || null, bio || null, muzikale_ervaring || null).run()

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'user_create', 'user', ?, ?)`
    ).bind(
      user.id,
      newUserId,
      JSON.stringify({ created_by: 'admin', email, role })
    ).run()

    return c.redirect(`/admin/leden/${newUserId}?success=created`)
  } catch (error) {
    console.error('Member create error:', error)
    return c.redirect('/admin/leden/nieuw?error=create_failed')
  }
})

// =====================================================
// MEMBER UPDATE API
// =====================================================

app.post('/api/admin/leden/update', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const {
      user_id,
      voornaam,
      achternaam,
      email,
      telefoon,
      adres,
      role,
      stemgroep,
      status,
      bio,
      muzikale_ervaring
    } = body

    // Validation
    if (!user_id || !voornaam || !achternaam || !email || !role || !status) {
      return c.redirect(`/admin/leden/${user_id}?error=required_fields`)
    }

    // Update user table
    await c.env.DB.prepare(
      `UPDATE users 
       SET email = ?, role = ?, stemgroep = ?, status = ?
       WHERE id = ?`
    ).bind(email, role, stemgroep || null, status, user_id).run()

    // Update profile table
    await c.env.DB.prepare(
      `UPDATE profiles 
       SET voornaam = ?, achternaam = ?, telefoon = ?, adres = ?, bio = ?, muzikale_ervaring = ?
       WHERE user_id = ?`
    ).bind(voornaam, achternaam, telefoon || null, adres || null, bio || null, muzikale_ervaring || null, user_id).run()

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'user_update', 'user', ?, ?)`
    ).bind(
      user.id,
      user_id,
      JSON.stringify({ updated_by: 'admin', fields: Object.keys(body) })
    ).run()

    return c.redirect(`/admin/leden/${user_id}?success=true`)
  } catch (error) {
    console.error('Member update error:', error)
    return c.redirect(`/admin/leden?error=update_failed`)
  }
})

// =====================================================
// MEMBER DELETE API
// =====================================================

app.get('/api/admin/leden/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')

  try {
    // Don't allow deleting yourself
    if (userId === user.id.toString()) {
      return c.redirect('/admin/leden?error=cannot_delete_self')
    }

    // Audit log before deletion
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'user_delete', 'user', ?, ?)`
    ).bind(user.id, userId, JSON.stringify({ deleted_by: 'admin' })).run()

    // Delete profile first (foreign key)
    await c.env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId).run()

    // Delete user
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()

    return c.redirect('/admin/leden?success=deleted')
  } catch (error) {
    console.error('Member delete error:', error)
    return c.redirect('/admin/leden?error=delete_failed')
  }
})

// =====================================================
// CONTENT MANAGEMENT - Overview
// =====================================================

app.get('/admin/content', async (c) => {
  const user = c.get('user') as SessionUser
  const tab = c.req.query('tab') || 'posts'
  const search = c.req.query('search') || ''
  const type = c.req.query('type') || 'all'

  let content: any[] = []

  if (tab === 'posts') {
    // Get posts (nieuws + board)
    let query = `
      SELECT p.id, p.type, p.titel, p.slug, p.is_published, p.zichtbaarheid, p.created_at, p.published_at,
             u.email as auteur_email, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam,
             (SELECT COUNT(*) FROM post_replies WHERE post_id = p.id) as reply_count
      FROM posts p
      LEFT JOIN users u ON u.id = p.auteur_id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      WHERE 1=1
    `
    const params: any[] = []

    if (search) {
      query += ` AND (p.titel LIKE ? OR p.excerpt LIKE ?)`
      params.push(`%${search}%`, `%${search}%`)
    }

    if (type !== 'all') {
      query += ` AND p.type = ?`
      params.push(type)
    }

    query += ` ORDER BY p.created_at DESC LIMIT 50`

    content = await queryAll(c.env.DB, query, params)
  } else if (tab === 'events') {
    // Get events
    let query = `
      SELECT e.id, e.type, e.titel, e.slug, e.start_at, e.end_at, e.locatie, e.is_publiek, e.doelgroep, e.created_at
      FROM events e
      WHERE 1=1
    `
    const params: any[] = []

    if (search) {
      query += ` AND (e.titel LIKE ? OR e.locatie LIKE ?)`
      params.push(`%${search}%`, `%${search}%`)
    }

    if (type !== 'all') {
      query += ` AND e.type = ?`
      params.push(type)
    }

    query += ` ORDER BY e.start_at DESC LIMIT 50`

    content = await queryAll(c.env.DB, query, params)
  }

  // Get counts
  const counts = {
    posts_all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM posts`),
    posts_nieuws: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM posts WHERE type = 'nieuws'`),
    posts_board: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM posts WHERE type = 'board'`),
    posts_published: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM posts WHERE is_published = 1`),
    events_all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM events`),
    events_repetitie: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM events WHERE type = 'repetitie'`),
    events_concert: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM events WHERE type = 'concert'`),
    events_upcoming: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM events WHERE start_at > datetime('now')`),
  }

  return c.html(
    <Layout 
      title="Content Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Content', href: '/admin/content' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-file-alt text-green-600 mr-3"></i>
                  Content Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer nieuws, berichten en agenda
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
                <a 
                  href={`/admin/content/nieuw?type=${tab === 'posts' ? 'nieuws' : 'event'}`}
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuw {tab === 'posts' ? 'Bericht' : 'Event'}
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Tabs */}
          <div class="bg-white rounded-lg shadow-md mb-6">
            <div class="border-b border-gray-200">
              <nav class="flex -mb-px">
                <a
                  href="/admin/content?tab=posts"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    tab === 'posts'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-newspaper mr-2"></i>
                  Posts ({counts.posts_all?.count || 0})
                </a>
                <a
                  href="/admin/content?tab=events"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    tab === 'events'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-calendar mr-2"></i>
                  Events ({counts.events_all?.count || 0})
                </a>
              </nav>
            </div>

            {/* Stats Bar */}
            <div class="p-6 border-b border-gray-200">
              {tab === 'posts' ? (
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div class="text-center">
                    <p class="text-2xl font-bold text-gray-900">{counts.posts_all?.count || 0}</p>
                    <p class="text-sm text-gray-600">Totaal</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-blue-600">{counts.posts_nieuws?.count || 0}</p>
                    <p class="text-sm text-gray-600">Nieuws</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-purple-600">{counts.posts_board?.count || 0}</p>
                    <p class="text-sm text-gray-600">Board Posts</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-green-600">{counts.posts_published?.count || 0}</p>
                    <p class="text-sm text-gray-600">Gepubliceerd</p>
                  </div>
                </div>
              ) : (
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div class="text-center">
                    <p class="text-2xl font-bold text-gray-900">{counts.events_all?.count || 0}</p>
                    <p class="text-sm text-gray-600">Totaal</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-blue-600">{counts.events_repetitie?.count || 0}</p>
                    <p class="text-sm text-gray-600">Repetities</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-purple-600">{counts.events_concert?.count || 0}</p>
                    <p class="text-sm text-gray-600">Concerten</p>
                  </div>
                  <div class="text-center">
                    <p class="text-2xl font-bold text-green-600">{counts.events_upcoming?.count || 0}</p>
                    <p class="text-sm text-gray-600">Aankomend</p>
                  </div>
                </div>
              )}
            </div>

            {/* Filters */}
            <div class="p-6">
              <form method="GET" action="/admin/content" class="flex gap-4">
                <input type="hidden" name="tab" value={tab} />
                <div class="flex-1">
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoeken..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <select
                    name="type"
                    class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={type === 'all'}>Alle types</option>
                    {tab === 'posts' ? (
                      <>
                        <option value="nieuws" selected={type === 'nieuws'}>Nieuws</option>
                        <option value="board" selected={type === 'board'}>Board</option>
                      </>
                    ) : (
                      <>
                        <option value="repetitie" selected={type === 'repetitie'}>Repetitie</option>
                        <option value="concert" selected={type === 'concert'}>Concert</option>
                        <option value="uitstap" selected={type === 'uitstap'}>Uitstap</option>
                      </>
                    )}
                  </select>
                </div>
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-search"></i>
                </button>
              </form>
            </div>
          </div>

          {/* Content List */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Titel
                    </th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    {tab === 'posts' ? (
                      <>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Auteur
                        </th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reacties
                        </th>
                      </>
                    ) : (
                      <>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Datum
                        </th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Locatie
                        </th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Zichtbaar
                        </th>
                      </>
                    )}
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acties
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {content.length > 0 ? (
                    content.map((item: any) => (
                      <tr class="hover:bg-gray-50 transition">
                        <td class="px-6 py-4">
                          <div class="text-sm font-medium text-gray-900">{item.titel}</div>
                          <div class="text-xs text-gray-500">{item.slug}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <span class={`px-2 py-1 text-xs font-semibold rounded-full ${
                            item.type === 'nieuws' ? 'bg-blue-100 text-blue-800' :
                            item.type === 'board' ? 'bg-purple-100 text-purple-800' :
                            item.type === 'repetitie' ? 'bg-green-100 text-green-800' :
                            item.type === 'concert' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {item.type}
                          </span>
                        </td>
                        {tab === 'posts' ? (
                          <>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {item.auteur_voornaam} {item.auteur_achternaam}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                              {item.is_published ? (
                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                  Gepubliceerd
                                </span>
                              ) : (
                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                  Concept
                                </span>
                              )}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <i class="fas fa-comment mr-1"></i>
                              {item.reply_count || 0}
                            </td>
                          </>
                        ) : (
                          <>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {new Date(item.start_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td class="px-6 py-4 text-sm text-gray-900">
                              {item.locatie || '-'}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                              {item.is_publiek ? (
                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                  Publiek
                                </span>
                              ) : (
                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                  Leden
                                </span>
                              )}
                            </td>
                          </>
                        )}
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <a 
                            href={`/admin/content/${item.id}?type=${tab}`} 
                            class="text-animato-primary hover:text-animato-secondary mr-3"
                          >
                            <i class="fas fa-edit"></i>
                          </a>
                          <button
                            onclick={`if(confirm('Weet je zeker dat je "${item.titel}" wilt verwijderen?')) { window.location.href='/api/admin/content/${item.id}/delete?type=${tab}' }`}
                            class="text-red-600 hover:text-red-900"
                          >
                            <i class="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colspan={tab === 'posts' ? '6' : '6'} class="px-6 py-12 text-center text-gray-500">
                        <i class="fas fa-inbox text-4xl mb-3 block text-gray-300"></i>
                        <p class="text-lg">Geen content gevonden</p>
                        <p class="text-sm mt-1">Pas je zoekfilters aan of voeg nieuwe content toe</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// POST EDIT/CREATE PAGE
// =====================================================

app.get('/admin/content/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const postId = c.req.param('id')
  const contentType = c.req.query('type') || 'posts'
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get post if editing (id !== 'nieuw')
  let post: any = null
  if (postId !== 'nieuw') {
    post = await queryOne<any>(
      c.env.DB,
      `SELECT p.*, u.email as auteur_email, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam
       FROM posts p
       LEFT JOIN users u ON u.id = p.auteur_id
       LEFT JOIN profiles pr ON pr.user_id = u.id
       WHERE p.id = ?`,
      [postId]
    )

    if (!post) {
      return c.redirect('/admin/content?error=not_found')
    }
  }

  const isNew = postId === 'nieuw'
  const pageTitle = isNew ? 'Nieuwe Post' : `Bewerk: ${post.titel}`

  return c.html(
    <Layout 
      title={pageTitle}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Content', href: '/admin/content' },
        { label: isNew ? 'Nieuw' : post.titel, href: `/admin/content/${postId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-edit text-green-600 mr-3"></i>
                  {isNew ? 'Nieuwe Post' : 'Bewerk Post'}
                </h1>
                <p class="mt-2 text-gray-600">
                  {isNew ? 'Maak een nieuwe post aan' : `Bewerk "${post.titel}"`}
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin/content" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Success/Error Messages */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 mr-3"></i>
                <div class="text-sm text-green-800">
                  {success === 'created' && 'Post succesvol aangemaakt'}
                  {success === 'updated' && 'Post succesvol bijgewerkt'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
                <div class="text-sm text-red-800">
                  {error === 'save_failed' && 'Er is iets misgegaan bij het opslaan'}
                  {error === 'not_found' && 'Post niet gevonden'}
                  {error === 'required_fields' && 'Vul alle verplichte velden in'}
                  {error === 'body_missing' && 'De inhoud (body) van de post ontbreekt. Vul de hoofdtekst in.'}
                </div>
              </div>
            </div>
          )}

          {/* Edit Form */}
          <form action="/api/admin/content/save" method="POST" class="bg-white rounded-lg shadow-md p-6 space-y-6">
            <input type="hidden" name="post_id" value={post?.id || ''} />
            <input type="hidden" name="is_new" value={isNew ? '1' : '0'} />

            {/* Basic Information */}
            <div>
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                <i class="fas fa-info-circle text-animato-primary mr-2"></i>
                Basis Informatie
              </h3>

              <div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Type *
                    </label>
                    <select
                      name="type"
                      required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="nieuws" selected={post?.type === 'nieuws' || (!post && contentType !== 'event')}>Nieuws</option>
                      <option value="event" selected={post?.type === 'event' || (!post && contentType === 'event')}>Event</option>
                      <option value="board" selected={post?.type === 'board'}>Board Post</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Categorie
                    </label>
                    <select
                      name="categorie"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="" selected={!post?.categorie}>Geen categorie</option>
                      <option value="algemeen" selected={post?.categorie === 'algemeen'}>Algemeen</option>
                      <option value="sopraan" selected={post?.categorie === 'sopraan'}>Sopraan</option>
                      <option value="alt" selected={post?.categorie === 'alt'}>Alt</option>
                      <option value="tenor" selected={post?.categorie === 'tenor'}>Tenor</option>
                      <option value="bas" selected={post?.categorie === 'bas'}>Bas</option>
                      <option value="bestuur" selected={post?.categorie === 'bestuur'}>Bestuur</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Titel *
                  </label>
                  <input
                    type="text"
                    id="titel-input"
                    name="titel"
                    value={post?.titel || ''}
                    required
                    placeholder="Bijv. Lenteconcert 2025 - Aankondiging"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Slug (URL-vriendelijk) *
                  </label>
                  <input
                    type="text"
                    id="slug-input"
                    name="slug"
                    value={post?.slug || ''}
                    required
                    placeholder="lenteconcert-2025-aankondiging"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <p class="mt-1 text-xs text-gray-500">
                    Alleen kleine letters, cijfers en koppeltekens. Automatisch gegenereerd als je dit leeg laat.
                  </p>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Excerpt (korte samenvatting)
                  </label>
                  <textarea
                    name="excerpt"
                    rows={2}
                    placeholder="Korte samenvatting voor in lijsten..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >{post?.excerpt || ''}</textarea>
                </div>
              </div>
            </div>

            {/* Content */}
            <div class="pt-6 border-t border-gray-200">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                <i class="fas fa-align-left text-animato-primary mr-2"></i>
                Inhoud
              </h3>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  Body (hoofdtekst) *
                </label>
                <textarea
                  id="body-editor"
                  name="body"
                  rows={12}
                  required
                  placeholder="Volledige inhoud van de post..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{post?.body || ''}</textarea>
                <p class="mt-2 text-xs text-gray-500">
                  <i class="fas fa-info-circle mr-1"></i>
                  Gebruik de editor toolbar voor opmaak. HTML wordt automatisch gegenereerd.
                </p>
              </div>
            </div>

            {/* Publishing */}
            <div class="pt-6 border-t border-gray-200">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                <i class="fas fa-globe text-animato-accent mr-2"></i>
                Publicatie
              </h3>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Zichtbaarheid *
                  </label>
                  <select
                    name="zichtbaarheid"
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="publiek" selected={post?.zichtbaarheid === 'publiek' || !post}>Publiek</option>
                    <option value="leden" selected={post?.zichtbaarheid === 'leden'}>Alleen Leden</option>
                    <option value="sopraan" selected={post?.zichtbaarheid === 'sopraan'}>Alleen Sopraan</option>
                    <option value="alt" selected={post?.zichtbaarheid === 'alt'}>Alleen Alt</option>
                    <option value="tenor" selected={post?.zichtbaarheid === 'tenor'}>Alleen Tenor</option>
                    <option value="bas" selected={post?.zichtbaarheid === 'bas'}>Alleen Bas</option>
                  </select>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Status *
                  </label>
                  <select
                    name="is_published"
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="0" selected={post?.is_published === 0}>Concept (niet gepubliceerd)</option>
                    <option value="1" selected={post?.is_published === 1 || !post}>Gepubliceerd</option>
                  </select>
                </div>
              </div>

              <div class="mt-4 flex items-center">
                <input
                  type="checkbox"
                  name="is_pinned"
                  id="is_pinned"
                  value="1"
                  checked={post?.is_pinned === 1}
                  class="w-4 h-4 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                />
                <label for="is_pinned" class="ml-2 text-sm text-gray-700">
                  Pin dit bericht bovenaan (voor belangrijke berichten)
                </label>
              </div>
            </div>

            {/* Meta Information */}
            {!isNew && post && (
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-info text-gray-400 mr-2"></i>
                  Meta Informatie
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                  <div>
                    <span class="font-medium">Auteur:</span> {post.auteur_voornaam} {post.auteur_achternaam}
                  </div>
                  <div>
                    <span class="font-medium">Aangemaakt:</span> {new Date(post.created_at).toLocaleString('nl-NL')}
                  </div>
                  <div>
                    <span class="font-medium">Views:</span> {post.views || 0}
                  </div>
                  {post.published_at && (
                    <div>
                      <span class="font-medium">Gepubliceerd:</span> {new Date(post.published_at).toLocaleString('nl-NL')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div class="flex justify-between items-center pt-6 border-t border-gray-200">
              {!isNew && post && (
                <button
                  type="button"
                  onclick={`if(confirm('Weet je zeker dat je "${post.titel}" wilt verwijderen?')) { window.location.href='/api/admin/content/${post.id}/delete?type=posts' }`}
                  class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  <i class="fas fa-trash mr-2"></i>
                  Verwijder
                </button>
              )}
              {isNew && <div></div>}
              <div class="flex gap-3">
                <a
                  href="/admin/content"
                  class="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Annuleren
                </a>
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                >
                  <i class="fas fa-save mr-2"></i>
                  {isNew ? 'Aanmaken' : 'Opslaan'}
                </button>
              </div>
            </div>
          </form>

          {/* Quill Rich Text Editor */}
          <link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet" />
          <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
          
          <script dangerouslySetInnerHTML={{
            __html: `
              // Wait for Quill to load
              document.addEventListener('DOMContentLoaded', function() {
                // Hide original textarea
                const textarea = document.getElementById('body-editor');
                if (!textarea) return;
                
                textarea.style.display = 'none';
                
                // Create editor container
                const editorContainer = document.createElement('div');
                editorContainer.id = 'quill-editor';
                editorContainer.style.height = '400px';
                editorContainer.style.backgroundColor = 'white';
                textarea.parentNode.insertBefore(editorContainer, textarea);
                
                // Initialize Quill
                const quill = new Quill('#quill-editor', {
                  theme: 'snow',
                  modules: {
                    toolbar: [
                      [{ 'header': [1, 2, 3, 4, false] }],
                      ['bold', 'italic', 'underline', 'strike'],
                      [{ 'color': [] }, { 'background': [] }],
                      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                      [{ 'indent': '-1'}, { 'indent': '+1' }],
                      [{ 'align': [] }],
                      ['blockquote', 'code-block'],
                      ['link', 'image', 'video'],
                      ['clean']
                    ]
                  },
                  placeholder: 'Schrijf hier je artikel...'
                });
                
                // Set initial content from textarea
                if (textarea.value) {
                  quill.root.innerHTML = textarea.value;
                }
                
                // Sync content back to textarea on change
                quill.on('text-change', function() {
                  textarea.value = quill.root.innerHTML;
                });
                
                // Sync on form submit
                const form = textarea.closest('form');
                if (form) {
                  form.addEventListener('submit', function() {
                    textarea.value = quill.root.innerHTML;
                  });
                }
                
                console.log('Quill editor initialized');
              });
              
              // Auto-generate slug from title
              (function() {
                const titelInput = document.getElementById('titel-input');
                const slugInput = document.getElementById('slug-input');
                
                if (!titelInput || !slugInput) return;
                
                // Only auto-generate if slug is empty
                const isNewPost = ${isNew ? 'true' : 'false'};
                let userEditedSlug = !isNewPost; // If editing existing post, don't auto-generate
                
                function generateSlug(text) {
                  return text
                    .toLowerCase()
                    .replace(/[àáâãäå]/g, 'a')
                    .replace(/[èéêë]/g, 'e')
                    .replace(/[ìíîï]/g, 'i')
                    .replace(/[òóôõö]/g, 'o')
                    .replace(/[ùúûü]/g, 'u')
                    .replace(/[ñ]/g, 'n')
                    .replace(/[ç]/g, 'c')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                }
                
                titelInput.addEventListener('input', function() {
                  if (!userEditedSlug) {
                    slugInput.value = generateSlug(this.value);
                  }
                });
                
                slugInput.addEventListener('input', function() {
                  userEditedSlug = true;
                });
                
                // Initial generation if slug is empty
                if (isNewPost && !slugInput.value && titelInput.value) {
                  slugInput.value = generateSlug(titelInput.value);
                }
              })();
            `
          }}></script>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// POST SAVE API (Create/Update)
// =====================================================

app.post('/api/admin/content/save', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const {
      post_id,
      is_new,
      type,
      categorie,
      titel,
      slug,
      excerpt,
      body: postBody,
      zichtbaarheid,
      is_published,
      is_pinned
    } = body

    // Debug logging
    console.log('Received body keys:', Object.keys(body))
    console.log('postBody value:', postBody)

    // Validation - check if body field exists and is not empty string
    if (!titel || !type || !zichtbaarheid) {
      const redirectUrl = is_new === '1' ? '/admin/content/nieuw' : `/admin/content/${post_id}`
      return c.redirect(`${redirectUrl}?error=required_fields`)
    }

    // Check specifically for body field
    if (postBody === undefined || postBody === null) {
      console.error('Body field is missing from request')
      const redirectUrl = is_new === '1' ? '/admin/content/nieuw' : `/admin/content/${post_id}`
      return c.redirect(`${redirectUrl}?error=body_missing`)
    }

    // Allow empty string for body, but must be present
    const finalBody = String(postBody || '')

    // Generate slug if empty
    const finalSlug = slug || titel.toString().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const now = new Date().toISOString()
    const publishedValue = is_published === '1' ? 1 : 0
    const pinnedValue = is_pinned === '1' ? 1 : 0

    if (is_new === '1') {
      // Create new post
      const result = await c.env.DB.prepare(
        `INSERT INTO posts (
          type, categorie, titel, slug, excerpt, body, zichtbaarheid, 
          is_published, is_pinned, auteur_id, created_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        type,
        categorie || null,
        titel,
        finalSlug,
        excerpt || null,
        finalBody,
        zichtbaarheid,
        publishedValue,
        pinnedValue,
        user.id,
        now,
        publishedValue === 1 ? now : null
      ).run()

      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'post_create', 'post', ?, ?)`
      ).bind(user.id, result.meta.last_row_id, JSON.stringify({ type, titel })).run()

      return c.redirect(`/admin/content/${result.meta.last_row_id}?success=created&type=posts`)
    } else {
      // Update existing post
      await c.env.DB.prepare(
        `UPDATE posts 
         SET type = ?, categorie = ?, titel = ?, slug = ?, excerpt = ?, body = ?, 
             zichtbaarheid = ?, is_published = ?, is_pinned = ?,
             published_at = CASE WHEN is_published = 0 AND ? = 1 THEN ? ELSE published_at END
         WHERE id = ?`
      ).bind(
        type,
        categorie || null,
        titel,
        finalSlug,
        excerpt || null,
        finalBody,
        zichtbaarheid,
        publishedValue,
        pinnedValue,
        publishedValue,
        now,
        post_id
      ).run()

      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'post_update', 'post', ?, ?)`
      ).bind(user.id, post_id, JSON.stringify({ titel })).run()

      return c.redirect(`/admin/content/${post_id}?success=updated&type=posts`)
    }
  } catch (error) {
    console.error('Post save error:', error)
    const redirectUrl = body.is_new === '1' ? '/admin/content/nieuw' : `/admin/content/${body.post_id}`
    return c.redirect(`${redirectUrl}?error=save_failed`)
  }
})

// =====================================================
// CONTENT DELETE API
// =====================================================

app.get('/api/admin/content/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const contentId = c.req.param('id')
  const contentType = c.req.query('type') || 'posts'

  try {
    if (contentType === 'posts') {
      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'post_delete', 'post', ?, ?)`
      ).bind(user.id, contentId, JSON.stringify({ deleted_by: 'admin' })).run()

      // Delete replies first
      await c.env.DB.prepare('DELETE FROM post_replies WHERE post_id = ?').bind(contentId).run()

      // Delete post
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(contentId).run()
    } else if (contentType === 'events') {
      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'event_delete', 'event', ?, ?)`
      ).bind(user.id, contentId, JSON.stringify({ deleted_by: 'admin' })).run()

      // Delete concert data if exists
      await c.env.DB.prepare('DELETE FROM concerts WHERE event_id = ?').bind(contentId).run()

      // Delete event
      await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(contentId).run()
    }

    return c.redirect(`/admin/content?tab=${contentType}&success=deleted`)
  } catch (error) {
    console.error('Content delete error:', error)
    return c.redirect(`/admin/content?tab=${contentType}&error=delete_failed`)
  }
})

export default app
