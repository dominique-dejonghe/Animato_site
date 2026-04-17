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
  const checkins = await queryAll<any>(db,
    `SELECT qc.event_id, e.start_at 
     FROM qr_checkins qc
     JOIN events e ON e.id = qc.event_id
     WHERE qc.user_id = ? AND e.type = 'repetitie'
     ORDER BY e.start_at DESC`,
    [userId]
  )

  if (checkins.length === 0) return { current: 0, longest: 0, total: 0 }

  // Get all repetitie events (to know which weeks had a rehearsal)
  const allRehearsals = await queryAll<any>(db,
    `SELECT id, start_at FROM events 
     WHERE type = 'repetitie' AND start_at <= datetime('now')
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
     WHERE e.type = 'repetitie' AND e.start_at >= datetime('now', '-1 day') AND qt.id IS NULL
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
     WHERE e.type = 'repetitie' AND e.start_at >= datetime('now', '-1 day')
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
     WHERE e.type = 'repetitie' AND e.start_at < datetime('now')
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

  // Calculate streaks for all active users
  const topUsers = []
  for (const au of activeUsers) {
    if (au.total_checkins > 0) {
      const streak = await calculateStreak(c.env.DB, au.id)
      topUsers.push({ ...au, streak })
    } else {
      topUsers.push({ ...au, streak: { current: 0, longest: 0, total: 0 } })
    }
  }
  topUsers.sort((a, b) => b.streak.current - a.streak.current || b.streak.total - a.streak.total)

  const siteUrl = c.env.SITE_URL || 'https://animato-live.pages.dev'

  return c.html(
    <Layout title="Aanwezigheid" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" />
        <main class="flex-1 p-8">
          <div class="max-w-6xl mx-auto">
            {/* Header */}
            <div class="flex items-center justify-between mb-8">
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
                              >
                                <i class="fas fa-list mr-1"></i> Lijst
                              </a>
                            </>
                          ) : (
                            <form action={`/api/admin/attendance/generate-qr`} method="POST" class="flex-1">
                              <input type="hidden" name="event_id" value={String(r.id)} />
                              <button 
                                type="submit"
                                class="w-full px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm font-medium"
                              >
                                <i class="fas fa-qrcode mr-1"></i> Genereer QR Code
                              </button>
                            </form>
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
        <AdminSidebar activeSection="attendance" />
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

  // All checkins for this event
  const checkins = await queryAll<any>(c.env.DB,
    `SELECT qc.checked_in_at, u.id as user_id, u.stemgroep, u.email,
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

  return c.html(
    <Layout title="Aanwezigheidsdetail" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="attendance" />
        <main class="flex-1 p-8">
          <div class="max-w-5xl mx-auto">
            <a href="/admin/attendance" class="inline-flex items-center text-animato-primary hover:text-animato-secondary mb-6">
              <i class="fas fa-arrow-left mr-2"></i> Terug
            </a>

            <h1 class="text-2xl font-bold text-gray-900 mb-1">{event.titel}</h1>
            <p class="text-gray-600 mb-6">{dateStr}</p>

            {/* Stats per stemgroep */}
            <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {Object.entries(stemCounts).map(([sg, counts]) => {
                const label = sg === 'S' ? 'Sopraan' : sg === 'A' ? 'Alt' : sg === 'T' ? 'Tenor' : sg === 'B' ? 'Bas' : sg
                const pct = counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0
                return (
                  <div class="bg-white rounded-lg shadow p-4 text-center">
                    <div class="text-xs text-gray-500 font-medium uppercase">{label}</div>
                    <div class="text-2xl font-bold text-animato-primary mt-1">{counts.present}/{counts.total}</div>
                    <div class="text-xs text-gray-400">{pct}%</div>
                  </div>
                )
              })}
              <div class="bg-animato-primary text-white rounded-lg shadow p-4 text-center">
                <div class="text-xs font-medium uppercase opacity-80">Totaal</div>
                <div class="text-2xl font-bold mt-1">{checkins.length}/{allMembers.length}</div>
                <div class="text-xs opacity-70">{allMembers.length > 0 ? Math.round((checkins.length / allMembers.length) * 100) : 0}%</div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Present */}
              <div class="bg-white rounded-xl shadow-md p-6">
                <h2 class="font-bold text-gray-900 mb-4">
                  <i class="fas fa-check-circle text-green-500 mr-2"></i>
                  Aanwezig ({checkins.length})
                </h2>
                <div class="space-y-2 max-h-96 overflow-y-auto">
                  {checkins.map((ci: any) => (
                    <div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span class="font-medium text-gray-900 text-sm">{ci.voornaam} {ci.achternaam}</span>
                      <div class="flex items-center gap-2">
                        <span class="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">
                          {ci.stemgroep || '-'}
                        </span>
                        <span class="text-xs text-gray-400">
                          {new Date(ci.checked_in_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Absent */}
              <div class="bg-white rounded-xl shadow-md p-6">
                <h2 class="font-bold text-gray-900 mb-4">
                  <i class="fas fa-times-circle text-red-400 mr-2"></i>
                  Afwezig ({absentMembers.length})
                </h2>
                <div class="space-y-2 max-h-96 overflow-y-auto">
                  {absentMembers.map((m: any) => (
                    <div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span class="text-sm text-gray-600">{m.voornaam} {m.achternaam}</span>
                      <span class="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">
                        {m.stemgroep || '-'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </Layout>
  )
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
