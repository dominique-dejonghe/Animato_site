// Admin Activity Logging routes
// View user login/logout sessions and activity

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware - only admin and moderator
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// ACTIVITY DASHBOARD
// =====================================================

app.get('/admin/activity', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  // Get filter parameters
  const filter = c.req.query('filter') || 'active' // active, all, today
  const userId = c.req.query('user_id')

  // Build query based on filter
  let query = `
    SELECT 
      s.*,
      u.email,
      p.voornaam,
      p.achternaam,
      u.stemgroep,
      u.role
    FROM user_sessions s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
  `
  const params: any[] = []

  if (filter === 'active') {
    query += ` WHERE s.is_active = 1`
  } else if (filter === 'today') {
    query += ` WHERE DATE(s.login_at) = DATE('now')`
  }

  if (userId) {
    query += (query.includes('WHERE') ? ' AND' : ' WHERE') + ` s.user_id = ?`
    params.push(userId)
  }

  query += ` ORDER BY s.login_at DESC LIMIT 100`

  const sessions = await queryAll(c.env.DB, query, params)

  // Get statistics
  const stats = {
    active_now: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM user_sessions WHERE is_active = 1`
    ),
    today_logins: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM user_sessions WHERE DATE(login_at) = DATE('now')`
    ),
    avg_session_duration: await queryOne<any>(c.env.DB,
      `SELECT AVG(duration_seconds) as avg_duration FROM user_sessions WHERE duration_seconds IS NOT NULL`
    ),
    total_sessions: await queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM user_sessions`
    )
  }

  // Get all users for filter dropdown
  const users = await queryAll(c.env.DB, `
    SELECT u.id, u.email, p.voornaam, p.achternaam, u.role, u.stemgroep
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.role IN ('lid', 'stemleider', 'moderator', 'admin')
    ORDER BY p.achternaam, p.voornaam
  `)

  // Format session duration
  const formatDuration = (seconds: number) => {
    if (!seconds) return '-'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}u ${minutes}m`
    return `${minutes}m`
  }

  // Format date/time
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('nl-BE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('nl-BE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('nl-BE', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return c.html(
    <Layout 
      title="Gebruikers Activiteit" 
      user={user}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-chart-line text-animato-accent mr-3"></i>
                  Gebruikers Activiteit
                </h1>
                <p class="mt-2 text-gray-600">
                  Login/logout sessies en gebruikersactiviteit
                </p>
              </div>
              <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                <i class="fas fa-arrow-left mr-2"></i>
                Terug naar Admin
              </a>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Statistics Cards */}
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white rounded-lg shadow p-6">
              <div class="flex items-center">
                <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <i class="fas fa-circle text-green-600 text-xl"></i>
                </div>
                <div class="ml-4">
                  <p class="text-gray-600 text-sm">Nu Online</p>
                  <p class="text-2xl font-bold text-gray-900">{stats.active_now?.count || 0}</p>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
              <div class="flex items-center">
                <div class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <i class="fas fa-calendar-day text-blue-600 text-xl"></i>
                </div>
                <div class="ml-4">
                  <p class="text-gray-600 text-sm">Vandaag Ingelogd</p>
                  <p class="text-2xl font-bold text-gray-900">{stats.today_logins?.count || 0}</p>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
              <div class="flex items-center">
                <div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                  <i class="fas fa-clock text-purple-600 text-xl"></i>
                </div>
                <div class="ml-4">
                  <p class="text-gray-600 text-sm">Gem. Sessieduur</p>
                  <p class="text-2xl font-bold text-gray-900">
                    {formatDuration(Math.round(stats.avg_session_duration?.avg_duration || 0))}
                  </p>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
              <div class="flex items-center">
                <div class="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                  <i class="fas fa-history text-amber-600 text-xl"></i>
                </div>
                <div class="ml-4">
                  <p class="text-gray-600 text-sm">Totaal Sessies</p>
                  <p class="text-2xl font-bold text-gray-900">{stats.total_sessions?.count || 0}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div class="bg-white rounded-lg shadow p-6 mb-6">
            <form method="GET" action="/admin/activity" class="flex flex-wrap gap-4">
              <div class="flex-1 min-w-[200px]">
                <label class="block text-sm font-medium text-gray-700 mb-2">Filter op Status</label>
                <select name="filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg" onchange="this.form.submit()">
                  <option value="active" selected={filter === 'active'}>Nu Online</option>
                  <option value="today" selected={filter === 'today'}>Vandaag</option>
                  <option value="all" selected={filter === 'all'}>Alle Sessies</option>
                </select>
              </div>

              <div class="flex-1 min-w-[200px]">
                <label class="block text-sm font-medium text-gray-700 mb-2">Filter op Gebruiker</label>
                <select name="user_id" class="w-full px-4 py-2 border border-gray-300 rounded-lg" onchange="this.form.submit()">
                  <option value="">Alle Gebruikers</option>
                  {users.map((u: any) => (
                    <option value={u.id} selected={userId === String(u.id)}>
                      {u.voornaam} {u.achternaam} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {(filter !== 'active' || userId) && (
                <div class="flex items-end">
                  <a href="/admin/activity" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
                    <i class="fas fa-times mr-2"></i>
                    Reset Filters
                  </a>
                </div>
              )}
            </form>
          </div>

          {/* Sessions Table */}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200">
              <h2 class="text-lg font-semibold text-gray-900">
                Sessies ({sessions.length})
              </h2>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gebruiker</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rol</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingelogd</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uitgelogd</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duur</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Adres</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-inbox text-4xl mb-3 text-gray-400"></i>
                        <p>Geen sessies gevonden</p>
                      </td>
                    </tr>
                  ) : (
                    sessions.map((session: any) => (
                      <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4">
                          <div class="flex items-center">
                            <div class="w-10 h-10 bg-animato-primary rounded-full flex items-center justify-center text-white font-bold mr-3">
                              {session.voornaam?.[0]}{session.achternaam?.[0]}
                            </div>
                            <div>
                              <div class="font-medium text-gray-900">
                                {session.voornaam} {session.achternaam}
                              </div>
                              <div class="text-sm text-gray-500">{session.email}</div>
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4">
                          <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            session.role === 'admin' ? 'bg-red-100 text-red-800' :
                            session.role === 'moderator' ? 'bg-purple-100 text-purple-800' :
                            session.role === 'stemleider' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {session.role}
                          </span>
                          {session.stemgroep && (
                            <span class="ml-2 text-xs text-gray-600">({session.stemgroep})</span>
                          )}
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-900">
                          <div>{formatDate(session.login_at)}</div>
                          <div class="text-gray-500">{formatTime(session.login_at)}</div>
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-900">
                          {session.logout_at ? (
                            <>
                              <div>{formatDate(session.logout_at)}</div>
                              <div class="text-gray-500">{formatTime(session.logout_at)}</div>
                            </>
                          ) : (
                            <span class="text-gray-400">-</span>
                          )}
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-900">
                          {formatDuration(session.duration_seconds)}
                        </td>
                        <td class="px-6 py-4">
                          {session.is_active ? (
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <i class="fas fa-circle text-xs mr-1"></i>
                              Online
                            </span>
                          ) : (
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              Offline
                            </span>
                          )}
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-500 font-mono">
                          {session.ip_address}
                        </td>
                      </tr>
                    ))
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

export default app
