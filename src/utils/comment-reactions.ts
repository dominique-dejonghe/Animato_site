// =====================================================================
// Polymorphic comment reactions — 6 emoji's op alle commentaar-types
// =====================================================================
// Eén tabel `comment_reactions` (target_type, target_id, user_id, reaction).
// Target-types: event_reply | post_reply | post_comment | feedback_comment.
//
// Twee API-stijlen ondersteund (back-compat):
//   1. Server-render: getReactionSummary + renderReactionsBarHtml
//      Gebruikt door /api/comment-reactions/* (oudere code-paden).
//   2. Pure data + client-render: getReactionsForTarget(s)
//      Gebruikt door nieuwe /api/leden/comment-reactions/* + static JS.
// =====================================================================

import type { D1Database } from '@cloudflare/workers-types'

// ---------- Types & constants ----------
export type ReactionTargetType = 'event_reply' | 'post_reply' | 'post_comment' | 'feedback_comment'
export type ReactionTarget = ReactionTargetType // alias voor nieuwe call-sites
export type ReactionType = 'like' | 'love' | 'laugh' | 'music' | 'clap' | 'pray'

export const REACTION_TYPES: ReactionType[] = ['like', 'love', 'laugh', 'music', 'clap', 'pray']

export const REACTION_EMOJI: Record<ReactionType, string> = {
  like:  '👍',
  love:  '❤️',
  laugh: '😄',
  music: '🎵',
  clap:  '👏',
  pray:  '🙏',
}

export const REACTION_LABEL: Record<ReactionType, string> = {
  like:  'Duim',
  love:  'Hartje',
  laugh: 'Glimlach',
  music: 'Muzieknoot',
  clap:  'Applaus',
  pray:  'Dankbaar',
}

export interface ReactionSummary {
  counts: Record<ReactionType, number>
  /** Welke reacties heeft de huidige gebruiker zelf gegeven */
  mine: Set<ReactionType>
  /** Totaal aantal reacties (alle types samen) */
  total: number
}

function emptySummary(): ReactionSummary {
  return {
    counts: { like: 0, love: 0, laugh: 0, music: 0, clap: 0, pray: 0 },
    mine: new Set<ReactionType>(),
    total: 0,
  }
}

// ---------- Read APIs ----------

/** Eén target — voor detailpagina's */
export async function getReactionsForTarget(
  db: D1Database,
  targetType: ReactionTargetType,
  targetId: number,
  currentUserId: number
): Promise<ReactionSummary> {
  const rows = await db.prepare(
    `SELECT reaction, user_id
       FROM comment_reactions
      WHERE target_type = ? AND target_id = ?`
  ).bind(targetType, targetId).all()

  const summary = emptySummary()
  for (const r of (rows.results || []) as any[]) {
    const rt = r.reaction as ReactionType
    if (!REACTION_TYPES.includes(rt)) continue
    summary.counts[rt]++
    summary.total++
    if (r.user_id === currentUserId) summary.mine.add(rt)
  }
  return summary
}

