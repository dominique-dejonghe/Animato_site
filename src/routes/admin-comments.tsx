import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono()

// ---------- AUTH MIDDLEWARE ----------
// Comment moderation = admin only. Bestuursleden komen er niet bij —
// dit is delicaat materiaal (verwijderen, vlaggen, persoonlijke comments).
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
    return c.redirect('/leden')
  }
  c.set('user', user)
  await next()
}
app.use('/admin/comments', adminAuthMiddleware)
app.use('/admin/comments/*', adminAuthMiddleware)

// ---------- HELPERS ----------
type Source = 'nieuws' | 'agenda'
// 'board' source verwijderd 2026-06-13: berichtenmodule afgeschaft. post_replies
// tabel blijft bestaan voor data-behoud, maar wordt niet meer getoond in admin.
type Status = 'visible' | 'flagged' | 'deleted' | 'all'

interface UnifiedComment {
  source: Source
  id: number
  parent_id: number | null // post.id of event.id
  parent_slug: string | null
  parent_title: string | null
  user_id: number
  author_name: string
  body: string
  created_at: string
  is_deleted: number
  is_flagged: number
  flagged_reason: string | null
  flagged_at: string | null
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('nl-BE') } catch { return s }
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function flashRedirect(params: Record<string, string>): string {
  const u = new URLSearchParams(params)
  return `/admin/comments?${u.toString()}`
}

function sourceLink(c: UnifiedComment): string {
  // Genereer de link naar de bronpagina waar de comment leeft.
  if (c.source === 'nieuws' && c.parent_slug) return `/nieuws/${c.parent_slug}#reacties`
  if (c.source === 'agenda' && c.parent_slug) return `/agenda/${c.parent_slug}#reacties`
  return '#'
}

function sourceBadge(source: Source): { label: string; color: string; icon: string } {
  switch (source) {
    case 'nieuws': return { label: 'Nieuws', color: 'bg-blue-100 text-blue-800', icon: 'fa-newspaper' }
    case 'agenda': return { label: 'Agenda', color: 'bg-green-100 text-green-800', icon: 'fa-calendar' }
  }
}

