// =====================================================================
// Section last-visit tracking — voor "Nieuw sinds je vorige bezoek"-badges
// =====================================================================
// Per (user, section) onthouden wanneer ze de sectie laatst bezochten.
// Sectie-namen: 'agenda', 'bestanden', 'nieuws', 'forum'.
//
// Workflow voor elke sectie-pagina:
//   1. const lastVisit = await getSectionLastVisit(db, userId, 'nieuws')
//   2. const newCount = await countNewSince(...)        // op basis van lastVisit
//   3. await markSectionVisit(db, userId, 'nieuws')     // pas DAARNA bumpen
//
// Cap op 30 dagen om "ik was 6 maanden weg → 87 nieuwe items" te vermijden.
// =====================================================================

import type { D1Database } from '@cloudflare/workers-types'

export type SectionName = 'agenda' | 'bestanden' | 'nieuws' | 'forum'

// Maximaal hoever we terug rapporteren voor "nieuw sinds vorige bezoek"
const MAX_LOOKBACK_DAYS = 30

/**
 * Geeft de last_visit_at DATETIME terug, of null als de sectie nooit
 * bezocht werd. Voor first-time users tellen we vanaf "30 dagen geleden"
 * zodat ze niet alle historiek als 'nieuw' krijgen.
 */
export async function getSectionLastVisit(
  db: D1Database,
  userId: number,
  section: SectionName
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT last_visit_at FROM section_last_visits
      WHERE user_id = ? AND section = ?
      LIMIT 1`
  ).bind(userId, section).first<{ last_visit_at: string }>()
  return row?.last_visit_at || null
}

/**
 * Markeert de huidige timestamp als laatste bezoek. Upsert (INSERT OR REPLACE)
 * gebaseerd op de UNIQUE(user_id, section) constraint.
 *
 * Roep dit aan NA het ophalen van de counter, anders is de counter altijd 0.
 */
export async function markSectionVisit(
  db: D1Database,
  userId: number,
  section: SectionName
): Promise<void> {
  await db.prepare(
    `INSERT INTO section_last_visits (user_id, section, last_visit_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, section)
     DO UPDATE SET last_visit_at = CURRENT_TIMESTAMP`
  ).bind(userId, section).run()
}

/**
 * Geeft de effectieve cut-off voor "nieuw sinds": het laatste bezoek,
 * maar nooit ouder dan MAX_LOOKBACK_DAYS dagen.
 */
function effectiveCutoff(lastVisit: string | null): string {
  // SQLite-style ISO format
  const lookbackMs = MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const minCutoff = new Date(Date.now() - lookbackMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')

  if (!lastVisit) return minCutoff
  // Als last_visit ouder dan 30 dagen is, cap
  return lastVisit < minCutoff ? minCutoff : lastVisit
}

/**
 * Algemene counter: hoeveel rijen in `table` zijn `created_at > cutoff`?
 * Optioneel met extra WHERE-clausule.
 */
export async function countNewSince(
  db: D1Database,
  userId: number,
  section: SectionName,
  table: string,
  options?: { extraWhere?: string; extraParams?: any[]; createdCol?: string }
): Promise<number> {
  const lastVisit = await getSectionLastVisit(db, userId, section)
  const cutoff = effectiveCutoff(lastVisit)
  const col = options?.createdCol || 'created_at'
  const extraWhere = options?.extraWhere ? ` AND ${options.extraWhere}` : ''
  const params = [cutoff, ...(options?.extraParams || [])]

  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} > ?${extraWhere}`
  ).bind(...params).first<{ n: number }>()
  return row?.n || 0
}

/**
 * Render-helper: geeft de badge HTML als count > 0, anders lege string.
 * Wordt vooral via JSX direct gebruikt; deze helper is voor inline html-strings.
 */
export function renderNewBadge(count: number, label: string = 'nieuw'): string {
  if (count <= 0) return ''
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 ml-2 text-xs font-medium rounded-full bg-animato-primary/10 text-animato-primary border border-animato-primary/30">
    <span class="w-1.5 h-1.5 rounded-full bg-animato-primary"></span>
    ${count} ${label}
  </span>`
}
