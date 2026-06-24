// Badges-evaluator: bepaalt welke badges een gebruiker zou moeten hebben
// op basis van bestaande activiteit in de database.
//
// Wordt aangeroepen:
//   1. Na elke login (lichte evaluatie, niet-blokkerend)
//   2. Wanneer de gebruiker zijn /leden/badges pagina opent (volle evaluatie)
//   3. Na key-events: poll-vote, profiel-update, voice-test, agenda-response
//
// De evaluator is idempotent: bestaande user_badges worden niet ontdubbeld
// dankzij UNIQUE(user_id, badge_key) + INSERT OR IGNORE.

import type { Bindings } from '../types'
import { queryAll, queryOne } from './db'

export interface BadgeRow {
  badge_key: string
  naam: string
  beschrijving: string
  icon: string
  kleur: string
  categorie: string
  zeldzaamheid: string
  criteria_type: string
  criteria_value: number
  zichtbaar: number
  sort_order: number
}

export interface UserBadgeRow extends BadgeRow {
  earned_at: string | null
  earned: boolean
  progress: number   // 0..criteria_value (huidige stand)
  percent: number    // 0..100
}

interface UserStats {
  login_count: number
  poll_vote_count: number
  agenda_response_count: number
  voice_test_done: number
  has_profile_photo: number
  profile_complete: number
  has_bio: number
  membership_years: number
  birthday_login: number
}

/**
 * Verzamelt alle activiteits-tellingen voor één gebruiker in één keer.
 * Eén query per metric, allemaal lichtgewicht COUNT() op indexed kolommen.
 */
async function gatherUserStats(db: D1Database, userId: number): Promise<UserStats> {
  // 1. Unieke login-dagen (op basis van audit_logs.user_login)
  const loginRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(DISTINCT DATE(created_at)) AS n
       FROM audit_logs
      WHERE user_id = ? AND actie = 'user_login'`,
    [userId]
  )

  // 2. Poll-stemmen
  const pollRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(DISTINCT poll_id) AS n FROM poll_votes WHERE user_id = ?`,
    [userId]
  )

  // 3. Agenda-responses (event_attendance)
  const agendaRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM event_attendance WHERE user_id = ?`,
    [userId]
  )

  // 4. Stemtests
  const voiceRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM voice_analyses WHERE user_id = ?`,
    [userId]
  )

  // 5. Profiel-completeness checks
  const profile = await queryOne<any>(db,
    `SELECT foto_url, voornaam, achternaam, telefoon, adres, bio
       FROM profiles WHERE user_id = ? LIMIT 1`,
    [userId]
  )

  const hasFoto = profile?.foto_url ? 1 : 0
  const hasBio = (profile?.bio && profile.bio.trim().length > 10) ? 1 : 0
  const profileComplete = (
    profile?.voornaam && profile?.achternaam &&
    profile?.telefoon && profile?.adres && profile?.foto_url
  ) ? 1 : 0

  // 6. Lidmaatschap in jaren (uit profiles.lid_sinds — NIET users)
  const userRow = await queryOne<{ lid_sinds: string | null, geboortedatum: string | null }>(db,
    `SELECT p.lid_sinds, p.geboortedatum
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  )

  let membershipYears = 0
  if (userRow?.lid_sinds) {
    const lidSinds = new Date(userRow.lid_sinds)
    const now = new Date()
    membershipYears = now.getFullYear() - lidSinds.getFullYear()
    // Correct als nog niet "verjaard" dit jaar
    const monthDiff = now.getMonth() - lidSinds.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < lidSinds.getDate())) {
      membershipYears--
    }
    if (membershipYears < 0) membershipYears = 0
  }

  // 7. Verjaardag-login (heeft user vandaag ingelogd op zijn verjaardag?)
  let birthdayLogin = 0
  if (userRow?.geboortedatum) {
    const gb = userRow.geboortedatum   // 'YYYY-MM-DD'
    const today = new Date()
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const gbMD = gb.substring(5, 10)   // 'MM-DD'
    if (gbMD === todayMD) {
      // Check of er vandaag een login is geweest
      const loginToday = await queryOne<{ n: number }>(db,
        `SELECT COUNT(*) AS n FROM audit_logs
          WHERE user_id = ? AND actie = 'user_login'
            AND DATE(created_at) = DATE('now')`,
        [userId]
      )
      if ((loginToday?.n || 0) > 0) birthdayLogin = 1
    }
  }

  return {
    login_count:           loginRow?.n || 0,
    poll_vote_count:       pollRow?.n || 0,
    agenda_response_count: agendaRow?.n || 0,
    voice_test_done:       voiceRow?.n || 0,
    has_profile_photo:     hasFoto,
    profile_complete:      profileComplete,
    has_bio:               hasBio,
    membership_years:      membershipYears,
    birthday_login:        birthdayLogin
  }
}

/**
 * Evalueer alle badges voor één gebruiker en ken nieuwe toe.
 * Retourneert de keys van NIEUW toegekende badges (handig voor toast/celebrate).
 */
export async function evaluateBadges(db: D1Database, userId: number): Promise<string[]> {
  const [stats, badges, alreadyEarned] = await Promise.all([
    gatherUserStats(db, userId),
    queryAll<BadgeRow>(db, `SELECT * FROM badges`),
    queryAll<{ badge_key: string }>(db,
      `SELECT badge_key FROM user_badges WHERE user_id = ?`,
      [userId]
    )
  ])

  const earnedSet = new Set(alreadyEarned.map(r => r.badge_key))
  const newlyEarned: string[] = []

  for (const badge of badges) {
    if (earnedSet.has(badge.badge_key)) continue

    const currentValue = (stats as any)[badge.criteria_type] as number | undefined
    if (typeof currentValue !== 'number') continue

    if (currentValue >= badge.criteria_value) {
      // Toekennen
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO user_badges (user_id, badge_key, meta)
           VALUES (?, ?, ?)`
        ).bind(
          userId,
          badge.badge_key,
          JSON.stringify({ value_at_unlock: currentValue })
        ).run()
        newlyEarned.push(badge.badge_key)
      } catch (_) { /* silent fail — niet kritiek */ }
    }
  }

  return newlyEarned
}