// ---------- UNIFIED QUERY ----------
// Eén UNION over de 3 comment-tabellen. We normaliseren auteur_id/user_id →
// user_id, en koppelen post/event metadata zodat we direct kunnen linken naar
// de bronpagina. SQLite UNION ALL is hier prima — gemiddeld volume is laag,
// en we sorteren clientside.
async function fetchAllComments(DB: D1Database, filters: {
  status: Status
  source: Source | 'all'
  search: string
  limit: number
  offset: number
}): Promise<{ rows: UnifiedComment[]; total: number }> {
  const { status, source, search, limit, offset } = filters
  const searchPattern = search ? `%${search.toLowerCase()}%` : null

  // Per-tabel WHERE-clausules
  const statusClauseReplies = (() => {
    if (status === 'visible') return 'AND r.is_deleted = 0 AND COALESCE(r.is_flagged,0) = 0'
    if (status === 'flagged') return 'AND COALESCE(r.is_flagged,0) = 1'
    if (status === 'deleted') return 'AND r.is_deleted = 1'
    return '' // all
  })()

  const statusClauseLegacy = (() => {
    // post_comments — is_deleted/is_flagged via COALESCE want kolommen pas in 0078 toegevoegd
    if (status === 'visible') return 'AND COALESCE(c.is_deleted,0) = 0 AND COALESCE(c.is_flagged,0) = 0'
    if (status === 'flagged') return 'AND COALESCE(c.is_flagged,0) = 1'
    if (status === 'deleted') return 'AND COALESCE(c.is_deleted,0) = 1'
    return ''
  })()

  // Search-clausules (LOWER-case match op body of auteurnaam)
  const searchClauseReplies = searchPattern
    ? `AND (LOWER(r.body) LIKE ? OR LOWER(COALESCE(p.voornaam,'')||' '||COALESCE(p.achternaam,'')) LIKE ?)`
    : ''
  const searchClauseLegacy = searchPattern
    ? `AND (LOWER(c.body) LIKE ? OR LOWER(COALESCE(p.voornaam,'')||' '||COALESCE(p.achternaam,'')) LIKE ?)`
    : ''

  const parts: string[] = []
  const params: any[] = []

  // --- NIEUWS (post_comments) ---
  if (source === 'all' || source === 'nieuws') {
    parts.push(`
      SELECT 'nieuws' AS source,
             c.id AS id,
             c.post_id AS parent_id,
             posts.slug AS parent_slug,
             posts.titel AS parent_title,
             c.user_id AS user_id,
             COALESCE(p.voornaam,'')||' '||COALESCE(p.achternaam,'') AS author_name,
             c.body AS body,
             c.created_at AS created_at,
             COALESCE(c.is_deleted,0) AS is_deleted,
             COALESCE(c.is_flagged,0) AS is_flagged,
             c.flagged_reason AS flagged_reason,
             c.flagged_at AS flagged_at
      FROM post_comments c
      LEFT JOIN profiles p ON p.user_id = c.user_id
      LEFT JOIN posts    ON posts.id = c.post_id
      WHERE 1=1 ${statusClauseLegacy} ${searchClauseLegacy}
    `)
    if (searchPattern) { params.push(searchPattern, searchPattern) }
  }

  // --- BOARD verwijderd 2026-06-13: berichtenmodule afgeschaft ---

  // --- AGENDA (event_replies) ---
  if (source === 'all' || source === 'agenda') {
    parts.push(`
      SELECT 'agenda' AS source,
             r.id AS id,
             r.event_id AS parent_id,
             events.slug AS parent_slug,
             events.titel AS parent_title,
             r.auteur_id AS user_id,
             COALESCE(p.voornaam,'')||' '||COALESCE(p.achternaam,'') AS author_name,
             r.body AS body,
             r.created_at AS created_at,
             r.is_deleted AS is_deleted,
             COALESCE(r.is_flagged,0) AS is_flagged,
             r.flagged_reason AS flagged_reason,
             r.flagged_at AS flagged_at
      FROM event_replies r
      LEFT JOIN profiles p ON p.user_id = r.auteur_id
      LEFT JOIN events   ON events.id = r.event_id
      WHERE 1=1 ${statusClauseReplies} ${searchClauseReplies}
    `)
    if (searchPattern) { params.push(searchPattern, searchPattern) }
  }

  if (parts.length === 0) return { rows: [], total: 0 }

  // Count total (for pagination indicator)
  const countSql = `SELECT COUNT(*) AS n FROM (${parts.join(' UNION ALL ')}) sub`
  const countRow = await queryOne<{ n: number }>(DB, countSql, params)
  const total = countRow?.n || 0

  // Paginated, sorted
  const pageSql = `
    SELECT * FROM (${parts.join(' UNION ALL ')}) sub
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `
  const rows = await queryAll<UnifiedComment>(DB, pageSql, [...params, limit, offset])
  return { rows, total }
}

// ---------- SPAMMER DETECTION ----------
// Top N auteurs op aantal comments in laatste 7 dagen. Simpele heuristiek —
// genoeg om snel een spam-aanvaller te spotten.
async function fetchTopAuthors(DB: D1Database, days = 7, limit = 10): Promise<any[]> {
  const sql = `
    SELECT user_id,
           SUM(n) AS total,
           MAX(last_at) AS last_at
    FROM (
      SELECT c.user_id AS user_id, COUNT(*) AS n, MAX(c.created_at) AS last_at
        FROM post_comments c
        WHERE c.created_at >= datetime('now', '-${days} days')
          AND COALESCE(c.is_deleted,0) = 0
        GROUP BY c.user_id
      UNION ALL
      SELECT r.auteur_id AS user_id, COUNT(*) AS n, MAX(r.created_at) AS last_at
        FROM post_replies r
        WHERE r.created_at >= datetime('now', '-${days} days')
          AND r.is_deleted = 0
        GROUP BY r.auteur_id
      UNION ALL
      SELECT r.auteur_id AS user_id, COUNT(*) AS n, MAX(r.created_at) AS last_at
        FROM event_replies r
        WHERE r.created_at >= datetime('now', '-${days} days')
          AND r.is_deleted = 0
        GROUP BY r.auteur_id
    ) combined
    GROUP BY user_id
    ORDER BY total DESC
    LIMIT ?
  `
  const rows = await queryAll<any>(DB, sql, [limit])

  // Join met profiles voor naam — apart om query simpel te houden
  const enriched: any[] = []
  for (const row of rows) {
    const prof = await queryOne<any>(
      DB,
      `SELECT voornaam, achternaam, foto_url FROM profiles WHERE user_id = ?`,
      [row.user_id]
    )
    enriched.push({
      ...row,
      author_name: prof ? `${prof.voornaam || ''} ${prof.achternaam || ''}`.trim() : `User #${row.user_id}`,
      foto_url: prof?.foto_url || null,
    })
  }
  return enriched
}

