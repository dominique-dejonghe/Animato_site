// =====================================================================
// Spotlight selector — "Koorlid in de kijker"
// =====================================================================
// Kiest één spotlight per request voor de banner bovenaan /leden.
//
// Prioriteit (eerste die match én niet door deze gebruiker is weggeklikt):
//   1. Verjaardag vandaag (any actief lid jarig vandaag — Belgisch tijdperk)
//   2. Nieuw lid (laatste 2 weken aangemaakt, status=actief)
//   3. Random weekly spotlight (lid met bio, roteert op kalenderweek)
//
// Spotlight-key formaat:
//   'birthday:<userId>:YYYY-MM-DD'      ← unieke key per verjaardag-dag
//   'newmember:<userId>'                ← één keer wegklikken volstaat
//   'random:<userId>:YYYY-Www'          ← één keer per week
//
// Een gebruiker wordt NOOIT in z'n eigen spotlight gezet (dat is awkward).
// =====================================================================

import type { D1Database } from '@cloudflare/workers-types'

export interface Spotlight {
  key: string
  type: 'birthday' | 'newmember' | 'random'
  user: {
    id: number
    voornaam: string
    achternaam: string
    foto_url: string | null
    stemgroep: string | null
    bio: string | null
  }
  meta?: {
    /** Voor 'newmember': hoeveel dagen geleden gestart */
    daysAgo?: number
  }
}

function todayBelgian(): string {
  // YYYY-MM-DD in Brussel-tijd. Cloudflare Workers draaien in UTC, dus
  // simpele +2 (CEST) of +1 (CET). We doen +2 als ruwe benadering — voor
  // de spotlight-key is een uur drift onproblematisch (gaat over dag-grens
  // op middernacht-grens, geen schade als het 1u afwijkt).
  const now = new Date()
  const be = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  return be.toISOString().substring(0, 10)
}

function isoWeek(): string {
  // YYYY-Www van vandaag (Brussel-tijd)
  const now = new Date()
  const be = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  // ISO week: thursday-trick
  const target = new Date(Date.UTC(be.getUTCFullYear(), be.getUTCMonth(), be.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setUTCMonth(0, 1)
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7)
  }
  const weekNr = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
  return `${be.getUTCFullYear()}-W${String(weekNr).padStart(2, '0')}`
}

export async function pickSpotlight(
  db: D1Database,
  currentUserId: number
): Promise<Spotlight | null> {
  // Welke spotlight-keys heeft deze gebruiker al weggeklikt?
  const dismissedRows = await db.prepare(
    `SELECT spotlight_key FROM user_dismissed_spotlights WHERE user_id = ?`
  ).bind(currentUserId).all()
  const dismissed = new Set(
    (dismissedRows.results || []).map((r: any) => r.spotlight_key)
  )

  // ----- 1. Verjaardag vandaag -----------------------------------------
  const today = todayBelgian()
  const mmdd = today.substring(5) // 'MM-DD'
  const birthdays = await db.prepare(
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.id != ?
        AND p.geboortedatum IS NOT NULL
        AND strftime('%m-%d', p.geboortedatum) = ?
      ORDER BY u.id ASC`
  ).bind(currentUserId, mmdd).all()

  for (const row of (birthdays.results || []) as any[]) {
    const key = `birthday:${row.id}:${today}`
    if (!dismissed.has(key)) {
      return {
        key,
        type: 'birthday',
        user: {
          id: row.id,
          voornaam: row.voornaam,
          achternaam: row.achternaam,
          foto_url: row.foto_url,
          stemgroep: row.stemgroep,
          bio: row.bio,
        }
      }
    }
  }

  // ----- 2. Nieuw lid (laatste 14 dagen) -------------------------------
  const newMembers = await db.prepare(
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio,
            CAST(julianday('now') - julianday(u.created_at) AS INTEGER) AS days_ago
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.id != ?
        AND u.created_at >= datetime('now', '-14 days')
      ORDER BY u.created_at DESC`
  ).bind(currentUserId).all()

  for (const row of (newMembers.results || []) as any[]) {
    const key = `newmember:${row.id}`
    if (!dismissed.has(key)) {
      return {
        key,
        type: 'newmember',
        user: {
          id: row.id,
          voornaam: row.voornaam,
          achternaam: row.achternaam,
          foto_url: row.foto_url,
          stemgroep: row.stemgroep,
          bio: row.bio,
        },
        meta: { daysAgo: row.days_ago }
      }
    }
  }

  // ----- 3. Random weekly spotlight (alleen leden met bio) -------------
  const week = isoWeek()
  // Pool: actieve leden met een bio van min. 20 tekens
  const candidates = await db.prepare(
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.id != ?
        AND p.bio IS NOT NULL
        AND length(trim(p.bio)) >= 20
      ORDER BY u.id ASC`
  ).bind(currentUserId).all()

  const pool = (candidates.results || []) as any[]
  if (pool.length === 0) return null

  // Deterministische selectie op (huidige user × week) — zo ziet elke
  // gebruiker dezelfde persoon de hele week, maar verschillende mensen
  // zien verschillende spotlights. Bouwt een zachte sociale ervaring:
  // "ken jij Marijke al?" "Hé, ik kreeg vorige week óók Marijke!"
  // — nee, eigenlijk zien jullie misschien iets anders, en dat is OK.
  // Hash op userId + week + lid-id pool-grootte:
  let seed = currentUserId
  for (let i = 0; i < week.length; i++) seed = (seed * 31 + week.charCodeAt(i)) & 0xffffffff
  const idx = Math.abs(seed) % pool.length
  const chosen = pool[idx]
  const key = `random:${chosen.id}:${week}`
  if (dismissed.has(key)) {
    // User klikte deze persoon deze week al weg → niets meer tonen
    return null
  }
  return {
    key,
    type: 'random',
    user: {
      id: chosen.id,
      voornaam: chosen.voornaam,
      achternaam: chosen.achternaam,
      foto_url: chosen.foto_url,
      stemgroep: chosen.stemgroep,
      bio: chosen.bio,
    }
  }
}
