// Admin Console routes
// Dashboard, Member Management, Content Management, File Management

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'
import { setCookie } from 'hono/cookie'
import { generateToken, hashPassword } from '../utils/auth'

const app = new Hono<{ Bindings: Bindings }>()

// If user is impersonating (has admin_impersonate_token), auto-restore admin session
app.use('*', async (c, next) => {
  const { getCookie: gc, setCookie: sc } = await import('hono/cookie')
  const impersonateToken = gc(c, 'admin_impersonate_token')
  if (impersonateToken) {
    // Restore admin session automatically when navigating to /admin/*
    sc(c, 'auth_token', impersonateToken, { maxAge: 7 * 24 * 60 * 60, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    sc(c, 'admin_impersonate_token', '', { maxAge: 0, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    return c.redirect(c.req.url)
  }
  await next()
})

// Apply auth middleware - admin and moderator for ALL /admin/* routes
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
    total_pending: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM users WHERE status = 'proeflid'`
    ),
    total_projects: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM concert_projects WHERE status IN ('in_uitvoering', 'planning')`
    ),
    total_meetings: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM meetings WHERE datetime(datum || ' ' || COALESCE(start_tijd, '00:00')) >= datetime('now')`
    ),
    total_checkins: await queryOne<any>(c.env.DB,
      `SELECT COUNT(DISTINCT user_id) as count FROM qr_checkins`
    ).catch(() => ({ count: 0 })),
    last_attendance: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM qr_checkins qc 
       JOIN events e ON e.id = qc.event_id 
       WHERE e.type = 'repetitie'
       AND e.start_at = (SELECT MAX(e2.start_at) FROM events e2 JOIN qr_checkins qc2 ON qc2.event_id = e2.id WHERE e2.type = 'repetitie')`
    ).catch(() => ({ count: 0 })),
    total_form_submissions: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM form_submissions WHERE status = 'nieuw'`
    ).catch(() => ({ count: 0 })),
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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="dashboard" pendingRegistrationsCount={stats.total_pending?.count || 0} />
        <div class="flex-1 min-w-0">
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
                <form method="POST" action="/admin/impersonate/79" class="inline">
                  <button type="submit" class="px-4 py-2 bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg transition font-medium text-sm" title="Bekijk de site als een gewoon lid (Test Koorlid)">
                    <i class="fas fa-user-secret mr-2"></i>
                    Bekijk als lid
                  </button>
                </form>
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
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-6 gap-4 mb-8">
            
            {/* Pending Registrations Alert Card */}
            {(stats.total_pending?.count || 0) > 0 && (
              <div class="bg-amber-50 border-l-4 border-amber-500 rounded-lg shadow-md p-6 col-span-1 md:col-span-2">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm text-amber-800 font-bold mb-1">Nieuwe Aanmeldingen</p>
                    <p class="text-3xl font-bold text-amber-900">{stats.total_pending?.count || 0}</p>
                  </div>
                  <div class="w-12 h-12 bg-amber-200 rounded-lg flex items-center justify-center animate-pulse">
                    <i class="fas fa-user-clock text-amber-700 text-xl"></i>
                  </div>
                </div>
                <a href="/admin/leden" class="mt-4 text-sm text-amber-800 hover:underline inline-flex items-center font-semibold">
                  Beheer aanmeldingen <i class="fas fa-arrow-right ml-1 text-xs"></i>
                </a>
              </div>
            )}

            <a href="/admin/leden" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg hover:border-animato-primary transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Actieve Leden</p>
                <div class="flex-shrink-0 w-9 h-9 bg-animato-primary/10 rounded-lg flex items-center justify-center">
                  <i class="fas fa-users text-animato-primary text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_leden?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Bekijk alle leden <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/content" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Gepubliceerde Posts</p>
                <div class="flex-shrink-0 w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-newspaper text-green-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_posts?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer content <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/events" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Aankomende Activiteiten</p>
                <div class="flex-shrink-0 w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-calendar text-purple-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_events?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer activiteiten <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/fotoboek" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Foto Albums</p>
                <div class="flex-shrink-0 w-9 h-9 bg-pink-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-images text-pink-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_albums?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer fotoboek <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/bestanden" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Actieve Materialen</p>
                <div class="flex-shrink-0 w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-file-audio text-amber-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_materials?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer bestanden <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/locaties" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Actieve Locaties</p>
                <div class="flex-shrink-0 w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-map-marker-alt text-red-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_locations?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer locaties <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/polls" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Actieve Polls</p>
                <div class="flex-shrink-0 w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-poll text-green-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_polls?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer polls <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/attendance" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Aanwezigheid</p>
                <div class="flex-shrink-0 w-9 h-9 bg-orange-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-qrcode text-orange-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.last_attendance?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                QR Check-in & Streaks <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/voorstellen" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Voorstellen</p>
                <div class="flex-shrink-0 w-9 h-9 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-lightbulb text-yellow-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_proposals_pending?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beoordeel voorstellen <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/projects" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Lopende Projecten</p>
                <div class="flex-shrink-0 w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-tasks text-blue-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_projects?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Beheer projecten <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/meetings" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Vergaderingen</p>
                <div class="flex-shrink-0 w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-handshake text-indigo-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-gray-900 leading-none">{stats.total_meetings?.count || 0}</p>
              <span class="text-xs text-animato-primary group-hover:underline inline-flex items-center gap-1 font-medium">
                Bekijk agenda <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            <a href="/admin/audit" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden border-2 border-animato-accent hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Gebruikers Activiteit</p>
                <div class="flex-shrink-0 w-9 h-9 bg-animato-accent/10 rounded-lg flex items-center justify-center">
                  <i class="fas fa-chart-line text-animato-accent text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-animato-accent leading-none"><i class="fas fa-chart-line"></i></p>
              <span class="text-xs text-animato-accent group-hover:underline inline-flex items-center gap-1 font-semibold">
                Bekijk login activiteit <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>

            {/* Lid-aanvragen (#74) */}
            <a href="/admin/aanmeldingen" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden border-2 border-green-300 hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Lid-aanvragen</p>
                <div class="flex-shrink-0 w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-user-plus text-green-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-green-700 leading-none">{stats.total_form_submissions?.count || 0}</p>
              <span class="text-xs text-green-700 group-hover:underline inline-flex items-center gap-1 font-semibold">
                Beheer aanvragen <i class="fas fa-arrow-right text-xs"></i>
              </span>
            </a>
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
              <a href="/admin/activities" class="flex flex-col items-center p-4 border-2 border-animato-accent rounded-lg hover:bg-animato-accent hover:bg-opacity-10 transition">
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
              <a href="/admin/projects" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-tasks text-2xl text-blue-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Projecten</span>
              </a>
              <a href="/admin/meetings" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-handshake text-2xl text-indigo-600 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Vergaderingen</span>
              </a>
              <a href="/admin/ai-nieuws" class="flex flex-col items-center p-4 border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition relative">
                <span class="absolute -top-2 -right-2 bg-purple-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">AI</span>
                <i class="fas fa-robot text-2xl text-purple-600 mb-2"></i>
                <span class="text-sm font-medium text-purple-700">AI Nieuws</span>
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
      </div>
    </Layout>
  )
})

// =====================================================
// LID-AANVRAGEN BEHEER (#74)
// =====================================================

app.get('/admin/aanmeldingen', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const filter = c.req.query('filter') || 'alle'
  const success = c.req.query('success')
  const error = c.req.query('error')

  let whereClause = "WHERE type = 'word_lid'"
  if (filter === 'nieuw') whereClause += " AND status = 'nieuw'"
  else if (filter === 'verwerkt') whereClause += " AND status = 'verwerkt'"
  else if (filter === 'gearchiveerd') whereClause += " AND status = 'gearchiveerd'"
  else if (filter === 'omgezet') whereClause += " AND status = 'omgezet_naar_lid'"

  const submissions = await queryAll(
    c.env.DB,
    `SELECT id, type, payload, email, naam, status, created_at, verwerkt_at, notities
     FROM form_submissions
     ${whereClause}
     ORDER BY CASE status WHEN 'nieuw' THEN 0 WHEN 'verwerkt' THEN 1 ELSE 2 END, created_at DESC`
  )

  // Counts per status
  const counts = await queryAll<any>(c.env.DB,
    `SELECT status, COUNT(*) as cnt FROM form_submissions WHERE type = 'word_lid' GROUP BY status`)
  const statusCounts: Record<string, number> = {}
  let totalCount = 0
  for (const r of counts) { statusCounts[r.status] = r.cnt; totalCount += r.cnt }

  const stemgroepLabel = (s: string) => {
    if (!s || s === 'weet_niet') return 'Weet niet'
    return s === 'S' ? 'Sopraan' : s === 'A' ? 'Alt' : s === 'T' ? 'Tenor' : s === 'B' ? 'Bas' : s
  }

  return c.html(
    <Layout 
      title="Lid-aanvragen" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lid-aanvragen', href: '/admin/aanmeldingen' }
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 min-w-0">
          <div class="bg-white border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div class="flex items-center justify-between">
                <div>
                  <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-user-plus text-green-600 mr-3"></i>
                    Lid-aanvragen
                  </h1>
                  <p class="mt-2 text-gray-600">
                    Beheer aanvragen van mensen die lid willen worden via het 'Word Lid' formulier
                  </p>
                </div>
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i> Terug
                </a>
              </div>
            </div>
          </div>

          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            {/* Success/error messages */}
            {success === 'converted' && (
              <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-check-circle mr-3 text-green-600"></i>
                Aanvrager is succesvol omgezet naar een lid! Het nieuwe lid kan nu inloggen.
              </div>
            )}
            {success === 'deleted' && (
              <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-check-circle mr-3 text-green-600"></i>
                Aanvraag succesvol verwijderd.
              </div>
            )}
            {success === 'updated' && (
              <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-check-circle mr-3 text-green-600"></i>
                Aanvraag bijgewerkt.
              </div>
            )}
            {error === 'email_exists' && (
              <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-exclamation-circle mr-3 text-red-600"></i>
                Dit e-mailadres is al in gebruik door een bestaand lid.
              </div>
            )}
            {error && error !== 'email_exists' && (
              <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-exclamation-circle mr-3 text-red-600"></i>
                Er ging iets mis: {error}
              </div>
            )}

            {/* Status filter tabs */}
            <div class="flex flex-wrap gap-2 mb-6">
              {[
                { key: 'alle', label: 'Alles', count: totalCount, color: 'bg-gray-100 text-gray-700', active: 'bg-gray-800 text-white' },
                { key: 'nieuw', label: 'Nieuw', count: statusCounts['nieuw'] || 0, color: 'bg-green-50 text-green-700', active: 'bg-green-600 text-white' },
                { key: 'verwerkt', label: 'Verwerkt', count: statusCounts['verwerkt'] || 0, color: 'bg-blue-50 text-blue-700', active: 'bg-blue-600 text-white' },
                { key: 'omgezet', label: 'Omgezet naar lid', count: statusCounts['omgezet_naar_lid'] || 0, color: 'bg-purple-50 text-purple-700', active: 'bg-purple-600 text-white' },
                { key: 'gearchiveerd', label: 'Gearchiveerd', count: statusCounts['gearchiveerd'] || 0, color: 'bg-gray-50 text-gray-500', active: 'bg-gray-500 text-white' },
              ].filter(f => f.count > 0 || f.key === 'alle' || f.key === filter).map(f => (
                <a
                  href={`/admin/aanmeldingen?filter=${f.key}`}
                  class={`px-4 py-2 rounded-full text-sm font-medium transition ${filter === f.key ? f.active : f.color + ' hover:opacity-80'}`}
                >
                  {f.label} {f.count > 0 && <span class="ml-1 opacity-75">({f.count})</span>}
                </a>
              ))}
            </div>

            {submissions.length === 0 ? (
              <div class="text-center py-16 text-gray-500">
                <i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-semibold mb-2">Geen aanvragen</h3>
                <p>Er zijn momenteel geen lid-aanvragen{filter !== 'alle' ? ` met status "${filter}"` : ''}.</p>
              </div>
            ) : (
              <div class="space-y-4">
                {submissions.map((sub: any) => {
                  const data = (() => { try { return JSON.parse(sub.payload) } catch { return {} } })()
                  const isNew = sub.status === 'nieuw'
                  const isConverted = sub.status === 'omgezet_naar_lid'
                  const borderColor = isNew ? 'border-green-500' : isConverted ? 'border-purple-500' : sub.status === 'verwerkt' ? 'border-blue-400' : 'border-gray-200'
                  const statusBadge = isNew ? 'bg-green-100 text-green-800' 
                    : sub.status === 'verwerkt' ? 'bg-blue-100 text-blue-800' 
                    : isConverted ? 'bg-purple-100 text-purple-800'
                    : 'bg-gray-100 text-gray-600'
                  const statusLabel = isNew ? 'Nieuw' : sub.status === 'verwerkt' ? 'Verwerkt' : isConverted ? 'Omgezet naar lid' : 'Gearchiveerd'

                  return (
                    <div class={`bg-white rounded-lg shadow-md p-6 border-l-4 ${borderColor}`} id={`aanvraag-${sub.id}`}>
                      {/* Header row */}
                      <div class="flex items-start justify-between mb-4">
                        <div class="flex items-center gap-3">
                          <div class="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                            <i class={`fas ${isConverted ? 'fa-user-check text-purple-500' : 'fa-user text-gray-400'}`}></i>
                          </div>
                          <div>
                            <h3 class="text-lg font-bold text-gray-900">{sub.naam}</h3>
                            <span class={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>

                        {/* Action buttons - always visible */}
                        <div class="flex items-center gap-2">
                          {/* Convert to member (not if already converted) */}
                          {!isConverted && (
                            <a
                              href={`/admin/aanmeldingen/${sub.id}/omzetten`}
                              class="px-3 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition font-medium"
                              title="Omzetten naar lid"
                            >
                              <i class="fas fa-user-plus mr-1"></i> Omzetten naar lid
                            </a>
                          )}
                          
                          {/* Mark as processed */}
                          {isNew && (
                            <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/verwerk`} class="inline">
                              <button type="submit" class="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
                                <i class="fas fa-check mr-1"></i> Verwerkt
                              </button>
                            </form>
                          )}

                          {/* Archive */}
                          {(isNew || sub.status === 'verwerkt') && (
                            <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/archiveer`} class="inline">
                              <button type="submit" class="px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition">
                                <i class="fas fa-archive mr-1"></i>
                              </button>
                            </form>
                          )}

                          {/* Delete with confirmation */}
                          <button
                            onclick={`if(confirm('Aanvraag van ${sub.naam.replace(/'/g, "\\'")} definitief verwijderen?')) document.getElementById('delete-form-${sub.id}').submit()`}
                            class="px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition"
                            title="Verwijderen"
                          >
                            <i class="fas fa-trash"></i>
                          </button>
                          <form id={`delete-form-${sub.id}`} method="POST" action={`/api/admin/aanmeldingen/${sub.id}/delete`} class="hidden"></form>
                        </div>
                      </div>

                      {/* Contact info */}
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-600 mb-3">
                        <div><i class="fas fa-envelope mr-2 text-gray-400"></i>{sub.email}</div>
                        {data.telefoon && <div><i class="fas fa-phone mr-2 text-gray-400"></i>{data.telefoon}</div>}
                        <div><i class="fas fa-music mr-2 text-gray-400"></i>Stemgroep: {stemgroepLabel(data.stemgroep)}</div>
                      </div>

                      {/* Extra details */}
                      {data.muzikale_ervaring && (
                        <p class="text-sm text-gray-700 mb-1"><strong>Ervaring:</strong> {data.muzikale_ervaring}</p>
                      )}
                      {data.motivatie && (
                        <p class="text-sm text-gray-700 mb-1"><strong>Motivatie:</strong> {data.motivatie}</p>
                      )}
                      {sub.notities && (
                        <p class="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded mt-2">
                          <i class="fas fa-sticky-note mr-1"></i> <strong>Notities:</strong> {sub.notities}
                        </p>
                      )}

                      {/* Footer */}
                      <div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                        <p class="text-xs text-gray-400">
                          <i class="far fa-clock mr-1"></i>
                          Aangemeld op {new Date(sub.created_at).toLocaleDateString('nl-BE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          {sub.verwerkt_at && ` · Verwerkt op ${new Date(sub.verwerkt_at).toLocaleDateString('nl-BE')}`}
                        </p>
                        {/* Inline edit button */}
                        <a href={`/admin/aanmeldingen/${sub.id}/bewerk`} class="text-xs text-gray-500 hover:text-animato-primary transition">
                          <i class="fas fa-pen mr-1"></i> Bewerken
                        </a>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

// API endpoints for form submissions management
app.post('/api/admin/aanmeldingen/:id/verwerk', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as SessionUser
  await execute(c.env.DB, 
    `UPDATE form_submissions SET status = 'verwerkt', verwerkt_door = ?, verwerkt_at = datetime('now') WHERE id = ?`,
    [user.id, id]
  )
  return c.redirect('/admin/aanmeldingen')
})

app.post('/api/admin/aanmeldingen/:id/archiveer', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as SessionUser
  await execute(c.env.DB,
    `UPDATE form_submissions SET status = 'gearchiveerd', verwerkt_door = ?, verwerkt_at = datetime('now') WHERE id = ?`,
    [user.id, id]
  )
  return c.redirect('/admin/aanmeldingen')
})

// Delete aanvraag
app.post('/api/admin/aanmeldingen/:id/delete', async (c) => {
  const id = c.req.param('id')
  await execute(c.env.DB, `DELETE FROM form_submissions WHERE id = ? AND type = 'word_lid'`, [id])
  return c.redirect('/admin/aanmeldingen?success=deleted')
})

// Edit aanvraag page
app.get('/admin/aanmeldingen/:id/bewerk', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)
  const id = c.req.param('id')
  const sub = await queryOne<any>(c.env.DB,
    `SELECT * FROM form_submissions WHERE id = ? AND type = 'word_lid'`, [id])
  if (!sub) return c.redirect('/admin/aanmeldingen?error=not_found')

  const data = (() => { try { return JSON.parse(sub.payload) } catch { return {} } })()

  return c.html(
    <Layout title="Aanvraag bewerken" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Lid-aanvragen', href: '/admin/aanmeldingen' },
      { label: 'Bewerken', href: '#' }
    ]}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 min-w-0">
          <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="bg-white rounded-xl shadow-md p-8">
              <h2 class="text-2xl font-bold text-gray-900 mb-6">
                <i class="fas fa-pen text-animato-primary mr-2"></i>
                Aanvraag bewerken
              </h2>
              <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/update`} class="space-y-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Voornaam</label>
                    <input type="text" name="voornaam" value={data.voornaam || ''} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Achternaam</label>
                    <input type="text" name="achternaam" value={data.achternaam || ''} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                    <input type="email" name="email" value={sub.email || ''} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Telefoon</label>
                    <input type="text" name="telefoon" value={data.telefoon || ''} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Stemgroep</label>
                    <select name="stemgroep" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent">
                      <option value="weet_niet" selected={!data.stemgroep || data.stemgroep === 'weet_niet'}>Weet niet</option>
                      <option value="S" selected={data.stemgroep === 'S'}>Sopraan</option>
                      <option value="A" selected={data.stemgroep === 'A'}>Alt</option>
                      <option value="T" selected={data.stemgroep === 'T'}>Tenor</option>
                      <option value="B" selected={data.stemgroep === 'B'}>Bas</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select name="status" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent">
                      <option value="nieuw" selected={sub.status === 'nieuw'}>Nieuw</option>
                      <option value="verwerkt" selected={sub.status === 'verwerkt'}>Verwerkt</option>
                      <option value="gearchiveerd" selected={sub.status === 'gearchiveerd'}>Gearchiveerd</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Muzikale ervaring</label>
                  <textarea name="muzikale_ervaring" rows={3} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent">{data.muzikale_ervaring || ''}</textarea>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Motivatie / Bericht</label>
                  <textarea name="motivatie" rows={3} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent">{data.motivatie || ''}</textarea>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Admin notities</label>
                  <textarea name="notities" rows={2} placeholder="Interne notities (niet zichtbaar voor de aanvrager)" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent bg-amber-50">{sub.notities || ''}</textarea>
                </div>
                <div class="flex items-center gap-3 pt-4 border-t border-gray-200">
                  <button type="submit" class="px-6 py-2.5 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition font-medium">
                    <i class="fas fa-save mr-2"></i> Opslaan
                  </button>
                  <a href="/admin/aanmeldingen" class="px-6 py-2.5 text-gray-600 hover:text-gray-800 transition">Annuleren</a>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// Update aanvraag
app.post('/api/admin/aanmeldingen/:id/update', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')
  const body = await c.req.parseBody()

  const sub = await queryOne<any>(c.env.DB, `SELECT * FROM form_submissions WHERE id = ?`, [id])
  if (!sub) return c.redirect('/admin/aanmeldingen?error=not_found')

  const existingData = (() => { try { return JSON.parse(sub.payload) } catch { return {} } })()

  // Update payload
  const updatedPayload = JSON.stringify({
    ...existingData,
    voornaam: body.voornaam || existingData.voornaam,
    achternaam: body.achternaam || existingData.achternaam,
    email: body.email || existingData.email,
    telefoon: body.telefoon || existingData.telefoon,
    stemgroep: body.stemgroep || existingData.stemgroep,
    muzikale_ervaring: body.muzikale_ervaring || null,
    motivatie: body.motivatie || null,
  })

  const naam = `${body.voornaam || existingData.voornaam} ${body.achternaam || existingData.achternaam}`.trim()

  await execute(c.env.DB,
    `UPDATE form_submissions 
     SET naam = ?, email = ?, payload = ?, status = ?, notities = ?, verwerkt_door = ?, verwerkt_at = datetime('now')
     WHERE id = ?`,
    [naam, body.email || sub.email, updatedPayload, body.status || sub.status, body.notities || null, user.id, id]
  )

  return c.redirect('/admin/aanmeldingen?success=updated')
})

// =====================================================
// CONVERT AANVRAAG TO MEMBER
// =====================================================

app.get('/admin/aanmeldingen/:id/omzetten', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)
  const id = c.req.param('id')

  const sub = await queryOne<any>(c.env.DB,
    `SELECT * FROM form_submissions WHERE id = ? AND type = 'word_lid'`, [id])
  if (!sub) return c.redirect('/admin/aanmeldingen?error=not_found')

  const data = (() => { try { return JSON.parse(sub.payload) } catch { return {} } })()

  // Check if email already exists as user
  const existingUser = await queryOne<any>(c.env.DB, 'SELECT id, email FROM users WHERE email = ?', [sub.email])

  return c.html(
    <Layout title="Omzetten naar lid" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Lid-aanvragen', href: '/admin/aanmeldingen' },
      { label: 'Omzetten', href: '#' }
    ]}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 min-w-0">
          <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="bg-white rounded-xl shadow-md p-8">
              <h2 class="text-2xl font-bold text-gray-900 mb-2">
                <i class="fas fa-user-plus text-purple-600 mr-2"></i>
                Omzetten naar lid
              </h2>
              <p class="text-gray-600 mb-6">
                Maak een gebruikersaccount aan op basis van de aanvraag van <strong>{sub.naam}</strong>.
              </p>

              {existingUser && (
                <div class="mb-6 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg">
                  <i class="fas fa-exclamation-triangle mr-2"></i>
                  <strong>Let op:</strong> Er bestaat al een gebruiker met e-mail <strong>{sub.email}</strong> (id #{existingUser.id}). 
                  Wijzig het e-mailadres of gebruik een ander adres.
                </div>
              )}

              <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/convert`} class="space-y-5">
                {/* Pre-filled from application */}
                <div class="bg-gray-50 rounded-lg p-5 border border-gray-200">
                  <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Gegevens uit aanvraag</h3>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Voornaam *</label>
                      <input type="text" name="voornaam" value={data.voornaam || ''} required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Achternaam *</label>
                      <input type="text" name="achternaam" value={data.achternaam || ''} required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">E-mail *</label>
                      <input type="email" name="email" value={sub.email || ''} required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Telefoon</label>
                      <input type="text" name="telefoon" value={data.telefoon || ''} class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent" />
                    </div>
                  </div>
                </div>

                {/* New member settings */}
                <div class="bg-purple-50 rounded-lg p-5 border border-purple-200">
                  <h3 class="text-sm font-semibold text-purple-700 uppercase tracking-wide mb-4">Instellingen nieuw lid</h3>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Stemgroep *</label>
                      <select name="stemgroep" required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                        <option value="">-- Kies --</option>
                        <option value="S" selected={data.stemgroep === 'S'}>Sopraan</option>
                        <option value="A" selected={data.stemgroep === 'A'}>Alt</option>
                        <option value="T" selected={data.stemgroep === 'T'}>Tenor</option>
                        <option value="B" selected={data.stemgroep === 'B'}>Bas</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                      <select name="role" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                        <option value="lid" selected>Lid</option>
                        <option value="proeflid">Proeflid</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select name="status" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                        <option value="actief" selected>Actief</option>
                        <option value="proeflid">Proeflid</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Wachtwoord *</label>
                      <input type="text" name="password" value={`Animato${new Date().getFullYear()}!`} required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono" />
                      <p class="text-xs text-gray-500 mt-1">Het lid moet dit wachtwoord wijzigen na eerste login.</p>
                    </div>
                  </div>
                </div>

                {data.muzikale_ervaring && (
                  <div class="text-sm text-gray-600 bg-gray-50 rounded-lg p-4">
                    <strong>Muzikale ervaring:</strong> {data.muzikale_ervaring}
                  </div>
                )}

                <div class="flex items-center gap-3 pt-4 border-t border-gray-200">
                  <button type="submit" class="px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium">
                    <i class="fas fa-user-plus mr-2"></i> Omzetten naar lid
                  </button>
                  <a href="/admin/aanmeldingen" class="px-6 py-2.5 text-gray-600 hover:text-gray-800 transition">Annuleren</a>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// Convert application to member