// ---------- WRITE OPERATIONS ----------
// Helper: tabel-naam veilig kiezen op basis van source. Voorkomt SQL injection
// op de table-name (kan niet als parameter).
function tableFor(source: string): string | null {
  if (source === 'nieuws') return 'post_comments'
  if (source === 'board') return 'post_replies'
  if (source === 'agenda') return 'event_replies'
  return null
}

async function softDelete(DB: D1Database, source: string, id: number): Promise<boolean> {
  const tbl = tableFor(source)
  if (!tbl) return false
  await execute(
    DB,
    `UPDATE ${tbl} SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  )
  return true
}

async function restore(DB: D1Database, source: string, id: number): Promise<boolean> {
  const tbl = tableFor(source)
  if (!tbl) return false
  await execute(
    DB,
    `UPDATE ${tbl} SET is_deleted = 0, is_flagged = 0, flagged_by = NULL, flagged_reason = NULL, flagged_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  )
  return true
}

async function flag(DB: D1Database, source: string, id: number, by: number, reason: string): Promise<boolean> {
  const tbl = tableFor(source)
  if (!tbl) return false
  await execute(
    DB,
    `UPDATE ${tbl} SET is_flagged = 1, flagged_by = ?, flagged_reason = ?, flagged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [by, reason || null, id]
  )
  return true
}

async function unflag(DB: D1Database, source: string, id: number): Promise<boolean> {
  const tbl = tableFor(source)
  if (!tbl) return false
  await execute(
    DB,
    `UPDATE ${tbl} SET is_flagged = 0, flagged_by = NULL, flagged_reason = NULL, flagged_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  )
  return true
}

async function purge(DB: D1Database, source: string, id: number): Promise<boolean> {
  // Permanent verwijderen — alleen vanuit "deleted" tab als laatste stap.
  const tbl = tableFor(source)
  if (!tbl) return false
  await execute(DB, `DELETE FROM ${tbl} WHERE id = ?`, [id])
  return true
}

