// Admin Attendance - QR Check-in systeem voor repetities
// Genereer QR codes, bekijk aanwezigheid, beheer streaks

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { requireAuth, requireRole } from '../middleware/auth'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// AUTH: Handled by admin.tsx's app.use('*', requireAuth, requireRole) middleware
// which is mounted before this sub-app in index.tsx and catches all /admin/* routes
// =====================================================

// =====================================================
// HELPER: Generate unique token
// =====================================================
function generateQRToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let token = ''
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

// =====================================================
// HELPER: Calculate streaks for a user
// =====================================================
async function calculateStreak(db: D1Database, userId: number): Promise<{ current: number; longest: number; total: number }> {
  // Get all checkins for this user, joined with events, ordered by event date DESC
  // BELANGRIJK: enkel 'qr'-source check-ins tellen mee voor de streak.
  // Admin-manuele check-ins worden wel als 'aanwezig' getoond in overzichten
  // maar geven geen streak-punten.
  const checkins = await queryAll<any>(db,
    `SELECT qc.event_id, e.start_at 
     FROM qr_checkins qc
     JOIN events e ON e.id = qc.event_id
     WHERE qc.user_id = ? AND e.type = 'repetitie'
       AND COALESCE(qc.source, 'qr') = 'qr'
     ORDER BY e.start_at DESC`,
    [userId]
  )

  if (checkins.length === 0) return { current: 0, longest: 0, total: 0 }

  // Get all repetitie events (to know which weeks had a rehearsal)
  const allRehearsals = await queryAll<any>(db,
    `SELECT id, start_at FROM events 
     WHERE type = 'repetitie' AND datetime(start_at) <= datetime('now')
     ORDER BY start_at DESC`
  )

  if (allRehearsals.length === 0) return { current: 0, longest: 0, total: checkins.length }

  const checkedInEventIds = new Set(checkins.map((c: any) => c.event_id))

  // Calculate current streak (consecutive from most recent rehearsal)
  let currentStreak = 0
  for (const rehearsal of allRehearsals) {
    if (checkedInEventIds.has(rehearsal.id)) {
      currentStreak++
    } else {
      break // Streak broken
    }
  }

  // Calculate longest streak
  let longestStreak = 0
  let tempStreak = 0
  for (const rehearsal of allRehearsals) {
    if (checkedInEventIds.has(rehearsal.id)) {
      tempStreak++
      longestStreak = Math.max(longestStreak, tempStreak)
    } else {
      tempStreak = 0
    }
  }

  return { current: currentStreak, longest: longestStreak, total: checkins.length }
}

// =====================================================
// HELPER: Bulk-calculate streaks for many users in a single pass (2 queries total)
// =====================================================
async function calculateStreaksBulk(db: D1Database): Promise<Map<number, { current: number; longest: number; total: number }>> {
  const map = new Map<number, { current: number; longest: number; total: number }>()

  // All past rehearsals, most recent first
  const allRehearsals = await queryAll<any>(db,
    `SELECT id, start_at FROM events
     WHERE type = 'repetitie' AND datetime(start_at) <= datetime('now')
     ORDER BY start_at DESC`
  )

  // All QR check-ins (source='qr' only) joined with events
  const allCheckins = await queryAll<any>(db,
    `SELECT qc.user_id, qc.event_id
     FROM qr_checkins qc
     JOIN events e ON e.id = qc.event_id
     WHERE e.type = 'repetitie' AND COALESCE(qc.source, 'qr') = 'qr'`
  )

  // Build per-user set of event_ids
  const byUser = new Map<number, Set<number>>()
  for (const row of allCheckins) {
    let s = byUser.get(row.user_id)
    if (!s) { s = new Set<number>(); byUser.set(row.user_id, s) }
    s.add(row.event_id)
  }

  for (const [userId, eventSet] of byUser.entries()) {
    let currentStreak = 0
    let longestStreak = 0
    let tempStreak = 0
    let stillCurrent = true
    for (const r of allRehearsals) {
      if (eventSet.has(r.id)) {
        if (stillCurrent) currentStreak++
        tempStreak++
        if (tempStreak > longestStreak) longestStreak = tempStreak
      } else {
        stillCurrent = false
        tempStreak = 0
      }
    }
    map.set(userId, { current: currentStreak, longest: longestStreak, total: eventSet.size })
  }
  return map
}

// =====================================================
// HELPER: Get badge info for streak count
// =====================================================
function getStreakBadge(streak: number): { name: string; icon: string; color: string } | null {
  if (streak >= 52) return { name: 'Gouden Noot', icon: 'fas fa-trophy', color: 'text-yellow-500' }
  if (streak >= 25) return { name: 'Zilveren Noot', icon: 'fas fa-medal', color: 'text-gray-400' }
  if (streak >= 10) return { name: 'Bronzen Noot', icon: 'fas fa-award', color: 'text-amber-700' }
  if (streak >= 5) return { name: 'Trouw Lid', icon: 'fas fa-star', color: 'text-blue-500' }
  return null
}

