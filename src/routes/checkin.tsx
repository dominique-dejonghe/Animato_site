// QR Check-in route - Leden scannen QR code om aanwezigheid te registreren
// Publieke scan-URL + streak weergave + leaderboard

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono<{ Bindings: Bindings }>()

// Default cartoon avatars per stemgroep (famous singers!)
function getDefaultAvatar(stemgroep: string): string {
  switch (stemgroep) {
    case 'S': return '/static/avatars/sopraan-callas.png'
    case 'A': return '/static/avatars/alt-bartoli.png'
    case 'T': return '/static/avatars/tenor-pavarotti.png'
    case 'B': return '/static/avatars/bas-terfel.png'
    default:  return '/static/avatars/tenor-pavarotti.png'
  }
}

// =====================================================
// HELPER: Calculate streaks for a user
// =====================================================
async function calculateStreak(db: D1Database, userId: number): Promise<{ current: number; longest: number; total: number }> {
  const checkins = await queryAll<any>(db,
    `SELECT qc.event_id, e.start_at 
     FROM qr_checkins qc
     JOIN events e ON e.id = qc.event_id
     WHERE qc.user_id = ? AND e.type = 'repetitie'
     ORDER BY e.start_at DESC`,
    [userId]
  )

  if (checkins.length === 0) return { current: 0, longest: 0, total: 0 }

  const allRehearsals = await queryAll<any>(db,
    `SELECT id, start_at FROM events 
     WHERE type = 'repetitie' AND start_at <= datetime('now')
     ORDER BY start_at DESC`
  )

  if (allRehearsals.length === 0) return { current: 0, longest: 0, total: checkins.length }

  const checkedInEventIds = new Set(checkins.map((c: any) => c.event_id))

  let currentStreak = 0
  for (const rehearsal of allRehearsals) {
    if (checkedInEventIds.has(rehearsal.id)) {
      currentStreak++
    } else {
      break
    }
  }

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

function getStreakBadge(streak: number): { name: string; icon: string; color: string; bg: string } | null {
  if (streak >= 52) return { name: 'Gouden Noot', icon: '🏆', color: 'text-yellow-600', bg: 'bg-yellow-100' }
  if (streak >= 25) return { name: 'Zilveren Noot', icon: '🥈', color: 'text-gray-600', bg: 'bg-gray-100' }
  if (streak >= 10) return { name: 'Bronzen Noot', icon: '🥉', color: 'text-amber-700', bg: 'bg-amber-100' }
  if (streak >= 5) return { name: 'Trouw Lid', icon: '⭐', color: 'text-blue-600', bg: 'bg-blue-100' }
  return null
}

// =====================================================
// CHECK-IN PAGE: /checkin/:token
// =====================================================
app.get('/checkin/:token', async (c) => {
  const token = c.req.param('token')
  
  // Verify QR token exists
  const qrToken = await queryOne<any>(c.env.DB,
    `SELECT qt.*, e.titel, e.start_at, e.locatie 
     FROM qr_tokens qt 
     JOIN events e ON e.id = qt.event_id 
     WHERE qt.token = ?`,
    [token]
  )

  if (!qrToken) {
    return c.html(
      <Layout title="Ongeldige QR" user={null}>
        <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
            <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <i class="fas fa-times text-red-500 text-4xl"></i>
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-3">Ongeldige QR Code</h1>
            <p class="text-gray-600 mb-6">Deze QR code is niet geldig of verlopen.</p>
            <a href="/login" class="inline-flex items-center px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition font-medium">
              <i class="fas fa-sign-in-alt mr-2"></i> Log in
            </a>
          </div>
        </div>
      </Layout>
    )
  }

  // Check if user is logged in
  const authToken = getCookie(c, 'auth_token')
  let user: SessionUser | null = null
  if (authToken) {
    user = await verifyToken(authToken, c.env.JWT_SECRET)
  }

  const eventDate = new Date(qrToken.start_at)
  const dateStr = eventDate.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = eventDate.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

  // Not logged in - redirect to login with return URL
  if (!user) {
    return c.html(
      <Layout title="Check-in" user={null}>
        <div class="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
          <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
            <div class="w-20 h-20 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-6">
              <i class="fas fa-qrcode text-animato-primary text-4xl"></i>
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-2" style="font-family: 'Playfair Display', serif;">
              Repetitie Check-in
            </h1>
            <p class="text-lg text-gray-700 font-medium mb-1">{qrToken.titel}</p>
            <p class="text-gray-500 mb-6">{dateStr} • {timeStr}</p>
            
            <p class="text-gray-600 mb-6">Log eerst in om je aanwezigheid te registreren.</p>
            
            <a 
              href={`/login?redirect=/checkin/${token}`}
              class="block w-full px-6 py-4 bg-animato-primary text-white rounded-xl hover:bg-animato-secondary transition font-bold text-lg"
            >
              <i class="fas fa-sign-in-alt mr-2"></i> Inloggen & Check-in
            </a>
          </div>
        </div>
      </Layout>
    )
  }

  // User is logged in - process check-in
  const existingCheckin = await queryOne<any>(c.env.DB,
    `SELECT id FROM qr_checkins WHERE event_id = ? AND user_id = ?`,
    [qrToken.event_id, user.id]
  )

  let isNewCheckin = false
  if (!existingCheckin) {
    try {
      await execute(c.env.DB,
        `INSERT INTO qr_checkins (event_id, user_id) VALUES (?, ?)`,
        [qrToken.event_id, user.id]
      )
      isNewCheckin = true
    } catch (e) {
      // Unique constraint - already checked in
    }
  }

  // Get user's streak
  const streak = await calculateStreak(c.env.DB, user.id)
  const badge = getStreakBadge(streak.current)

  // Get user profile
  const profile = await queryOne<any>(c.env.DB,
    `SELECT voornaam, achternaam FROM profiles WHERE user_id = ?`,
    [user.id]
  )

  // Get today's total checkins
  const totalCheckins = await queryOne<any>(c.env.DB,
    `SELECT COUNT(*) as count FROM qr_checkins WHERE event_id = ?`,
    [qrToken.event_id]
  )

  // Streak animation class
  const streakLevel = streak.current >= 25 ? 'legendary' : streak.current >= 10 ? 'epic' : streak.current >= 5 ? 'great' : 'normal'

  return c.html(
    <Layout title="Ingecheckt!" user={user}>
      <div class="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          
          {/* Success Animation */}
          <div class="checkin-success mb-6">
            <div class="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto animate-bounce-slow">
              <i class="fas fa-check-circle text-green-500 text-5xl"></i>
            </div>
          </div>

          <h1 class="text-2xl font-bold text-gray-900 mb-1" style="font-family: 'Playfair Display', serif;">
            {isNewCheckin ? '✅ Ingecheckt!' : '👋 Welkom terug!'}
          </h1>
          <p class="text-gray-600 mb-6">
            {isNewCheckin 
              ? `Hey ${profile?.voornaam || 'lid'}, je bent geregistreerd!` 
              : `${profile?.voornaam || 'Lid'}, je was al ingecheckt.`
            }
          </p>

          {/* Event Info */}
          <div class="bg-gray-50 rounded-xl p-4 mb-6">
            <div class="text-sm text-gray-500">{dateStr}</div>
            <div class="font-bold text-gray-900">{qrToken.titel}</div>
            <div class="text-sm text-gray-500">{timeStr} • {qrToken.locatie || 'Repetitielokaal'}</div>
            <div class="text-xs text-gray-400 mt-2">
              <i class="fas fa-users mr-1"></i> {totalCheckins?.count || 0} leden ingecheckt
            </div>
          </div>

          {/* Streak Display */}
          <div class={`rounded-xl p-6 mb-6 ${
            streakLevel === 'legendary' ? 'bg-gradient-to-r from-yellow-100 to-orange-100 border-2 border-yellow-300' :
            streakLevel === 'epic' ? 'bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300' :
            streakLevel === 'great' ? 'bg-gradient-to-r from-blue-100 to-cyan-100 border-2 border-blue-300' :
            'bg-gray-50'
          }`}>
            <div class="text-sm text-gray-500 mb-2">Jouw Repetitie Streak</div>
            <div class="text-5xl font-black mb-2">
              🔥 {streak.current}
            </div>
            <div class="text-sm text-gray-600">
              {streak.current === 1 ? 'week op rij' : 'weken op rij'}
            </div>
            
            {badge && (
              <div class={`mt-3 inline-flex items-center gap-2 px-4 py-2 ${badge.bg} rounded-full`}>
                <span class="text-xl">{badge.icon}</span>
                <span class={`font-bold ${badge.color}`}>{badge.name}</span>
              </div>
            )}

            <div class="grid grid-cols-2 gap-4 mt-4 text-center">
              <div>
                <div class="text-xs text-gray-500">Langste Streak</div>
                <div class="text-lg font-bold text-gray-700">{streak.longest}</div>
              </div>
              <div>
                <div class="text-xs text-gray-500">Totaal Aanwezig</div>
                <div class="text-lg font-bold text-gray-700">{streak.total}</div>
              </div>
            </div>
          </div>

          {/* Motivation */}
          {streak.current > 0 && streak.current < 5 && (
            <p class="text-sm text-gray-500 italic mb-4">
              Nog {5 - streak.current} {5 - streak.current === 1 ? 'week' : 'weken'} tot je eerste badge! 💪
            </p>
          )}
          {streak.current >= 5 && streak.current < 10 && (
            <p class="text-sm text-gray-500 italic mb-4">
              Nog {10 - streak.current} weken tot Bronzen Noot! 🥉
            </p>
          )}
          {streak.current >= 10 && streak.current < 25 && (
            <p class="text-sm text-gray-500 italic mb-4">
              Nog {25 - streak.current} weken tot Zilveren Noot! 🥈
            </p>
          )}
          {streak.current >= 25 && streak.current < 52 && (
            <p class="text-sm text-gray-500 italic mb-4">
              Nog {52 - streak.current} weken tot Gouden Noot! 🏆
            </p>
          )}

          {/* Navigation */}
          <div class="flex gap-3">
            <a href="/leden/streaks" class="flex-1 px-4 py-3 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition font-medium text-sm">
              <i class="fas fa-fire mr-1"></i> Leaderboard
            </a>
            <a href="/leden" class="flex-1 px-4 py-3 bg-animato-primary text-white rounded-xl hover:bg-animato-secondary transition font-medium text-sm">
              <i class="fas fa-home mr-1"></i> Portaal
            </a>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 1s ease-in-out 2;
        }
      `}} />
    </Layout>
  )
})

// =====================================================
// MEMBER: Leaderboard / Streaks page
// =====================================================
app.get('/leden/streaks', async (c) => {
  // Auth check
  const authToken = getCookie(c, 'auth_token')
  if (!authToken) return c.redirect('/login?redirect=/leden/streaks')
  const user = await verifyToken(authToken, c.env.JWT_SECRET)
  if (!user) return c.redirect('/login?redirect=/leden/streaks')

  // Get all active members with checkins
  const members = await queryAll<any>(c.env.DB,
    `SELECT u.id, u.stemgroep, p.voornaam, p.achternaam, p.foto_url,
            COUNT(qc.id) as total_checkins
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN qr_checkins qc ON qc.user_id = u.id
     WHERE u.status = 'actief' AND u.role NOT IN ('bezoeker')
     GROUP BY u.id
     ORDER BY total_checkins DESC`
  )

  // Calculate streaks for everyone
  const leaderboard = []
  for (const m of members) {
    const streak = await calculateStreak(c.env.DB, m.id)
    if (streak.total > 0 || m.id === user.id) {
      leaderboard.push({ ...m, streak, isMe: m.id === user.id })
    }
  }
  leaderboard.sort((a, b) => b.streak.current - a.streak.current || b.streak.total - a.streak.total)

  // Get my position
  const myRank = leaderboard.findIndex((m) => m.id === user.id) + 1
  const myData = leaderboard.find((m) => m.id === user.id)

  // Stats per stemgroep
  const stemStats: Record<string, { count: number; totalStreak: number }> = {}
  for (const m of leaderboard) {
    if (m.streak.total > 0) {
      const sg = m.stemgroep || 'Geen'
      if (!stemStats[sg]) stemStats[sg] = { count: 0, totalStreak: 0 }
      stemStats[sg].count++
      stemStats[sg].totalStreak += m.streak.current
    }
  }

  return c.html(
    <Layout 
      title="Streaks & Leaderboard" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Streaks', href: '/leden/streaks' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              🔥 Repetitie Streaks
            </h1>
            <p class="mt-2 text-gray-600">Wie is het meest trouw aanwezig?</p>
          </div>

          {/* How it works - for members */}
          <div class="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-xl p-5 mb-8">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <i class="fas fa-qrcode text-orange-600"></i>
              </div>
              <div>
                <h3 class="font-bold text-gray-900 mb-1">Hoe bouw je een streak op?</h3>
                <p class="text-sm text-gray-600 mb-3">
                  Bij elke repetitie hangt er een QR-poster in het lokaal. Scan de code met je telefoon-camera,
                  log in (eenmalig), en je bent ingecheckt! Elke opeenvolgende week dat je aanwezig bent groeit je streak.
                </p>
                <div class="flex flex-wrap gap-3 text-xs">
                  <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">⭐ 5 weken = Trouw Lid</span>
                  <span class="bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-medium">🥉 10 weken = Bronzen Noot</span>
                  <span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full font-medium">🥈 25 weken = Zilveren Noot</span>
                  <span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full font-medium">🏆 52 weken = Gouden Noot</span>
                </div>
              </div>
            </div>
          </div>

          {/* My Stats Card */}
          {myData && (
            <div class="bg-gradient-to-r from-animato-primary to-animato-secondary rounded-2xl shadow-lg p-6 mb-8 text-white">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm opacity-80">Jouw positie</div>
                  <div class="text-3xl font-black">#{myRank}</div>
                </div>
                <div class="text-center">
                  <div class="text-5xl font-black">🔥 {myData.streak.current}</div>
                  <div class="text-sm opacity-80">{myData.streak.current === 1 ? 'week' : 'weken'} op rij</div>
                </div>
                <div class="text-right">
                  <div class="text-sm opacity-80">Totaal</div>
                  <div class="text-3xl font-black">{myData.streak.total}</div>
                </div>
              </div>
              {(() => {
                const badge = getStreakBadge(myData.streak.current)
                return badge ? (
                  <div class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 rounded-full">
                    <span class="text-xl">{badge.icon}</span>
                    <span class="font-bold">{badge.name}</span>
                  </div>
                ) : null
              })()}
            </div>
          )}

          {/* Stemgroep Scores */}
          {Object.keys(stemStats).length > 0 && (
            <div class="bg-white rounded-xl shadow-md p-6 mb-8">
              <h2 class="text-lg font-bold text-gray-900 mb-4">
                <i class="fas fa-users text-animato-primary mr-2"></i>
                Score per Stemgroep
              </h2>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(stemStats).sort((a, b) => b[1].totalStreak - a[1].totalStreak).map(([sg, stats]) => {
                  const label = sg === 'S' ? 'Sopraan' : sg === 'A' ? 'Alt' : sg === 'T' ? 'Tenor' : sg === 'B' ? 'Bas' : sg
                  const avgStreak = stats.count > 0 ? (stats.totalStreak / stats.count).toFixed(1) : '0'
                  return (
                    <div class="bg-gray-50 rounded-lg p-4 text-center">
                      <div class="text-sm text-gray-500 font-medium">{label}</div>
                      <div class="text-2xl font-bold text-animato-primary mt-1">🔥 {stats.totalStreak}</div>
                      <div class="text-xs text-gray-400">gem. {avgStreak} per lid</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Full Leaderboard */}
          <div class="bg-white rounded-xl shadow-md p-6">
            <h2 class="text-lg font-bold text-gray-900 mb-4">
              <i class="fas fa-trophy text-yellow-500 mr-2"></i>
              Ranglijst
            </h2>
            
            {leaderboard.length === 0 ? (
              <p class="text-gray-500 italic text-center py-8">Nog geen check-ins. Scan de QR code op de repetitie!</p>
            ) : (
              <div class="space-y-2">
                {leaderboard.filter(m => m.streak.total > 0).map((m: any, idx: number) => {
                  const badge = getStreakBadge(m.streak.current)
                  const stemLabel = m.stemgroep === 'S' ? 'Sop' : m.stemgroep === 'A' ? 'Alt' : m.stemgroep === 'T' ? 'Ten' : m.stemgroep === 'B' ? 'Bas' : '-'
                  return (
                    <div class={`flex items-center gap-4 p-3 rounded-xl transition ${m.isMe ? 'bg-blue-50 border-2 border-blue-300 shadow-sm' : 'hover:bg-gray-50'}`}>
                      {/* Rank */}
                      <div class="w-10 text-center text-lg font-bold text-gray-400 flex-shrink-0">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                      </div>
                      
                      {/* Avatar */}
                      <div class="w-10 h-10 rounded-full bg-animato-primary bg-opacity-10 flex items-center justify-center text-sm font-bold text-animato-primary overflow-hidden flex-shrink-0">
                          <img src={m.foto_url || getDefaultAvatar(m.stemgroep)} class="w-full h-full object-cover" alt="" />
                      </div>

                      {/* Name & Badge */}
                      <div class="flex-1 min-w-0">
                        <div class="font-medium text-gray-900 truncate">
                          {m.voornaam} {m.achternaam}
                          {m.isMe && <span class="ml-2 text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full">jij</span>}
                        </div>
                        <div class="flex items-center gap-2 text-xs text-gray-500">
                          <span>{stemLabel}</span>
                          {badge && (
                            <span class={`${badge.bg} ${badge.color} px-2 py-0.5 rounded-full font-medium`}>
                              {badge.icon} {badge.name}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Streak */}
                      <div class="text-right flex-shrink-0">
                        <div class="text-xl font-black text-orange-600">🔥 {m.streak.current}</div>
                        <div class="text-xs text-gray-400">totaal: {m.streak.total}</div>
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

export default app