app.post('/api/admin/aanmeldingen/:id/convert', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')
  const body = await c.req.parseBody()

  const { voornaam, achternaam, email, telefoon, stemgroep, role, status, password } = body as Record<string, string>

  if (!voornaam || !achternaam || !email || !stemgroep || !password) {
    return c.redirect(`/admin/aanmeldingen/${id}/omzetten?error=required`)
  }

  // Check email uniqueness
  const existing = await queryOne<any>(c.env.DB, 'SELECT id FROM users WHERE email = ?', [email])
  if (existing) {
    return c.redirect('/admin/aanmeldingen?error=email_exists')
  }

  try {
    const { hashPassword } = await import('../utils/auth')
    const password_hash = await hashPassword(password)

    // Create user
    const userResult = await c.env.DB.prepare(
      `INSERT INTO users (email, password_hash, role, stemgroep, status, two_fa_enabled, email_verified, is_bestuurslid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, 0, datetime('now'), datetime('now'))`
    ).bind(email, password_hash, role || 'lid', stemgroep, status || 'actief').run()

    const newUserId = userResult.meta.last_row_id

    // Create profile
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, smoelenboek_zichtbaar, toon_email, toon_telefoon, lid_sinds)
       VALUES (?, ?, ?, ?, 1, 1, 1, DATE('now'))`
    ).bind(newUserId, voornaam, achternaam, telefoon || null).run()

    // Update form submission status
    await execute(c.env.DB,
      `UPDATE form_submissions 
       SET status = 'omgezet_naar_lid', verwerkt_door = ?, verwerkt_at = datetime('now'),
           notities = COALESCE(notities || ' | ', '') || 'Omgezet naar lid #' || ? || ' door admin'
       WHERE id = ?`,
      [user.id, newUserId, id]
    )

    return c.redirect('/admin/aanmeldingen?success=converted')
  } catch (e: any) {
    console.error('Convert error:', e)
    return c.redirect(`/admin/aanmeldingen?error=${encodeURIComponent(e.message || 'server')}`)
  }
})

// =====================================================
// MEMBER MANAGEMENT - Overview
// =====================================================

app.get('/admin/leden', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''
  const role = c.req.query('role') || 'all'
  const stemgroep = c.req.query('stemgroep') || 'all'
  const status = c.req.query('status') || 'actief'  // Default to only active members

  // Build query with online status
  let query = `
    SELECT u.id, u.email, u.role, u.stemgroep, u.status, u.created_at, u.last_login_at,
           p.voornaam, p.achternaam, p.telefoon, u.is_test_account,
           (SELECT COUNT(*) FROM user_sessions WHERE user_id = u.id AND is_active = 1) as is_online
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

  // Default sort: stemgroep first, then alphabetically (#54)
  const sortBy = c.req.query('sort') || 'stemgroep'
  if (sortBy === 'stemgroep') {
    query += ` ORDER BY u.stemgroep ASC, p.achternaam ASC, p.voornaam ASC`
  } else {
    query += ` ORDER BY p.achternaam ASC, p.voornaam ASC`
  }

  const leden = await queryAll(c.env.DB, query, params)

  // Get pending registrations (proefleden)
  const pendingRegistrations = await queryAll(
    c.env.DB,
    `SELECT u.id, u.email, u.stemgroep, u.created_at, p.voornaam, p.achternaam
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'proeflid'
     ORDER BY u.created_at DESC`
  )

  // Get counts for filters (only active members by default)
  const counts = {
    all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'actief'`),
    admin: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'actief'`),
    moderator: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'moderator' AND status = 'actief'`),
    stemleider: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'stemleider' AND status = 'actief'`),
    lid: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'lid' AND status = 'actief'`),
    actief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'actief'`),
    inactief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'inactief'`),
    online: await queryOne<any>(c.env.DB, `SELECT COUNT(DISTINCT user_id) as count FROM user_sessions WHERE is_active = 1`),
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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" pendingRegistrationsCount={pendingRegistrations.length} />
        <div class="flex-1 min-w-0">
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
                <a href="/admin/leden/import" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition">
                  <i class="fas fa-file-import mr-2"></i>
                  Importeren
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
              <div class="text-center border-l-2 border-animato-accent pl-4">
                <p class="text-2xl font-bold text-animato-accent flex items-center justify-center">
                  <i class="fas fa-circle text-xs mr-2 animate-pulse"></i>
                  {counts.online?.count || 0}
                </p>
                <p class="text-sm font-semibold text-animato-accent">Nu Online</p>
              </div>
            </div>
          </div>

          {/* Pending Registrations (Wachtrij) */}
          {pendingRegistrations.length > 0 && (
            <div class="bg-white rounded-lg shadow-md mb-8 border-l-4 border-amber-500 overflow-hidden">
              <div class="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
                <h2 class="text-lg font-bold text-amber-800 flex items-center">
                  <i class="fas fa-user-clock mr-2"></i>
                  Nieuwe Aanmeldingen ({pendingRegistrations.length})
                </h2>
                <span class="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                  Actie vereist
                </span>
              </div>
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Naam</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stemgroep</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aangemeld op</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {pendingRegistrations.map((reg: any) => (
                    <tr>
                      <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                        {reg.voornaam} {reg.achternaam}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {reg.email}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {reg.stemgroep || '-'}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(reg.created_at).toLocaleDateString('nl-NL')}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <form 
                          action={`/api/admin/leden/${reg.id}/approve`} 
                          method="POST" 
                          class="inline-block mr-2"
                          onsubmit="return confirm('Weet je zeker dat je dit lid wilt accepteren?')"
                        >
                          <button type="submit" class="text-green-600 hover:text-green-900 bg-green-50 hover:bg-green-100 px-3 py-1 rounded transition">
                            <i class="fas fa-check mr-1"></i> Accepteren
                          </button>
                        </form>
                        <form 
                          action={`/api/admin/leden/${reg.id}/reject`} 
                          method="POST" 
                          class="inline-block"
                          onsubmit="return confirm('Zeker weten dat je deze aanmelding wilt afwijzen en verwijderen?')"
                        >
                          <button type="submit" class="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 px-3 py-1 rounded transition">
                            <i class="fas fa-times mr-1"></i> Afwijzen
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
                    oninput="clearTimeout(window._searchTimer); window._searchTimer = setTimeout(() => this.form.submit(), 500)"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Rol</label>
                  <select
                    name="role"
                    onchange="this.form.submit()"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={role === 'all'}>Alle rollen</option>
                    <option value="lid" selected={role === 'lid'}>Lid</option>
                    <option value="stemleider" selected={role === 'stemleider'}>Stemleider</option>
                    <option value="moderator" selected={role === 'moderator'}>Moderator</option>
                    <option value="admin" selected={role === 'admin'}>Admin</option>
                    <option value="dirigent" selected={role === 'dirigent'}>Dirigent</option>
                    <option value="pianist" selected={role === 'pianist'}>Pianist</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Stemgroep</label>
                  <select
                    name="stemgroep"
                    onchange="this.form.submit()"
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
                    onchange="this.form.submit()"
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
                  <input type="hidden" name="sort" value={sortBy} />
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

          {/* Sort options */}
          <div class="flex items-center gap-2 mb-4">
            <span class="text-sm text-gray-600 font-medium">Sorteren:</span>
            <a href={`/admin/leden?search=${search}&role=${role}&stemgroep=${stemgroep}&status=${status}&sort=naam`}
               class={`text-sm px-3 py-1 rounded-full transition ${sortBy === 'naam' ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <i class="fas fa-sort-alpha-down mr-1"></i> Op naam
            </a>
            <a href={`/admin/leden?search=${search}&role=${role}&stemgroep=${stemgroep}&status=${status}&sort=stemgroep`}
               class={`text-sm px-3 py-1 rounded-full transition ${sortBy === 'stemgroep' ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <i class="fas fa-music mr-1"></i> Op stemgroep
            </a>
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
                        'bezoeker': 'Bezoeker',
                        'dirigent': 'Dirigent',
                        'pianist': 'Pianist'
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
                        'bezoeker': 'bg-gray-100 text-gray-800',
                        'dirigent': 'bg-pink-100 text-pink-800',
                        'pianist': 'bg-purple-100 text-purple-800'
                      }
                      
                      const lastLogin = lid.last_login_at 
                        ? new Date(lid.last_login_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Nooit'
                      
                      return (
                        <tr class="hover:bg-gray-50 transition cursor-pointer" onclick={`window.location='/admin/leden/${lid.id}'`}>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="flex items-center">
                              <div class="relative">
                                <div class="w-10 h-10 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white font-bold text-sm mr-3">
                                  {lid.voornaam?.charAt(0) || 'U'}{lid.achternaam?.charAt(0) || ''}
                                </div>
                                {lid.is_online > 0 && (
                                  <div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full animate-pulse" title="Online"></div>
                                )}
                              </div>
                              <div>
                                <div class="text-sm font-medium text-gray-900 flex items-center">
                                  {lid.voornaam} {lid.achternaam}
                                  {lid.is_test_account === 1 && (
                                    <span class="ml-2 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-semibold" title="Testaccount — niet zichtbaar voor leden">
                                      <i class="fas fa-flask mr-0.5"></i>TEST
                                    </span>
                                  )}
                                  {lid.is_online > 0 && (
                                    <span class="ml-2 text-xs text-green-600 font-semibold">
                                      <i class="fas fa-circle text-xs"></i> Online
                                    </span>
                                  )}
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
                            <a href={`/admin/leden/${lid.id}`} class="text-animato-primary hover:text-animato-secondary mr-3" title="Bewerken">
                              <i class="fas fa-edit"></i>
                            </a>
                            <button 
                              onclick={`openDeleteModal('/api/admin/leden/${lid.id}/delete')`}
                              class="text-red-600 hover:text-red-900"
                              title="Verwijderen"
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

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', async function() {
          if (deleteUrl) {
            this.disabled = true;
            this.innerText = 'Verwijderen...';
            try {
              const res = await fetch(deleteUrl, { method: 'POST' });
              if (res.ok) {
                closeDeleteModal();
                window.location.reload();
              } else {
                alert('Verwijderen mislukt. Probeer opnieuw.');
                this.disabled = false;
                this.innerText = 'Verwijderen';
              }
            } catch(e) {
              // Fallback: navigate directly
              window.location.href = deleteUrl;
            }
          }
          closeDeleteModal();
        });
      ` }} />
    </Layout>
  )
})