// =====================================================
// ADMIN: Aanwezigheidsoverzicht
// =====================================================
app.get('/admin/attendance', async (c) => {
  const user = c.get('user') as SessionUser

  // AUTO-GENERATE QR tokens for ALL future rehearsals that don't have one yet
  const futureWithoutQR = await queryAll<any>(c.env.DB,
    `SELECT e.id FROM events e
     LEFT JOIN qr_tokens qt ON qt.event_id = e.id
     WHERE e.type = 'repetitie' AND datetime(e.start_at) >= datetime('now', '-1 day') AND qt.id IS NULL
     ORDER BY e.start_at ASC`
  )
  for (const evt of futureWithoutQR) {
    const token = generateQRToken()
    try {
      await execute(c.env.DB,
        `INSERT INTO qr_tokens (event_id, token, created_by) VALUES (?, ?, ?)`,
        [evt.id, token, user.id]
      )
    } catch (e) { /* ignore duplicate */ }
  }

  // Get upcoming rehearsals (next 4 weeks) - all should now have QR tokens
  const upcomingRehearsals = await queryAll<any>(c.env.DB,
    `SELECT e.id, e.titel, e.start_at, e.locatie,
            qt.token, qt.valid_from, qt.valid_until, qt.id as qr_id
     FROM events e
     LEFT JOIN qr_tokens qt ON qt.event_id = e.id
     WHERE e.type = 'repetitie' AND datetime(e.start_at) >= datetime('now', '-1 day')
     ORDER BY e.start_at ASC
     LIMIT 8`
  )

  // Get past rehearsals with attendance counts
  const pastRehearsals = await queryAll<any>(c.env.DB,
    `SELECT e.id, e.titel, e.start_at, e.locatie,
            COUNT(qc.id) as checkin_count,
            qt.token IS NOT NULL as has_qr
     FROM events e
     LEFT JOIN qr_checkins qc ON qc.event_id = e.id
     LEFT JOIN qr_tokens qt ON qt.event_id = e.id
     WHERE e.type = 'repetitie' AND datetime(e.start_at) < datetime('now')
     GROUP BY e.id
     ORDER BY e.start_at DESC
     LIMIT 20`
  )

  // Get total active members
  const memberCount = await queryOne<any>(c.env.DB,
    `SELECT COUNT(*) as count FROM users WHERE status = 'actief' AND role != 'bezoeker' AND is_test_account = 0`
  )

  // Top streaks leaderboard — show ALL active members
  const activeUsers = await queryAll<any>(c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, u.stemgroep, p.foto_url,
            COUNT(qc.id) as total_checkins
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN qr_checkins qc ON qc.user_id = u.id
     WHERE u.status = 'actief' AND u.role NOT IN ('bezoeker', 'dirigent', 'pianist') AND u.is_test_account = 0
     GROUP BY u.id
     ORDER BY total_checkins DESC`
  )

  // Calculate streaks for ALL active users in bulk (2 queries total, not N+2)
  const streakMap = await calculateStreaksBulk(c.env.DB)
  const topUsers = activeUsers.map((au: any) => ({
    ...au,
    streak: streakMap.get(au.id) || { current: 0, longest: 0, total: 0 }
  }))
  topUsers.sort((a: any, b: any) => b.streak.current - a.streak.current || b.streak.total - a.streak.total)

  const siteUrl = c.env.SITE_URL || 'https://animato-live.pages.dev'

  return c.html(
    <Layout title="Aanwezigheid" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-8">
          <div class="max-w-6xl mx-auto">
            {/* Header */}
            <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-qrcode text-animato-primary mr-3"></i>
                  Aanwezigheid & Streaks
                </h1>
                <p class="mt-2 text-gray-600">QR check-in voor repetities • {memberCount?.count || 0} actieve leden</p>
                {futureWithoutQR.length > 0 && (
                  <p class="mt-1 text-sm text-green-600 font-medium">
                    <i class="fas fa-magic mr-1"></i>
                    {futureWithoutQR.length} nieuwe QR code(s) automatisch aangemaakt!
                  </p>
                )}
              </div>
              <a href="/admin/attendance/repetities" class="inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary text-sm font-medium shadow">
                <i class="fas fa-calendar-check mr-2"></i> Repetitie overzicht
              </a>
            </div>

            {/* How it works - Admin side */}
            <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mb-8">
              <h2 class="text-lg font-bold text-gray-900 mb-4">
                <i class="fas fa-info-circle text-blue-500 mr-2"></i>
                Hoe werkt het?
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div class="flex flex-col items-center text-center">
                  <div class="w-14 h-14 bg-white rounded-full shadow-md flex items-center justify-center mb-3">
                    <span class="text-2xl font-bold text-blue-600">1</span>
                  </div>
                  <h3 class="font-bold text-gray-900 text-sm mb-1">QR Automatisch</h3>
                  <p class="text-xs text-gray-600">QR codes worden automatisch aangemaakt voor alle toekomstige repetities</p>
                </div>
                <div class="flex flex-col items-center text-center">
                  <div class="w-14 h-14 bg-white rounded-full shadow-md flex items-center justify-center mb-3">
                    <span class="text-2xl font-bold text-blue-600">2</span>
                  </div>
                  <h3 class="font-bold text-gray-900 text-sm mb-1">Afdrukken</h3>
                  <p class="text-xs text-gray-600">Print de QR poster (A4) en hang die op in het repetitielokaal</p>
                </div>
                <div class="flex flex-col items-center text-center">
                  <div class="w-14 h-14 bg-white rounded-full shadow-md flex items-center justify-center mb-3">
                    <span class="text-2xl font-bold text-blue-600">3</span>
                  </div>
                  <h3 class="font-bold text-gray-900 text-sm mb-1">Leden Scannen</h3>
                  <p class="text-xs text-gray-600">Leden openen hun camera, scannen de QR code en checken in</p>
                </div>
                <div class="flex flex-col items-center text-center">
                  <div class="w-14 h-14 bg-white rounded-full shadow-md flex items-center justify-center mb-3">
                    <span class="text-2xl font-bold text-orange-500">🔥</span>
                  </div>
                  <h3 class="font-bold text-gray-900 text-sm mb-1">Streaks Groeien</h3>
                  <p class="text-xs text-gray-600">Elke opeenvolgende week bouwt een streak op. Badges bij 5, 10, 25, 52 weken!</p>
                </div>
              </div>
              <div class="mt-4 p-3 bg-white bg-opacity-60 rounded-lg">
                <p class="text-xs text-gray-500">
                  <i class="fas fa-user mr-1"></i>
                  <strong>Wat ziet het lid?</strong> Na het scannen van de QR code ziet het lid direct zijn/haar huidige streak, 
                  badge-voortgang en hoe ver ze zijn van de volgende badge. Alles is zichtbaar via <a href="/leden/streaks" class="text-blue-600 underline">Leaderboard</a> 
                  en op het <a href="/leden/profiel" class="text-blue-600 underline">Profiel</a>.
                </p>
              </div>
            </div>

            {/* Upcoming Rehearsals - QR Codes */}
            <div class="bg-white rounded-xl shadow-md p-6 mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-calendar-week text-blue-500 mr-2"></i>
                Komende Repetities
              </h2>
              
              {upcomingRehearsals.length === 0 ? (
                <p class="text-gray-500 italic text-center py-8">Geen komende repetities gevonden.</p>
              ) : (
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {upcomingRehearsals.map((r: any) => {
                    const eventDate = new Date(r.start_at)
                    const dayName = eventDate.toLocaleDateString('nl-BE', { weekday: 'long' })
                    const dateStr = eventDate.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
                    const timeStr = eventDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
                    const hasQR = !!r.token
                    
                    return (
                      <div class={`border-2 rounded-xl p-5 transition-all ${hasQR ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
                        <div class="flex justify-between items-start mb-3">
                          <div>
                            <div class="text-sm font-medium text-gray-500 capitalize">{dayName}</div>
                            <div class="text-lg font-bold text-gray-900">{dateStr}</div>
                            <div class="text-sm text-gray-600"><i class="far fa-clock mr-1"></i>{timeStr} • {r.locatie || 'Repetitielokaal'}</div>
                          </div>
                          {hasQR && (
                            <span class="px-3 py-1 bg-green-200 text-green-800 text-xs font-bold rounded-full">
                              <i class="fas fa-check mr-1"></i>QR klaar
                            </span>
                          )}
                        </div>
                        
                        <div class="flex gap-2 mt-3">
                          {hasQR ? (
                            <>
                              <a 
                                href={`/admin/attendance/qr/${r.id}`}
                                class="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
                              >
                                <i class="fas fa-eye mr-1"></i> Bekijk QR
                              </a>
                              <a 
                                href={`/admin/attendance/print/${r.id}`}
                                target="_blank"
                                class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm"
                              >
                                <i class="fas fa-print mr-1"></i> Print
                              </a>
                              <a 
                                href={`/admin/attendance/event/${r.id}`}
                                class="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm"
                                title="Handmatig aanwezigheid registreren"
                              >
                                <i class="fas fa-user-check mr-1"></i> Invullen
                              </a>
                            </>
                          ) : (
                            <>
                              <form action={`/api/admin/attendance/generate-qr`} method="POST" class="flex-1">
                                <input type="hidden" name="event_id" value={String(r.id)} />
                                <button 
                                  type="submit"
                                  class="w-full px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm font-medium"
                                >
                                  <i class="fas fa-qrcode mr-1"></i> Genereer QR
                                </button>
                              </form>
                              <a 
                                href={`/admin/attendance/event/${r.id}`}
                                class="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm"
                                title="Handmatig aanwezigheid registreren"
                              >
                                <i class="fas fa-user-check mr-1"></i> Invullen
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Leaderboard */}
            <div class="bg-white rounded-xl shadow-md p-6 mb-8">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-fire text-orange-500 mr-2"></i>
                Streak Leaderboard
              </h2>
              
              {topUsers.length === 0 ? (
                <p class="text-gray-500 italic text-center py-8">Nog geen check-ins geregistreerd.</p>
              ) : (
                <div class="overflow-x-auto">
                  <table class="w-full">
                    <thead>
                      <tr class="text-xs text-gray-500 border-b">
                        <th class="py-2 text-left">#</th>
                        <th class="py-2 text-left">Lid</th>
                        <th class="py-2 text-left">Stemgroep</th>
                        <th class="py-2 text-center">Huidige Streak</th>
                        <th class="py-2 text-center">Langste Streak</th>
                        <th class="py-2 text-center">Totaal</th>
                        <th class="py-2 text-center">Badge</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y">
                      {topUsers.map((u: any, idx: number) => {
                        const badge = getStreakBadge(u.streak.current)
                        const stemLabel = u.stemgroep === 'S' ? 'Sopraan' : u.stemgroep === 'A' ? 'Alt' : u.stemgroep === 'T' ? 'Tenor' : u.stemgroep === 'B' ? 'Bas' : u.stemgroep || '-'
                        return (
                          <tr class="hover:bg-gray-50 transition">
                            <td class="py-3 text-lg font-bold text-gray-400">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                            </td>
                            <td class="py-3">
                              <div class="flex items-center gap-3">
                                <div class="w-8 h-8 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center text-sm font-bold text-animato-primary overflow-hidden">
                                  <img src={u.foto_url || (u.stemgroep === 'S' ? '/static/avatars/sopraan-callas.png' : u.stemgroep === 'A' ? '/static/avatars/alt-bartoli.png' : u.stemgroep === 'T' ? '/static/avatars/tenor-pavarotti.png' : '/static/avatars/bas-terfel.png')} class="w-full h-full object-cover" />
                                </div>
                                <span class="font-medium text-gray-900">{u.voornaam} {u.achternaam}</span>
                              </div>
                            </td>
                            <td class="py-3 text-sm text-gray-600">{stemLabel}</td>
                            <td class="py-3 text-center">
                              <span class="text-lg font-bold text-orange-600">
                                🔥 {u.streak.current}
                              </span>
                            </td>
                            <td class="py-3 text-center text-gray-600">{u.streak.longest}</td>
                            <td class="py-3 text-center text-gray-600">{u.streak.total}</td>
                            <td class="py-3 text-center">
                              {badge ? (
                                <span class={`${badge.color} text-sm`} title={badge.name}>
                                  <i class={badge.icon}></i> {badge.name}
                                </span>
                              ) : (
                                <span class="text-gray-300 text-sm">-</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Past Rehearsals */}
            <div class="bg-white rounded-xl shadow-md p-6">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-history text-gray-500 mr-2"></i>
                Eerdere Repetities
              </h2>
              
              {pastRehearsals.length === 0 ? (
                <p class="text-gray-500 italic text-center py-8">Geen eerdere repetities.</p>
              ) : (
                <div class="overflow-x-auto">
                  <table class="w-full">
                    <thead>
                      <tr class="text-xs text-gray-500 border-b">
                        <th class="py-2 text-left">Datum</th>
                        <th class="py-2 text-left">Titel</th>
                        <th class="py-2 text-center">Aanwezig</th>
                        <th class="py-2 text-center">QR</th>
                        <th class="py-2 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y">
                      {pastRehearsals.map((r: any) => {
                        const dateStr = new Date(r.start_at).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                        return (
                          <tr class="hover:bg-gray-50 transition">
                            <td class="py-3 text-sm text-gray-600">{dateStr}</td>
                            <td class="py-3 font-medium text-gray-900">{r.titel}</td>
                            <td class="py-3 text-center">
                              <span class={`px-3 py-1 rounded-full text-sm font-bold ${r.checkin_count > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                                {r.checkin_count}
                              </span>
                            </td>
                            <td class="py-3 text-center">
                              {r.has_qr ? (
                                <i class="fas fa-check-circle text-green-500"></i>
                              ) : (
                                <i class="fas fa-times-circle text-gray-300"></i>
                              )}
                            </td>
                            <td class="py-3 text-right">
                              <a href={`/admin/attendance/event/${r.id}`} class="text-animato-primary hover:text-animato-secondary text-sm font-medium">
                                Bekijk <i class="fas fa-chevron-right ml-1 text-xs"></i>
                              </a>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </Layout>
  )
})

// =====================================================
// ADMIN: View QR code for event
// =====================================================
app.get('/admin/attendance/qr/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = parseInt(c.req.param('id'))

  const event = await queryOne<any>(c.env.DB,
    `SELECT e.*, qt.token FROM events e LEFT JOIN qr_tokens qt ON qt.event_id = e.id WHERE e.id = ?`,
    [eventId]
  )

  if (!event) return c.redirect('/admin/attendance?error=not_found')

  // Generate QR if not exists
  if (!event.token) {
    const token = generateQRToken()
    await execute(c.env.DB,
      `INSERT INTO qr_tokens (event_id, token, created_by) VALUES (?, ?, ?)`,
      [eventId, token, user.id]
    )
    event.token = token
  }

  const siteUrl = c.env.SITE_URL || 'https://animato-live.pages.dev'
  const checkinUrl = `${siteUrl}/checkin/${event.token}`
  const eventDate = new Date(event.start_at)
  const dateStr = eventDate.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = eventDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

  // Get current checkins
  const checkins = await queryAll<any>(c.env.DB,
    `SELECT qc.checked_in_at, p.voornaam, p.achternaam, u.stemgroep
     FROM qr_checkins qc
     JOIN users u ON u.id = qc.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE qc.event_id = ?
     ORDER BY qc.checked_in_at ASC`,
    [eventId]
  )

  return c.html(
    <Layout title="QR Code" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-8">
          <div class="max-w-3xl mx-auto">
            {/* Back Button */}
            <a href="/admin/attendance" class="inline-flex items-center text-animato-primary hover:text-animato-secondary mb-6">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar overzicht
            </a>

            {/* QR Display Card */}
            <div class="bg-white rounded-xl shadow-lg p-8 text-center mb-8">
              <h1 class="text-2xl font-bold text-gray-900 mb-1" style="font-family: 'Playfair Display', serif;">
                {event.titel}
              </h1>
              <p class="text-lg text-gray-600 mb-6">{dateStr} • {timeStr}</p>

              {/* QR Code - using external API */}
              <div class="inline-block bg-white p-4 rounded-xl border-4 border-animato-primary shadow-inner mb-4">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(checkinUrl)}&margin=10`}
                  alt="QR Code"
                  class="w-72 h-72"
                  id="qr-image"
                />
              </div>

              <p class="text-sm text-gray-500 mb-2">Scan met je telefoon om in te checken</p>
              <p class="text-xs text-gray-400 font-mono break-all px-8">{checkinUrl}</p>

              <div class="flex gap-3 justify-center mt-6">
                <a 
                  href={`/admin/attendance/print/${eventId}`}
                  target="_blank"
                  class="px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition font-medium"
                >
                  <i class="fas fa-print mr-2"></i> Afdrukken
                </a>
                <button
                  onclick={`navigator.clipboard.writeText('${checkinUrl}').then(() => { this.innerHTML = '<i class=\\'fas fa-check mr-2\\'></i>Gekopieerd!'; setTimeout(() => { this.innerHTML = '<i class=\\'fas fa-link mr-2\\'></i>Kopieer Link'; }, 2000); })`}
                  class="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                >
                  <i class="fas fa-link mr-2"></i> Kopieer Link
                </button>
              </div>
            </div>

            {/* Current Check-ins */}
            <div class="bg-white rounded-xl shadow-md p-6">
              <h2 class="text-xl font-bold text-gray-900 mb-4">
                <i class="fas fa-users text-green-500 mr-2"></i>
                Ingecheckt ({checkins.length})
              </h2>
              {checkins.length === 0 ? (
                <p class="text-gray-500 italic text-center py-6">Nog niemand ingecheckt.</p>
              ) : (
                <div class="space-y-2">
                  {checkins.map((ci: any, idx: number) => (
                    <div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div class="flex items-center gap-3">
                        <span class="w-8 h-8 bg-green-100 text-green-800 rounded-full flex items-center justify-center text-sm font-bold">{idx + 1}</span>
                        <span class="font-medium text-gray-900">{ci.voornaam} {ci.achternaam}</span>
                        <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {ci.stemgroep === 'S' ? 'Sopraan' : ci.stemgroep === 'A' ? 'Alt' : ci.stemgroep === 'T' ? 'Tenor' : ci.stemgroep === 'B' ? 'Bas' : ci.stemgroep || '-'}
                        </span>
                      </div>
                      <span class="text-xs text-gray-400">
                        {new Date(ci.checked_in_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </Layout>
  )
})

// =====================================================
// ADMIN: Print-friendly QR page
// =====================================================
app.get('/admin/attendance/print/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = parseInt(c.req.param('id'))

  const event = await queryOne<any>(c.env.DB,
    `SELECT e.*, qt.token FROM events e LEFT JOIN qr_tokens qt ON qt.event_id = e.id WHERE e.id = ?`,
    [eventId]
  )

  if (!event || !event.token) return c.redirect('/admin/attendance?error=no_qr')

  const siteUrl = c.env.SITE_URL || 'https://animato-live.pages.dev'
  const checkinUrl = `${siteUrl}/checkin/${event.token}`
  const eventDate = new Date(event.start_at)
  const dateStr = eventDate.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = eventDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

  // Return a clean printable page (no Layout wrapper)
  return c.html(`
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>QR Check-in - ${event.titel}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: white;
        }
        
        .print-card {
          text-align: center;
          padding: 40px;
          max-width: 600px;
          width: 100%;
        }
        
        .logo {
          font-family: 'Playfair Display', serif;
          font-size: 36px;
          color: #1a365d;
          margin-bottom: 8px;
        }
        
        .subtitle {
          font-size: 14px;
          color: #718096;
          margin-bottom: 32px;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        
        .event-title {
          font-size: 22px;
          font-weight: bold;
          color: #2d3748;
          margin-bottom: 4px;
        }
        
        .event-date {
          font-size: 18px;
          color: #4a5568;
          margin-bottom: 4px;
        }
        
        .event-time {
          font-size: 16px;
          color: #718096;
          margin-bottom: 32px;
        }
        
        .qr-frame {
          display: inline-block;
          padding: 20px;
          border: 4px solid #1a365d;
          border-radius: 16px;
          margin-bottom: 24px;
        }
        
        .qr-frame img {
          width: 280px;
          height: 280px;
        }
        
        .instruction {
          font-size: 20px;
          font-weight: bold;
          color: #2d3748;
          margin-bottom: 8px;
        }
        
        .instruction-sub {
          font-size: 14px;
          color: #718096;
          margin-bottom: 16px;
        }
        
        .steps {
          display: flex;
          justify-content: center;
          gap: 32px;
          margin-top: 24px;
        }
        
        .step {
          text-align: center;
        }
        
        .step-num {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #1a365d;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 8px;
          font-weight: bold;
          font-size: 18px;
        }
        
        .step-text {
          font-size: 13px;
          color: #4a5568;
        }
        
        .url-text {
          font-size: 10px;
          color: #a0aec0;
          margin-top: 20px;
          word-break: break-all;
        }
        
        @media print {
          body { background: white; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="print-card">
        <div class="logo">♪ Animato</div>
        <div class="subtitle">Gemengd Koor</div>
        
        <div class="event-title">${event.titel}</div>
        <div class="event-date">${dateStr}</div>
        <div class="event-time">${timeStr} • ${event.locatie || 'Repetitielokaal'}</div>
        
        <div class="qr-frame">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(checkinUrl)}&margin=10" alt="QR Code" />
        </div>
        
        <div class="instruction">📱 Scan om in te checken!</div>
        <div class="instruction-sub">Open je camera-app en richt op de QR code</div>
        
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-text">Open camera</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-text">Scan QR code</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-text">Bevestig check-in</div>
          </div>
        </div>
        
        <div class="url-text">${checkinUrl}</div>
        
        <button class="no-print" onclick="window.print()" style="margin-top: 24px; padding: 12px 32px; background: #1a365d; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">
          🖨️ Afdrukken
        </button>
      </div>
    </body>
    </html>
  `)
})

// =====================================================
// ADMIN: Event attendance detail
// =====================================================
app.get('/admin/attendance/event/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const eventId = parseInt(c.req.param('id'))

  const event = await queryOne<any>(c.env.DB,
    `SELECT * FROM events WHERE id = ?`,
    [eventId]
  )

  if (!event) return c.redirect('/admin/attendance?error=not_found')

  // All checkins for this event, incl. source (qr = self-scan, admin = handmatig)
  const checkins = await queryAll<any>(c.env.DB,
    `SELECT qc.checked_in_at, COALESCE(qc.source, 'qr') as source,
            u.id as user_id, u.stemgroep, u.email,
            p.voornaam, p.achternaam, p.foto_url
     FROM qr_checkins qc
     JOIN users u ON u.id = qc.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE qc.event_id = ?
     ORDER BY qc.checked_in_at ASC`,
    [eventId]
  )

  // All active members (for absence overview)
  const allMembers = await queryAll<any>(c.env.DB,
    `SELECT u.id, u.stemgroep, u.email, p.voornaam, p.achternaam
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief' AND u.role NOT IN ('bezoeker') AND u.is_test_account = 0
     ORDER BY p.voornaam ASC`
  )

  const checkedInIds = new Set(checkins.map((ci: any) => ci.user_id))
  const absentMembers = allMembers.filter((m: any) => !checkedInIds.has(m.id))

  const eventDate = new Date(event.start_at)
  const dateStr = eventDate.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Counts per stemgroep
  const stemCounts: Record<string, { present: number; total: number }> = {}
  for (const m of allMembers) {
    const sg = m.stemgroep || 'Geen'
    if (!stemCounts[sg]) stemCounts[sg] = { present: 0, total: 0 }
    stemCounts[sg].total++
    if (checkedInIds.has(m.id)) stemCounts[sg].present++
  }

  // Build a combined member list with present/absent state for the toggle UI
  const checkinMap = new Map<number, any>()
  for (const ci of checkins) checkinMap.set(ci.user_id, ci)
  const allMembersWithState = allMembers.map((m: any) => {
    const ci = checkinMap.get(m.id)
    return {
      ...m,
      is_present: !!ci,
      checked_in_at: ci?.checked_in_at || null,
      source: ci?.source || null,  // 'qr' | 'admin' | null
    }
  })
  // Counts van QR-scans vs admin-registraties
  const qrCount = checkins.filter((ci: any) => ci.source === 'qr').length
  const adminCount = checkins.filter((ci: any) => ci.source === 'admin').length
  // Sort: stemgroep (S, A, T, B, rest), then first name
  const stemOrder: Record<string, number> = { S: 1, A: 2, T: 3, B: 4 }
  allMembersWithState.sort((a: any, b: any) => {
    const oa = stemOrder[a.stemgroep] || 99
    const ob = stemOrder[b.stemgroep] || 99
    if (oa !== ob) return oa - ob
    return (a.voornaam || '').localeCompare(b.voornaam || '')
  })

  const success = c.req.query('success')

  return c.html(
    <Layout title="Aanwezigheidsdetail" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-8">
          <div class="max-w-6xl mx-auto">
            <div class="flex items-center gap-4 mb-6 flex-wrap">
              <a href="/admin/attendance/repetities" class="inline-flex items-center text-animato-primary hover:text-animato-secondary text-sm">
                <i class="fas fa-arrow-left mr-1"></i> Overzicht
              </a>
              <span class="text-gray-300">|</span>
              <a href="/admin/attendance" class="inline-flex items-center text-gray-500 hover:text-gray-700 text-sm">
                <i class="fas fa-qrcode mr-1"></i> Aanwezigheid dashboard
              </a>
            </div>

            <div class="flex items-start justify-between mb-6 flex-wrap gap-4">
              <div>
                <h1 class="text-2xl font-bold text-gray-900 mb-1">{event.titel}</h1>
                <p class="text-gray-600"><i class="far fa-calendar mr-1"></i>{dateStr}</p>
                {event.locatie && <p class="text-gray-500 text-sm"><i class="fas fa-map-marker-alt mr-1"></i>{event.locatie}</p>}
              </div>
              <div class="flex gap-2">
                <a href={`/admin/attendance/qr/${event.id}`} class="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                  <i class="fas fa-qrcode mr-1"></i> QR code
                </a>
                <a href={`/admin/attendance/print/${event.id}`} target="_blank" class="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                  <i class="fas fa-print mr-1"></i> Print poster
                </a>
              </div>
            </div>

            {success && (
              <div class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 mb-6 text-sm">
                <i class="fas fa-check-circle mr-2"></i>
                {success === 'bulk_all_present' ? 'Alle leden aanwezig gezet.' : success === 'bulk_clear_all' ? 'Alle aanwezigheden gewist.' : 'Wijziging opgeslagen.'}
              </div>
            )}

            {/* Stats per stemgroep */}
            <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {Object.entries(stemCounts).map(([sg, counts]) => {
                const label = sg === 'S' ? 'Sopraan' : sg === 'A' ? 'Alt' : sg === 'T' ? 'Tenor' : sg === 'B' ? 'Bas' : sg
                const pct = counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0
                return (
                  <div class="bg-white rounded-lg shadow p-4 text-center" data-stem-stat={sg}>
                    <div class="text-xs text-gray-500 font-medium uppercase">{label}</div>
                    <div class="text-2xl font-bold text-animato-primary mt-1">
                      <span data-stem-present={sg}>{counts.present}</span>/<span>{counts.total}</span>
                    </div>
                    <div class="text-xs text-gray-400"><span data-stem-pct={sg}>{pct}</span>%</div>
                  </div>
                )
              })}
              <div class="bg-animato-primary text-white rounded-lg shadow p-4 text-center">
                <div class="text-xs font-medium uppercase opacity-80">Totaal</div>
                <div class="text-2xl font-bold mt-1">
                  <span id="total-present">{checkins.length}</span>/<span>{allMembers.length}</span>
                </div>
                <div class="text-xs opacity-70"><span id="total-pct">{allMembers.length > 0 ? Math.round((checkins.length / allMembers.length) * 100) : 0}</span>%</div>
              </div>
            </div>

            {/* Source breakdown */}
            {checkins.length > 0 && (
              <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                  <div class="text-xs text-gray-500 font-medium uppercase flex items-center gap-1">
                    <i class="fas fa-qrcode text-blue-500"></i> Zelf ingescand (QR)
                  </div>
                  <div class="text-2xl font-bold text-blue-600 mt-1">{qrCount}</div>
                  <div class="text-xs text-gray-400">telt mee voor streak 🔥</div>
                </div>
                <div class="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
                  <div class="text-xs text-gray-500 font-medium uppercase flex items-center gap-1">
                    <i class="fas fa-user-shield text-purple-500"></i> Door admin geregistreerd
                  </div>
                  <div class="text-2xl font-bold text-purple-600 mt-1">{adminCount}</div>
                  <div class="text-xs text-gray-400">aanwezig, maar geen streak</div>
                </div>
              </div>
            )}

            {/* Manual attendance section */}
            <div class="bg-white rounded-xl shadow-md p-6 mb-6">
              <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 class="text-lg font-bold text-gray-900">
                  <i class="fas fa-user-check text-animato-primary mr-2"></i>
                  Handmatig aanwezigheid registreren
                </h2>
                <div class="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    id="member-search"
                    placeholder="Zoek lid..."
                    class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-animato-primary"
                  />
                  <form id="bulk-all-present-form" method="POST" action="/api/admin/attendance/bulk" style="display:inline"
                        onsubmit="return confirm('Alle actieve leden als aanwezig markeren?');">
                    <input type="hidden" name="event_id" value={String(event.id)} />
                    <input type="hidden" name="action" value="all_present" />
                    <input type="hidden" name="count_for_streak" id="bulk-cfs-1" value={event.type === 'repetitie' ? '1' : '0'} />
                    <button type="submit" class="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                      <i class="fas fa-check-double mr-1"></i> Allen aanwezig
                    </button>
                  </form>
                  <form method="POST" action="/api/admin/attendance/bulk" style="display:inline"
                        onsubmit="return confirm('Alle aanwezigheden voor deze repetitie wissen?');">
                    <input type="hidden" name="event_id" value={String(event.id)} />
                    <input type="hidden" name="action" value="clear_all" />
                    <button type="submit" class="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                      <i class="fas fa-eraser mr-1"></i> Wissen
                    </button>
                  </form>
                </div>
              </div>

              {/* Streak-toggle: bepaalt of admin-correcties (toggle + bulk 'allen aanwezig') wel/niet meetellen voor de streak */}
              <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                <label class="inline-flex items-center cursor-pointer mt-0.5">
                  <input type="checkbox" id="count-for-streak-toggle" class="sr-only peer" defaultChecked={event.type === 'repetitie'} />
                  <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
                <div class="flex-1">
                  <div class="text-sm font-semibold text-amber-900">
                    <i class="fas fa-fire mr-1"></i>
                    Streak mee laten tellen
                    <span id="cfs-state-label" class="ml-2 text-xs font-normal text-gray-600">
                      {event.type === 'repetitie'
                        ? '(aan — wijzigingen tellen WEL mee voor streak)'
                        : '(uit — wijzigingen tellen NIET mee)'}
                    </span>
                  </div>
                  <p class="text-xs text-amber-800 mt-1">
                    <strong>Aan</strong>: een handmatige check-in geldt alsof het lid zelf de QR scande, en telt mee voor de streak/badges. Gebruik dit bij correcties (bv. lid was er wél maar vergat te scannen).<br />
                    <strong>Uit</strong>: registratie blijft als 'admin'-correctie, telt niet mee — voorkomt dat streaks "gratis" doortikken.
                    {event.type === 'repetitie' ? (
                      <span> <em>Default voor repetities = aan</em> (admin corrigeert meestal écht aanwezige leden).</span>
                    ) : (
                      <span> <em>Default voor dit type event = uit.</em></span>
                    )}
                  </p>
                </div>
              </div>

              <p class="text-xs text-gray-500 mb-4">
                <i class="fas fa-info-circle mr-1"></i>
                Klik op een lid om de aanwezigheid om te schakelen. Wijzigingen worden direct opgeslagen.
              </p>

              <div id="members-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {allMembersWithState.map((m: any) => {
                  const stemLabel = m.stemgroep === 'S' ? 'Sopraan' : m.stemgroep === 'A' ? 'Alt' : m.stemgroep === 'T' ? 'Tenor' : m.stemgroep === 'B' ? 'Bas' : (m.stemgroep || '-')
                  const fullName = `${m.voornaam || ''} ${m.achternaam || ''}`.trim()
                  const timeStr = m.checked_in_at ? new Date(m.checked_in_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : ''
                  // Source badge: qr = blauw (telt voor streak), admin = paars (handmatig)
                  const isQr = m.source === 'qr'
                  const isAdminReg = m.source === 'admin'
                  return (
                    <button
                      type="button"
                      class={`attendance-toggle flex items-center justify-between p-3 rounded-lg border-2 transition text-left ${m.is_present ? (isQr ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-purple-400 bg-purple-50 hover:bg-purple-100') : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                      data-event-id={String(event.id)}
                      data-user-id={String(m.id)}
                      data-stem={m.stemgroep || ''}
                      data-name={fullName.toLowerCase()}
                      data-state={m.is_present ? 'present' : 'absent'}
                      data-source={m.source || ''}
                    >
                      <div class="flex items-center gap-3 min-w-0">
                        <div class={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm ${m.is_present ? (isQr ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white') : 'bg-gray-200 text-gray-400'}`} title={isQr ? 'Zelf ingescand via QR' : isAdminReg ? 'Door admin geregistreerd' : ''}>
                          <i class={isQr ? 'fas fa-qrcode' : isAdminReg ? 'fas fa-user-shield' : 'fas fa-user'}></i>
                        </div>
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-gray-900 truncate">{fullName || m.email}</div>
                          <div class="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                            <span>{stemLabel}</span>
                            {timeStr && (
                              <span class={isQr ? 'text-blue-600' : isAdminReg ? 'text-purple-600' : 'text-green-600'}>
                                <i class="far fa-clock mr-0.5"></i>{timeStr}
                              </span>
                            )}
                            {isQr && <span class="text-[10px] font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">QR 🔥</span>}
                            {isAdminReg && <span class="text-[10px] font-semibold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">admin</span>}
                          </div>
                        </div>
                      </div>
                      <span class={`attendance-badge text-xs px-2 py-1 rounded-full font-medium ml-2 flex-shrink-0 ${m.is_present ? (isQr ? 'bg-blue-200 text-blue-900' : 'bg-purple-200 text-purple-900') : 'bg-gray-100 text-gray-500'}`}>
                        {m.is_present ? 'Aanwezig' : 'Afwezig'}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p id="no-results" class="text-sm text-gray-400 italic text-center py-6 hidden">Geen leden gevonden.</p>
            </div>

          </div>
        </main>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const grid = document.getElementById('members-grid');
          const search = document.getElementById('member-search');
          const noResults = document.getElementById('no-results');
          const totalPresentEl = document.getElementById('total-present');
          const totalPctEl = document.getElementById('total-pct');
          const totalMembers = ${allMembersWithState.length};

          // Streak-toggle: synchroniseer met hidden input van bulk-form + label
          const cfsToggle = document.getElementById('count-for-streak-toggle');
          const cfsLabel = document.getElementById('cfs-state-label');
          const bulkCfsInput = document.getElementById('bulk-cfs-1');
          if (cfsToggle) {
            cfsToggle.addEventListener('change', function() {
              const on = cfsToggle.checked;
              if (bulkCfsInput) bulkCfsInput.value = on ? '1' : '0';
              if (cfsLabel) cfsLabel.textContent = on
                ? '(aan — wijzigingen tellen WEL mee voor streak)'
                : '(uit — wijzigingen tellen NIET mee)';
            });
          }

          // Toggle attendance on click
          grid.addEventListener('click', async function(e) {
            const btn = e.target.closest('.attendance-toggle');
            if (!btn) return;
            const eventId = btn.dataset.eventId;
            const userId = btn.dataset.userId;
            const currentState = btn.dataset.state;
            const wantState = currentState === 'present' ? 'absent' : 'present';

            btn.disabled = true;
            btn.style.opacity = '0.6';

            try {
              const fd = new FormData();
              fd.append('event_id', eventId);
              fd.append('user_id', userId);
              fd.append('action', wantState);
              // Streak-toggle status meegeven
              const cfsToggle = document.getElementById('count-for-streak-toggle');
              const countForStreak = cfsToggle && cfsToggle.checked;
              fd.append('count_for_streak', countForStreak ? '1' : '0');
              const res = await fetch('/api/admin/attendance/toggle', { method: 'POST', body: fd });
              const data = await res.json();

              if (data.success) {
                btn.dataset.state = data.state;
                btn.dataset.source = data.state === 'present' ? (data.source || 'admin') : '';
                const badge = btn.querySelector('.attendance-badge');
                const avatar = btn.querySelector('.w-8.h-8');
                const avatarIcon = avatar.querySelector('i');

                // Verwijder evt. bestaande source-pil (QR/admin) uit de subtitel
                const subtitle = btn.querySelector('.text-xs.text-gray-500');
                if (subtitle) {
                  const pills = subtitle.querySelectorAll('span.text-\\\\[10px\\\\]');
                  pills.forEach(p => p.remove());
                }

                if (data.state === 'present') {
                  const isQrSource = data.source === 'qr';
                  if (isQrSource) {
                    // Lid telt mee voor streak — blauwe stijl (zoals zelf-scan)
                    btn.classList.remove('border-gray-200','bg-white','hover:bg-gray-50','border-purple-400','bg-purple-50','hover:bg-purple-100');
                    btn.classList.add('border-blue-400','bg-blue-50','hover:bg-blue-100');
                    badge.className = 'attendance-badge text-xs px-2 py-1 rounded-full font-medium ml-2 flex-shrink-0 bg-blue-200 text-blue-900';
                    badge.textContent = 'Aanwezig';
                    avatar.className = 'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm bg-blue-500 text-white';
                    avatar.title = 'Door admin gemarkeerd — telt mee voor streak';
                    avatarIcon.className = 'fas fa-qrcode';
                    if (subtitle) {
                      const pill = document.createElement('span');
                      pill.className = 'text-[10px] font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded';
                      pill.textContent = 'streak ✓';
                      pill.title = 'Door admin gemarkeerd, telt mee voor streak';
                      subtitle.appendChild(pill);
                    }
                  } else {
                    // Admin-correctie zonder streak — paarse stijl
                    btn.classList.remove('border-gray-200','bg-white','hover:bg-gray-50','border-blue-400','bg-blue-50','hover:bg-blue-100');
                    btn.classList.add('border-purple-400','bg-purple-50','hover:bg-purple-100');
                    badge.className = 'attendance-badge text-xs px-2 py-1 rounded-full font-medium ml-2 flex-shrink-0 bg-purple-200 text-purple-900';
                    badge.textContent = 'Aanwezig';
                    avatar.className = 'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm bg-purple-500 text-white';
                    avatar.title = 'Door admin geregistreerd — telt NIET mee voor streak';
                    avatarIcon.className = 'fas fa-user-shield';
                    if (subtitle) {
                      const pill = document.createElement('span');
                      pill.className = 'text-[10px] font-semibold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded';
                      pill.textContent = 'admin';
                      subtitle.appendChild(pill);
                    }
                  }
                } else {
                  btn.classList.add('border-gray-200','bg-white','hover:bg-gray-50');
                  btn.classList.remove('border-blue-400','bg-blue-50','hover:bg-blue-100','border-purple-400','bg-purple-50','hover:bg-purple-100');
                  badge.className = 'attendance-badge text-xs px-2 py-1 rounded-full font-medium ml-2 flex-shrink-0 bg-gray-100 text-gray-500';
                  badge.textContent = 'Afwezig';
                  avatar.className = 'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm bg-gray-200 text-gray-400';
                  avatar.title = '';
                  avatarIcon.className = 'fas fa-user';
                }
                updateCounts();
              } else {
                alert('Fout: ' + (data.error || 'onbekend'));
              }
            } catch (err) {
              alert('Netwerkfout: ' + err.message);
            } finally {
              btn.disabled = false;
              btn.style.opacity = '1';
            }
          });

          function updateCounts() {
            const buttons = grid.querySelectorAll('.attendance-toggle');
            const stemPresent = { S: 0, A: 0, T: 0, B: 0 };
            const stemTotal = { S: 0, A: 0, T: 0, B: 0 };
            let totalPresent = 0;
            buttons.forEach(b => {
              const sg = b.dataset.stem || 'Geen';
              if (stemTotal[sg] !== undefined) stemTotal[sg]++;
              if (b.dataset.state === 'present') {
                totalPresent++;
                if (stemPresent[sg] !== undefined) stemPresent[sg]++;
              }
            });
            totalPresentEl.textContent = totalPresent;
            totalPctEl.textContent = totalMembers > 0 ? Math.round((totalPresent/totalMembers)*100) : 0;
            ['S','A','T','B'].forEach(sg => {
              const el = document.querySelector('[data-stem-present="'+sg+'"]');
              const pctEl = document.querySelector('[data-stem-pct="'+sg+'"]');
              if (el) el.textContent = stemPresent[sg];
              if (pctEl) pctEl.textContent = stemTotal[sg] > 0 ? Math.round((stemPresent[sg]/stemTotal[sg])*100) : 0;
            });
          }

          // Live search filter (client-side)
          search.addEventListener('input', function() {
            const q = search.value.toLowerCase().trim();
            const buttons = grid.querySelectorAll('.attendance-toggle');
            let visible = 0;
            buttons.forEach(b => {
              const match = !q || (b.dataset.name || '').indexOf(q) !== -1;
              b.style.display = match ? '' : 'none';
              if (match) visible++;
            });
            noResults.classList.toggle('hidden', visible > 0);
          });
        })();
      ` }}></script>
    </Layout>
  )
})

// =====================================================
// ADMIN: Repetities overzicht (voorbij + komend) met snelle aanwezigheid
// =====================================================
app.get('/admin/attendance/repetities', async (c) => {
  const user = c.get('user') as SessionUser
  const filter = c.req.query('filter') || 'past' // all | past | upcoming (default: past)
  const search = (c.req.query('search') || '').trim()
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)

  // Build WHERE clause
  let where = "e.type = 'repetitie'"
  const params: any[] = []
  if (filter === 'past') where += " AND datetime(e.start_at) < datetime('now')"
  else if (filter === 'upcoming') where += " AND datetime(e.start_at) >= datetime('now', '-1 day')"
  if (search) {
    where += ` AND (e.titel LIKE ? OR e.locatie LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }

  // OPTIMIZED: parallel queries + LIMIT
  const [rehearsals, memberCountRow, globalStats] = await Promise.all([
    queryAll<any>(c.env.DB,
      `SELECT e.id, e.titel, e.start_at, e.locatie,
              COUNT(DISTINCT qc.user_id) as checkin_count,
              MAX(CASE WHEN qt.token IS NOT NULL THEN 1 ELSE 0 END) as has_qr
       FROM events e
       LEFT JOIN qr_checkins qc ON qc.event_id = e.id
       LEFT JOIN qr_tokens qt ON qt.event_id = e.id
       WHERE ${where}
       GROUP BY e.id
       ORDER BY e.start_at DESC
       LIMIT ?`,
      [...params, limit]
    ),
    queryOne<any>(c.env.DB,
      `SELECT COUNT(*) as count FROM users WHERE status = 'actief' AND role NOT IN ('bezoeker') AND is_test_account = 0`
    ),
    queryOne<any>(c.env.DB,
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN datetime(start_at) < datetime('now') THEN 1 ELSE 0 END) as past_count,
         SUM(CASE WHEN datetime(start_at) >= datetime('now') THEN 1 ELSE 0 END) as upcoming_count
       FROM events WHERE type = 'repetitie'`
    )
  ])
  const totalMembers = memberCountRow?.count || 0

  // Stats
  const now = new Date()
  const past = rehearsals.filter((r: any) => new Date(r.start_at) < now)
  const upcoming = rehearsals.filter((r: any) => new Date(r.start_at) >= now)
  const avgAttendance = past.length > 0
    ? Math.round(past.reduce((sum: number, r: any) => sum + (r.checkin_count || 0), 0) / past.length)
    : 0
  const totalCount = globalStats?.total ?? rehearsals.length
  const pastCount = globalStats?.past_count ?? past.length
  const upcomingCount = globalStats?.upcoming_count ?? upcoming.length

  return c.html(
    <Layout title="Repetitie Overzicht" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-8">
          <div class="max-w-6xl mx-auto">
            {/* Header */}
            <div class="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div>
                <a href="/admin/attendance" class="inline-flex items-center text-animato-primary hover:text-animato-secondary text-sm mb-2">
                  <i class="fas fa-arrow-left mr-1"></i> Terug naar aanwezigheid
                </a>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-calendar-check text-animato-primary mr-3"></i>
                  Repetities Overzicht
                </h1>
                <p class="mt-1 text-gray-600">Alle voorbije en komende repetities met aanwezigheid.</p>
              </div>
            </div>

            {/* Stats */}
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase">Totaal</div>
                <div class="text-2xl font-bold text-gray-900">{totalCount}</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase">Voorbij</div>
                <div class="text-2xl font-bold text-gray-700">{pastCount}</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase">Komend</div>
                <div class="text-2xl font-bold text-blue-600">{upcomingCount}</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase">Gem. aanwezig</div>
                <div class="text-2xl font-bold text-green-600">{avgAttendance}/{totalMembers}</div>
                <div class="text-xs text-gray-400 mt-1">van {past.length} voorbije repetities getoond</div>
              </div>
            </div>

            {/* Filters */}
            <form method="GET" action="/admin/attendance/repetities" class="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div class="flex-1 min-w-[200px]">
                <label class="block text-xs font-medium text-gray-700 mb-1">Zoeken</label>
                <input
                  type="text"
                  name="search"
                  value={search}
                  placeholder="Titel of locatie..."
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-animato-primary"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Periode</label>
                <select name="filter" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="all" selected={filter === 'all'}>Alle</option>
                  <option value="upcoming" selected={filter === 'upcoming'}>Komend</option>
                  <option value="past" selected={filter === 'past'}>Voorbij</option>
                </select>
              </div>
              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg text-sm font-medium hover:bg-animato-secondary">
                <i class="fas fa-filter mr-1"></i> Filter
              </button>
              <a href="/admin/attendance/repetities?filter=past" class="px-4 py-2 text-gray-600 text-sm hover:underline">Reset</a>
            </form>

            {/* Table */}
            <div class="bg-white rounded-xl shadow-md overflow-hidden">
              {rehearsals.length === 0 ? (
                <p class="text-gray-500 italic text-center py-12">Geen repetities gevonden.</p>
              ) : (
                <div class="overflow-x-auto">
                  <table class="w-full">
                    <thead class="bg-gray-50 border-b">
                      <tr class="text-xs text-gray-500 uppercase">
                        <th class="px-4 py-3 text-left">Datum</th>
                        <th class="px-4 py-3 text-left">Titel</th>
                        <th class="px-4 py-3 text-left">Locatie</th>
                        <th class="px-4 py-3 text-center">Aanwezig</th>
                        <th class="px-4 py-3 text-center">%</th>
                        <th class="px-4 py-3 text-center">QR</th>
                        <th class="px-4 py-3 text-right">Actie</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y">
                      {rehearsals.map((r: any) => {
                        const eventDate = new Date(r.start_at)
                        const isPast = eventDate < now
                        const isToday = eventDate.toDateString() === now.toDateString()
                        const dayName = eventDate.toLocaleDateString('nl-BE', { weekday: 'short' })
                        const dateStr = eventDate.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
                        const timeStr = eventDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
                        const pct = totalMembers > 0 ? Math.round(((r.checkin_count || 0) / totalMembers) * 100) : 0
                        return (
                          <tr class={`hover:bg-gray-50 transition ${isToday ? 'bg-yellow-50' : ''}`}>
                            <td class="px-4 py-3 text-sm">
                              <div class="font-medium text-gray-900 capitalize">{dayName} {dateStr}</div>
                              <div class="text-xs text-gray-500">{timeStr}</div>
                              {isToday && <span class="inline-block mt-1 px-2 py-0.5 bg-yellow-200 text-yellow-900 text-xs font-bold rounded">VANDAAG</span>}
                              {!isPast && !isToday && <span class="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">Komend</span>}
                            </td>
                            <td class="px-4 py-3 text-sm font-medium text-gray-900">{r.titel}</td>
                            <td class="px-4 py-3 text-sm text-gray-600">{r.locatie || '-'}</td>
                            <td class="px-4 py-3 text-center">
                              <span class={`px-3 py-1 rounded-full text-sm font-bold ${(r.checkin_count || 0) > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                                {r.checkin_count || 0}/{totalMembers}
                              </span>
                            </td>
                            <td class="px-4 py-3 text-center text-sm text-gray-600">{pct}%</td>
                            <td class="px-4 py-3 text-center">
                              {r.has_qr ? (
                                <i class="fas fa-check-circle text-green-500" title="QR actief"></i>
                              ) : (
                                <i class="fas fa-times-circle text-gray-300" title="Geen QR"></i>
                              )}
                            </td>
                            <td class="px-4 py-3 text-right">
                              <a href={`/admin/attendance/event/${r.id}`} class="inline-flex items-center px-3 py-1.5 bg-animato-primary text-white rounded-lg text-xs font-medium hover:bg-animato-secondary">
                                <i class="fas fa-user-check mr-1"></i> Aanwezigheid
                              </a>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p class="mt-4 text-xs text-gray-500">
              <i class="fas fa-info-circle mr-1"></i>
              Tip: klik op <strong>"Aanwezigheid"</strong> om handmatig leden aan- of af te vinken. Ideaal als QR-scannen niet lukt.
            </p>
          </div>
        </main>
      </div>
    </Layout>
  )
})

// =====================================================
// API: Toggle attendance for a single user (manual check-in)
// =====================================================
app.post('/api/admin/attendance/toggle', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const eventId = parseInt(body.event_id as string)
  const userId = parseInt(body.user_id as string)
  const action = String(body.action || 'toggle') // 'present' | 'absent' | 'toggle'
  // Nieuw: admin kiest of deze handmatige check-in voor de streak telt.
  // Default = false (veilige optie: blijft 'admin'-source, telt niet mee).
  // true → 'qr'-source, alsof het lid zelf scande, telt wel mee voor streak.
  const countForStreak = body.count_for_streak === '1' || body.count_for_streak === 'true'
  const sourceTag: 'qr' | 'admin' = countForStreak ? 'qr' : 'admin'

  if (!eventId || !userId) {
    return c.json({ success: false, error: 'invalid_params' }, 400)
  }

  // Verify event is a repetitie
  const event = await queryOne<any>(c.env.DB, `SELECT id, type FROM events WHERE id = ?`, [eventId])
  if (!event || event.type !== 'repetitie') {
    return c.json({ success: false, error: 'not_a_rehearsal' }, 400)
  }

  // Check current state
  const existing = await queryOne<any>(c.env.DB,
    `SELECT id, source FROM qr_checkins WHERE event_id = ? AND user_id = ?`,
    [eventId, userId]
  )

  let newState: 'present' | 'absent'
  if (action === 'present' || (action === 'toggle' && !existing)) {
    if (!existing) {
      await execute(c.env.DB,
        `INSERT INTO qr_checkins (event_id, user_id, checked_in_at, source) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
        [eventId, userId, sourceTag]
      )
    } else if (existing.source !== sourceTag) {
      // Bestaat al — admin upgrade/downgrade van source (bv. omzetten naar 'qr' om streak te laten meetellen)
      await execute(c.env.DB,
        `UPDATE qr_checkins SET source = ? WHERE event_id = ? AND user_id = ?`,
        [sourceTag, eventId, userId]
      )
    }
    newState = 'present'
  } else {
    if (existing) {
      await execute(c.env.DB,
        `DELETE FROM qr_checkins WHERE event_id = ? AND user_id = ?`,
        [eventId, userId]
      )
    }
    newState = 'absent'
  }

  // Audit log
  try {
    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, ?, ?, ?, ?)`,
      [user.id, `attendance_${newState}`, 'qr_checkins', eventId,
       JSON.stringify({ target_user_id: userId, by_admin: true, source: sourceTag, count_for_streak: countForStreak })]
    )
  } catch (e) { /* audit_logs optional */ }

  return c.json({ success: true, state: newState, source: sourceTag, count_for_streak: countForStreak, event_id: eventId, user_id: userId })
})

// =====================================================
// API: Bulk mark all present / absent (clear)
// =====================================================
app.post('/api/admin/attendance/bulk', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const eventId = parseInt(body.event_id as string)
  const action = String(body.action || '') // 'all_present' | 'clear_all'
  const countForStreak = body.count_for_streak === '1' || body.count_for_streak === 'true'
  const sourceTag: 'qr' | 'admin' = countForStreak ? 'qr' : 'admin'

  if (!eventId) return c.redirect('/admin/attendance?error=invalid_event')

  const event = await queryOne<any>(c.env.DB, `SELECT id, type FROM events WHERE id = ?`, [eventId])
  if (!event || event.type !== 'repetitie') {
    return c.redirect(`/admin/attendance/event/${eventId}?error=not_a_rehearsal`)
  }

  if (action === 'clear_all') {
    await execute(c.env.DB, `DELETE FROM qr_checkins WHERE event_id = ?`, [eventId])
  } else if (action === 'all_present') {
    const members = await queryAll<any>(c.env.DB,
      `SELECT id FROM users WHERE status = 'actief' AND role NOT IN ('bezoeker') AND is_test_account = 0`
    )
    for (const m of members) {
      try {
        await execute(c.env.DB,
          `INSERT OR IGNORE INTO qr_checkins (event_id, user_id, source) VALUES (?, ?, ?)`,
          [eventId, m.id, sourceTag]
        )
      } catch (e) { /* ignore */ }
    }
  }

  try {
    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, ?, ?, ?, ?)`,
      [user.id, `attendance_bulk_${action}`, 'qr_checkins', eventId,
       JSON.stringify({ by_admin: true, source: sourceTag, count_for_streak: countForStreak })]
    )
  } catch (e) { /* ignore */ }

  return c.redirect(`/admin/attendance/event/${eventId}?success=bulk_${action}`)
})

// =====================================================
// API: Generate QR for event
// =====================================================
app.post('/api/admin/attendance/generate-qr', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const eventId = parseInt(body.event_id as string)

  if (!eventId) return c.redirect('/admin/attendance?error=invalid_event')

  // Check event exists and is a repetitie
  const event = await queryOne<any>(c.env.DB, `SELECT id, type, start_at FROM events WHERE id = ?`, [eventId])
  if (!event) return c.redirect('/admin/attendance?error=not_found')

  // Check if token already exists
  const existing = await queryOne<any>(c.env.DB, `SELECT id FROM qr_tokens WHERE event_id = ?`, [eventId])
  if (existing) return c.redirect(`/admin/attendance/qr/${eventId}`)

  // Generate unique token
  const token = generateQRToken()
  await execute(c.env.DB,
    `INSERT INTO qr_tokens (event_id, token, created_by) VALUES (?, ?, ?)`,
    [eventId, token, user.id]
  )

  return c.redirect(`/admin/attendance/qr/${eventId}`)
})

export default app