/**
 * Haal voor één gebruiker alle badges op met huidige progress.
 * Verborgen badges (zichtbaar=0) tonen we enkel als ze al verdiend zijn.
 */
export async function getUserBadgesWithProgress(db: D1Database, userId: number): Promise<UserBadgeRow[]> {
  const [stats, badges, earned] = await Promise.all([
    gatherUserStats(db, userId),
    queryAll<BadgeRow>(db, `SELECT * FROM badges ORDER BY sort_order ASC, naam ASC`),
    queryAll<{ badge_key: string, earned_at: string }>(db,
      `SELECT badge_key, earned_at FROM user_badges WHERE user_id = ?`,
      [userId]
    )
  ])

  const earnedMap = new Map(earned.map(r => [r.badge_key, r.earned_at]))

  return badges
    .filter(b => b.zichtbaar === 1 || earnedMap.has(b.badge_key))
    .map(b => {
      const isEarned = earnedMap.has(b.badge_key)
      const earnedAt = earnedMap.get(b.badge_key) || null
      const currentValue = (stats as any)[b.criteria_type] as number | undefined
      const progress = typeof currentValue === 'number' ? Math.min(currentValue, b.criteria_value) : 0
      const percent = b.criteria_value > 0 ? Math.round((progress / b.criteria_value) * 100) : 0

      return {
        ...b,
        earned: isEarned,
        earned_at: earnedAt,
        progress,
        percent: isEarned ? 100 : percent
      }
    })
}

/**
 * Lichte versie voor dashboard-widget: enkel verdiende badges, max N stuks, sortering nieuwste eerst.
 */