// ---------- ROUTES ----------
app.get('/admin/comments', async (c) => {
  const user = c.get('user') as any
  const url = new URL(c.req.url)

  const status = (url.searchParams.get('status') || 'visible') as Status
  const source = (url.searchParams.get('source') || 'all') as (Source | 'all')
  const search = (url.searchParams.get('q') || '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = 50
  const offset = (page - 1) * limit

  const { rows, total } = await fetchAllComments(c.env.DB, {
    status, source, search, limit, offset,
  })
  const topAuthors = await fetchTopAuthors(c.env.DB, 7, 5)
  const totalPages = Math.max(1, Math.ceil(total / limit))

  // Flash
  const flash = url.searchParams.get('flash') // 'ok' | 'err' | 'info'
  const flashMsg = url.searchParams.get('msg') || ''

  // Counters per status (voor de tab-badges) — losse lichte queries
  const visibleCountRow = await queryOne<{ n: number }>(c.env.DB, `
    SELECT (
      (SELECT COUNT(*) FROM post_comments WHERE COALESCE(is_deleted,0)=0 AND COALESCE(is_flagged,0)=0) +
      (SELECT COUNT(*) FROM post_replies  WHERE is_deleted=0 AND COALESCE(is_flagged,0)=0) +
      (SELECT COUNT(*) FROM event_replies WHERE is_deleted=0 AND COALESCE(is_flagged,0)=0)
    ) AS n
  `, [])
  const flaggedCountRow = await queryOne<{ n: number }>(c.env.DB, `
    SELECT (
      (SELECT COUNT(*) FROM post_comments WHERE COALESCE(is_flagged,0)=1) +
      (SELECT COUNT(*) FROM post_replies  WHERE COALESCE(is_flagged,0)=1) +
      (SELECT COUNT(*) FROM event_replies WHERE COALESCE(is_flagged,0)=1)
    ) AS n
  `, [])
  const deletedCountRow = await queryOne<{ n: number }>(c.env.DB, `
    SELECT (
      (SELECT COUNT(*) FROM post_comments WHERE COALESCE(is_deleted,0)=1) +
      (SELECT COUNT(*) FROM post_replies  WHERE is_deleted=1) +
      (SELECT COUNT(*) FROM event_replies WHERE is_deleted=1)
    ) AS n
  `, [])
  const visibleCount = visibleCountRow?.n || 0
  const flaggedCount = flaggedCountRow?.n || 0
  const deletedCount = deletedCountRow?.n || 0
  const allCount = visibleCount + flaggedCount + deletedCount

  // --- Tabs + filters URL builders ---
  const buildUrl = (overrides: Record<string, string>) => {
    const u = new URLSearchParams()
    const base = { status, source, q: search, page: '1', ...overrides }
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v)
    return `/admin/comments?${u.toString()}`
  }

  return c.html(
    <Layout title="Comment-moderatie · Admin" user={user}>
      <div class="flex">
        <AdminSidebar activeSection="comments" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-6 md:p-8 bg-gray-50 min-h-screen">
          <div class="max-w-7xl mx-auto">
            {/* Header */}
            <div class="mb-6">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">
                <i class="fas fa-comments mr-2 text-animato-primary"></i>
                Comment-moderatie
              </h1>
              <p class="text-gray-600">
                Centraal overzicht van alle reacties op nieuws en agenda. Verwijderingen zijn soft —
                je kan altijd herstellen vanuit de "Verwijderd" tab.
              </p>
            </div>

            {/* Flash */}
            {flash && (
              <div class={`mb-4 p-4 rounded-lg border-l-4 ${
                flash === 'ok'   ? 'bg-green-50 border-green-500 text-green-800' :
                flash === 'err'  ? 'bg-red-50 border-red-500 text-red-800' :
                                   'bg-blue-50 border-blue-500 text-blue-800'
              }`}>
                <i class={`fas ${
                  flash === 'ok' ? 'fa-check-circle' :
                  flash === 'err' ? 'fa-exclamation-triangle' :
                                    'fa-info-circle'
                } mr-2`}></i>
                {flashMsg || (flash === 'ok' ? 'Actie uitgevoerd.' : 'Er ging iets mis.')}
              </div>
            )}

            {/* Spammer detection panel */}
            {topAuthors.length > 0 && (
              <details class="mb-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <summary class="cursor-pointer p-4 font-semibold text-gray-800 hover:bg-gray-50">
                  <i class="fas fa-user-shield mr-2 text-orange-500"></i>
                  Top auteurs (laatste 7 dagen) — {topAuthors.length} {topAuthors.length === 1 ? 'persoon' : 'personen'}
                </summary>
                <div class="border-t border-gray-200 p-4">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="text-left text-gray-500 border-b border-gray-200">
                        <th class="pb-2">Auteur</th>
                        <th class="pb-2 text-right"># reacties</th>
                        <th class="pb-2">Laatste reactie</th>
                        <th class="pb-2 text-right">Acties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topAuthors.map(a => (
                        <tr class="border-b border-gray-100 last:border-0">
                          <td class="py-2">
                            <a href={`/admin/leden?q=${encodeURIComponent(a.author_name)}`} class="text-blue-600 hover:underline">
                              {a.author_name}
                            </a>
                          </td>
                          <td class={`py-2 text-right font-semibold ${a.total > 20 ? 'text-red-600' : a.total > 10 ? 'text-orange-600' : 'text-gray-700'}`}>
                            {a.total}
                          </td>
                          <td class="py-2 text-gray-500">{fmtDateTime(a.last_at)}</td>
                          <td class="py-2 text-right">
                            <a href={buildUrl({ q: a.author_name, status: 'all' })} class="text-xs text-blue-600 hover:underline">
                              <i class="fas fa-filter mr-1"></i>Toon reacties
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p class="text-xs text-gray-500 mt-3">
                    <i class="fas fa-info-circle mr-1"></i>
                    Rode telling = &gt;20 reacties in 7 dagen, oranje = &gt;10. Niet automatisch verdacht — maar wel een hint om eens binnen te kijken.
                  </p>
                </div>
              </details>
            )}

            {/* Status tabs */}
            <div class="bg-white border border-gray-200 rounded-t-lg flex overflow-x-auto">
              {[
                { key: 'visible', label: 'Zichtbaar', count: visibleCount, color: 'text-gray-700', icon: 'fa-eye' },
                { key: 'flagged', label: 'Gevlagd', count: flaggedCount, color: 'text-orange-600', icon: 'fa-flag' },
                { key: 'deleted', label: 'Verwijderd', count: deletedCount, color: 'text-red-600', icon: 'fa-trash' },
                { key: 'all', label: 'Alle', count: allCount, color: 'text-gray-700', icon: 'fa-layer-group' },
              ].map(tab => {
                const isActive = status === tab.key
                return (
                  <a href={buildUrl({ status: tab.key })}
                     class={`flex-1 min-w-[120px] px-4 py-3 text-center font-medium transition-colors border-b-2 ${
                       isActive
                         ? 'border-animato-primary bg-animato-primary bg-opacity-5 ' + tab.color
                         : 'border-transparent text-gray-500 hover:bg-gray-50'
                     }`}>
                    <i class={`fas ${tab.icon} mr-2`}></i>
                    {tab.label}
                    <span class={`ml-2 px-2 py-0.5 text-xs rounded-full ${isActive ? 'bg-white' : 'bg-gray-200'} ${tab.color}`}>
                      {tab.count}
                    </span>
                  </a>
                )
              })}
            </div>

            {/* Filter row */}
            <form method="GET" action="/admin/comments" class="bg-white border-x border-b border-gray-200 p-4 flex flex-wrap gap-3 items-end">
              <input type="hidden" name="status" value={status} />

              <div class="flex-1 min-w-[200px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Bron</label>
                <select name="source" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="all"    selected={source === 'all'}>Alle bronnen</option>
                  <option value="nieuws" selected={source === 'nieuws'}>Nieuws</option>
                  <option value="agenda" selected={source === 'agenda'}>Agenda</option>
                </select>
              </div>

              <div class="flex-1 min-w-[300px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Zoeken (in tekst of auteur)</label>
                <input type="text" name="q" value={search} placeholder="bv. spam, viagra, gebruikersnaam..."
                       class="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>

              <div class="flex gap-2">
                <button type="submit" class="bg-animato-primary text-white px-4 py-2 rounded font-semibold text-sm hover:opacity-90">
                  <i class="fas fa-search mr-1"></i> Filter
                </button>
                {(search || source !== 'all') && (
                  <a href={`/admin/comments?status=${status}`} class="bg-gray-200 text-gray-700 px-4 py-2 rounded font-semibold text-sm hover:bg-gray-300">
                    <i class="fas fa-times mr-1"></i> Reset
                  </a>
                )}
              </div>
            </form>

            {/* Results */}
            <form method="POST" action="/admin/comments/bulk" id="bulk-form">
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="source" value={source} />
              <input type="hidden" name="q" value={search} />

              <div class="bg-white border-x border-b border-gray-200 rounded-b-lg">
                {rows.length === 0 ? (
                  <div class="p-8 text-center text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-3 text-gray-300"></i>
                    <p>Geen reacties gevonden met deze filters.</p>
                  </div>
                ) : (
                  <>
                    {/* Bulk action bar */}
                    <div class="border-b border-gray-200 p-3 bg-gray-50 flex items-center gap-3 sticky top-0 z-10">
                      <label class="flex items-center text-sm gap-2 cursor-pointer">
                        <input type="checkbox" id="select-all" class="h-4 w-4" />
                        <span class="font-medium text-gray-700">Alles selecteren</span>
                      </label>
                      <span class="text-xs text-gray-500" id="selection-count">0 geselecteerd</span>
                      <div class="ml-auto flex gap-2">
                        <button type="submit" name="action" value="bulk_delete"
                                onclick="return confirm('Weet je zeker dat je alle geselecteerde comments wil soft-deleten?')"
                                class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                                disabled>
                          <i class="fas fa-trash mr-1"></i> Verwijder selectie
                        </button>
                        <button type="submit" name="action" value="bulk_flag"
                                onclick="return confirm('Vlag alle geselecteerde comments als verdacht?')"
                                class="bg-orange-500 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-orange-600 disabled:opacity-50"
                                disabled>
                          <i class="fas fa-flag mr-1"></i> Vlag selectie
                        </button>
                      </div>
                    </div>

                    {/* Comment rows */}
                    <div class="divide-y divide-gray-200">
                      {rows.map(r => {
                        const badge = sourceBadge(r.source)
                        const link = sourceLink(r)
                        const itemKey = `${r.source}:${r.id}`
                        return (
                          <div class={`p-4 hover:bg-gray-50 ${r.is_deleted ? 'opacity-60' : ''}`}>
                            <div class="flex items-start gap-3">
                              <input type="checkbox" name="selected" value={itemKey} class="mt-1 h-4 w-4 bulk-cb" />
                              <div class="flex-1 min-w-0">
                                <div class="flex flex-wrap items-center gap-2 mb-2">
                                  <span class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                                    <i class={`fas ${badge.icon} mr-1`}></i>
                                    {badge.label}
                                  </span>
                                  {r.is_flagged === 1 && (
                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                      <i class="fas fa-flag mr-1"></i> Gevlagd
                                    </span>
                                  )}
                                  {r.is_deleted === 1 && (
                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                      <i class="fas fa-trash mr-1"></i> Verwijderd
                                    </span>
                                  )}
                                  <span class="text-xs text-gray-500">{fmtDateTime(r.created_at)}</span>
                                  <span class="text-xs text-gray-400">•</span>
                                  <span class="text-xs font-medium text-gray-700">{r.author_name || `User #${r.user_id}`}</span>
                                  {r.parent_title && (
                                    <>
                                      <span class="text-xs text-gray-400">•</span>
                                      <a href={link} target="_blank" class="text-xs text-blue-600 hover:underline truncate max-w-[300px]">
                                        <i class="fas fa-external-link-alt mr-1"></i>
                                        {r.parent_title}
                                      </a>
                                    </>
                                  )}
                                </div>
                                <div class={`text-sm text-gray-800 whitespace-pre-wrap break-words ${r.is_deleted ? 'line-through' : ''}`}>
                                  {r.body}
                                </div>
                                {r.flagged_reason && (
                                  <div class="mt-2 text-xs text-orange-700 bg-orange-50 border-l-2 border-orange-400 px-2 py-1 rounded">
                                    <i class="fas fa-flag mr-1"></i>
                                    <strong>Vlag-reden:</strong> {r.flagged_reason}
                                  </div>
                                )}
                              </div>
                              <div class="flex flex-col gap-1 items-stretch min-w-[140px]">
                                {r.is_deleted === 0 && r.is_flagged === 0 && (
                                  <button type="button" onclick={`openFlagDialog('${r.source}', ${r.id})`}
                                          class="text-xs bg-orange-500 text-white px-2 py-1 rounded hover:bg-orange-600">
                                    <i class="fas fa-flag mr-1"></i> Vlag
                                  </button>
                                )}
                                {r.is_flagged === 1 && r.is_deleted === 0 && (
                                  <form method="POST" action={`/admin/comments/${r.source}/${r.id}/unflag`} class="inline">
                                    <button class="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300 w-full">
                                      <i class="fas fa-flag-checkered mr-1"></i> Ontvlag
                                    </button>
                                  </form>
                                )}
                                {r.is_deleted === 0 && (
                                  <form method="POST" action={`/admin/comments/${r.source}/${r.id}/delete`} class="inline"
                                        onsubmit="return confirm('Deze reactie soft-deleten? (Te herstellen vanuit Verwijderd-tab.)')">
                                    <button class="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 w-full">
                                      <i class="fas fa-trash mr-1"></i> Verwijder
                                    </button>
                                  </form>
                                )}
                                {r.is_deleted === 1 && (
                                  <>
                                    <form method="POST" action={`/admin/comments/${r.source}/${r.id}/restore`} class="inline">
                                      <button class="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 w-full">
                                        <i class="fas fa-undo mr-1"></i> Herstel
                                      </button>
                                    </form>
                                    <form method="POST" action={`/admin/comments/${r.source}/${r.id}/purge`} class="inline"
                                          onsubmit="return confirm('PERMANENT verwijderen? Dit kan niet ongedaan worden gemaakt.')">
                                      <button class="text-xs bg-gray-800 text-white px-2 py-1 rounded hover:bg-black w-full">
                                        <i class="fas fa-fire mr-1"></i> Purge
                                      </button>
                                    </form>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </form>

            {/* Pagination */}
            {totalPages > 1 && (
              <div class="mt-4 flex justify-between items-center text-sm">
                <span class="text-gray-600">
                  Pagina {page} van {totalPages} — {total} reacties totaal
                </span>
                <div class="flex gap-1">
                  {page > 1 && (
                    <a href={buildUrl({ page: String(page - 1) })} class="px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50">
                      <i class="fas fa-chevron-left"></i> Vorige
                    </a>
                  )}
                  {page < totalPages && (
                    <a href={buildUrl({ page: String(page + 1) })} class="px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50">
                      Volgende <i class="fas fa-chevron-right"></i>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Flag dialog */}
            <div id="flag-dialog" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50">
              <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                <h3 class="text-lg font-bold text-gray-800 mb-3">
                  <i class="fas fa-flag mr-2 text-orange-500"></i> Comment vlaggen
                </h3>
                <p class="text-sm text-gray-600 mb-4">
                  Markeer deze comment als verdacht zonder hem te verwijderen. Andere admins zien de vlag
                  en kunnen beslissen.
                </p>
                <form id="flag-form" method="POST">
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Reden (optioneel)</label>
                  <textarea name="reason" rows={3} placeholder="bv. spam, ongepaste taal, off-topic..."
                            class="w-full border border-gray-300 rounded px-3 py-2 text-sm"></textarea>
                  <div class="mt-4 flex justify-end gap-2">
                    <button type="button" onclick="document.getElementById('flag-dialog').classList.add('hidden'); document.getElementById('flag-dialog').classList.remove('flex')"
                            class="px-4 py-2 bg-gray-200 text-gray-700 rounded font-medium text-sm hover:bg-gray-300">
                      Annuleren
                    </button>
                    <button type="submit" class="px-4 py-2 bg-orange-500 text-white rounded font-semibold text-sm hover:bg-orange-600">
                      <i class="fas fa-flag mr-1"></i> Vlag
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Inline script: selection + flag dialog */}
            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var selectAll = document.getElementById('select-all');
                var cbs = document.querySelectorAll('.bulk-cb');
                var countEl = document.getElementById('selection-count');
                var bulkBtns = document.querySelectorAll('#bulk-form button[name="action"]');

                function updateCount() {
                  var n = 0;
                  cbs.forEach(function(cb) { if (cb.checked) n++; });
                  if (countEl) countEl.textContent = n + ' geselecteerd';
                  bulkBtns.forEach(function(b) { b.disabled = (n === 0); });
                }

                if (selectAll) {
                  selectAll.addEventListener('change', function() {
                    cbs.forEach(function(cb) { cb.checked = selectAll.checked; });
                    updateCount();
                  });
                }
                cbs.forEach(function(cb) { cb.addEventListener('change', updateCount); });
                updateCount();

                // Flag dialog
                window.openFlagDialog = function(source, id) {
                  var dlg = document.getElementById('flag-dialog');
                  var form = document.getElementById('flag-form');
                  form.action = '/admin/comments/' + source + '/' + id + '/flag';
                  dlg.classList.remove('hidden');
                  dlg.classList.add('flex');
                };
              })();
            `}} />
          </div>
        </main>
      </div>
    </Layout>
  )
})

// ---------- WRITE ENDPOINTS ----------
function preserveFilters(c: any): Record<string, string> {
  const url = new URL(c.req.url)
  const out: Record<string, string> = {}
  for (const k of ['status', 'source', 'q', 'page']) {
    const v = url.searchParams.get(k)
    if (v) out[k] = v
  }
  return out
}

app.post('/admin/comments/:source/:id/delete', async (c) => {
  const source = c.req.param('source')
  const id = parseInt(c.req.param('id'), 10)
  const ok = await softDelete(c.env.DB, source, id)
  return c.redirect(flashRedirect({
    ...preserveFilters(c),
    flash: ok ? 'ok' : 'err',
    msg: ok ? 'Reactie soft-deleted.' : 'Verwijderen mislukt.',
  }))
})

app.post('/admin/comments/:source/:id/restore', async (c) => {
  const source = c.req.param('source')
  const id = parseInt(c.req.param('id'), 10)
  const ok = await restore(c.env.DB, source, id)
  return c.redirect(flashRedirect({
    ...preserveFilters(c),
    flash: ok ? 'ok' : 'err',
    msg: ok ? 'Reactie hersteld.' : 'Herstellen mislukt.',
  }))
})

app.post('/admin/comments/:source/:id/flag', async (c) => {
  const user = c.get('user') as any
  const source = c.req.param('source')
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.parseBody()
  const reason = String(body.reason || '').trim().substring(0, 500)
  const ok = await flag(c.env.DB, source, id, user.id, reason)
  return c.redirect(flashRedirect({
    ...preserveFilters(c),
    flash: ok ? 'ok' : 'err',
    msg: ok ? 'Reactie gevlagd.' : 'Vlaggen mislukt.',
  }))
})

app.post('/admin/comments/:source/:id/unflag', async (c) => {
  const source = c.req.param('source')
  const id = parseInt(c.req.param('id'), 10)
  const ok = await unflag(c.env.DB, source, id)
  return c.redirect(flashRedirect({
    ...preserveFilters(c),
    flash: ok ? 'ok' : 'err',
    msg: ok ? 'Vlag verwijderd.' : 'Ontvlaggen mislukt.',
  }))
})

app.post('/admin/comments/:source/:id/purge', async (c) => {
  const source = c.req.param('source')
  const id = parseInt(c.req.param('id'), 10)
  const ok = await purge(c.env.DB, source, id)
  return c.redirect(flashRedirect({
    ...preserveFilters(c),
    flash: ok ? 'ok' : 'err',
    msg: ok ? 'Reactie permanent verwijderd.' : 'Purge mislukt.',
  }))
})

// Bulk action: selected = "source:id" strings
app.post('/admin/comments/bulk', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.parseBody({ all: true })
  const action = String(body.action || '')
  const rawSelected = body.selected
  const selected: string[] = Array.isArray(rawSelected) ? rawSelected.map(String) : (rawSelected ? [String(rawSelected)] : [])

  // Filter-preservatie via form fields
  const status = String(body.status || 'visible')
  const source = String(body.source || 'all')
  const q = String(body.q || '')

  if (selected.length === 0) {
    return c.redirect(flashRedirect({ status, source, q, flash: 'err', msg: 'Geen reacties geselecteerd.' }))
  }

  let count = 0
  for (const key of selected) {
    const [src, idStr] = key.split(':')
    const id = parseInt(idStr, 10)
    if (!src || isNaN(id)) continue
    let ok = false
    if (action === 'bulk_delete') ok = await softDelete(c.env.DB, src, id)
    else if (action === 'bulk_flag') ok = await flag(c.env.DB, src, id, user.id, 'Bulk-gevlagd door admin')
    if (ok) count++
  }

  const msg = action === 'bulk_delete'
    ? `${count} reactie(s) soft-deleted.`
    : `${count} reactie(s) gevlagd.`
  return c.redirect(flashRedirect({ status, source, q, flash: 'ok', msg }))
})

export default app
