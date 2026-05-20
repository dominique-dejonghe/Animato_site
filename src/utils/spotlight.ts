// =====================================================================
// Spotlight selector — "Koorlid in de kijker"
// =====================================================================
// Kiest één spotlight per request voor de banner bovenaan /leden.
//
// Prioriteit (eerste die match én niet door deze gebruiker is weggeklikt):
//   1. Verjaardag vandaag (any actief lid jarig vandaag — Belgisch tijdperk)
//   2. Nieuw lid (laatste 30 dagen, op basis van profiles.lid_sinds —
//      NIET users.created_at: dat is de account-aanmaak-datum en kan misleidend
//      zijn voor leden die ooit gemigreerd zijn vanuit een lid-aanvraag).
//   3. Random weekly spotlight — élk actief lid (met of zonder bio), roteert
//      op kalenderweek. Garandeert dat er altíjd een spotlight is.
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

  // ----- 2. Nieuw lid (laatste 30 dagen op basis van profiles.lid_sinds) -----
  // BUG-FIX (Dominique): users.created_at geeft account-aanmaak-datum, niet de
  // echte start in het koor. Bij migraties kan dat misleidend zijn (lid sinds
  // 2020, maar account net aangemaakt). profiles.lid_sinds is de werkelijke
  // aanvangsdatum en die is voor alle 68 actieve leden ingevuld.
  const newMembers = await db.prepare(
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio,
            CAST(julianday('now') - julianday(p.lid_sinds) AS INTEGER) AS days_ago
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.id != ?
        AND p.lid_sinds IS NOT NULL
        AND p.lid_sinds >= date('now', '-30 days')
      ORDER BY p.lid_sinds DESC, u.id DESC`
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

  // ----- 3. Random weekly spotlight — élk actief lid komt in aanmerking ----
  // BUG-FIX (Dominique): vroeger eis 'bio ≥ 20 chars' → pool vaak leeg →
  // geen spotlight. Nu: alle actieve leden, gesorteerd zodat leden met bio
  // én foto bovenaan staan (mooier in de banner). Foto wordt niet vereist,
  // ledenlijst toont anders gewoon initialen-avatar.
  const week = isoWeek()
  const candidates = await db.prepare(
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio,
            CASE WHEN p.bio IS NOT NULL AND length(trim(p.bio)) >= 20 THEN 1 ELSE 0 END AS has_bio,
            CASE WHEN p.foto_url IS NOT NULL AND length(trim(p.foto_url)) > 0 THEN 1 ELSE 0 END AS has_foto
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND u.id != ?
        AND p.voornaam IS NOT NULL
      ORDER BY u.id ASC`
  ).bind(currentUserId).all()

  const pool = (candidates.results || []) as any[]
  if (pool.length === 0) return null

  // Deterministische selectie op (huidige user × week) — zo ziet elke
  // gebruiker dezelfde persoon de hele week, maar verschillende mensen
  // zien verschillende spotlights. Bouwt een zachte sociale ervaring:
  // "ken jij Marijke al?" "Hé, ik kreeg vorige week óók Marijke!"
  // — nee, eigenlijk zien jullie misschien iets anders, en dat is OK.
  // Hash op userId + week:
  let seed = currentUserId
  for (let i = 0; i < week.length; i++) seed = (seed * 31 + week.charCodeAt(i)) & 0xffffffff
  const startIdx = Math.abs(seed) % pool.length

  // BUG-FIX (Dominique): "toch een lid in de kijker zetten" — als de gekozen
  // persoon al is weggeklikt voor deze week, kies de volgende. Probeer tot
  // pool.length kandidaten voor we opgeven.
  for (let offset = 0; offset < pool.length; offset++) {
    const chosen = pool[(startIdx + offset) % pool.length]
    const key = `random:${chosen.id}:${week}`
    if (!dismissed.has(key)) {
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
  }

  // Alle leden deze week al weggeklikt — gebruiker heeft duidelijk geen zin
  // in spotlights deze week, respecteer dat.
  return null
}
