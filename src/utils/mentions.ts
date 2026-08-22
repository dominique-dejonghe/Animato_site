// =====================================================================
// @mentions in commentaren — detect, resolve, render, notify
// =====================================================================
// Formaat: @voornaam-achternaam, @voornaam_achternaam, @voornaam.achternaam,
// of @voornaam (als die uniek is binnen actieve leden). Spaties zijn lastig
// in mentions — daarom altijd met een scheidingsteken of CamelCase.
//
// Pipeline:
//   1. extractMentionTokens(body)      → ['marijke-van-goethem', 'dries']
//   2. resolveMentions(db, tokens)     → Map<token, { userId, voornaam, ach... }>
//   3. renderMentions(html, map)       → vervangt @token door <a href="/leden/smoelenboek/:id">
//   4. notifyMentionedUsers(db, map, ...) → stuurt notificatie naar genoemden
// =====================================================================

import type { D1Database } from '@cloudflare/workers-types'

export interface MentionInfo {
  token: string         // de tekst die in body stond (zonder @)
  userId: number
  voornaam: string
  achternaam: string
  email: string
}

/**
 * Regex die @woord-met-scheidingstekens matcht. Verboden chars:
 * spatie, punt, komma, ! ? ; : ( ) [ ] { } " ' < > / \ |.
 * Toegestane chars: letters (Unicode), cijfers, _ - .
 * Maximaal 60 tekens om DoS te vermijden.
 *
 * Voorbeelden die matchen:
 *   @marijke         → token 'marijke'
 *   @marijke-van-goethem
 *   @dries.raes
 *   @Veerle_Mampaey
 *   @voornaam.achternaam@voorbeeld.org  → token stopt bij @ → 'voornaam.achternaam' (domein wordt niet gevangen — bewust)
 *
 * NB: een @-teken aan de start van de match wordt niet behouden in groep 1.
 */
const MENTION_RE = /(?:^|[\s>(])@([A-Za-zÀ-ÖØ-öø-ÿ0-9_.-]{2,60})/g

/**
 * Haalt alle unieke mention-tokens uit een tekstblok.
 * Strikt: punctuatie aan het einde wordt afgekapt (bv. '@marijke,' → 'marijke').
 */
export function extractMentionTokens(body: string | null | undefined): string[] {
  if (!body) return []
  const found = new Set<string>()
  let m: RegExpExecArray | null
  // Reset lastIndex omdat MENTION_RE een /g regex is met state
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(body)) !== null) {
    let tok = m[1]
    // Trim trailing punctuation (- . _ blijven, want geldig)
    tok = tok.replace(/[.\-_]+$/, '')
    if (tok.length >= 2) found.add(tok.toLowerCase())
  }
  return Array.from(found)
}

/**
 * Resolve tokens naar effectieve users. Strategy:
 *   1. Probeer EXACT match op 'firstname-lastname' (met diverse separators)
 *   2. Probeer EXACT match op email-localpart (voor @dries.raes)
 *   3. Probeer EXACT match op voornaam — alleen als UNIEK in actieve leden
 *
 * Returns Map<lowercase token, MentionInfo>.
 */
export async function resolveMentions(
  db: D1Database,
  tokens: string[]
): Promise<Map<string, MentionInfo>> {
  const result = new Map<string, MentionInfo>()
  if (tokens.length === 0) return result

  // Eén query: haal alle actieve leden op met hun namen/email.
  // Dit is goedkoop (~80 rijen voor een koor) en vermijdt N+1.
  const rows = await db.prepare(
    `SELECT u.id AS user_id, u.email,
            p.voornaam, p.achternaam
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief'
        AND p.voornaam IS NOT NULL`
  ).all<{ user_id: number; email: string; voornaam: string; achternaam: string }>()

  const users = (rows.results || []) as any[]

  // Bouw lookup-indexen
  const byFullname = new Map<string, MentionInfo[]>()
  const byFirstname = new Map<string, MentionInfo[]>()
  const byEmailLocal = new Map<string, MentionInfo[]>()

  function norm(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accenten weg
      .replace(/[^a-z0-9]/g, '')                          // alleen letters/cijfers
  }

  for (const u of users) {
    const fn = String(u.voornaam || '').trim()
    const ln = String(u.achternaam || '').trim()
    const em = String(u.email || '').trim()
    if (!fn) continue

    const info: MentionInfo = {
      token: '', // wordt per match ingevuld
      userId: u.user_id,
      voornaam: fn,
      achternaam: ln,
      email: em,
    }

    const fnKey = norm(fn)
    const fullKey = norm(fn + ln)
    const emailLocal = em.includes('@') ? norm(em.split('@')[0]) : ''

    if (fnKey) {
      if (!byFirstname.has(fnKey)) byFirstname.set(fnKey, [])
      byFirstname.get(fnKey)!.push(info)
    }
    if (fullKey && fullKey !== fnKey) {
      if (!byFullname.has(fullKey)) byFullname.set(fullKey, [])
      byFullname.get(fullKey)!.push(info)
    }
    if (emailLocal) {
      if (!byEmailLocal.has(emailLocal)) byEmailLocal.set(emailLocal, [])
      byEmailLocal.get(emailLocal)!.push(info)
    }
  }

  for (const rawToken of tokens) {
    const key = norm(rawToken)
    if (!key) continue

    // 1. fullname
    let candidates = byFullname.get(key)
    if (candidates && candidates.length === 1) {
      result.set(rawToken, { ...candidates[0], token: rawToken })
      continue
    }
    // 2. email-localpart
    candidates = byEmailLocal.get(key)
    if (candidates && candidates.length === 1) {
      result.set(rawToken, { ...candidates[0], token: rawToken })
      continue
    }
    // 3. voornaam (alleen als uniek)
    candidates = byFirstname.get(key)
    if (candidates && candidates.length === 1) {
      result.set(rawToken, { ...candidates[0], token: rawToken })
      continue
    }
    // Ambigu of niet gevonden → geen entry. Token blijft als plain @text in body.
  }

  return result
}