// =====================================================
// NEW MEMBER PAGE
// =====================================================

app.get('/admin/leden/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  const error = c.req.query('error')
  const details = c.req.query('details')
  
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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 min-w-0">
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
              {error === 'create_failed' && `Er is een fout opgetreden bij het aanmaken van het lid. ${details ? `(${decodeURIComponent(details)})` : 'Probeer opnieuw.'}`}
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

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Geboortedatum
                    </label>
                    <input
                      type="date"
                      name="geboortedatum"
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
                      <option value="dirigent">Dirigent</option>
                      <option value="pianist">Pianist</option>
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
                    <div class="relative">
                      <input
                        type="password"
                        name="password"
                        id="pwd-new"
                        required
                        minlength="8"
                        class="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <button type="button" onclick="togglePwdVisibility('pwd-new')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition" tabindex="-1" title="Toon/verberg wachtwoord">
                        <i class="far fa-eye" id="pwd-new-icon"></i>
                      </button>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">Minimaal 8 karakters</p>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Wachtwoord Bevestigen *
                    </label>
                    <div class="relative">
                      <input
                        type="password"
                        name="password_confirm"
                        id="pwd-confirm"
                        required
                        minlength="8"
                        class="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <button type="button" onclick="togglePwdVisibility('pwd-confirm')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition" tabindex="-1" title="Toon/verberg wachtwoord">
                        <i class="far fa-eye" id="pwd-confirm-icon"></i>
                      </button>
                    </div>
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
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        function togglePwdVisibility(inputId) {
          const input = document.getElementById(inputId);
          const icon = document.getElementById(inputId + '-icon');
          if (!input || !icon) return;
          if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'far fa-eye-slash';
          } else {
            input.type = 'password';
            icon.className = 'far fa-eye';
          }
        }
      `}} />
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
    `SELECT u.*, p.voornaam, p.achternaam, p.telefoon, p.adres, p.straat, p.huisnummer, p.bus, p.postcode, COALESCE(p.gemeente, p.stad) as gemeente, p.bio, p.muzikale_ervaring, p.geboortedatum, p.foto_url, p.lid_sinds
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  )

  if (!member) {
    return c.redirect('/admin/leden?error=not_found')
  }

  const relations = await queryAll(c.env.DB, `SELECT * FROM user_relations WHERE user_id = ? ORDER BY start_date DESC`, [userId])

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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 min-w-0">
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
                  {member.is_test_account === 1 && (
                    <span class="ml-2 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-semibold">
                      <i class="fas fa-flask mr-1"></i>Testaccount — niet zichtbaar voor leden
                    </span>
                  )}
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

              {/* CRM Relations */}
              <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-tags text-animato-secondary mr-2"></i>
                    Relaties & Rollen
                  </h3>
                  <button onclick="document.getElementById('addRelationModal').classList.remove('hidden')" class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded">
                    + Toevoegen
                  </button>
                </div>
                
                {relations.length > 0 ? (
                  <div class="flex flex-wrap gap-2">
                    {relations.map((rel: any) => (
                      <div class="inline-flex items-center bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-sm text-blue-800">
                        <span class="font-semibold mr-2">{rel.type.charAt(0).toUpperCase() + rel.type.slice(1)}</span>
                        {rel.notes && <span class="text-xs text-gray-500 mr-2 border-l border-gray-300 pl-2">{rel.notes}</span>}
                        <form action="/api/admin/leden/relations/delete" method="POST" class="inline" onsubmit="return confirm('Verwijderen?')">
                          <input type="hidden" name="relation_id" value={rel.id} />
                          <input type="hidden" name="user_id" value={userId} />
                          <button type="submit" class="text-blue-400 hover:text-red-500 ml-1">
                            <i class="fas fa-times"></i>
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 italic text-sm">Geen relaties gedefinieerd (behalve de hoofdrol).</p>
                )}

                {/* Add Relation Modal */}
                <div id="addRelationModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                  <div class="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
                    <h3 class="font-bold mb-4">Relatie Toevoegen</h3>
                    <form action="/api/admin/leden/relations/create" method="POST">
                      <input type="hidden" name="user_id" value={userId} />
                      <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Type</label>
                        <select name="type" class="w-full border rounded p-2">
                          <option value="lid">Lid</option>
                          <option value="sympathisant">Sympathisant</option>
                          <option value="vrijwilliger">Vrijwilliger</option>
                          <option value="sponsor">Sponsor</option>
                          <option value="oud_lid">Oud-lid</option>
                          <option value="erelid">Erelid</option>
                        </select>
                      </div>
                      <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Notitie</label>
                        <input type="text" name="notes" class="w-full border rounded p-2" placeholder="bv. bardienst" />
                      </div>
                      <div class="flex justify-end gap-2">
                        <button type="button" onclick="document.getElementById('addRelationModal').classList.add('hidden')" class="px-3 py-1 border rounded">Annuleren</button>
                        <button type="submit" class="px-3 py-1 bg-animato-primary text-white rounded">Opslaan</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>

              {/* Profile Card */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="flex items-center mb-6 pb-6 border-b border-gray-200">
              {/* Profielfoto met upload */}
              <div id="foto-upload-zone" data-user-id={member.id} class="w-20 h-20 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden cursor-pointer relative group border-2 border-transparent hover:border-blue-400 transition" title="Klik of sleep een foto om te uploaden">
                {member.foto_url ? (
                  <>
                    <img 
                      id="foto-preview-img"
                      src={member.foto_url}
                      alt={`${member.voornaam} ${member.achternaam}`}
                      class="w-full h-full object-cover"
                    />
                    <div id="foto-placeholder" class="hidden absolute inset-0 flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary">
                      <span>{member.voornaam?.charAt(0) || 'U'}{member.achternaam?.charAt(0) || ''}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <img 
                      id="foto-preview-img"
                      src=""
                      alt="Foto preview"
                      class="w-full h-full object-cover hidden"
                    />
                    <div id="foto-placeholder" class="absolute inset-0 flex items-center justify-center">
                      <span>{member.voornaam?.charAt(0) || 'U'}{member.achternaam?.charAt(0) || ''}</span>
                    </div>
                  </>
                )}
                {/* Hover overlay */}
                <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 rounded-full flex items-center justify-center transition">
                  <i class="fas fa-camera text-white opacity-0 group-hover:opacity-100 transition"></i>
                </div>
                <input type="file" id="foto-file-input" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" />
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
                    Lid sinds {member.lid_sinds ? new Date(member.lid_sinds + 'T00:00:00').toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }) : new Date(member.created_at).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-1">
                  <span id="foto-upload-status" class="text-xs text-gray-400">Klik op de foto om te wijzigen</span>
                  {member.foto_url && (
                    <button type="button" id="foto-remove-btn" class="text-xs text-red-500 hover:text-red-700 underline">
                      Foto verwijderen
                    </button>
                  )}
                  {!member.foto_url && (
                    <button type="button" id="foto-remove-btn" class="text-xs text-red-500 hover:text-red-700 underline hidden">
                      Foto verwijderen
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Edit Form */}
            <form action="/api/admin/leden/update" method="POST" class="space-y-6">
              <input type="hidden" name="user_id" value={member.id} />
              <input type="hidden" id="foto-url-input" name="foto_url" value={member.foto_url || ''} />

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
                  <h4 class="text-sm font-medium text-gray-700 mb-2">Adres</h4>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Straat</label>
                      <input type="text" name="straat" value={member.straat || ''} placeholder="Koorstraat" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nr</label>
                            <input type="text" name="huisnummer" value={member.huisnummer || ''} placeholder="1" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Bus</label>
                            <input type="text" name="bus" value={member.bus || ''} placeholder="A" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                        </div>
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Postcode</label>
                      <input type="text" name="postcode" value={member.postcode || ''} placeholder="1000" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Gemeente</label>
                      <input type="text" name="gemeente" value={member.gemeente || ''} placeholder="Brussel" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Geboortedatum
                    </label>
                    <input
                      type="date"
                      name="geboortedatum"
                      value={member.geboortedatum || ''}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      <i class="fas fa-calendar-check text-animato-primary mr-1"></i>
                      Lid sinds
                    </label>
                    <input
                      type="date"
                      name="lid_sinds"
                      value={member.lid_sinds || ''}
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                    <p class="text-xs text-gray-400 mt-1">
                      <i class="fas fa-info-circle mr-1"></i>
                      Datum waarop het lid bij Animato is aangesloten. Pas aan indien nodig.
                    </p>
                  </div>
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
                      <option value="dirigent" selected={member.role === 'dirigent'}>Dirigent</option>
                      <option value="pianist" selected={member.role === 'pianist'}>Pianist</option>
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

                {/* Board member checkbox */}
                <div class="mt-4">
                  <label class="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      name="is_bestuurslid"
                      value="1"
                      checked={member.is_bestuurslid === 1}
                      class="w-4 h-4 text-animato-primary border-gray-300 rounded focus:ring-animato-primary"
                    />
                    <span class="ml-2 text-sm font-medium text-gray-700">
                      <i class="fas fa-shield-alt text-yellow-500 mr-1"></i>
                      Bestuurslid
                    </span>
                    <span class="ml-2 text-xs text-gray-500">(toegang tot vergaderingen & projecten)</span>
                  </label>
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
                  onclick={`openDeleteModal('/api/admin/leden/${member.id}/delete')`}
                  class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition inline-block"
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

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', async function() {
          if (deleteUrl) {
            this.disabled = true;
            this.innerText = 'Verwijderen...';
            try {
              const res = await fetch(deleteUrl, { method: 'POST' });
              if (res.ok) {
                closeDeleteModal();
                window.location.reload();
              } else {
                alert('Verwijderen mislukt. Probeer opnieuw.');
                this.disabled = false;
                this.innerText = 'Verwijderen';
              }
            } catch(e) {
              // Fallback: navigate directly
              window.location.href = deleteUrl;
            }
          }
          closeDeleteModal();
        });
      ` }} />
      {/* Foto upload script */}
      <script src="/static/js/foto-upload.js"></script>
    </Layout>
  )
})

// =====================================================
// RELATIONS API
// =====================================================

app.post('/api/admin/leden/relations/create', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, `INSERT INTO user_relations (user_id, type, notes) VALUES (?, ?, ?)`, [body.user_id, body.type, body.notes])
  return c.redirect(`/admin/leden/${body.user_id}`)
})

app.post('/api/admin/leden/relations/delete', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, `DELETE FROM user_relations WHERE id = ?`, [body.relation_id])
  return c.redirect(`/admin/leden/${body.user_id}`)
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
      muzikale_ervaring,
      geboortedatum,
      straat,
      huisnummer,
      bus,
      postcode,
      gemeente
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

    // Hash password using the same function as login
    const password_hash = await hashPassword(password as string)

    // Insert user
    const userResult = await c.env.DB.prepare(
      `INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(email, password_hash, role, stemgroep || null, status).run()

    const newUserId = userResult.meta.last_row_id

    // Insert profile
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, adres, straat, huisnummer, bus, postcode, gemeente, stad, bio, muzikale_ervaring, geboortedatum, lid_sinds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE('now'))`
    ).bind(newUserId, voornaam, achternaam, telefoon || null, adres || null, straat || null, huisnummer || null, bus || null, postcode || null, gemeente || null, gemeente || null, bio || null, muzikale_ervaring || null, geboortedatum || null).run()

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
  } catch (error: any) {
    console.error('Member create error:', error?.message || error)
    // Check for common SQLite errors
    if (error?.message?.includes('UNIQUE constraint')) {
      return c.redirect('/admin/leden/nieuw?error=email_exists')
    }
    return c.redirect(`/admin/leden/nieuw?error=create_failed&details=${encodeURIComponent(String(error?.message || 'onbekend'))}`)
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
      muzikale_ervaring,
      geboortedatum,
      straat,
      huisnummer,
      bus,
      postcode,
      gemeente,
      foto_url,
      lid_sinds,
      is_bestuurslid
    } = body

    // Validation
    if (!user_id || !voornaam || !achternaam || !email || !role || !status) {
      return c.redirect(`/admin/leden/${user_id}?error=required_fields`)
    }

    const bestuurValue = is_bestuurslid === '1' ? 1 : 0

    // Update user table (including board member status)
    await c.env.DB.prepare(
      `UPDATE users 
       SET email = ?, role = ?, stemgroep = ?, status = ?, is_bestuurslid = ?
       WHERE id = ?`
    ).bind(email, role, stemgroep || null, status, bestuurValue, user_id).run()

    // Update profile table (inclusief foto_url en lid_sinds)
    await c.env.DB.prepare(
      `UPDATE profiles 
       SET voornaam = ?, achternaam = ?, telefoon = ?, straat = ?, huisnummer = ?, bus = ?, postcode = ?, gemeente = ?, stad = ?, bio = ?, muzikale_ervaring = ?, geboortedatum = ?, foto_url = ?, lid_sinds = ?
       WHERE user_id = ?`
    ).bind(voornaam, achternaam, telefoon || null, straat || null, huisnummer || null, bus || null, postcode || null, gemeente || null, gemeente || null, bio || null, muzikale_ervaring || null, geboortedatum || null, foto_url || null, lid_sinds || null, user_id).run()

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
// MEMBER APPROVE API
// =====================================================

app.post('/api/admin/leden/:id/approve', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')

  try {
    // Update user status to active and role to lid
    await c.env.DB.prepare(
      `UPDATE users SET status = 'actief', role = 'lid' WHERE id = ?`
    ).bind(userId).run()

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'user_approve', 'user', ?, ?)`
    ).bind(
      user.id,
      userId,
      JSON.stringify({ approved_by: 'admin' })
    ).run()

    return c.redirect('/admin/leden?success=approved')
  } catch (error) {
    console.error('Member approve error:', error)
    return c.redirect('/admin/leden?error=approve_failed')
  }
})