export async function getRecentBadgesForUser(db: D1Database, userId: number, limit = 4): Promise<UserBadgeRow[]> {
  const rows = await queryAll<BadgeRow & { earned_at: string }>(db,
    `SELECT b.*, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON b.badge_key = ub.badge_key
      WHERE ub.user_id = ?
      ORDER BY ub.earned_at DESC
      LIMIT ?`,
    [userId, limit]
  )

  return rows.map(r => ({
    ...r,
    earned: true,
    earned_at: r.earned_at,
    progress: r.criteria_value,
    percent: 100
  }))
}

/**
 * Globale telling: hoeveel badges heeft de gebruiker / hoeveel totaal beschikbaar.
 */
export async function getBadgeSummary(db: D1Database, userId: number): Promise<{ earned: number, total: number }> {
  const earnedRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ?`,
    [userId]
  )
  const totalRow = await queryOne<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM badges WHERE zichtbaar = 1`
  )

  return {
    earned: earnedRow?.n || 0,
    total: totalRow?.n || 0
  }
}

// Tailwind-kleur → CSS-klasse mapping voor JSX
export const BADGE_COLOR_CLASSES: Record<string, { ring: string, glow: string, text: string, bg: string }> = {
  sky:     { ring: 'ring-sky-400',     glow: 'shadow-sky-300/60',     text: 'text-sky-600',     bg: 'bg-sky-50' },
  emerald: { ring: 'ring-emerald-400', glow: 'shadow-emerald-300/60', text: 'text-emerald-600', bg: 'bg-emerald-50' },
  orange:  { ring: 'ring-orange-400',  glow: 'shadow-orange-300/60',  text: 'text-orange-600',  bg: 'bg-orange-50' },
  amber:   { ring: 'ring-amber-400',   glow: 'shadow-amber-300/60',   text: 'text-amber-600',   bg: 'bg-amber-50' },
  pink:    { ring: 'ring-pink-400',    glow: 'shadow-pink-300/60',    text: 'text-pink-600',    bg: 'bg-pink-50' },
  indigo:  { ring: 'ring-indigo-400',  glow: 'shadow-indigo-300/60',  text: 'text-indigo-600',  bg: 'bg-indigo-50' },
  purple:  { ring: 'ring-purple-400',  glow: 'shadow-purple-300/60',  text: 'text-purple-600',  bg: 'bg-purple-50' },
  violet:  { ring: 'ring-violet-400',  glow: 'shadow-violet-300/60',  text: 'text-violet-600',  bg: 'bg-violet-50' },
  fuchsia: { ring: 'ring-fuchsia-400', glow: 'shadow-fuchsia-300/60', text: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  teal:    { ring: 'ring-teal-400',    glow: 'shadow-teal-300/60',    text: 'text-teal-600',    bg: 'bg-teal-50' },
  cyan:    { ring: 'ring-cyan-400',    glow: 'shadow-cyan-300/60',    text: 'text-cyan-600',    bg: 'bg-cyan-50' },
  lime:    { ring: 'ring-lime-400',    glow: 'shadow-lime-300/60',    text: 'text-lime-600',    bg: 'bg-lime-50' },
  green:   { ring: 'ring-green-400',   glow: 'shadow-green-300/60',   text: 'text-green-600',   bg: 'bg-green-50' },
  rose:    { ring: 'ring-rose-400',    glow: 'shadow-rose-300/60',    text: 'text-rose-600',    bg: 'bg-rose-50' },
  yellow:  { ring: 'ring-yellow-400',  glow: 'shadow-yellow-300/60',  text: 'text-yellow-600',  bg: 'bg-yellow-50' },
  red:     { ring: 'ring-red-400',     glow: 'shadow-red-300/60',     text: 'text-red-600',     bg: 'bg-red-50' }
}

export const RARITY_LABEL: Record<string, { label: string, class: string }> = {
  gewoon:        { label: 'Gewoon',       class: 'bg-gray-100 text-gray-700' },
  zeldzaam:      { label: 'Zeldzaam',     class: 'bg-blue-100 text-blue-700' },
  episch:        { label: 'Episch',       class: 'bg-purple-100 text-purple-700' },
  legendarisch:  { label: 'Legendarisch', class: 'bg-gradient-to-r from-amber-200 to-yellow-300 text-amber-900' }
}