/**
 * Vervangt @tokens in een HTML/text body door klikbare mention-pills.
 * Werkt op zowel rich-text (HTML) als plain-text bodies.
 *
 * BELANGRIJK: roept aan NA processBodyLinks() zodat we niet bestaande
 * <a>-tags breken. We vervangen alleen @tokens die niet binnen een tag staan.
 *
 * Veiligheid: deze functie produceert HTML en moet dus veilig zijn tegen XSS.
 * - Voor PLAIN-text input (event_replies, post_replies, post_comments):
 *   escape eerst de hele body met `escapeForMention`, dan toepassen.
 * - Voor RICH-text input (Quill HTML uit de board-editor):
 *   geef HTML mee zoals het is — processBodyLinks deed al de sanitisering.
 */
export function escapeForMention(plainText: string | null | undefined): string {
  if (!plainText) return ''
  return String(plainText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderMentions(
  body: string | null | undefined,
  mentionMap: Map<string, MentionInfo>
): string {
  if (!body) return ''
  if (mentionMap.size === 0) return body

  // Vervang per token. Reuse MENTION_RE met state-reset.
  return body.replace(MENTION_RE, (match, tokenRaw, offset) => {
    // Trim trailing punctuation om token-key te matchen
    const tok = String(tokenRaw).replace(/[.\-_]+$/, '').toLowerCase()
    const info = mentionMap.get(tok)
    if (!info) return match // ambigu/unknown → laat plain
    // Behoud de leading character (spatie, '>', '(', etc.)
    const leading = match.slice(0, match.indexOf('@'))
    const display = `${info.voornaam}${info.achternaam ? ' ' + info.achternaam : ''}`
    return `${leading}<a href="/leden/smoelenboek/${info.userId}" class="mention inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-animato-primary/10 text-animato-primary font-medium hover:bg-animato-primary/20 transition no-underline" title="${escapeAttr(info.email)}">@${escapeAttr(display)}</a>`
  })
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Notifieer alle genoemde users via de bestaande notification-pipeline.
 * Skipt de auteur zelf (geen self-mention notificaties).
 * Skipt users die 'board' notifications hebben uitgezet (opt-out respect).
 */
export async function notifyMentionedUsers(
  db: D1Database,
  mentionMap: Map<string, MentionInfo>,
  opts: {
    authorId: number
    authorName: string
    title: string         // "Marijke noemde je in een reactie"
    bodySnippet: string   // ~120 tekens van de comment
    link: string          // /agenda/42, /leden/board/17, /nieuws/xxx
    jwtSecret?: string
  }
): Promise<{ notified: number[]; skipped: number[] }> {
  const notified: number[] = []
  const skipped: number[] = []

  if (mentionMap.size === 0) return { notified, skipped }

  // Lazy-import om circular dependencies te vermijden
  const { notifyUserIfEnabled } = await import('./notifications')

  // Dedup userIds (een persoon meermaals genoemd → één notificatie)
  const uniqueIds = new Set<number>()
  mentionMap.forEach(info => {
    if (info.userId !== opts.authorId) uniqueIds.add(info.userId)
  })

  for (const userId of uniqueIds) {
    try {
      const ok = await notifyUserIfEnabled(
        db, userId, 'board',
        opts.title, opts.bodySnippet, opts.link
      )
      if (ok) notified.push(userId)
      else skipped.push(userId)
    } catch (_) {
      skipped.push(userId)
    }
  }

  return { notified, skipped }
}