// =====================================================
// MEMBER DELETE API
// =====================================================

// Shared helper: delete all user data (full cascade)
async function deleteUserCascade(db: D1Database, userId: string) {
  // Verwijder alle gerelateerde data vóór de user zelf
  const tables: Array<[string, string]> = [
    ['user_sessions',            'user_id'],
    ['user_memberships',         'user_id'],
    ['user_relations',           'user_id'],
    ['event_attendance',         'user_id'],
    ['poll_votes',               'user_id'],
    ['proposal_votes',           'user_id'],
    ['notifications',            'user_id'],
    ['password_resets',          'user_id'],
    ['member_favorites',         'user_id'],
    ['member_favorites',         'favorite_member_id'],
    ['walkthrough_progress',     'user_id'],
    ['voice_analyses',           'user_id'],
    ['feedback',                 'user_id'],
    ['donations',                'user_id'],
    ['activity_registrations',   'user_id'],
    ['activity_invitations',     'user_id'],
    ['activity_custom_answers',  'user_id'],
    ['meeting_participants',     'user_id'],
    ['meeting_action_items',     'verantwoordelijke_id'],
    ['post_replies',             'user_id'],
    // karaoke tables removed
    ['print_requests',           'user_id'],
    ['form_submissions',         'user_id'],
    ['notification_subscriptions','user_id'],
    ['profiles',                 'user_id'],
  ]
  for (const [table, col] of tables) {
    try {
      await db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).bind(userId).run()
    } catch (_) { /* kolom bestaat niet in deze tabel → skip */ }
  }
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}

