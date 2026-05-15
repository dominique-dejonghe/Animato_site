// Admin Console routes
// Dashboard, Member Management, Content Management, File Management

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { QuillLinkPicker } from '../components/QuillLinkPicker'
import { requireAuth, requireBestuurslid } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'
import { setCookie } from 'hono/cookie'
import { generateToken, hashPassword } from '../utils/auth'
import { notifyAllActiveMembers } from '../utils/notifications'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// IMPERSONATE AUTO-RESTORE
// Wanneer een admin op de site heeft rondgekeken als lid en
// terug navigeert naar /admin (of /api/admin/*), dan willen we
// automatisch de admin-sessie herstellen — ook als het 1h-token
// inmiddels is verlopen. De admin_impersonate_token is 7d geldig.
//
// LET OP: '/admin/*' matcht in Hono GEEN '/admin' zelf (zonder
// trailing path). Daarom registreren we het twee keer.
// =====================================================
const restoreAdminSessionIfImpersonating = async (c: any, next: any) => {
  const { getCookie: gc, setCookie: sc } = await import('hono/cookie')
  const impersonateToken = gc(c, 'admin_impersonate_token')
  if (impersonateToken) {
    // Zet beide cookies in dezelfde response zodat de browser ze atomair
    // toepast — geen race waarbij auth_token al weg is en de redirect
    // binnenkomt zonder geldige sessie.
    sc(c, 'auth_token', impersonateToken, { maxAge: 7 * 24 * 60 * 60, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    sc(c, 'admin_impersonate_token', '', { maxAge: 0, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    return c.redirect(c.req.url)
  }
  await next()
}

// Match zowel /admin (exact) als /admin/* (subpaths)
app.use('/admin', restoreAdminSessionIfImpersonating)
app.use('/admin/*', restoreAdminSessionIfImpersonating)
app.use('/api/admin', restoreAdminSessionIfImpersonating)
app.use('/api/admin/*', restoreAdminSessionIfImpersonating)

// =====================================================
// AUTH FALLBACK voor impersonate-edge-case:
// Als de gewone auth_token (lid, kortlevend) niet meer geldig is
// MAAR er is nog een admin_impersonate_token, gebruik dan dat token.
// Dit voorkomt "Ongeldige of verlopen sessie" wanneer een admin
// na > 1u terug naar /admin gaat.
// =====================================================
const impersonateAuthFallback = async (c: any, next: any) => {
  const { getCookie: gc, setCookie: sc } = await import('hono/cookie')
  const adminToken = gc(c, 'admin_impersonate_token')
  const liveToken = gc(c, 'auth_token')

  if (adminToken && !liveToken) {
    // Geen levend lid-token meer maar wel admin-token bewaard → herstel
    sc(c, 'auth_token', adminToken, { maxAge: 7 * 24 * 60 * 60, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    sc(c, 'admin_impersonate_token', '', { maxAge: 0, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    return c.redirect(c.req.url)
  }
  await next()
}

app.use('/admin', impersonateAuthFallback)
app.use('/admin/*', impersonateAuthFallback)
app.use('/api/admin', impersonateAuthFallback)
app.use('/api/admin/*', impersonateAuthFallback)

// Apply auth middleware - admin, moderator én bestuursleden krijgen toegang tot /admin/*
// (bestuursleden hebben verantwoordelijkheid voor projecten, vergaderingen, budgettering)
// Strikte admin-only acties (bv. user roles wijzigen, lid verwijderen) blijven binnen
// individuele handlers via expliciete role-check beschermd.
app.use('/admin/*', requireAuth)
app.use('/admin/*', requireBestuurslid)
app.use('/api/admin/*', requireAuth)
app.use('/api/admin/*', requireBestuurslid)

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
      // Alle actieve users tellen mee — lid, stemleider, pianist, dirigent, admin, moderator
      `SELECT COUNT(*) as count FROM users WHERE status = 'actief'`
    ),
    total_posts: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM posts WHERE is_published = 1`
    ),
    total_events: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM events WHERE datetime(start_at) > datetime('now')`
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
      `SELECT COUNT(*) as count FROM form_submissions WHERE status = 'nieuw' AND type IN ('word_lid','contact')`
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

  // Lijst van leden voor de "Bekijk als lid" dropdown (#115)
  // — testaccount eerst, dan alfabetisch, met test-leden bovenaan
  const impersonateMembers = await queryAll<any>(
    c.env.DB,
    `SELECT u.id, u.email, u.is_test_account, u.stemgroep,
            COALESCE(p.voornaam, '') as voornaam, COALESCE(p.achternaam, '') as achternaam
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief' AND u.role != 'admin'
     ORDER BY u.is_test_account DESC, p.achternaam ASC, p.voornaam ASC`
  )

  return c.html(
    <Layout 
      title="Admin Dashboard" 
      user={user}
      breadcrumbs={[{ label: 'Admin', href: '/admin' }]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="dashboard" pendingRegistrationsCount={stats.total_pending?.count || 0} userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
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
              <div class="flex items-center gap-3 flex-wrap">
                {/* #115: Bekijk als lid — selecteer welk lid */}
                <form method="POST" action="#" id="impersonateForm" class="inline-flex items-stretch gap-0" onsubmit="return submitImpersonate(event)">
                  <select id="impersonateUserId" required class="px-3 py-2 border border-orange-300 bg-orange-50 text-orange-800 rounded-l-lg text-sm focus:ring-2 focus:ring-orange-300 focus:outline-none max-w-xs">
                    <option value="">— Kies een lid —</option>
                    {impersonateMembers.filter((m: any) => m.is_test_account).length > 0 && (
                      <optgroup label="Test-accounts">
                        {impersonateMembers.filter((m: any) => m.is_test_account).map((m: any) => (
                          <option value={m.id}>
                            {(m.voornaam + ' ' + m.achternaam).trim() || m.email} (test)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Echte leden">
                      {impersonateMembers.filter((m: any) => !m.is_test_account).map((m: any) => (
                        <option value={m.id}>
                          {(m.voornaam + ' ' + m.achternaam).trim() || m.email}{m.stemgroep ? ' (' + m.stemgroep + ')' : ''}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button type="submit" class="px-4 py-2 bg-orange-100 text-orange-700 hover:bg-orange-200 border border-l-0 border-orange-300 rounded-r-lg transition font-medium text-sm whitespace-nowrap" title="Bekijk de site als het gekozen lid">
                    <i class="fas fa-user-secret mr-2"></i>
                    Bekijk als lid
                  </button>
                </form>
                <script dangerouslySetInnerHTML={{ __html: `
                  function submitImpersonate(e){
                    e.preventDefault();
                    var sel = document.getElementById('impersonateUserId');
                    if (!sel || !sel.value) { alert('Kies eerst een lid'); return false; }
                    var f = document.getElementById('impersonateForm');
                    f.action = '/admin/impersonate/' + encodeURIComponent(sel.value);
                    f.submit();
                    return true;
                  }
                `}}></script>
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

            {/* Lid-aanvragen + Contact-berichten (#74) */}
            <a href="/admin/aanmeldingen" class="bg-white rounded-lg shadow-md p-4 flex flex-col gap-3 overflow-hidden border-2 border-green-300 hover:shadow-lg transition cursor-pointer group">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">Aanvragen &amp; Berichten</p>
                <div class="flex-shrink-0 w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-inbox text-green-600 text-base"></i>
                </div>
              </div>
              <p class="text-3xl font-bold text-green-700 leading-none">{stats.total_form_submissions?.count || 0}</p>
              <span class="text-xs text-green-700 group-hover:underline inline-flex items-center gap-1 font-semibold">
                Beheer inbox <i class="fas fa-arrow-right text-xs"></i>
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
              <a href="/admin/leeftijden" class="flex flex-col items-center p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 transition">
                <i class="fas fa-birthday-cake text-2xl text-pink-500 mb-2"></i>
                <span class="text-sm font-medium text-gray-700">Leeftijden</span>
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
                    
                    const row = (
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
                    return activity.user_id ? (
                      <a href={`/admin/leden/${activity.user_id}`} class="block hover:bg-gray-50 rounded -mx-2 px-2 transition" title="Open fiche van dit lid">
                        {row}
                      </a>
                    ) : row
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
  // Type-tab: 'word_lid' (standaard) of 'contact'
  const submissionType = c.req.query('type') === 'contact' ? 'contact' : 'word_lid'
  const success = c.req.query('success')
  const error = c.req.query('error')

  let whereClause = `WHERE type = '${submissionType}'`
  if (filter === 'nieuw') whereClause += " AND status = 'nieuw'"
  else if (filter === 'verwerkt') whereClause += " AND status = 'verwerkt' AND (notities IS NULL OR notities NOT LIKE '%Omgezet naar lid%')"
  else if (filter === 'gearchiveerd') whereClause += " AND status = 'gearchiveerd'"
  // 'omgezet' is verwerkt MET notitie 'Omgezet naar lid' (we kunnen geen aparte status gebruiken — CHECK constraint)
  else if (filter === 'omgezet') whereClause += " AND status = 'verwerkt' AND notities LIKE '%Omgezet naar lid%'"

  const submissions = await queryAll(
    c.env.DB,
    `SELECT id, type, payload, email, naam, status, created_at, verwerkt_at, notities
     FROM form_submissions
     ${whereClause}
     ORDER BY CASE status WHEN 'nieuw' THEN 0 WHEN 'verwerkt' THEN 1 ELSE 2 END, created_at DESC`
  )

  // Counts per status (voor actieve type-tab)
  const counts = await queryAll<any>(c.env.DB,
    `SELECT status, COUNT(*) as cnt FROM form_submissions WHERE type = ? GROUP BY status`,
    [submissionType])
  const statusCounts: Record<string, number> = {}
  let totalCount = 0
  for (const r of counts) { statusCounts[r.status] = r.cnt; totalCount += r.cnt }

  // Aparte count voor 'omgezet naar lid' (= status verwerkt + notitie 'Omgezet naar lid')
  if (submissionType === 'word_lid') {
    const omgezetRow = await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as cnt FROM form_submissions
       WHERE type = 'word_lid' AND status = 'verwerkt' AND notities LIKE '%Omgezet naar lid%'`)
    statusCounts['omgezet_naar_lid'] = omgezetRow?.cnt || 0
    // Trek de omgezet-rijen af van de algemene 'verwerkt' counter, anders worden ze dubbel geteld in de tabs
    statusCounts['verwerkt'] = Math.max(0, (statusCounts['verwerkt'] || 0) - (omgezetRow?.cnt || 0))
  }

  // Counts per type (voor type-tabs bovenaan)
  const typeCounts = await queryAll<any>(c.env.DB,
    `SELECT type, COUNT(*) as cnt FROM form_submissions WHERE status = 'nieuw' GROUP BY type`)
  const newByType: Record<string, number> = {}
  for (const r of typeCounts) { newByType[r.type] = r.cnt }

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
                    <i class={`fas ${submissionType === 'contact' ? 'fa-envelope text-animato-primary' : 'fa-user-plus text-green-600'} mr-3`}></i>
                    {submissionType === 'contact' ? 'Contact-berichten' : 'Lid-aanvragen'}
                  </h1>
                  <p class="mt-2 text-gray-600">
                    {submissionType === 'contact'
                      ? 'Berichten die binnenkwamen via het contactformulier op de publieke website'
                      : "Beheer aanvragen van mensen die lid willen worden via het 'Word Lid' formulier"}
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

            {/* Type tabs (Lid-aanvragen / Contact-berichten) */}
            <div class="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-2">
              <a
                href={`/admin/aanmeldingen?type=word_lid&filter=${filter}`}
                class={`px-4 py-2 rounded-t-lg text-sm font-semibold transition inline-flex items-center gap-2 ${submissionType === 'word_lid' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                <i class="fas fa-user-plus"></i>
                Lid-aanvragen
                {(newByType['word_lid'] || 0) > 0 && (
                  <span class="ml-1 bg-white/20 text-xs px-2 py-0.5 rounded-full font-bold">{newByType['word_lid']}</span>
                )}
              </a>
              <a
                href={`/admin/aanmeldingen?type=contact&filter=${filter}`}
                class={`px-4 py-2 rounded-t-lg text-sm font-semibold transition inline-flex items-center gap-2 ${submissionType === 'contact' ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                <i class="fas fa-envelope"></i>
                Contact-berichten
                {(newByType['contact'] || 0) > 0 && (
                  <span class="ml-1 bg-white/20 text-xs px-2 py-0.5 rounded-full font-bold">{newByType['contact']}</span>
                )}
              </a>
            </div>

            {/* Status filter tabs */}
            <div class="flex flex-wrap gap-2 mb-6">
              {[
                { key: 'alle', label: 'Alles', count: totalCount, color: 'bg-gray-100 text-gray-700', active: 'bg-gray-800 text-white' },
                { key: 'nieuw', label: 'Nieuw', count: statusCounts['nieuw'] || 0, color: 'bg-green-50 text-green-700', active: 'bg-green-600 text-white' },
                { key: 'verwerkt', label: 'Verwerkt', count: statusCounts['verwerkt'] || 0, color: 'bg-blue-50 text-blue-700', active: 'bg-blue-600 text-white' },
                ...(submissionType === 'word_lid' ? [{ key: 'omgezet', label: 'Omgezet naar lid', count: statusCounts['omgezet_naar_lid'] || 0, color: 'bg-purple-50 text-purple-700', active: 'bg-purple-600 text-white' }] : []),
                { key: 'gearchiveerd', label: 'Gearchiveerd', count: statusCounts['gearchiveerd'] || 0, color: 'bg-gray-50 text-gray-500', active: 'bg-gray-500 text-white' },
              ].filter(f => f.count > 0 || f.key === 'alle' || f.key === filter).map(f => (
                <a
                  href={`/admin/aanmeldingen?type=${submissionType}&filter=${f.key}`}
                  class={`px-4 py-2 rounded-full text-sm font-medium transition ${filter === f.key ? f.active : f.color + ' hover:opacity-80'}`}
                >
                  {f.label} {f.count > 0 && <span class="ml-1 opacity-75">({f.count})</span>}
                </a>
              ))}
            </div>

            {submissions.length === 0 ? (
              <div class="text-center py-16 text-gray-500">
                <i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-semibold mb-2">{submissionType === 'contact' ? 'Geen contact-berichten' : 'Geen aanvragen'}</h3>
                <p>Er zijn momenteel geen {submissionType === 'contact' ? 'contact-berichten' : 'lid-aanvragen'}{filter !== 'alle' ? ` met status "${filter}"` : ''}.</p>
              </div>
            ) : (
              <div class="space-y-4">
                {submissions.map((sub: any) => {
                  const data = (() => { try { return JSON.parse(sub.payload) } catch { return {} } })()
                  const isNew = sub.status === 'nieuw'
                  // CHECK constraint laat enkel nieuw/verwerkt/gearchiveerd toe — 'omgezet' herkennen via notitie
                  const isConverted = sub.status === 'verwerkt' && typeof sub.notities === 'string' && sub.notities.includes('Omgezet naar lid')
                  const borderColor = isNew ? 'border-green-500' : isConverted ? 'border-purple-500' : sub.status === 'verwerkt' ? 'border-blue-400' : 'border-gray-200'
                  const statusBadge = isNew ? 'bg-green-100 text-green-800' 
                    : isConverted ? 'bg-purple-100 text-purple-800'
                    : sub.status === 'verwerkt' ? 'bg-blue-100 text-blue-800' 
                    : 'bg-gray-100 text-gray-600'
                  const statusLabel = isNew ? 'Nieuw' : isConverted ? 'Omgezet naar lid' : sub.status === 'verwerkt' ? 'Verwerkt' : 'Gearchiveerd'

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

                        {/* Action buttons - always visible — alle knoppen h-9 voor strakke uitlijning */}
                        <div class="flex items-center gap-2 flex-shrink-0">
                          {/* Convert to member (only for word_lid submissions, niet als al omgezet) */}
                          {!isConverted && sub.type === 'word_lid' && (
                            <a
                              href={`/admin/aanmeldingen/${sub.id}/omzetten`}
                              class="inline-flex items-center justify-center h-9 px-3 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition font-medium whitespace-nowrap"
                              title="Omzetten naar lid (maakt automatisch een actief account aan en zet status op verwerkt)"
                            >
                              <i class="fas fa-user-plus mr-1.5"></i> Omzetten naar lid
                            </a>
                          )}

                          {/* "Verwerkt" markeren — alleen voor contact-formulieren of als word_lid niet wordt omgezet */}
                          {isNew && sub.type !== 'word_lid' && (
                            <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/verwerk`} class="inline-flex m-0">
                              <button
                                type="submit"
                                class="inline-flex items-center justify-center h-9 px-3 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition whitespace-nowrap font-medium"
                                title="Markeer als afgehandeld zonder lid aan te maken"
                              >
                                <i class="fas fa-check mr-1.5"></i> Afgehandeld
                              </button>
                            </form>
                          )}

                          {/* Archive — duidelijk label "Archiveer" + grijs (= bewaar voor naslag, kan terugkomen) */}
                          {(isNew || sub.status === 'verwerkt') && (
                            <form method="POST" action={`/api/admin/aanmeldingen/${sub.id}/archiveer`} class="inline-flex m-0">
                              <button
                                type="submit"
                                class="inline-flex items-center justify-center h-9 px-3 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition border border-gray-300 whitespace-nowrap"
                                title="Verbergen uit actieve lijst, blijft bewaard voor naslag"
                              >
                                <i class="fas fa-archive mr-1.5"></i> Archiveer
                              </button>
                            </form>
                          )}

                          {/* Delete — duidelijk rood + label "Verwijder" (= permanent weg) */}
                          <form
                            method="POST"
                            action={`/api/admin/aanmeldingen/${sub.id}/delete`}
                            class="inline-flex m-0"
                            onsubmit={`return confirm('LET OP: definitief verwijderen.\\n\\nAanvraag van ${sub.naam.replace(/'/g, "\\'")} wordt permanent uit de database verwijderd. Dit kan niet ongedaan gemaakt worden.\\n\\nDoorgaan?');`}
                          >
                            <button
                              type="submit"
                              class="inline-flex items-center justify-center h-9 px-3 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition border border-red-200 whitespace-nowrap"
                              title="Permanent verwijderen uit database (onomkeerbaar)"
                            >
                              <i class="fas fa-trash mr-1.5"></i> Verwijder
                            </button>
                          </form>
                        </div>
                      </div>

                      {/* Contact info */}
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-600 mb-3">
                        <div><i class="fas fa-envelope mr-2 text-gray-400"></i><a href={`mailto:${sub.email}`} class="hover:text-animato-primary">{sub.email}</a></div>
                        {data.telefoon && <div><i class="fas fa-phone mr-2 text-gray-400"></i>{data.telefoon}</div>}
                        {sub.type === 'word_lid' && (
                          <div><i class="fas fa-music mr-2 text-gray-400"></i>Stemgroep: {stemgroepLabel(data.stemgroep)}</div>
                        )}
                      </div>

                      {/* Extra details */}
                      {sub.type === 'contact' ? (
                        <>
                          {data.onderwerp && (
                            <p class="text-sm text-gray-700 mb-2"><strong>Onderwerp:</strong> {data.onderwerp}</p>
                          )}
                          {data.bericht && (
                            <div class="text-sm text-gray-700 bg-gray-50 border-l-4 border-animato-primary p-3 rounded whitespace-pre-wrap">
                              {data.bericht}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {data.muzikale_ervaring && (
                            <p class="text-sm text-gray-700 mb-1"><strong>Ervaring:</strong> {data.muzikale_ervaring}</p>
                          )}
                          {data.motivatie && (
                            <p class="text-sm text-gray-700 mb-1"><strong>Motivatie:</strong> {data.motivatie}</p>
                          )}
                        </>
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

    // Update form submission status (CHECK constraint only allows nieuw/verwerkt/gearchiveerd)
    await execute(c.env.DB,
      `UPDATE form_submissions 
       SET status = 'verwerkt', verwerkt_door = ?, verwerkt_at = datetime('now'),
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
  const bestuur = c.req.query('bestuur') || 'all'   // 'all' | 'yes' | 'no'
  const inactief = c.req.query('inactief') || 'all' // 'all' | 'never' | '14d' | '30d' | '90d'

  // Build query with online status
  let query = `
    SELECT u.id, u.email, u.role, u.stemgroep, u.status, u.created_at, u.last_login_at,
           u.is_bestuurslid,
           p.voornaam, p.achternaam, p.telefoon, u.is_test_account, p.foto_url,
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

  // Bestuur filter
  if (bestuur === 'yes') {
    query += ` AND u.is_bestuurslid = 1`
  } else if (bestuur === 'no') {
    query += ` AND (u.is_bestuurslid IS NULL OR u.is_bestuurslid = 0)`
  }

  // Inactiviteits-filter
  if (inactief === 'never') {
    query += ` AND u.last_login_at IS NULL`
  } else if (inactief === '14d') {
    query += ` AND (u.last_login_at IS NULL OR u.last_login_at < datetime('now','-14 days'))`
  } else if (inactief === '30d') {
    query += ` AND (u.last_login_at IS NULL OR u.last_login_at < datetime('now','-30 days'))`
  } else if (inactief === '90d') {
    query += ` AND (u.last_login_at IS NULL OR u.last_login_at < datetime('now','-90 days'))`
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
    pianist: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'pianist' AND status = 'actief'`),
    dirigent: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE role = 'dirigent' AND status = 'actief'`),
    actief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'actief'`),
    inactief: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE status = 'inactief'`),
    online: await queryOne<any>(c.env.DB, `SELECT COUNT(DISTINCT user_id) as count FROM user_sessions WHERE is_active = 1`),
    bestuur: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM users WHERE is_bestuurslid = 1 AND status = 'actief'`),
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
                <a href="/admin/leden/import" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition" title="Leden importeren uit Excel/CSV">
                  <i class="fas fa-file-import mr-2"></i>
                  Importeren
                </a>
                <a href="/admin/leden/export.csv" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition" title="Download alle leden als CSV (Excel-vriendelijk)">
                  <i class="fas fa-file-excel mr-2 text-green-600"></i>
                  Exporteren
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
                <p class="text-sm text-gray-600">Leden</p>
              </div>
              <a href="/admin/leden?bestuur=yes&status=actief" class="text-center hover:bg-yellow-50 rounded-lg py-1 transition cursor-pointer" title="Toon alleen bestuursleden">
                <p class="text-2xl font-bold text-yellow-600 flex items-center justify-center">
                  <i class="fas fa-shield-alt text-sm mr-1"></i>
                  {counts.bestuur?.count || 0}
                </p>
                <p class="text-sm text-gray-600">Bestuur</p>
              </a>
              <a href="/admin/leden?role=dirigent&status=actief" class="text-center hover:bg-indigo-50 rounded-lg py-1 transition cursor-pointer" title="Toon dirigenten">
                <p class="text-2xl font-bold text-indigo-600 flex items-center justify-center">
                  <i class="fas fa-user-tie text-sm mr-1"></i>
                  {counts.dirigent?.count || 0}
                </p>
                <p class="text-sm text-gray-600">Dirigent</p>
              </a>
              <a href="/admin/leden?role=pianist&status=actief" class="text-center hover:bg-pink-50 rounded-lg py-1 transition cursor-pointer" title="Toon pianisten">
                <p class="text-2xl font-bold text-pink-600 flex items-center justify-center">
                  <i class="fas fa-music text-sm mr-1"></i>
                  {counts.pianist?.count || 0}
                </p>
                <p class="text-sm text-gray-600">Pianist</p>
              </a>
              <div class="text-center">
                <p class="text-2xl font-bold text-red-600">{counts.admin?.count || 0}</p>
                <p class="text-sm text-gray-600">Admins</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-green-600">{counts.actief?.count || 0}</p>
                <p class="text-sm text-gray-600">Actief</p>
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
            <form method="GET" action="/admin/leden" class="space-y-4" id="ledenFilterForm">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Zoeken
                    <span class="text-xs font-normal text-gray-400 ml-1">(live)</span>
                  </label>
                  <input
                    type="text"
                    name="search"
                    id="ledenSearchInput"
                    value={search}
                    placeholder="Naam of email, druk Enter om volledig te zoeken"
                    autocomplete="off"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
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
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-shield-alt text-yellow-500 mr-1"></i>
                    Bestuur
                  </label>
                  <select
                    name="bestuur"
                    onchange="this.form.submit()"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all" selected={bestuur === 'all'}>Iedereen</option>
                    <option value="yes" selected={bestuur === 'yes'}>👔 Enkel bestuursleden ({counts.bestuur?.count || 0})</option>
                    <option value="no" selected={bestuur === 'no'}>Enkel gewone leden</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-moon text-amber-500 mr-1"></i>
                    Inactiviteit
                  </label>
                  <select
                    name="inactief"
                    onchange="this.form.submit()"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    title="Filter op leden die lang niet ingelogd hebben"
                  >
                    <option value="all" selected={inactief === 'all'}>Alle leden</option>
                    <option value="never" selected={inactief === 'never'}>Nooit ingelogd</option>
                    <option value="14d" selected={inactief === '14d'}>≥ 14 dagen inactief</option>
                    <option value="30d" selected={inactief === '30d'}>≥ 30 dagen inactief</option>
                    <option value="90d" selected={inactief === '90d'}>≥ 90 dagen inactief</option>
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
            <a href={`/admin/leden?search=${search}&role=${role}&stemgroep=${stemgroep}&status=${status}&bestuur=${bestuur}&sort=naam`}
               class={`text-sm px-3 py-1 rounded-full transition ${sortBy === 'naam' ? 'bg-animato-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <i class="fas fa-sort-alpha-down mr-1"></i> Op naam
            </a>
            <a href={`/admin/leden?search=${search}&role=${role}&stemgroep=${stemgroep}&status=${status}&bestuur=${bestuur}&sort=stemgroep`}
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
                      
                      // last_login_at is UTC zonder timezone-suffix → expliciet 'Z' toevoegen
                      // anders interpreteert iOS Safari de string verkeerd (datum kan een dag verschuiven).
                      const lastLoginDate = lid.last_login_at
                        ? new Date(lid.last_login_at.replace(' ', 'T') + 'Z')
                        : null
                      const lastLogin = lastLoginDate
                        ? lastLoginDate.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Nooit'
                      const lastLoginTime = lastLoginDate
                        ? lastLoginDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
                        : null
                      // Inactivity tracking — bereken dagen sinds laatste login
                      let inactiveDays: number | null = null
                      let inactiveBadge: { label: string; cls: string } | null = null
                      if (lid.last_login_at) {
                        const ms = Date.now() - new Date(lid.last_login_at + 'Z').getTime()
                        inactiveDays = Math.floor(ms / 86400000)
                        if (inactiveDays >= 90) inactiveBadge = { label: `${inactiveDays}d inactief`, cls: 'bg-red-100 text-red-700' }
                        else if (inactiveDays >= 30) inactiveBadge = { label: `${inactiveDays}d inactief`, cls: 'bg-amber-100 text-amber-700' }
                        else if (inactiveDays >= 14) inactiveBadge = { label: `${inactiveDays}d inactief`, cls: 'bg-yellow-50 text-yellow-700' }
                      } else {
                        inactiveBadge = { label: 'Nooit ingelogd', cls: 'bg-gray-100 text-gray-600' }
                      }
                      
                      const searchHaystack = [
                        lid.voornaam, lid.achternaam, lid.email,
                        lid.telefoon, lid.stemgroep,
                        roleLabels[lid.role] || lid.role,
                        stemgroepLabels[lid.stemgroep] || ''
                      ].filter(Boolean).join(' ').toLowerCase()
                      return (
                        <tr
                          class="leden-row hover:bg-gray-50 transition cursor-pointer"
                          data-search={searchHaystack}
                          onclick={`window.location='/admin/leden/${lid.id}'`}
                        >
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="flex items-center">
                              <div class="relative">
                                {/* #108/#109: foto tonen ipv initialen indien beschikbaar */}
                                {lid.foto_url ? (
                                  <img
                                    src={lid.foto_url}
                                    alt={`${lid.voornaam || ''} ${lid.achternaam || ''}`.trim() || 'Lid'}
                                    class="w-10 h-10 rounded-full object-cover mr-3 border border-gray-200 bg-gray-100"
                                    loading="lazy"
                                    onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling && (this.nextElementSibling.style.display='flex')"
                                  />
                                ) : null}
                                <div
                                  class="w-10 h-10 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white font-bold text-sm mr-3"
                                  style={lid.foto_url ? 'display:none' : ''}
                                >
                                  {lid.voornaam?.charAt(0) || 'U'}{lid.achternaam?.charAt(0) || ''}
                                </div>
                                {lid.is_online > 0 && (
                                  <div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full animate-pulse" title="Online"></div>
                                )}
                              </div>
                              <div>
                                <div class="text-sm font-medium text-gray-900 flex items-center flex-wrap gap-1">
                                  <span>{lid.voornaam} {lid.achternaam}</span>
                                  {lid.is_bestuurslid === 1 && (
                                    <span class="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded font-semibold border border-yellow-300" title="Bestuurslid — toegang tot vergaderingen & projecten">
                                      <i class="fas fa-shield-alt mr-0.5"></i>BESTUUR
                                    </span>
                                  )}
                                  {lid.is_test_account === 1 && (
                                    <span class="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-semibold" title="Testaccount — niet zichtbaar voor leden">
                                      <i class="fas fa-flask mr-0.5"></i>TEST
                                    </span>
                                  )}
                                  {lid.is_online > 0 && (
                                    <span class="text-xs text-green-600 font-semibold">
                                      <i class="fas fa-circle text-xs"></i> Online
                                    </span>
                                  )}
                                  {!lid.last_login_at && lid.role !== 'bezoeker' && (
                                    <span class="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 rounded font-semibold border border-amber-200" title="Deze gebruiker heeft nog nooit ingelogd. Klik op de sleutel-knop om een reset-link te genereren en stuur die door.">
                                      <i class="fas fa-key mr-0.5"></i>Nooit ingelogd
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
                            <div>{lastLogin}</div>
                            {lastLoginTime && (
                              <div class="text-xs text-gray-400">{lastLoginTime}</div>
                            )}
                            {inactiveBadge && (
                              <span class={`inline-block mt-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${inactiveBadge.cls}`} title="Aantal dagen sinds laatste login">
                                <i class="fas fa-moon mr-1"></i>{inactiveBadge.label}
                              </span>
                            )}
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

        // ------------------------------------------------------------
        // Live client-side search filter (no reload, no focus-loss)
        // - Typen = filtert direct de zichtbare rijen in de tabel
        // - Enter = volledige server-side zoek (URL ?search=...) zodat
        //   de term ook na reload bewaard blijft
        // ------------------------------------------------------------
        (function() {
          const input = document.getElementById('ledenSearchInput');
          if (!input) return;
          const form = document.getElementById('ledenFilterForm');

          function applyFilter() {
            const q = input.value.trim().toLowerCase();
            const rows = document.querySelectorAll('tr.leden-row');
            rows.forEach(function(tr) {
              const hay = tr.getAttribute('data-search') || '';
              tr.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
            });
          }

          input.addEventListener('input', applyFilter);
          input.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              if (form) form.submit();
            }
          });

          // Als er een search-term via de URL staat (server-side), pas ook
          // de live-filter toe zodat de count rechts zichtbaar klopt.
          if (input.value) applyFilter();
        })();
      ` }} />
    </Layout>
  )
})

// =====================================================
// EXPORT MEMBERS AS CSV (#154)
// =====================================================
// Download alle leden als CSV — Excel-vriendelijk (UTF-8 BOM + ; separator).
app.get('/admin/leden/export.csv', async (c) => {
  const user = c.get('user') as SessionUser
  if (user.role !== 'admin') {
    return c.json({ error: 'Alleen voor admins' }, 403)
  }

  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT u.id, u.email, u.role, u.stemgroep, u.status, u.created_at,
            p.voornaam, p.achternaam, p.telefoon, p.geboortedatum,
            p.straat, p.huisnummer, p.bus, p.postcode, p.gemeente,
            p.lid_sinds, p.bio, p.muzikale_ervaring,
            p.is_bestuurslid, p.bestuurs_functie
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.role != 'bezoeker'
     ORDER BY p.achternaam ASC, p.voornaam ASC`
  )

  // CSV-escape: dubbele quotes verdubbelen, omsluiten met quotes als nodig
  const esc = (val: any): string => {
    if (val === null || val === undefined) return ''
    const s = String(val)
    if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  const headers = [
    'ID', 'Voornaam', 'Achternaam', 'Email', 'Telefoon', 'Geboortedatum',
    'Straat', 'Huisnummer', 'Bus', 'Postcode', 'Gemeente',
    'Rol', 'Stemgroep', 'Status', 'Lid sinds', 'Bestuurslid', 'Bestuurs functie',
    'Bio', 'Muzikale ervaring', 'Account aangemaakt'
  ]
  const lines = [headers.map(esc).join(';')]
  for (const r of rows) {
    lines.push([
      r.id,
      r.voornaam || '',
      r.achternaam || '',
      r.email || '',
      r.telefoon || '',
      r.geboortedatum || '',
      r.straat || '',
      r.huisnummer || '',
      r.bus || '',
      r.postcode || '',
      r.gemeente || '',
      r.role || '',
      r.stemgroep || '',
      r.status || '',
      r.lid_sinds || '',
      r.is_bestuurslid ? 'ja' : 'nee',
      r.bestuurs_functie || '',
      (r.bio || '').replace(/<[^>]+>/g, '').slice(0, 500),
      (r.muzikale_ervaring || '').replace(/<[^>]+>/g, '').slice(0, 500),
      r.created_at || ''
    ].map(esc).join(';'))
  }

  // UTF-8 BOM zodat Excel de encoding correct herkent + scheidingsteken ;
  const csv = '\uFEFFsep=;\n' + lines.join('\n')
  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="animato-leden-${today}.csv"`,
      'Cache-Control': 'no-store'
    }
  })
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

                {/* Adres — opgesplitst in straat, nummer, bus, postcode, gemeente (analoog aan edit-lid form) */}
                <div class="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div class="md:col-span-7">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Straat</label>
                    <input
                      type="text"
                      name="straat"
                      placeholder="Lange Straat"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div class="md:col-span-3">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Huisnummer</label>
                    <input
                      type="text"
                      name="huisnummer"
                      placeholder="123"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Bus</label>
                    <input
                      type="text"
                      name="bus"
                      placeholder="A"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div class="md:col-span-4">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Postcode</label>
                    <input
                      type="text"
                      name="postcode"
                      placeholder="2890"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div class="md:col-span-8">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Gemeente</label>
                    <input
                      type="text"
                      name="gemeente"
                      placeholder="Oppuurs"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Lid sinds */}
                <div class="mt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Lid sinds
                  </label>
                  <input
                    type="date"
                    name="lid_sinds"
                    class="w-full md:w-1/2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <p class="text-xs text-gray-500 mt-1">Datum waarop deze persoon lid werd. Laat leeg voor 'vandaag'.</p>
                </div>

                {/* Bio */}
                <div class="mt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Korte bio
                  </label>
                  <textarea
                    name="bio"
                    rows={2}
                    placeholder="Kort persoonlijk verhaaltje (zichtbaar in smoelenboek)"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                </div>

                {/* Muzikale ervaring */}
                <div class="mt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    Muzikale ervaring
                  </label>
                  <textarea
                    name="muzikale_ervaring"
                    rows={2}
                    placeholder="Eerdere koorervaring, muziekopleiding..."
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

  // Login activiteit: laatste 5 sessies + totaal aantal logins
  const recentSessions = await queryAll<any>(c.env.DB,
    `SELECT login_at, logout_at, duration_seconds, ip_address, user_agent, login_method
     FROM user_sessions
     WHERE user_id = ?
     ORDER BY login_at DESC
     LIMIT 5`,
    [userId]
  )
  const sessionStats = await queryOne<any>(c.env.DB,
    `SELECT COUNT(*) as total_logins,
            MAX(login_at) as last_login,
            SUM(COALESCE(duration_seconds, 0)) as total_seconds
     FROM user_sessions
     WHERE user_id = ?`,
    [userId]
  )

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

              {/* Login Activiteit Card */}
              {(() => {
                const lastLogin = sessionStats?.last_login || member.last_login_at;
                const totalLogins = sessionStats?.total_logins || 0;
                const totalSeconds = sessionStats?.total_seconds || 0;
                const totalHours = Math.floor(totalSeconds / 3600);
                const totalMinutes = Math.floor((totalSeconds % 3600) / 60);

                // Helper: relatieve tijd ("3 dagen geleden")
                const relTime = (iso: string | null) => {
                  if (!iso) return null;
                  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
                  const diffMs = Date.now() - d.getTime();
                  const diffMin = Math.floor(diffMs / 60000);
                  if (diffMin < 1) return 'zojuist';
                  if (diffMin < 60) return `${diffMin} min geleden`;
                  const diffH = Math.floor(diffMin / 60);
                  if (diffH < 24) return `${diffH} u geleden`;
                  const diffD = Math.floor(diffH / 24);
                  if (diffD < 7) return `${diffD} dag${diffD === 1 ? '' : 'en'} geleden`;
                  if (diffD < 30) {
                    const w = Math.floor(diffD / 7);
                    return `${w} ${w === 1 ? 'week' : 'weken'} geleden`;
                  }
                  if (diffD < 365) {
                    const m = Math.floor(diffD / 30);
                    return `${m} ${m === 1 ? 'maand' : 'maanden'} geleden`;
                  }
                  return `${Math.floor(diffD / 365)} jaar geleden`;
                };

                // Helper: detect device/browser uit user_agent
                const parseUA = (ua: string | null) => {
                  if (!ua) return { device: 'Onbekend', icon: 'fa-question' };
                  const lo = ua.toLowerCase();
                  let device = 'Desktop', icon = 'fa-desktop';
                  if (lo.includes('iphone') || lo.includes('android')) { device = 'Mobile'; icon = 'fa-mobile-screen'; }
                  else if (lo.includes('ipad') || lo.includes('tablet')) { device = 'Tablet'; icon = 'fa-tablet-screen-button'; }
                  let browser = '';
                  if (lo.includes('edg/')) browser = 'Edge';
                  else if (lo.includes('chrome/')) browser = 'Chrome';
                  else if (lo.includes('firefox/')) browser = 'Firefox';
                  else if (lo.includes('safari/')) browser = 'Safari';
                  return { device: browser ? `${device} · ${browser}` : device, icon };
                };

                const lastLoginRel = relTime(lastLogin);
                const isStale = lastLogin ? (Date.now() - new Date(lastLogin.replace(' ', 'T') + 'Z').getTime()) > 30 * 24 * 60 * 60 * 1000 : false;

                return (
                  <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <div class="flex items-center justify-between mb-4">
                      <h3 class="text-xl font-bold text-gray-900">
                        <i class="fas fa-clock-rotate-left text-animato-primary mr-2"></i>
                        Login Activiteit
                      </h3>
                      <a href={`/admin/audit?user_id=${userId}`} class="text-xs text-animato-primary hover:underline">
                        <i class="fas fa-external-link-alt mr-1"></i>Volledige audit log
                      </a>
                    </div>

                    {/* Top KPI strip */}
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                      <div class={`rounded-lg border p-3 ${isStale ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                        <p class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Laatste login</p>
                        <p class={`text-lg font-bold mt-1 ${isStale ? 'text-amber-800' : 'text-green-800'}`}>
                          {lastLoginRel || '—'}
                        </p>
                        {lastLogin && (
                          <p class="text-xs text-gray-500 mt-0.5">
                            {new Date(lastLogin.includes('T') ? lastLogin : lastLogin.replace(' ', 'T') + 'Z').toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        )}
                        {!lastLogin && <p class="text-xs text-gray-500 mt-0.5">Nog nooit ingelogd</p>}
                      </div>
                      <div class="rounded-lg border bg-blue-50 border-blue-200 p-3">
                        <p class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Totaal logins</p>
                        <p class="text-lg font-bold text-blue-800 mt-1">{totalLogins}</p>
                        <p class="text-xs text-gray-500 mt-0.5">sessies geregistreerd</p>
                      </div>
                      <div class="rounded-lg border bg-purple-50 border-purple-200 p-3">
                        <p class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Totaal tijd online</p>
                        <p class="text-lg font-bold text-purple-800 mt-1">
                          {totalHours > 0 ? `${totalHours}u ${totalMinutes}m` : totalMinutes > 0 ? `${totalMinutes}m` : '—'}
                        </p>
                        <p class="text-xs text-gray-500 mt-0.5">cumulatief</p>
                      </div>
                    </div>

                    {/* Recente sessies tabel */}
                    {recentSessions.length > 0 ? (
                      <div>
                        <h4 class="text-sm font-semibold text-gray-700 mb-2">
                          <i class="fas fa-history text-gray-400 mr-1"></i>
                          Laatste {recentSessions.length} login{recentSessions.length === 1 ? '' : 's'}
                        </h4>
                        <div class="overflow-x-auto">
                          <table class="w-full text-sm">
                            <thead class="bg-gray-50 border-y border-gray-200">
                              <tr>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wanneer</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Apparaat</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Methode</th>
                                <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Duur</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">
                              {recentSessions.map((s: any) => {
                                const ua = parseUA(s.user_agent);
                                const dur = s.duration_seconds
                                  ? (s.duration_seconds < 60
                                      ? `${s.duration_seconds}s`
                                      : s.duration_seconds < 3600
                                        ? `${Math.floor(s.duration_seconds / 60)}m`
                                        : `${Math.floor(s.duration_seconds / 3600)}u ${Math.floor((s.duration_seconds % 3600) / 60)}m`)
                                  : (s.logout_at ? '—' : <span class="text-green-600 font-semibold">actief</span>);
                                const loginIso = s.login_at;
                                const loginRel = relTime(loginIso);
                                return (
                                  <tr class="hover:bg-gray-50">
                                    <td class="px-3 py-2 whitespace-nowrap">
                                      <div class="text-gray-900">{loginRel}</div>
                                      <div class="text-xs text-gray-400">
                                        {loginIso ? new Date(loginIso.includes('T') ? loginIso : loginIso.replace(' ', 'T') + 'Z').toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                                      </div>
                                    </td>
                                    <td class="px-3 py-2 whitespace-nowrap text-gray-700">
                                      <i class={`fas ${ua.icon} text-gray-400 mr-1.5`}></i>{ua.device}
                                    </td>
                                    <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-500 font-mono">{s.ip_address || '—'}</td>
                                    <td class="px-3 py-2 whitespace-nowrap">
                                      <span class={`text-xs px-2 py-0.5 rounded-full ${
                                        s.login_method === 'password' ? 'bg-blue-100 text-blue-700' :
                                        s.login_method === 'magic_link' ? 'bg-purple-100 text-purple-700' :
                                        s.login_method === 'reset_token' ? 'bg-amber-100 text-amber-700' :
                                        'bg-gray-100 text-gray-700'
                                      }`}>
                                        {s.login_method || 'onbekend'}
                                      </span>
                                    </td>
                                    <td class="px-3 py-2 whitespace-nowrap text-right text-gray-700">{dur}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div class="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded">
                        <i class="fas fa-user-slash text-2xl mb-2 text-gray-300"></i>
                        <p>{lastLogin ? 'Logins geregistreerd voor het sessie-tracking systeem' : 'Dit lid heeft nog nooit ingelogd.'}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                <input type="file" id="foto-file-input" accept="image/*" class="hidden" />
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
              <div class="flex justify-between items-center pt-6 border-t border-gray-200 flex-wrap gap-3">
                <div class="flex gap-3 flex-wrap">
                  <button
                    type="button"
                    onclick={`openDeleteModal('/api/admin/leden/${member.id}/delete')`}
                    class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition inline-block"
                  >
                    <i class="fas fa-trash mr-2"></i>
                    Verwijder Lid
                  </button>
                  <button
                    type="button"
                    onclick={`generateResetLink(${member.id}, '${(member.voornaam + ' ' + member.achternaam).replace(/'/g, "\\'")}')`}
                    class="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition inline-block"
                    title="Genereer een reset-link en deel manueel (geen email)"
                  >
                    <i class="fas fa-key mr-2"></i>
                    Reset link genereren
                  </button>
                </div>
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

              {/* Reset link result modal */}
              <div id="resetLinkModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-[200] flex items-center justify-center p-4">
                <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
                  <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-gray-900">
                      <i class="fas fa-key text-amber-500 mr-2"></i>
                      Wachtwoord reset link
                    </h3>
                    <button type="button" onclick="document.getElementById('resetLinkModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-700">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                  <div id="resetLinkContent" class="text-sm text-gray-700">
                    <div class="animate-pulse">Bezig...</div>
                  </div>
                </div>
              </div>
              <script dangerouslySetInnerHTML={{ __html: `
                async function generateResetLink(userId, naam) {
                  const modal = document.getElementById('resetLinkModal');
                  const content = document.getElementById('resetLinkContent');
                  modal.classList.remove('hidden');
                  content.innerHTML = '<div class="text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Reset link genereren voor ' + naam + '...</div>';
                  try {
                    const r = await fetch('/api/admin/users/' + userId + '/reset-link', {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' }
                    });
                    const d = await r.json();
                    if (!r.ok) {
                      content.innerHTML = '<div class="text-red-600"><i class="fas fa-exclamation-circle mr-2"></i>' + (d.error || 'Onbekende fout') + '</div>';
                      return;
                    }
                    content.innerHTML =
                      '<div class="space-y-3">' +
                        '<div class="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-sm">' +
                          '<i class="fas fa-check-circle mr-1"></i> Reset link gegenereerd voor <strong>' + d.email + '</strong>' +
                        '</div>' +
                        '<div>' +
                          '<label class="block text-xs font-medium text-gray-600 mb-1">Reset link (geldig ' + d.expires_in + ', éénmalig bruikbaar)</label>' +
                          '<div class="flex gap-2">' +
                            '<input type="text" id="rl_input" readonly value="' + d.reset_link + '" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono bg-gray-50" onclick="this.select()" />' +
                            '<button type="button" id="rl_copy_btn" onclick="copyResetLink()" class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">' +
                              '<i class="fas fa-copy"></i> Kopieer' +
                            '</button>' +
                          '</div>' +
                        '</div>' +
                        '<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-xs">' +
                          '<strong>Tip:</strong> kopieer en stuur de link via WhatsApp, SMS of een ander kanaal. ' + d.note +
                        '</div>' +
                      '</div>';
                  } catch (e) {
                    content.innerHTML = '<div class="text-red-600"><i class="fas fa-exclamation-circle mr-2"></i>' + e.message + '</div>';
                  }
                }
                window.generateResetLink = generateResetLink;
                function copyResetLink() {
                  const input = document.getElementById('rl_input');
                  if (!input) return;
                  input.select();
                  navigator.clipboard.writeText(input.value).then(function() {
                    const btn = document.getElementById('rl_copy_btn');
                    if (btn) {
                      btn.innerHTML = '<i class="fas fa-check"></i> Gekopieerd';
                      btn.classList.remove('bg-blue-500','hover:bg-blue-600');
                      btn.classList.add('bg-green-500');
                    }
                  });
                }
                window.copyResetLink = copyResetLink;
              `}} />
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
      gemeente,
      lid_sinds
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

    // Insert profile — lid_sinds is gebruiker-instelbaar; fallback = vandaag
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, adres, straat, huisnummer, bus, postcode, gemeente, stad, bio, muzikale_ervaring, geboortedatum, lid_sinds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, DATE('now')))`
    ).bind(
      newUserId, voornaam, achternaam, telefoon || null, adres || null,
      straat || null, huisnummer || null, bus || null, postcode || null,
      gemeente || null, gemeente || null, bio || null, muzikale_ervaring || null,
      geboortedatum || null, lid_sinds || null
    ).run()

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
      SELECT p.id, p.type, p.titel, p.slug, p.excerpt, p.public_share,
             p.is_published, p.zichtbaarheid, p.categorie, p.created_at, p.published_at,
             p.shared_via_whatsapp, p.shared_via_whatsapp_at,
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
    events_upcoming: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM events WHERE datetime(start_at) > datetime('now')`),
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
                        <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Is dit bericht via WhatsApp gedeeld?">
                          <i class="fab fa-whatsapp text-green-600 mr-1"></i>
                          WhatsApp
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
                            <td class="px-6 py-4 whitespace-nowrap text-center">
                              {/* #150: WhatsApp-vinkje — klik om aan/uit te zetten */}
                              <button
                                type="button"
                                onclick={`toggleWhatsappShared(${item.id}, this)`}
                                class={`inline-flex items-center justify-center w-8 h-8 rounded-full transition ${item.shared_via_whatsapp ? 'bg-green-100 hover:bg-green-200 text-green-700' : 'bg-gray-50 hover:bg-gray-100 text-gray-400'}`}
                                title={item.shared_via_whatsapp ? `Gedeeld via WhatsApp${item.shared_via_whatsapp_at ? ' op ' + new Date(item.shared_via_whatsapp_at).toLocaleDateString('nl-BE') : ''} — klik om uit te vinken` : 'Klik om aan te vinken: gedeeld via WhatsApp'}
                                data-shared={item.shared_via_whatsapp ? '1' : '0'}
                              >
                                {item.shared_via_whatsapp ? (
                                  <i class="fas fa-check text-base"></i>
                                ) : (
                                  <i class="far fa-square text-base"></i>
                                )}
                              </button>
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
                          {/* Snelle WhatsApp share — enkel voor gepubliceerde posts met slug */}
                          {tab === 'posts' && item.is_published === 1 && item.slug && (() => {
                            const baseUrl = 'https://animato-live.pages.dev'
                            const detailPath = item.type === 'nieuws' ? `/nieuws/${item.slug}` : `/posts/${item.slug}`
                            const isPubliclyAccessible = item.zichtbaarheid === 'publiek' || item.public_share === 1
                            // Voor leden-only: gebruik /preview/:slug zodat WhatsApp's bot wel OG-tags kan scrapen
                            const shareUrl = isPubliclyAccessible ? `${baseUrl}${detailPath}` : `${baseUrl}/preview/${item.slug}`
                            const titelSafe = (item.titel || '').replace(/\*/g, '')
                            const excerptClean = (item.excerpt || '').trim()
                            const lines = [`*${titelSafe}*`]
                            if (excerptClean) lines.push('', excerptClean)
                            lines.push('', shareUrl)
                            const shareText = lines.join('\n')
                            return (
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onclick={`event.stopPropagation(); markWhatsappShared(${item.id})`}
                                class="text-green-600 hover:text-green-800 mr-3"
                                title={isPubliclyAccessible ? 'Deel direct via WhatsApp (publiek)' : 'Deel via WhatsApp — leden-only, ontvangers zien preview-kaart'}
                              >
                                <i class="fab fa-whatsapp text-base"></i>
                              </a>
                            )
                          })()}
                          <a 
                            href={`/admin/content/${item.id}?type=${tab}`} 
                            class="text-animato-primary hover:text-animato-secondary mr-3"
                            title="Bewerken"
                          >
                            <i class="fas fa-edit"></i>
                          </a>
                          <button
                            onclick={`openDeleteModal('/api/admin/content/${item.id}/delete?type=${tab}')`}
                            class="text-red-600 hover:text-red-900"
                            title="Verwijderen"
                          >
                            <i class="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colspan={tab === 'posts' ? '8' : '6'} class="px-6 py-12 text-center text-gray-500">
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

      {/* #150: WhatsApp toggle script — alleen op deze content-overzicht pagina */}
      <script dangerouslySetInnerHTML={{ __html: `
        async function toggleWhatsappShared(postId, btn) {
          const wasShared = btn.dataset.shared === '1';
          btn.disabled = true;
          try {
            const res = await fetch('/api/admin/content/' + postId + '/toggle-whatsapp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.success) {
              const isShared = data.shared_via_whatsapp;
              btn.dataset.shared = isShared ? '1' : '0';
              btn.className = 'inline-flex items-center justify-center w-8 h-8 rounded-full transition ' + (isShared ? 'bg-green-100 hover:bg-green-200 text-green-700' : 'bg-gray-50 hover:bg-gray-100 text-gray-400');
              btn.innerHTML = isShared ? '<i class="fas fa-check text-base"></i>' : '<i class="far fa-square text-base"></i>';
              btn.title = isShared ? 'Gedeeld via WhatsApp — klik om uit te vinken' : 'Klik om aan te vinken: gedeeld via WhatsApp';
            } else {
              alert('Fout: ' + (data.error || 'onbekend'));
            }
          } catch (e) {
            alert('Netwerkfout: ' + e.message);
          } finally {
            btn.disabled = false;
          }
        }
        window.toggleWhatsappShared = toggleWhatsappShared;

        // Markeer als "gedeeld" wanneer admin op de directe WhatsApp share-knop in de actie-kolom klikt.
        // Anders dan toggle: dit ZET het vinkje aan (idempotent — als al aan, niets doen).
        async function markWhatsappShared(postId) {
          // Zoek het toggle-knopje in dezelfde rij
          const row = document.querySelector('button[onclick*="toggleWhatsappShared(' + postId + ','][data-shared]');
          if (row && row.dataset.shared === '1') return; // al aangevinkt
          try {
            const res = await fetch('/api/admin/content/' + postId + '/toggle-whatsapp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.success && row) {
              const isShared = data.shared_via_whatsapp;
              // Als de toggle "uitvinkte" (omdat hij al stond), zet hem terug aan
              if (!isShared) {
                await fetch('/api/admin/content/' + postId + '/toggle-whatsapp', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }
                });
              }
              row.dataset.shared = '1';
              row.className = 'inline-flex items-center justify-center w-8 h-8 rounded-full transition bg-green-100 hover:bg-green-200 text-green-700';
              row.innerHTML = '<i class="fas fa-check text-base"></i>';
              row.title = 'Gedeeld via WhatsApp — klik om uit te vinken';
            }
          } catch (e) {
            // Stil falen — gebruiker zit al in WhatsApp tegen die tijd
            console.warn('markWhatsappShared:', e);
          }
        }
        window.markWhatsappShared = markWhatsappShared;
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
  const errorMsg = c.req.query('msg')

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

  // Bericht-templates ophalen voor inline gebruik in de editor (#151)
  const messageTemplates = await queryAll<any>(
    c.env.DB,
    `SELECT id, title, subject, body, category FROM message_templates ORDER BY category, title`
  )

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

          {/* #119 / #150 — PERMANENTE DEEL-KAART
              Toont WhatsApp/Facebook/LinkedIn/Email-share knoppen telkens als je een
              gepubliceerd bericht bekijkt of bewerkt — niet enkel direct na save.
              Voorwaarden: gepubliceerde post, post-type (geen events), en een slug. */}
          {post && post.is_published === 1 && contentType === 'posts' && post.slug && (() => {
            const baseUrl = 'https://animato-live.pages.dev'
            const detailPath = post.type === 'nieuws' ? `/nieuws/${post.slug}` : `/posts/${post.slug}`
            const detailUrl = `${baseUrl}${detailPath}`
            const isPublicShare = post.public_share === 1
            const isPubliclyAccessible = post.zichtbaarheid === 'publiek' || isPublicShare
            // Voor leden-only: deel de /preview/:slug link zodat WhatsApp's bot wél OG-tags krijgt
            // (zonder dat we de inhoud lekken — preview toont alleen titel, excerpt en cover)
            const shareUrl = isPubliclyAccessible ? detailUrl : `${baseUrl}/preview/${post.slug}`
            const needsLogin = !isPubliclyAccessible

            // Nette share-tekst: titel in WhatsApp-bold + lege regel + excerpt + lege regel + URL.
            // GEEN emojis (Dominique: "anders slordig" — bv. squares in oudere fonts).
            const titelEscaped = post.titel.replace(/\*/g, '')   // dubbele asterisks in titel slopen WhatsApp bold
            const excerptClean = (post.excerpt || '').trim()
            const shareLines = [`*${titelEscaped}*`]
            if (excerptClean) shareLines.push('', excerptClean)
            shareLines.push('', shareUrl)
            const shareText = shareLines.join('\n')
            // Voor "Kopieer link" — gewoon URL, geen markdown
            const copyText = `${post.titel} — ${shareUrl}`
            const copyTextEscaped = copyText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
            // Facebook / LinkedIn / Email
            const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`
            const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`
            const mailSubj = encodeURIComponent(post.titel)
            const mailBody = encodeURIComponent(`${excerptClean ? excerptClean + '\n\n' : ''}Lees verder: ${shareUrl}\n\n— Gemengd Koor Animato`)
            const mailUrl = `mailto:?subject=${mailSubj}&body=${mailBody}`

            return (
              <div class="mb-6 bg-white border-2 border-animato-primary/20 rounded-xl shadow-sm overflow-hidden">
                <div class="bg-gradient-to-r from-animato-primary/10 to-animato-secondary/10 px-5 py-3 border-b border-animato-primary/10 flex items-center justify-between flex-wrap gap-2">
                  <div class="flex items-center gap-2">
                    <i class="fas fa-share-nodes text-animato-primary"></i>
                    <h3 class="font-semibold text-gray-800 text-sm">Deel dit bericht</h3>
                  </div>
                  {/* Status-indicator: openbaar of leden-only */}
                  {isPublicShare ? (
                    <span class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                      <i class="fas fa-share-alt mr-1.5"></i>
                      Publiek deelbaar
                    </span>
                  ) : needsLogin ? (
                    <span class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700" title="Volledige inhoud vereist login; preview-kaart is wel publiek">
                      <i class="fas fa-lock mr-1.5"></i>
                      Leden-only (met publieke preview)
                    </span>
                  ) : (
                    <span class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                      <i class="fas fa-globe mr-1.5"></i>
                      Publieke post
                    </span>
                  )}
                </div>

                <div class="p-5 flex flex-col gap-3">
                  {/* Primaire actie + alternatieven */}
                  <div class="flex items-center gap-2 flex-wrap">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition shadow-sm"
                      title="Open WhatsApp om dit bericht te delen — de cover en samenvatting verschijnen automatisch als preview-kaart"
                    >
                      <i class="fab fa-whatsapp mr-2 text-base"></i>
                      Deel via WhatsApp
                    </a>
                    <a
                      href={fbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition"
                      title="Deel via Facebook"
                    >
                      <i class="fab fa-facebook-f text-sm"></i>
                    </a>
                    <a
                      href={liUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-sky-700 hover:bg-sky-800 text-white transition"
                      title="Deel via LinkedIn"
                    >
                      <i class="fab fa-linkedin-in text-sm"></i>
                    </a>
                    <a
                      href={mailUrl}
                      class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-600 hover:bg-gray-700 text-white transition"
                      title="Deel via e-mail"
                    >
                      <i class="fas fa-envelope text-sm"></i>
                    </a>
                    <a
                      href={detailPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm transition"
                      title="Open het publieke bericht in een nieuw tabblad"
                    >
                      <i class="fas fa-external-link-alt mr-1.5"></i>
                      Bekijk
                    </a>
                    <button
                      type="button"
                      onclick={`navigator.clipboard.writeText('${copyTextEscaped}'); this.innerHTML='<i class=\\'fas fa-check mr-1.5\\'></i> Gekopieerd!'; setTimeout(()=>{this.innerHTML='<i class=\\'fas fa-copy mr-1.5\\'></i> Kopieer link'}, 2000);`}
                      class="inline-flex items-center px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm transition"
                      title="Kopieer link + titel voor andere kanalen"
                    >
                      <i class="fas fa-copy mr-1.5"></i>
                      Kopieer link
                    </button>
                  </div>

                  {/* Live preview van de WhatsApp share-tekst */}
                  <details class="w-full">
                    <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                      <i class="fas fa-eye mr-1"></i>Voorbeeld van de WhatsApp-tekst
                    </summary>
                    <div class="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {shareText}
                    </div>
                    <div class="mt-1 text-[11px] text-gray-400">
                      <i class="fas fa-image mr-1"></i>Cover + samenvatting komen er automatisch bij als kaartje (OpenGraph).
                    </div>
                  </details>

                  {needsLogin && (
                    <div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <i class="fas fa-info-circle mr-1"></i>
                      Tip: vink <strong>"Maak publiek deelbaar"</strong> aan in de zichtbaarheidsopties om de volledige inhoud direct toegankelijk te maken voor iedereen die de link ontvangt.
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {error && (
            <div class="mb-6 bg-red-50 border-l-4 border-red-400 rounded-lg p-4 shadow-sm">
              <div class="flex items-start">
                <i class="fas fa-exclamation-triangle text-red-500 mr-3 mt-0.5 text-lg"></i>
                <div class="flex-1">
                  <div class="text-sm font-semibold text-red-800 mb-1">
                    {error === 'save_failed' && 'Opslaan mislukt'}
                    {error === 'server_error' && 'Server fout'}
                    {error === 'not_found' && 'Post niet gevonden'}
                    {error === 'required_fields' && 'Verplichte velden ontbreken'}
                    {error === 'body_missing' && 'De inhoud (body) ontbreekt'}
                  </div>
                  <div class="text-sm text-red-700">
                    {error === 'save_failed' && 'Er is iets misgegaan bij het opslaan van de post.'}
                    {error === 'server_error' && 'Een onverwachte server fout is opgetreden.'}
                    {error === 'required_fields' && 'Vul alle verplichte velden (titel, type, zichtbaarheid) in.'}
                    {error === 'body_missing' && 'Vul de hoofdtekst van de post in.'}
                  </div>
                  {errorMsg && (
                    <details class="mt-2">
                      <summary class="text-xs text-red-600 cursor-pointer hover:underline">Technische details</summary>
                      <code class="block mt-1 text-xs bg-red-100 text-red-900 p-2 rounded font-mono">{decodeURIComponent(errorMsg)}</code>
                    </details>
                  )}
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
                <div class="flex items-center justify-between mb-1 flex-wrap gap-2">
                  <label class="block text-sm font-medium text-gray-700">
                    Body (hoofdtekst) *
                  </label>
                  {/* Template-picker (#151) — laat een admin een vooraf gemaakte template inladen */}
                  {messageTemplates.length > 0 && (
                    <div class="flex items-center gap-2">
                      <label class="text-xs text-gray-500" htmlFor="template-picker">
                        <i class="fas fa-magic mr-1 text-purple-500"></i>
                        Template inladen:
                      </label>
                      <select
                        id="template-picker"
                        class="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value="">— Kies een template —</option>
                        {messageTemplates.map((tpl: any) => (
                          <option value={tpl.id}>
                            [{tpl.category}] {tpl.title}
                          </option>
                        ))}
                      </select>
                      <a href="/admin/communicatie" target="_blank" rel="noopener" class="text-xs text-purple-600 hover:underline" title="Beheer templates in nieuw tabblad">
                        <i class="fas fa-cog"></i>
                      </a>
                    </div>
                  )}
                </div>
                {/* #118 fix: 'required' verwijderd van verborgen textarea — HTML5 validation
                    blokkeerde stilletjes het submitten omdat de textarea display:none was
                    en (initieel) leeg vóór Quill 'text-change' had gesync't. Validatie
                    gebeurt nu via JS in form 'submit' (zie Quill init script verderop). */}
                <textarea
                  id="body-editor"
                  name="body"
                  rows={12}
                  placeholder="Volledige inhoud van de post..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{post?.body || ''}</textarea>
                <p class="mt-2 text-xs text-gray-500">
                  <i class="fas fa-info-circle mr-1"></i>
                  Gebruik de editor toolbar voor opmaak. HTML wordt automatisch gegenereerd.
                  {messageTemplates.length > 0 && ' Of laad een template hierboven om snel te starten.'}
                </p>

                {/* Hidden data store voor JS — alle templates serialized */}
                <script
                  id="message-templates-data"
                  type="application/json"
                  dangerouslySetInnerHTML={{ __html: JSON.stringify(messageTemplates) }}
                />
                <script dangerouslySetInnerHTML={{ __html: `
                  (function() {
                    var picker = document.getElementById('template-picker');
                    if (!picker) return;
                    var dataEl = document.getElementById('message-templates-data');
                    var templates = [];
                    try { templates = JSON.parse(dataEl.textContent || '[]'); } catch(e) {}

                    picker.addEventListener('change', function(e) {
                      var id = parseInt(e.target.value, 10);
                      if (!id) return;
                      var tpl = templates.find(function(t) { return t.id === id; });
                      if (!tpl) return;

                      var current = '';
                      // Try Quill (gebruikt op deze pagina)
                      var quill = window.bodyQuill;
                      if (quill && typeof quill.root !== 'undefined') {
                        current = (quill.root.innerHTML || '').replace(/<p><br><\\/p>/g, '').trim();
                      } else {
                        var ta = document.getElementById('body-editor');
                        current = (ta ? ta.value : '').trim();
                      }

                      var doInsert = !current || confirm('Huidige inhoud wordt overschreven met de template "' + tpl.title + '". Doorgaan?');
                      if (!doInsert) {
                        e.target.value = '';
                        return;
                      }

                      // Vul title en subject indien leeg
                      var titelInput = document.querySelector('input[name="titel"]');
                      if (titelInput && !titelInput.value && tpl.subject) {
                        titelInput.value = tpl.subject;
                      }

                      // Vul de body
                      if (quill && typeof quill.root !== 'undefined') {
                        quill.root.innerHTML = tpl.body || '';
                        quill.update();
                      } else {
                        var ta2 = document.getElementById('body-editor');
                        if (ta2) ta2.value = tpl.body || '';
                      }

                      // Reset picker zodat dezelfde template opnieuw geselecteerd kan worden
                      e.target.value = '';
                    });
                  })();
                ` }} />
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

              {/* Public-share toggle: als aan, is /posts/:slug toegankelijk zonder login (voor WhatsApp-delen) */}
              <div class="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div class="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="public_share"
                    id="public_share"
                    value="1"
                    checked={post?.public_share === 1}
                    class="mt-0.5 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                  />
                  <div class="flex-1">
                    <label for="public_share" class="text-sm font-semibold text-green-900 cursor-pointer">
                      🔓 Maak deze post publiek deelbaar via WhatsApp
                    </label>
                    <p class="text-xs text-green-800 mt-1">
                      <strong>Aan:</strong> de share-link <code class="bg-white px-1 rounded text-[11px]">/posts/{post?.slug || '<slug>'}</code> werkt
                      zonder login — handig om via WhatsApp breder te delen (familie, vrienden, andere koren).
                      <br />
                      <strong>Uit (standaard):</strong> de zichtbaarheid hierboven bepaalt wie het kan zien.
                      Niet-leden krijgen een loginscherm.
                      <br />
                      <em class="text-amber-700">⚠️ Let op: zet enkel aan als de inhoud echt voor het bredere publiek bestemd is.</em>
                    </p>
                  </div>
                </div>
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
          {/* News-artikel editor heeft grotere ademruimte nodig dan de globale instelling */}
          <style dangerouslySetInnerHTML={{ __html: `
            #quill-editor .ql-editor {
              min-height: 320px;
              max-height: 600px;
              overflow-y: auto;
            }
          ` }} />
          
          <script dangerouslySetInnerHTML={{
            __html: `
              // Wait for Quill to load
              document.addEventListener('DOMContentLoaded', function() {
                // Hide original textarea
                const textarea = document.getElementById('body-editor');
                if (!textarea) return;
                
                textarea.style.display = 'none';
                
                // Create editor container. Height wordt bepaald door .ql-editor
                // (globaal in Layout: min 160px, max 320px voor admin-formulieren).
                // Voor het volledig artikel hebben we meer ademruimte nodig:
                const editorContainer = document.createElement('div');
                editorContainer.id = 'quill-editor';
                editorContainer.style.backgroundColor = 'white';
                textarea.parentNode.insertBefore(editorContainer, textarea);
                
                // Initialize Quill met custom link-handler (#120: interne pagina-picker)
                const quill = new Quill('#quill-editor', {
                  theme: 'snow',
                  modules: {
                    toolbar: {
                      container: [
                        [{ 'header': [1, 2, 3, 4, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'color': [] }, { 'background': [] }],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        [{ 'indent': '-1'}, { 'indent': '+1' }],
                        [{ 'align': [] }],
                        ['blockquote', 'code-block'],
                        ['link', 'image', 'video'],
                        ['clean']
                      ],
                      handlers: {
                        link: function(value) {
                          // Open onze custom modal — value=true bij toevoegen, false bij verwijderen
                          if (value) {
                            const range = this.quill.getSelection(true);
                            const selectedText = range && range.length > 0
                              ? this.quill.getText(range.index, range.length)
                              : '';
                            window.__openLinkPicker(this.quill, range, selectedText);
                          } else {
                            this.quill.format('link', false);
                          }
                        }
                      }
                    }
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

                // Expose voor template-picker (#151)
                window.bodyQuill = quill;
                
                // Sync on form submit + #118 fix: client-side validation voor body
                const form = textarea.closest('form');
                if (form) {
                  form.addEventListener('submit', function(e) {
                    textarea.value = quill.root.innerHTML;
                    // Quill toont een lege editor als '<p><br></p>' — strip die check
                    const plain = (quill.getText() || '').trim();
                    if (!plain) {
                      e.preventDefault();
                      alert('De inhoud (Body) mag niet leeg zijn. Schrijf eerst je artikel.');
                      try { quill.focus(); } catch(_) {}
                      return false;
                    }
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

          {/* #120: Link picker modal — herbruikbare component (interne pagina-picker voor Quill) */}
          <QuillLinkPicker />

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
          if (!deleteUrl) { closeDeleteModal(); return; }
          this.disabled = true;
          this.innerText = 'Verwijderen...';
          try {
            const res = await fetch(deleteUrl, {
              method: 'POST',
              headers: { 'Accept': 'application/json' }
            });
            let data = null;
            try { data = await res.json(); } catch (_) {}
            if (res.ok && (!data || data.ok !== false)) {
              // De huidige edit-pagina toont een record dat niet meer bestaat.
              // Redirect naar de content-lijst (server kan een specifiek tab teruggeven).
              const target = (data && data.redirect) || '/admin/content';
              window.location.href = target;
              return;
            }
            const msg = (data && data.error) || ('Verwijderen mislukt (HTTP ' + res.status + ')');
            alert(msg);
            this.disabled = false;
            this.innerText = 'Verwijderen';
          } catch(e) {
            // Fallback bij netwerkfout: navigeer direct naar de GET-versie
            window.location.href = deleteUrl;
          }
        });
      ` }} />
    </Layout>
  )
})

// =====================================================
// INTERNAL PAGES PICKER API (#120)
// Levert een lijst van interne pagina's voor de Quill link-knop
// zodat redacteurs zonder URL te typen naar een eigen pagina kunnen linken.
// =====================================================
app.get('/api/admin/internal-pages', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`

  // 1) Vaste pagina's (hardcoded)
  const fixedPages: Array<{ titel: string; url: string; type: string; subtitel?: string }> = [
    { titel: 'Homepage',          url: '/',                  type: 'pagina', subtitel: 'Startpagina' },
    { titel: 'Over het koor',     url: '/koor',              type: 'pagina', subtitel: 'Voorstelling van Animato' },
    { titel: 'Word lid',          url: '/word-lid',          type: 'pagina', subtitel: 'Aanmeldformulier nieuwe leden' },
    { titel: 'Contact',           url: '/contact',           type: 'pagina', subtitel: 'Contactformulier' },
    { titel: 'Nieuws (overzicht)', url: '/nieuws',           type: 'pagina', subtitel: 'Alle nieuwsberichten' },
    { titel: 'Concerten (overzicht)', url: '/concerten',     type: 'pagina', subtitel: 'Alle concerten' },
    { titel: 'Agenda (overzicht)', url: '/agenda',           type: 'pagina', subtitel: 'Volledige agenda' },
    { titel: 'Fotoboek',          url: '/fotoboek',          type: 'pagina', subtitel: 'Foto-albums' },
    { titel: 'Privacyverklaring', url: '/privacyverklaring', type: 'pagina' },
    { titel: 'Cookieverklaring',  url: '/cookies',           type: 'pagina' },
  ]
  const fixedFiltered = q
    ? fixedPages.filter(p =>
        p.titel.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        (p.subtitel || '').toLowerCase().includes(q))
    : fixedPages

  try {
    // 2) Gepubliceerde nieuws-posts (route: /nieuws/:slug)
    const newsRows = q
      ? await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug, type, published_at FROM posts
           WHERE type = 'nieuws' AND is_published = 1 AND zichtbaarheid = 'publiek'
             AND (LOWER(titel) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\')
           ORDER BY published_at DESC LIMIT 50`,
          [like, like])
      : await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug, type, published_at FROM posts
           WHERE type = 'nieuws' AND is_published = 1 AND zichtbaarheid = 'publiek'
           ORDER BY published_at DESC LIMIT 30`)

    // 3) Concerten / events met slug (route: /concerten/:slug en /agenda/:slug)
    const eventRows = q
      ? await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug, type, start_at FROM events
           WHERE slug IS NOT NULL AND slug != ''
             AND (LOWER(titel) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\')
           ORDER BY start_at DESC LIMIT 50`,
          [like, like])
      : await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug, type, start_at FROM events
           WHERE slug IS NOT NULL AND slug != ''
           ORDER BY start_at DESC LIMIT 30`)

    // 4) Albums (route: /fotoboek/:slug)
    const albumRows = q
      ? await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug FROM albums
           WHERE is_publiek = 1 AND slug IS NOT NULL AND slug != ''
             AND (LOWER(titel) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\')
           ORDER BY created_at DESC LIMIT 30`,
          [like, like]).catch(() => [])
      : await queryAll<any>(c.env.DB,
          `SELECT id, titel, slug FROM albums
           WHERE is_publiek = 1 AND slug IS NOT NULL AND slug != ''
           ORDER BY created_at DESC LIMIT 20`).catch(() => [])

    const items = [
      ...fixedFiltered.map(p => ({
        category: 'Vaste pagina',
        titel: p.titel,
        url: p.url,
        subtitel: p.subtitel || ''
      })),
      ...newsRows.map((r: any) => ({
        category: 'Nieuws',
        titel: r.titel,
        url: '/nieuws/' + r.slug,
        subtitel: r.published_at ? new Date(r.published_at).toLocaleDateString('nl-BE') : ''
      })),
      ...eventRows.map((r: any) => ({
        category: r.type === 'concert' ? 'Concert' : (r.type === 'repetitie' ? 'Repetitie' : 'Activiteit'),
        titel: r.titel,
        url: (r.type === 'concert' ? '/concerten/' : '/agenda/') + r.slug,
        subtitel: r.start_at ? new Date(r.start_at).toLocaleDateString('nl-BE') : ''
      })),
      ...albumRows.map((r: any) => ({
        category: 'Fotoalbum',
        titel: r.titel,
        url: '/fotoboek/' + r.slug,
        subtitel: ''
      })),
    ]

    return c.json({ items, total: items.length })
  } catch (e: any) {
    console.error('internal-pages error:', e)
    // Bij DB-fout: minimaal de vaste pagina's teruggeven zodat de picker bruikbaar blijft
    return c.json({
      items: fixedFiltered.map(p => ({ category: 'Vaste pagina', titel: p.titel, url: p.url, subtitel: p.subtitel || '' })),
      total: fixedFiltered.length,
      partial: true,
      error: e.message
    })
  }
})

// =====================================================
// POST SAVE API (Create/Update)
// =====================================================

app.post('/api/admin/content/save', async (c) => {
  const user = c.get('user') as SessionUser
  let body: any = {}

  try {
    body = await c.req.parseBody()
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
      public_share,
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
    const publicShareValue = public_share === '1' ? 1 : 0

    // Determine published_at: use custom date if provided, else auto-set on publish
    const resolvedPublishedAt = customPublishedAt 
      ? String(customPublishedAt).replace('T', ' ') + ':00'
      : (publishedValue === 1 ? now : null)

    if (is_new === '1') {
      // Create new post
      const result = await c.env.DB.prepare(
        `INSERT INTO posts (
          type, categorie, titel, slug, excerpt, body, zichtbaarheid, 
          is_published, is_pinned, public_share, auteur_id, created_at, published_at, cover_image, verloopt_op
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        publicShareValue,
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

      // #116 — Notificeer alle actieve leden bij gepubliceerd nieuws
      if (type === 'posts' && publishedValue === 1 && (zichtbaarheid === 'leden' || zichtbaarheid === 'publiek')) {
        try {
          await notifyAllActiveMembers(
            c.env.DB,
            'nieuws',
            `Nieuw bericht: ${titel}`,
            (excerpt && String(excerpt).slice(0, 140)) || undefined,
            `/nieuws/${finalSlug}`
          )
        } catch (e) { console.error('notify on post_create failed:', e) }
      }

      return c.redirect(`/admin/content/${result.meta.last_row_id}?success=created&type=posts`)
    } else {
      // Update existing post
      await c.env.DB.prepare(
        `UPDATE posts 
         SET type = ?, categorie = ?, titel = ?, slug = ?, excerpt = ?, body = ?, 
             zichtbaarheid = ?, is_published = ?, is_pinned = ?, public_share = ?,
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
        publicShareValue,
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
  } catch (error: any) {
    console.error('Post save error:', error)
    const isNew = body?.is_new === '1'
    const postId = body?.post_id
    const redirectUrl = isNew || !postId ? '/admin/content/nieuw' : `/admin/content/${postId}`
    const errMsg = encodeURIComponent(error?.message || 'save_failed').substring(0, 100)
    return c.redirect(`${redirectUrl}?error=save_failed&msg=${errMsg}`)
  }
})

// =====================================================
// CONTENT DELETE API
// =====================================================

// =====================================================
// TOGGLE WHATSAPP-SHARED FLAG (#150)
// =====================================================
app.post('/api/admin/content/:id/toggle-whatsapp', async (c) => {
  const user = c.get('user') as SessionUser
  if (user.role !== 'admin') {
    return c.json({ error: 'Geen toegang' }, 403)
  }
  const contentId = c.req.param('id')

  try {
    const post = await queryOne<any>(
      c.env.DB,
      `SELECT id, shared_via_whatsapp FROM posts WHERE id = ?`,
      [contentId]
    )
    if (!post) return c.json({ error: 'Post niet gevonden' }, 404)

    const newValue = post.shared_via_whatsapp ? 0 : 1
    const now = newValue ? new Date().toISOString() : null
    await c.env.DB.prepare(
      `UPDATE posts SET shared_via_whatsapp = ?, shared_via_whatsapp_at = ? WHERE id = ?`
    ).bind(newValue, now, contentId).run()

    return c.json({
      success: true,
      shared_via_whatsapp: newValue === 1,
      shared_via_whatsapp_at: now
    })
  } catch (err: any) {
    console.error('toggle-whatsapp error:', err)
    return c.json({ error: err.message || 'Fout bij bijwerken' }, 500)
  }
})

// Shared handler — content (post/event) delete.
// Accepts both GET (legacy direct-link) and POST (fetch from edit-page modal).
// Returns JSON for fetch requests, redirect for browser navigation.
const handleContentDelete = async (c: any) => {
  const user = c.get('user') as SessionUser
  const contentId = c.req.param('id')
  const contentType = c.req.query('type') || 'posts'

  // Did the client send via fetch (expects JSON) or via direct link/form (expects redirect)?
  const accept = c.req.header('accept') || ''
  const wantsJson = accept.includes('application/json') || c.req.method === 'POST'

  try {
    let deletedTitle: string | null = null

    if (contentType === 'posts') {
      // Capture title for audit + nicer UX
      const postRow: any = await c.env.DB.prepare(
        `SELECT titel, cover_image FROM posts WHERE id = ?`
      ).bind(contentId).first()
      if (!postRow) {
        const msg = 'Bericht niet gevonden (mogelijk al verwijderd).'
        if (wantsJson) return c.json({ ok: false, error: msg }, 404)
        return c.redirect(`/admin/content?tab=${contentType}&error=not_found`)
      }
      deletedTitle = postRow.titel || null

      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'post_delete', 'post', ?, ?)`
      ).bind(user.id, contentId, JSON.stringify({ deleted_by: 'admin', titel: deletedTitle })).run()

      // Cleanup related rows (best-effort; tables may not exist on older deploys)
      try { await c.env.DB.prepare('DELETE FROM post_replies WHERE post_id = ?').bind(contentId).run() } catch (e) {}
      try { await c.env.DB.prepare('DELETE FROM post_comments WHERE post_id = ?').bind(contentId).run() } catch (e) {}
      try { await c.env.DB.prepare('DELETE FROM post_reactions WHERE post_id = ?').bind(contentId).run() } catch (e) {}

      // Optional: delete R2 cover if it's an R2-served URL
      try {
        if (postRow.cover_image && typeof postRow.cover_image === 'string') {
          const m = postRow.cover_image.match(/^\/r2\/(.+)$/)
          if (m && c.env.R2) await c.env.R2.delete(m[1])
        }
      } catch (e) { console.warn('R2 cover cleanup failed:', e) }

      // Delete the post itself
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(contentId).run()
    } else if (contentType === 'events') {
      const evtRow: any = await c.env.DB.prepare(`SELECT titel FROM events WHERE id = ?`).bind(contentId).first()
      if (!evtRow) {
        const msg = 'Event niet gevonden (mogelijk al verwijderd).'
        if (wantsJson) return c.json({ ok: false, error: msg }, 404)
        return c.redirect(`/admin/content?tab=${contentType}&error=not_found`)
      }
      deletedTitle = evtRow.titel || null

      // Audit log
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'event_delete', 'event', ?, ?)`
      ).bind(user.id, contentId, JSON.stringify({ deleted_by: 'admin', titel: deletedTitle })).run()

      // Cleanup linked tables
      try { await c.env.DB.prepare('DELETE FROM concerts WHERE event_id = ?').bind(contentId).run() } catch (e) {}
      try { await c.env.DB.prepare('DELETE FROM event_rsvps WHERE event_id = ?').bind(contentId).run() } catch (e) {}

      await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(contentId).run()
    }

    const redirectUrl = `/admin/content?tab=${contentType}&success=deleted`
    if (wantsJson) return c.json({ ok: true, id: contentId, type: contentType, redirect: redirectUrl })
    return c.redirect(redirectUrl)
  } catch (error: any) {
    console.error('Content delete error:', error)
    const msg = error?.message || 'Verwijderen mislukt'
    if (wantsJson) return c.json({ ok: false, error: msg }, 500)
    return c.redirect(`/admin/content?tab=${contentType}&error=delete_failed`)
  }
}

app.get('/api/admin/content/:id/delete', handleContentDelete)
app.post('/api/admin/content/:id/delete', handleContentDelete)

// =====================================================
// AUDIT LOGS
// =====================================================

app.get('/admin/audit', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Filters
  const actieFilter = (c.req.query('actie') || '').trim()
  const userIdFilter = (c.req.query('user_id') || '').trim()
  const sinceFilter = (c.req.query('since') || '').trim() // 24h, 7d, 30d, all
  const searchFilter = (c.req.query('q') || '').trim()
  const limitFilter = Math.min(parseInt(c.req.query('limit') || '200'), 1000)

  // Build WHERE clause dynamisch
  const where: string[] = []
  const params: any[] = []
  if (actieFilter) { where.push('a.actie = ?'); params.push(actieFilter) }
  if (userIdFilter && /^\d+$/.test(userIdFilter)) { where.push('a.user_id = ?'); params.push(parseInt(userIdFilter)) }
  if (sinceFilter === '24h') where.push("a.created_at >= datetime('now', '-1 day')")
  else if (sinceFilter === '7d') where.push("a.created_at >= datetime('now', '-7 days')")
  else if (sinceFilter === '30d') where.push("a.created_at >= datetime('now', '-30 days')")
  if (searchFilter) {
    where.push('(u.email LIKE ? OR p.voornaam LIKE ? OR p.achternaam LIKE ? OR a.meta LIKE ?)')
    const q = `%${searchFilter}%`
    params.push(q, q, q, q)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const logs = await queryAll<any>(
    c.env.DB,
    `SELECT a.*, u.email, p.voornaam, p.achternaam
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     ${whereSql}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [...params, limitFilter]
  )

  // Lijst van unieke acties voor het dropdown
  const distinctActies = await queryAll<any>(
    c.env.DB,
    `SELECT actie, COUNT(*) as cnt FROM audit_logs GROUP BY actie ORDER BY cnt DESC`
  )

  // Voor login-events: zoek de bijhorende user_sessions op zodat we duur +
  // inactiviteit kunnen tonen. We matchen op (user_id, login_at ≈ created_at).
  // In SQLite doen we dit via één query met vensterbenadering (±5s tolerantie).
  const sessions = await queryAll<any>(
    c.env.DB,
    `SELECT user_id, login_at, logout_at, duration_seconds, updated_at, is_active
     FROM user_sessions
     ORDER BY login_at DESC
     LIMIT 500`
  )

  // Helper: koppel session aan audit-login event
  function findSession(log: any): any | null {
    if (log.actie !== 'user_login' || !log.user_id) return null
    const logTs = new Date(log.created_at + 'Z').getTime()
    // Zoek de session die binnen 10s van het login-event begint
    for (const s of sessions) {
      if (s.user_id !== log.user_id) continue
      const sessTs = new Date(s.login_at + 'Z').getTime()
      if (Math.abs(sessTs - logTs) < 10_000) return s
    }
    return null
  }

  // Format helpers
  function fmtDuration(seconds: number | null | undefined): string {
    if (!seconds || seconds < 0) return '—'
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
    const h = Math.floor(m / 60)
    const mm = m % 60
    return mm ? `${h}u ${mm}m` : `${h}u`
  }

  function fmtRelative(isoUtc: string | null | undefined): string {
    if (!isoUtc) return '—'
    const then = new Date(isoUtc + 'Z').getTime()
    const diffSec = Math.floor((Date.now() - then) / 1000)
    if (diffSec < 60) return `${diffSec}s geleden`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m geleden`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}u geleden`
    return `${Math.floor(diffSec / 86400)}d geleden`
  }

  // Pretty-print JSON metadata with sensible fallback
  function prettyMeta(raw: string | null | undefined): { short: string; pretty: string; isJson: boolean } {
    if (!raw) return { short: '—', pretty: '', isJson: false }
    try {
      const obj = JSON.parse(raw)
      const pretty = JSON.stringify(obj, null, 2)
      // Korte samenvatting: eerste 2-3 veldnamen
      const keys = Object.keys(obj)
      const preview = keys.length
        ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? `, +${keys.length - 3}` : '')
        : '(leeg)'
      return { short: preview, pretty, isJson: true }
    } catch {
      // Geen geldige JSON — toon eerste 60 tekens
      const short = raw.length > 60 ? raw.substring(0, 60) + '…' : raw
      return { short, pretty: raw, isJson: false }
    }
  }

  const actieKleur: Record<string, string> = {
    user_login:    'bg-green-100 text-green-800',
    user_logout:   'bg-gray-100 text-gray-700',
    user_update:   'bg-blue-100 text-blue-800',
    profile_update:'bg-indigo-100 text-indigo-800',
    user_delete:   'bg-red-100 text-red-800',
    user_create:   'bg-emerald-100 text-emerald-800',
  }

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
                    Bekijk systeem activiteit, logins en sessieduur
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
            {/* Legenda */}
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-900">
              <i class="fas fa-info-circle mr-1"></i>
              <strong>Duur</strong> = tijd tussen login en logout (of nu, voor actieve sessies).
              <strong class="ml-2">Inactief sinds</strong> = tijd sinds laatste pagina-bezoek.
              Klik op een rij om JSON-details uit te klappen.
            </div>

            {/* Filters */}
            <form method="GET" action="/admin/audit" class="bg-white rounded-lg shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Zoeken</label>
                <input
                  type="text"
                  name="q"
                  value={searchFilter}
                  placeholder="Naam, email, meta..."
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-animato-primary"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Actie</label>
                <select name="actie" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="" selected={!actieFilter}>Alle acties</option>
                  {distinctActies.map((a: any) => (
                    <option value={a.actie} selected={actieFilter === a.actie}>
                      {a.actie} ({a.cnt})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">User ID</label>
                <input
                  type="number"
                  name="user_id"
                  value={userIdFilter}
                  placeholder="bv. 79"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Periode</label>
                <select name="since" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="" selected={!sinceFilter}>Alles</option>
                  <option value="24h" selected={sinceFilter === '24h'}>Laatste 24u</option>
                  <option value="7d" selected={sinceFilter === '7d'}>Laatste 7 dagen</option>
                  <option value="30d" selected={sinceFilter === '30d'}>Laatste 30 dagen</option>
                </select>
              </div>
              <div class="flex gap-2">
                <button type="submit" class="flex-1 px-4 py-2 bg-animato-primary text-white rounded-lg text-sm font-medium hover:bg-animato-secondary">
                  <i class="fas fa-filter mr-1"></i> Filter
                </button>
                <a href="/admin/audit" class="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm" title="Reset filters">
                  <i class="fas fa-redo"></i>
                </a>
              </div>
            </form>

            {/* Resultaat-teller */}
            <div class="text-xs text-gray-500 mb-2">
              <i class="fas fa-database mr-1"></i>
              {logs.length} resultaten getoond {logs.length === limitFilter && <span class="text-amber-600">(limit bereikt — verfijn filters)</span>}
            </div>

            <div class="bg-white rounded-lg shadow-md overflow-hidden">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Datum</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gebruiker</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actie</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duur</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inactief sinds</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    {logs.map((log: any) => {
                      const sess = findSession(log)
                      // Duur berekenen
                      let duurStr = '—'
                      let inactiefStr = '—'
                      if (sess) {
                        if (sess.duration_seconds) {
                          duurStr = fmtDuration(sess.duration_seconds)
                        } else if (sess.is_active) {
                          // Actieve sessie: nu - login_at
                          const liveSec = Math.floor(
                            (Date.now() - new Date(sess.login_at + 'Z').getTime()) / 1000
                          )
                          duurStr = fmtDuration(liveSec) + ' (nog actief)'
                        }
                        // Inactief = nu - updated_at (alleen nuttig voor actieve sessies)
                        if (sess.is_active && sess.updated_at) {
                          inactiefStr = fmtRelative(sess.updated_at)
                        } else if (sess.logout_at) {
                          inactiefStr = 'Uitgelogd'
                        }
                      }

                      const meta = prettyMeta(log.meta)
                      const rowId = `log-${log.id}`

                      return (
                        <>
                          <tr
                            class="hover:bg-gray-50 cursor-pointer"
                            onclick={`(function(){var el=document.getElementById('${rowId}-details'); if(el) el.classList.toggle('hidden');})()`}
                          >
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                              {new Date(log.created_at + 'Z').toLocaleString('nl-BE', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </td>
                            <td
                              class="px-4 py-3 whitespace-nowrap text-sm"
                              onclick="event.stopPropagation()"
                            >
                              {log.user_id ? (
                                <a
                                  href={`/admin/leden/${log.user_id}`}
                                  class="block hover:bg-blue-50 -mx-2 -my-1 px-2 py-1 rounded transition"
                                  title="Open fiche van dit lid"
                                >
                                  <div class="font-medium text-animato-primary hover:underline">
                                    {log.voornaam} {log.achternaam}
                                  </div>
                                  <div class="text-xs text-gray-400">{log.email}</div>
                                </a>
                              ) : (
                                <div>
                                  <div class="font-medium text-gray-500 italic">Systeem / verwijderd</div>
                                  <div class="text-xs text-gray-400">{log.email || '-'}</div>
                                </div>
                              )}
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap">
                              <span class={`px-2 py-1 rounded-full text-xs font-semibold ${actieKleur[log.actie] || 'bg-gray-100 text-gray-800'}`}>
                                {log.actie}
                              </span>
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                              {log.entity_type} #{log.entity_id}
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-700">
                              {duurStr}
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-700">
                              {inactiefStr}
                            </td>
                            <td class="px-4 py-3 text-xs text-gray-500">
                              <div class="flex items-center gap-2">
                                <i class="fas fa-chevron-down text-gray-400 text-[10px]"></i>
                                <span class="font-mono text-xs truncate max-w-[200px] inline-block align-middle">
                                  {meta.short}
                                </span>
                              </div>
                            </td>
                          </tr>
                          <tr id={`${rowId}-details`} class="hidden bg-gray-50">
                            <td colspan={7} class="px-6 py-3">
                              {meta.isJson ? (
                                <pre class="bg-white border border-gray-200 rounded p-3 text-xs font-mono text-gray-800 overflow-x-auto max-h-64">
                                  {meta.pretty}
                                </pre>
                              ) : (
                                <div class="text-xs font-mono text-gray-600 whitespace-pre-wrap">
                                  {meta.pretty || '(geen details)'}
                                </div>
                              )}
                              {log.ip_adres && (
                                <div class="mt-2 text-xs text-gray-500">
                                  <strong>IP:</strong> <span class="font-mono">{log.ip_adres}</span>
                                  {log.user_agent && (
                                    <>
                                      &nbsp; <strong>Browser:</strong>
                                      <span class="font-mono ml-1">{log.user_agent.substring(0, 100)}{log.user_agent.length > 100 ? '…' : ''}</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        </>
                      )
                    })}
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

  // Lid-token: 8 uur geldig — lang genoeg voor een werkdag impersonate-sessie
  // zonder de admin halverwege uit te loggen
  const token = await generateToken(sessionUser, c.env.JWT_SECRET, '8h')

  setCookie(c, 'auth_token', token, {
    maxAge: 8 * 60 * 60, // 8 hours
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/'
  })

  // Admin's originele sessie bewaren — 7 dagen geldig zodat we ALTIJD
  // terug kunnen, ook als de admin de impersonate-tab een tijd open laat
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
    maxAge: 7 * 24 * 60 * 60, // 7 days
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/'
  })

  return c.redirect('/leden')
})

// Note: /leden/stop-impersonate is in leden.tsx (uses /leden/ path to bypass admin role check)

// =====================================================
// /admin/leeftijden — Live leeftijdsoverzicht
// =====================================================
// Toont gemiddelde leeftijd per stemgroep en geslacht, leeftijdscategorieën,
// en lijst van leden zonder geboortedatum (om aan te porren).
// Geslacht is afgeleid uit stemgroep (S/A=vrouw, T/B=man).
//
// Schrijft ook lazy maandelijkse snapshots in member_stats_snapshots
// zodat we evolutie over de tijd kunnen plotten (geen aparte cron nodig).
app.get('/admin/leeftijden', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Algemene metrics + ontbrekende geboortedata
  const overall = await queryOne<any>(c.env.DB, `
    SELECT 
      COUNT(*) as totaal,
      SUM(CASE WHEN p.geboortedatum IS NOT NULL AND p.geboortedatum != '' THEN 1 ELSE 0 END) as met_dob
    FROM users u 
    JOIN profiles p ON p.user_id = u.id 
    WHERE u.status = 'actief' AND u.is_test_account = 0
  `)

  const avgRow = await queryOne<any>(c.env.DB, `
    SELECT 
      ROUND(AVG((julianday('now') - julianday(p.geboortedatum)) / 365.25), 1) as gem,
      MIN(CAST((julianday('now') - julianday(p.geboortedatum)) / 365.25 AS INTEGER)) as jongste,
      MAX(CAST((julianday('now') - julianday(p.geboortedatum)) / 365.25 AS INTEGER)) as oudste,
      COUNT(*) as n
    FROM users u 
    JOIN profiles p ON p.user_id = u.id 
    WHERE u.status = 'actief' AND u.is_test_account = 0
      AND p.geboortedatum IS NOT NULL AND p.geboortedatum != ''
  `)

  // Per stemgroep
  const perStem = await queryAll<any>(c.env.DB, `
    SELECT 
      COALESCE(u.stemgroep, 'X') as stemgroep,
      COUNT(*) as aantal,
      ROUND(AVG((julianday('now') - julianday(p.geboortedatum)) / 365.25), 1) as gem,
      MIN(CAST((julianday('now') - julianday(p.geboortedatum)) / 365.25 AS INTEGER)) as jongste,
      MAX(CAST((julianday('now') - julianday(p.geboortedatum)) / 365.25 AS INTEGER)) as oudste
    FROM users u 
    JOIN profiles p ON p.user_id = u.id 
    WHERE u.status = 'actief' AND u.is_test_account = 0
      AND p.geboortedatum IS NOT NULL AND p.geboortedatum != ''
    GROUP BY u.stemgroep
    ORDER BY 
      CASE COALESCE(u.stemgroep, 'X')
        WHEN 'S' THEN 1 WHEN 'A' THEN 2
        WHEN 'T' THEN 3 WHEN 'B' THEN 4
        ELSE 5 END
  `)

  // Per geslacht (afgeleid)
  const perGender = await queryAll<any>(c.env.DB, `
    WITH base AS (
      SELECT
        CASE 
          WHEN u.stemgroep IN ('S','A') THEN 'F'
          WHEN u.stemgroep IN ('T','B') THEN 'M'
          ELSE 'X'
        END as g,
        (julianday('now') - julianday(p.geboortedatum)) / 365.25 as leeftijd
      FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief' AND u.is_test_account = 0
        AND p.geboortedatum IS NOT NULL AND p.geboortedatum != ''
    )
    SELECT g, COUNT(*) as aantal, ROUND(AVG(leeftijd),1) as gem,
           MIN(CAST(leeftijd AS INT)) as jongste, MAX(CAST(leeftijd AS INT)) as oudste
    FROM base GROUP BY g
  `)
  const genderMap = new Map(perGender.map((r: any) => [r.g, r]))
  const femaleRow = genderMap.get('F') || { aantal: 0, gem: 0, jongste: 0, oudste: 0 }
  const maleRow   = genderMap.get('M') || { aantal: 0, gem: 0, jongste: 0, oudste: 0 }
  const unknownRow= genderMap.get('X') || { aantal: 0, gem: 0, jongste: 0, oudste: 0 }

  // Histogram (leeftijdscategorieën)
  const hist = await queryOne<any>(c.env.DB, `
    WITH base AS (
      SELECT (julianday('now') - julianday(p.geboortedatum)) / 365.25 as leeftijd
      FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief' AND u.is_test_account = 0
        AND p.geboortedatum IS NOT NULL AND p.geboortedatum != ''
    )
    SELECT
      SUM(CASE WHEN leeftijd < 30 THEN 1 ELSE 0 END) as b1,
      SUM(CASE WHEN leeftijd >= 30 AND leeftijd < 40 THEN 1 ELSE 0 END) as b2,
      SUM(CASE WHEN leeftijd >= 40 AND leeftijd < 50 THEN 1 ELSE 0 END) as b3,
      SUM(CASE WHEN leeftijd >= 50 AND leeftijd < 60 THEN 1 ELSE 0 END) as b4,
      SUM(CASE WHEN leeftijd >= 60 AND leeftijd < 70 THEN 1 ELSE 0 END) as b5,
      SUM(CASE WHEN leeftijd >= 70 THEN 1 ELSE 0 END) as b6
    FROM base
  `)
  const buckets = [
    { label: 'Onder 30',  n: hist?.b1 || 0 },
    { label: '30 – 39',   n: hist?.b2 || 0 },
    { label: '40 – 49',   n: hist?.b3 || 0 },
    { label: '50 – 59',   n: hist?.b4 || 0 },
    { label: '60 – 69',   n: hist?.b5 || 0 },
    { label: '70 +',      n: hist?.b6 || 0 },
  ]
  const maxBucket = Math.max(1, ...buckets.map(b => b.n))
  const totaalMetDob = avgRow?.n || 0

  // Leden zonder geboortedatum (om aan te porren)
  const zonderDob = await queryAll<any>(c.env.DB, `
    SELECT u.id, u.email, u.stemgroep, p.voornaam, p.achternaam
    FROM users u JOIN profiles p ON p.user_id = u.id
    WHERE u.status = 'actief' AND u.is_test_account = 0
      AND (p.geboortedatum IS NULL OR p.geboortedatum = '')
    ORDER BY p.voornaam, p.achternaam
  `)

  const stemLabel = (s: string) => {
    const m: any = { S: 'Sopraan', A: 'Alt', T: 'Tenor', B: 'Bas', X: 'Onbekend' }
    return m[s] || s
  }
  const stemBadge = (s: string) => {
    const m: any = {
      S: 'bg-pink-100 text-pink-700',
      A: 'bg-pink-200 text-pink-800',
      T: 'bg-blue-100 text-blue-700',
      B: 'bg-indigo-100 text-indigo-700',
      X: 'bg-gray-200 text-gray-600'
    }
    return m[s] || 'bg-gray-100 text-gray-700'
  }

  // =============================================================
  // LAZY SNAPSHOT — schrijf een nieuwe snapshot als de laatste
  // ouder is dan 25 dagen (of nog niet bestaat). Stille fout-afhandeling:
  // als de snapshot mislukt, blijft de pagina gewoon werken.
  // =============================================================
  try {
    const lastSnap = await queryOne<any>(c.env.DB, `
      SELECT snapshot_date FROM member_stats_snapshots
      ORDER BY snapshot_date DESC LIMIT 1
    `)
    const daysSince = lastSnap
      ? Math.floor((Date.now() - new Date(lastSnap.snapshot_date).getTime()) / 86400000)
      : 9999

    if (daysSince >= 25) {
      const today = new Date().toISOString().split('T')[0]
      // Bouw details JSON
      const stemMap: any = {}
      perStem.forEach((r: any) => {
        stemMap[r.stemgroep] = { n: r.aantal, avg: r.gem, min: r.jongste, max: r.oudste }
      })
      const details = JSON.stringify({
        stemgroepen: stemMap,
        buckets: {
          u30: hist?.b1 || 0, d30: hist?.b2 || 0, d40: hist?.b3 || 0,
          d50: hist?.b4 || 0, d60: hist?.b5 || 0, d70p: hist?.b6 || 0
        }
      })
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO member_stats_snapshots
          (snapshot_date, total_active, with_dob, avg_age, min_age, max_age,
           female_count, male_count, female_avg, male_avg, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        today,
        overall?.totaal || 0,
        avgRow?.n || 0,
        avgRow?.gem || null,
        avgRow?.jongste || null,
        avgRow?.oudste || null,
        femaleRow.aantal,
        maleRow.aantal,
        femaleRow.gem || null,
        maleRow.gem || null,
        details
      ).run()
    }
  } catch (e) {
    console.warn('Snapshot write failed (non-fatal):', e)
  }

  // Trendgegevens — laatste 24 snapshots (≈ 2 jaar)
  const trends = await queryAll<any>(c.env.DB, `
    SELECT snapshot_date, total_active, with_dob, avg_age, female_count, male_count, female_avg, male_avg
    FROM member_stats_snapshots
    ORDER BY snapshot_date ASC
    LIMIT 24
  `)
  const hasTrend = trends.length >= 2

  return c.html(
    <Layout title="Leeftijdsoverzicht" user={user}
      breadcrumbs={[{label: 'Admin', href: '/admin'}, {label: 'Leeftijdsoverzicht', href: '/admin/leeftijden'}]}>
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-birthday-cake text-pink-500 mr-2"></i>
              Leeftijdsoverzicht
            </h1>
            <p class="text-sm text-gray-500 mt-1">
              Live cijfers — automatisch bijgewerkt op basis van de huidige profielgegevens.
            </p>
          </div>
          <a href="/admin" class="text-sm text-gray-600 hover:text-animato-primary">
            <i class="fas fa-arrow-left mr-1"></i> Terug naar admin
          </a>
        </div>

        {/* Hero */}
        <div class="bg-gradient-to-br from-purple-600 to-pink-500 text-white rounded-2xl shadow-lg p-8 mb-8">
          <div class="text-sm uppercase tracking-widest opacity-80">Gemiddelde leeftijd</div>
          <div class="text-7xl font-extrabold leading-none my-2">
            {avgRow?.gem ?? '—'}
          </div>
          <div class="text-base opacity-90">
            jaar · gebaseerd op <strong>{avgRow?.n || 0}</strong> van de <strong>{overall?.totaal || 0}</strong> actieve leden
            ({Math.round(((avgRow?.n || 0) / Math.max(1, (overall?.totaal || 1))) * 100)}% dekking)
          </div>
        </div>

        {/* 3 cards */}
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">Jongste lid</div>
            <div class="text-3xl font-bold text-gray-900">{avgRow?.jongste ?? '—'}</div>
            <div class="text-xs text-gray-400 mt-1">jaar</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">Oudste lid</div>
            <div class="text-3xl font-bold text-gray-900">{avgRow?.oudste ?? '—'}</div>
            <div class="text-xs text-gray-400 mt-1">jaar</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">Spreiding</div>
            <div class="text-3xl font-bold text-gray-900">
              {avgRow?.oudste && avgRow?.jongste ? (avgRow.oudste - avgRow.jongste) : '—'}
            </div>
            <div class="text-xs text-gray-400 mt-1">jaar tussen jongste en oudste</div>
          </div>
        </div>

        {/* Per geslacht */}
        <h2 class="text-lg font-bold text-gray-900 mb-4">
          <i class="fas fa-venus-mars text-purple-500 mr-2"></i>
          Per geslacht <span class="text-xs font-normal text-gray-500">(afgeleid uit stemgroep)</span>
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div class="bg-gradient-to-br from-pink-500 to-rose-500 text-white rounded-xl p-6 relative overflow-hidden">
            <i class="fas fa-venus absolute right-5 top-4 text-5xl opacity-20"></i>
            <div class="text-xs uppercase tracking-widest opacity-85">Vrouwen (sopraan + alt)</div>
            <div class="text-4xl font-bold my-2">{femaleRow.aantal}</div>
            <div class="text-sm opacity-95">
              Gem. leeftijd <strong class="text-xl">{femaleRow.gem}</strong> jaar · bereik {femaleRow.jongste} – {femaleRow.oudste}
            </div>
          </div>
          <div class="bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-xl p-6 relative overflow-hidden">
            <i class="fas fa-mars absolute right-5 top-4 text-5xl opacity-20"></i>
            <div class="text-xs uppercase tracking-widest opacity-85">Mannen (tenor + bas)</div>
            <div class="text-4xl font-bold my-2">{maleRow.aantal}</div>
            <div class="text-sm opacity-95">
              Gem. leeftijd <strong class="text-xl">{maleRow.gem}</strong> jaar · bereik {maleRow.jongste} – {maleRow.oudste}
            </div>
          </div>
        </div>
        {unknownRow.aantal > 0 && (
          <div class="bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 mb-8 text-sm text-gray-600">
            <i class="fas fa-info-circle mr-1"></i>
            {unknownRow.aantal} lid (leden) zonder ingestelde stemgroep, gemiddelde {unknownRow.gem} jaar.
          </div>
        )}

        {/* Per stemgroep */}
        <h2 class="text-lg font-bold text-gray-900 mb-4">
          <i class="fas fa-music text-animato-primary mr-2"></i>
          Per stemgroep
        </h2>
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 uppercase text-xs tracking-wide">
              <tr>
                <th class="text-left px-4 py-3">Stemgroep</th>
                <th class="text-right px-4 py-3">Aantal</th>
                <th class="text-right px-4 py-3">Gem. leeftijd</th>
                <th class="text-right px-4 py-3">Jongste</th>
                <th class="text-right px-4 py-3">Oudste</th>
                <th class="text-right px-4 py-3">Spreiding</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {perStem.map((row: any) => (
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-3">
                    <span class={`inline-block px-3 py-1 rounded-full font-semibold ${stemBadge(row.stemgroep)}`}>
                      {stemLabel(row.stemgroep)}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">{row.aantal}</td>
                  <td class="px-4 py-3 text-right tabular-nums font-bold text-gray-900">{row.gem}</td>
                  <td class="px-4 py-3 text-right tabular-nums">{row.jongste}</td>
                  <td class="px-4 py-3 text-right tabular-nums">{row.oudste}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-500">{row.oudste - row.jongste} j</td>
                </tr>
              ))}
              <tr class="bg-gray-50 font-semibold">
                <td class="px-4 py-3">Totaal</td>
                <td class="px-4 py-3 text-right tabular-nums">{avgRow?.n || 0}</td>
                <td class="px-4 py-3 text-right tabular-nums">{avgRow?.gem ?? '—'}</td>
                <td class="px-4 py-3 text-right tabular-nums">{avgRow?.jongste ?? '—'}</td>
                <td class="px-4 py-3 text-right tabular-nums">{avgRow?.oudste ?? '—'}</td>
                <td class="px-4 py-3 text-right tabular-nums text-gray-500">
                  {avgRow?.oudste && avgRow?.jongste ? `${avgRow.oudste - avgRow.jongste} j` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Histogram */}
        <h2 class="text-lg font-bold text-gray-900 mb-4">
          <i class="fas fa-chart-bar text-amber-500 mr-2"></i>
          Verdeling per leeftijdscategorie
        </h2>
        <div class="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          {buckets.map(b => {
            const widthPct = Math.round((b.n / maxBucket) * 100)
            const pctOfTotal = totaalMetDob > 0 ? Math.round((b.n / totaalMetDob) * 1000) / 10 : 0
            return (
              <div class="grid grid-cols-[110px_1fr_60px] items-center gap-3 mb-2">
                <div class="text-sm font-medium text-gray-700">{b.label}</div>
                <div class="bg-gray-100 h-6 rounded-md overflow-hidden">
                  <div
                    class="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-md flex items-center justify-end pr-2 text-white text-xs font-semibold"
                    style={`width: ${widthPct}%`}
                  >
                    {b.n > 0 && b.n}
                  </div>
                </div>
                <div class="text-sm text-gray-500 text-right tabular-nums">{pctOfTotal}%</div>
              </div>
            )
          })}
        </div>

        {/* Trend grafiek — alleen tonen als we minstens 2 snapshots hebben */}
        {hasTrend && (
          <>
            <h2 class="text-lg font-bold text-gray-900 mb-4">
              <i class="fas fa-chart-line text-emerald-500 mr-2"></i>
              Evolutie over de tijd
              <span class="text-xs font-normal text-gray-500 ml-2">
                ({trends.length} maandelijkse snapshots — gem. leeftijd vs. ledental)
              </span>
            </h2>
            <div class="bg-white rounded-xl border border-gray-200 p-6 mb-8">
              <div class="relative" style="height: 280px;">
                <canvas id="trendChart"></canvas>
              </div>
              <details class="mt-4 text-xs text-gray-500">
                <summary class="cursor-pointer hover:text-gray-700">Bekijk ruwe data ({trends.length} snapshots)</summary>
                <table class="w-full mt-3 text-xs">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="text-left px-2 py-1">Datum</th>
                      <th class="text-right px-2 py-1">Leden</th>
                      <th class="text-right px-2 py-1">Met geboortedat.</th>
                      <th class="text-right px-2 py-1">Gem. leeftijd</th>
                      <th class="text-right px-2 py-1">♀ aantal</th>
                      <th class="text-right px-2 py-1">♂ aantal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.map((t: any) => (
                      <tr class="border-t">
                        <td class="px-2 py-1">{t.snapshot_date}</td>
                        <td class="px-2 py-1 text-right tabular-nums">{t.total_active}</td>
                        <td class="px-2 py-1 text-right tabular-nums">{t.with_dob}</td>
                        <td class="px-2 py-1 text-right tabular-nums font-medium">{t.avg_age}</td>
                        <td class="px-2 py-1 text-right tabular-nums">{t.female_count}</td>
                        <td class="px-2 py-1 text-right tabular-nums">{t.male_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
            <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                const data = ${JSON.stringify(trends.map((t: any) => ({
                  d: t.snapshot_date,
                  avg: t.avg_age,
                  n: t.total_active,
                  f: t.female_count,
                  m: t.male_count
                })))};
                if (!data || data.length < 2) return;
                const ctx = document.getElementById('trendChart');
                if (!ctx || typeof Chart === 'undefined') return;
                new Chart(ctx, {
                  type: 'line',
                  data: {
                    labels: data.map(d => d.d),
                    datasets: [
                      {
                        label: 'Gem. leeftijd',
                        data: data.map(d => d.avg),
                        borderColor: 'rgb(124, 58, 237)',
                        backgroundColor: 'rgba(124, 58, 237, 0.1)',
                        yAxisID: 'y',
                        tension: 0.3,
                        borderWidth: 3,
                        pointRadius: 4
                      },
                      {
                        label: 'Aantal leden',
                        data: data.map(d => d.n),
                        borderColor: 'rgb(236, 72, 153)',
                        backgroundColor: 'rgba(236, 72, 153, 0.1)',
                        yAxisID: 'y1',
                        tension: 0.3,
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 3
                      }
                    ]
                  },
                  options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                      legend: { position: 'bottom' },
                      tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)' }
                    },
                    scales: {
                      y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Gem. leeftijd (jaar)' },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                      },
                      y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Aantal leden' },
                        grid: { display: false },
                        beginAtZero: true
                      }
                    }
                  }
                });
              })();
            ` }} />
          </>
        )}

        {!hasTrend && (
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-8 text-sm text-blue-800">
            <i class="fas fa-info-circle mr-2"></i>
            <strong>Trend-tracking is gestart.</strong> Elke maand wordt automatisch een snapshot
            opgeslagen wanneer iemand deze pagina bezoekt. Binnen enkele maanden verschijnt hier
            een grafiek met de evolutie van de gemiddelde leeftijd en het ledental.
            {trends.length === 1 && (
              <span class="block mt-1 text-xs text-blue-700">
                Eerste snapshot opgeslagen op {trends[0].snapshot_date}.
              </span>
            )}
          </div>
        )}

        {/* Ontbrekende geboortedata */}
        {zonderDob.length > 0 && (
          <div class="bg-amber-50 border-l-4 border-amber-400 rounded-xl p-6 mb-6">
            <h2 class="text-lg font-bold text-amber-900 mb-2">
              <i class="fas fa-exclamation-triangle mr-2"></i>
              {zonderDob.length} actieve leden zonder geboortedatum
            </h2>
            <p class="text-sm text-amber-800 mb-4">
              Deze leden tellen niet mee in de gemiddelden. Een korte herinnering om hun profiel
              te vervolledigen verbetert de cijfers.
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {zonderDob.map((l: any) => (
                <a href={`/admin/leden/${l.id}`}
                   class="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-3 py-2 hover:border-amber-400 hover:shadow-sm transition">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${stemBadge(l.stemgroep || 'X')}`}>
                      {l.stemgroep || '–'}
                    </span>
                    <span class="text-sm font-medium text-gray-900 truncate">
                      {l.voornaam} {l.achternaam}
                    </span>
                  </div>
                  <i class="fas fa-chevron-right text-gray-400 text-xs"></i>
                </a>
              ))}
            </div>
          </div>
        )}

        <div class="text-xs text-gray-400 text-center py-4">
          Live data — vernieuw deze pagina om de meest recente cijfers te zien.
          Geslacht wordt afgeleid uit stemgroep (S/A → vrouw, T/B → man).
        </div>
      </div>
    </Layout>
  )
})

export default app