/** Bulk — voor lijsten met veel comments. Geeft Map<targetId, ReactionSummary>. */
export async function getReactionsForTargets(
  db: D1Database,
  targetType: ReactionTargetType,
  targetIds: number[],
  currentUserId: number
): Promise<Map<number, ReactionSummary>> {
  const map = new Map<number, ReactionSummary>()
  if (targetIds.length === 0) return map

  const placeholders = targetIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT target_id, reaction, user_id
       FROM comment_reactions
      WHERE target_type = ?
        AND target_id IN (${placeholders})`
  ).bind(targetType, ...targetIds).all()

  for (const id of targetIds) map.set(id, emptySummary())
  for (const r of (rows.results || []) as any[]) {
    const rt = r.reaction as ReactionType
    if (!REACTION_TYPES.includes(rt)) continue
    const s = map.get(r.target_id)
    if (!s) continue
    s.counts[rt]++
    s.total++
    if (r.user_id === currentUserId) s.mine.add(rt)
  }
  return map
}

// ---------- Back-compat aliases ----------
// Bestaande routes (agenda.tsx, leden.tsx, comment-reactions.tsx) gebruiken
// deze namen — we exporteren ze zodat we niets in callers hoeven aan te raken.

/** Alias voor getReactionsForTarget met andere argumentvolgorde */
export async function getReactionSummary(
  db: D1Database,
  currentUserId: number,
  targetType: ReactionTargetType,
  targetId: number
): Promise<ReactionSummary> {
  return getReactionsForTarget(db, targetType, targetId, currentUserId)
}

/** Bulk-versie als plain object (i.p.v. Map) — voor easy templating */
export async function getReactionSummariesBulk(
  db: D1Database,
  currentUserId: number,
  targetType: ReactionTargetType,
  targetIds: number[]
): Promise<Record<number, ReactionSummary>> {
  const map = await getReactionsForTargets(db, targetType, targetIds, currentUserId)
  const out: Record<number, ReactionSummary> = {}
  map.forEach((v, k) => { out[k] = v })
  return out
}

// ---------- Toggle ----------

/**
 * Toggle: als de user al die specifieke reactie heeft, verwijder ze; anders
 * INSERT. Een gebruiker kan WEL meerdere verschillende reacties op hetzelfde
 * comment achterlaten (zoals Slack), maar niet 2× dezelfde.
 *
 * Argumentvolgorde matched de bestaande call-sites:
 *   toggleReaction(db, userId, targetType, targetId, reaction)
 */
export async function toggleReaction(
  db: D1Database,
  userId: number,
  targetType: ReactionTargetType,
  targetId: number,
  reaction: ReactionType
): Promise<{ active: boolean; added: boolean; summary: ReactionSummary }> {
  const existing = await db.prepare(
    `SELECT id FROM comment_reactions
      WHERE target_type = ? AND target_id = ? AND user_id = ? AND reaction = ?
      LIMIT 1`
  ).bind(targetType, targetId, userId, reaction).first<{ id: number }>()

  let added = false
  if (existing) {
    await db.prepare(`DELETE FROM comment_reactions WHERE id = ?`).bind(existing.id).run()
  } else {
    await db.prepare(
      `INSERT OR IGNORE INTO comment_reactions (target_type, target_id, user_id, reaction)
       VALUES (?, ?, ?, ?)`
    ).bind(targetType, targetId, userId, reaction).run()
    added = true
  }

  const summary = await getReactionsForTarget(db, targetType, targetId, userId)
  // 'active' = de huidige user heeft DIT type nu actief (na de toggle)
  const active = summary.mine.has(reaction)
  return { active, added, summary }
}

// ---------- Server-side HTML rendering ----------

/**
 * Rendert de reactions-bar als HTML-string. Wordt door comment-reactions.tsx
 * teruggestuurd in de toggle-response zodat de oude integraties zonder
 * client-side JS direct kunnen hot-swappen. Voor nieuwe pagina's gebruiken
 * we liever het auto-init script /static/js/comment-reactions.js.
 */
export function renderReactionsBarHtml(
  targetType: ReactionTargetType,
  targetId: number,
  summary: ReactionSummary
): string {
  const counts = summary.counts
  const mine = summary.mine
  // Wrapper-div met data-attrs zodat het script /static/js/comment-reactions.js
  // óók deze server-gerenderde versie kan oppikken en aanvullend events kan binden.
  const mineArr = Array.from(mine)
  let html = `<div class="comment-reactions" data-target-type="${targetType}" data-target-id="${targetId}" `
  html += `data-counts='${JSON.stringify(counts)}' data-mine='${JSON.stringify(mineArr)}'></div>`
  return html
}

/**
 * Inline client-script: legacy fallback voor pagina's die de static JS niet
 * inladen. Doet hetzelfde als /static/js/comment-reactions.js maar dan
 * embedded. Lege string by default — het globale script in Layout.tsx
 * dekt nu alle cases.
 */
export const REACTIONS_CLIENT_SCRIPT = ''