app.get('/api/admin/leden/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')

  try {
    if (userId === user.id.toString()) {
      return c.redirect('/admin/leden?error=cannot_delete_self')
    }
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'user_delete', 'user', ?, ?)`
    ).bind(user.id, userId, JSON.stringify({ deleted_by: 'admin' })).run()
    await deleteUserCascade(c.env.DB, userId)
    return c.redirect('/admin/leden?success=deleted')
  } catch (error) {
    console.error('Member delete error:', error)
    return c.redirect('/admin/leden?error=delete_failed')
  }
})

// DELETE via POST/JSON (for fetch-based delete from UI)
app.post('/api/admin/leden/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')

  try {
    if (userId === user.id.toString()) {
      return c.json({ success: false, error: 'cannot_delete_self' }, 400)
    }
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'user_delete', 'user', ?, ?)`
    ).bind(user.id, userId, JSON.stringify({ deleted_by: 'admin' })).run()
    await deleteUserCascade(c.env.DB, userId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Member delete error:', error)
    return c.json({ success: false, error: 'delete_failed' }, 500)
  }
})

// =====================================================
// MEMBER REJECT API (DELETE PROEFLID)
// =====================================================

app.post('/api/admin/leden/:id/reject', async (c) => {
  const user = c.get('user') as SessionUser
  const userId = c.req.param('id')

  try {
    // Audit log before deletion
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'user_reject', 'user', ?, ?)`
    ).bind(user.id, userId, JSON.stringify({ rejected_by: 'admin' })).run()

    await deleteUserCascade(c.env.DB, userId)

    return c.redirect('/admin/leden?success=rejected')
  } catch (error) {
    console.error('Member reject error:', error)
    return c.redirect('/admin/leden?error=reject_failed')
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
      SELECT p.id, p.type, p.titel, p.slug, p.is_published, p.zichtbaarheid, p.categorie, p.created_at, p.published_at,
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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="content" />
        <div class="flex-1 min-w-0">
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
                  Activiteiten ({counts.events_all?.count || 0})
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
              <form id="contentFilterForm" method="GET" action="/admin/content" class="flex gap-4">
                <input type="hidden" name="tab" value={tab} />
                <div class="flex-1">
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoeken..."
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    oninput="clearTimeout(window._searchTimer); window._searchTimer = setTimeout(() => this.form.submit(), 500)"
                  />
                </div>
                <div>
                  <select
                    name="type"
                    onchange="this.form.submit()"
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
                          Doelgroep
                        </th>
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
                            <td class="px-6 py-4 whitespace-nowrap">
                              {item.categorie ? (
                                <span class={`px-2 py-1 text-xs font-semibold rounded-full ${
                                  item.categorie === 'sopraan' ? 'bg-pink-100 text-pink-700' :
                                  item.categorie === 'alt' ? 'bg-orange-100 text-orange-700' :
                                  item.categorie === 'tenor' ? 'bg-blue-100 text-blue-700' :
                                  item.categorie === 'bas' ? 'bg-indigo-100 text-indigo-700' :
                                  item.categorie === 'bestuur' ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {item.categorie}
                                </span>
                              ) : (
                                <span class="text-xs text-gray-400">Algemeen</span>
                              )}
                            </td>
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
                            onclick={`openDeleteModal('/api/admin/content/${item.id}/delete?type=${tab}')`}
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

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', async function() {
          if (deleteUrl) {
            this.disabled = true;
            this.innerText = 'Verwijderen...';
            try {
              const res = await fetch(deleteUrl, { method: 'POST' });
              if (res.ok) {
                closeDeleteModal();
                window.location.reload();
              } else {
                alert('Verwijderen mislukt. Probeer opnieuw.');
                this.disabled = false;
                this.innerText = 'Verwijderen';
              }
            } catch(e) {
              // Fallback: navigate directly
              window.location.href = deleteUrl;
            }
          }
          closeDeleteModal();
        });
      ` }} />
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
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="content" />
        <div class="flex-1 min-w-0">
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
                      <option value="event" selected={post?.type === 'event' || (!post && contentType === 'event')}>Activiteit</option>
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

              <div class="mt-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  Publicatiedatum
                </label>
                <input
                  type="datetime-local"
                  name="published_at"
                  value={post?.published_at ? new Date(post.published_at).toISOString().slice(0, 16) : ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
                <p class="mt-1 text-xs text-gray-500">
                  <i class="fas fa-info-circle mr-1"></i>
                  Laat leeg om de huidige datum/tijd te gebruiken bij publicatie.
                </p>
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

              <div class="mt-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  <i class="fas fa-clock text-orange-500 mr-1"></i>
                  Automatisch offline halen op
                </label>
                <input
                  type="date"
                  name="verloopt_op"
                  value={post?.verloopt_op || ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
                <p class="mt-1 text-xs text-gray-500">
                  <i class="fas fa-info-circle mr-1"></i>
                  Na deze datum wordt het bericht automatisch niet meer getoond. Laat leeg voor onbeperkt zichtbaar.
                </p>
              </div>
            </div>

            {/* Afbeelding (#76) */}
            <div class="pt-6 border-t border-gray-200">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                <i class="fas fa-image text-purple-600 mr-2"></i>
                Afbeelding
              </h3>
              <div>
                <input
                  type="file"
                  id="postImageUpload"
                  accept="image/*"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-animato-primary file:text-white hover:file:bg-animato-secondary file:cursor-pointer"
                  onchange="handlePostImageUpload(event)"
                />
                <input type="hidden" name="cover_image" id="postImageValue" value={post?.cover_image || ''} />
                <p class="text-xs text-gray-500 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Upload een omslagfoto (JPG, PNG, max 2MB). Wordt weergegeven als thumbnail bij het bericht.
                </p>
                <div id="postImagePreview" class={`mt-3 ${post?.cover_image ? '' : 'hidden'}`}>
                  <div class="relative w-48 h-32 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                    <img id="postPreviewImg" src={post?.cover_image || ''} alt="Preview" class="w-full h-full object-cover" />
                    <button type="button" onclick="clearPostImage()" class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full hover:bg-red-600 transition text-xs">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                </div>
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
                  onclick={`openDeleteModal('/api/admin/content/${post.id}/delete?type=posts')`}
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

              // Post image upload handler (#76)
              function handlePostImageUpload(event) {
                const file = event.target.files[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  alert('Bestand te groot! Max 2MB.');
                  event.target.value = '';
                  return;
                }
                if (!file.type.startsWith('image/')) {
                  alert('Alleen afbeeldingen!');
                  event.target.value = '';
                  return;
                }
                const reader = new FileReader();
                reader.onload = function(e) {
                  document.getElementById('postImageValue').value = e.target.result;
                  document.getElementById('postPreviewImg').src = e.target.result;
                  document.getElementById('postImagePreview').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
              }
              function clearPostImage() {
                document.getElementById('postImageUpload').value = '';
                document.getElementById('postImageValue').value = '';
                document.getElementById('postImagePreview').classList.add('hidden');
              }
            `
          }}></script>

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

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', async function() {
          if (deleteUrl) {
            this.disabled = true;
            this.innerText = 'Verwijderen...';
            try {
              const res = await fetch(deleteUrl, { method: 'POST' });
              if (res.ok) {
                closeDeleteModal();
                window.location.reload();
              } else {
                alert('Verwijderen mislukt. Probeer opnieuw.');
                this.disabled = false;
                this.innerText = 'Verwijderen';
              }
            } catch(e) {
              // Fallback: navigate directly
              window.location.href = deleteUrl;
            }
          }
          closeDeleteModal();
        });
      ` }} />
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
      is_pinned,
      cover_image,
      published_at: customPublishedAt,
      verloopt_op
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

    // Determine published_at: use custom date if provided, else auto-set on publish
    const resolvedPublishedAt = customPublishedAt 
      ? String(customPublishedAt).replace('T', ' ') + ':00'
      : (publishedValue === 1 ? now : null)

    if (is_new === '1') {
      // Create new post
      const result = await c.env.DB.prepare(
        `INSERT INTO posts (
          type, categorie, titel, slug, excerpt, body, zichtbaarheid, 
          is_published, is_pinned, auteur_id, created_at, published_at, cover_image, verloopt_op
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        resolvedPublishedAt,
        cover_image || null,
        verloopt_op || null
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
             published_at = CASE WHEN ? IS NOT NULL THEN ? WHEN is_published = 0 AND ? = 1 THEN ? ELSE published_at END,
             cover_image = ?,
             verloopt_op = ?,
             updated_at = ?
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
        customPublishedAt || null,
        customPublishedAt ? String(customPublishedAt).replace('T', ' ') + ':00' : null,
        publishedValue,
        now,
        cover_image || null,
        verloopt_op || null,
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

// =====================================================
// AUDIT LOGS
// =====================================================

app.get('/admin/audit', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const logs = await queryAll(
    c.env.DB,
    `SELECT a.*, u.email, p.voornaam, p.achternaam
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     ORDER BY a.created_at DESC
     LIMIT 100`
  )

  return c.html(
    <Layout 
      title="Audit Logs" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Audit Logs', href: '/admin/audit' }
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="dashboard" />
        <div class="flex-1 min-w-0">
          <div class="bg-white border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div class="flex items-center justify-between">
                <div>
                  <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-history text-animato-accent mr-3"></i>
                    Audit Logs
                  </h1>
                  <p class="mt-2 text-gray-600">
                    Bekijk systeem activiteit en logins
                  </p>
                </div>
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
              </div>
            </div>
          </div>

          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="bg-white rounded-lg shadow-md overflow-hidden">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Datum</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gebruiker</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actie</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    {logs.map((log: any) => (
                      <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(log.created_at).toLocaleString('nl-NL')}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {log.voornaam} {log.achternaam} <span class="text-gray-400">({log.email})</span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span class="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100">
                            {log.actie}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.entity_type} #{log.entity_id}
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-500 font-mono text-xs">
                          {log.meta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// IMPERSONATE - Admin can view site as a regular member
// =====================================================

app.post('/admin/impersonate/:userId', async (c) => {
  const admin = c.get('user') as SessionUser
  if (admin.role !== 'admin') {
    return c.text('Alleen hoofdadmins mogen impersoneren', 403)
  }

  const targetId = parseInt(c.req.param('userId'))
  const target = await queryOne<any>(c.env.DB, `
    SELECT u.id, u.email, u.role, u.stemgroep, u.is_bestuurslid,
           p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `, [targetId])

  if (!target) return c.text('Gebruiker niet gevonden', 404)

  // Create session as the target user, but store original admin id
  const sessionUser: SessionUser = {
    id: target.id,
    email: target.email,
    role: target.role,
    stemgroep: target.stemgroep,
    voornaam: target.voornaam || 'Gebruiker',
    achternaam: target.achternaam || '',
    is_bestuurslid: target.is_bestuurslid || 0
  }

  const token = await generateToken(sessionUser, c.env.JWT_SECRET, '1h')

  // Set impersonate cookie (short-lived, 1 hour)
  setCookie(c, 'auth_token', token, {
    maxAge: 60 * 60, // 1 hour
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/'
  })

  // Store admin's original session so they can switch back
  const adminToken = await generateToken({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    stemgroep: admin.stemgroep,
    voornaam: admin.voornaam,
    achternaam: admin.achternaam,
    is_bestuurslid: admin.is_bestuurslid || 0
  }, c.env.JWT_SECRET, '7d')
  setCookie(c, 'admin_impersonate_token', adminToken, {
    maxAge: 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/'
  })

  return c.redirect('/leden')
})

// Note: /leden/stop-impersonate is in leden.tsx (uses /leden/ path to bypass admin role check)

export default app
