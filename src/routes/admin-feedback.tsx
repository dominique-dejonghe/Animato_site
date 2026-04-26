import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import type { Bindings, SessionUser } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware – scoped to /admin/* and /api/admin/* only
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
}
app.use('/admin/*', adminAuthMiddleware)
app.use('/api/admin/*', adminAuthMiddleware)

// =============================================================================
// STATUS CONFIG - Central definition of all statuses
// =============================================================================
const STATUS_CONFIG = [
  { val: 'all', label: 'Alles', color: 'bg-gray-100 text-gray-700', icon: '' },
  { val: 'open', label: 'Open', color: 'bg-yellow-100 text-yellow-800', icon: '🟡' },
  { val: 'meer_info_nodig', label: 'Meer info nodig', color: 'bg-orange-100 text-orange-800', icon: '🔶' },
  { val: 'in_progress', label: 'In behandeling', color: 'bg-blue-100 text-blue-800', icon: '🔵' },
  { val: 'hertesten', label: 'Hertesten', color: 'bg-purple-100 text-purple-800', icon: '🔁' },
  { val: 'resolved', label: 'Opgelost', color: 'bg-green-100 text-green-800', icon: '✅' },
  { val: 'rejected', label: 'Afgewezen', color: 'bg-red-100 text-red-800', icon: '❌' },
]

function getStatusLabel(status: string): string {
  return STATUS_CONFIG.find(s => s.val === status)?.label || status
}

function getStatusColor(status: string): string {
  return STATUS_CONFIG.find(s => s.val === status)?.color || 'bg-gray-100 text-gray-800'
}

function getStatusIcon(status: string): string {
  return STATUS_CONFIG.find(s => s.val === status)?.icon || ''
}

// =============================================================================
// EXPORT ENDPOINTS - AI-ready JSON and Markdown exports
// =============================================================================

// JSON Export - structured for AI consumption (Genspark AI)
app.get('/api/admin/feedback/export/json', async (c) => {
  const statusFilter = c.req.query('status') || 'open'  // default: open items
  const typeFilter = c.req.query('type') || 'all'

  let query = `SELECT f.*, u.email, p.voornaam, p.achternaam,
     (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE 1=1`
  const params: any[] = []

  // Allow 'actionable' to get all non-resolved/non-rejected items
  if (statusFilter === 'actionable') {
    query += ` AND f.status NOT IN ('resolved', 'rejected')`
  } else if (statusFilter !== 'all') {
    query += ` AND f.status = ?`
    params.push(statusFilter)
  }
  if (typeFilter !== 'all') { query += ` AND f.type = ?`; params.push(typeFilter) }
  query += ` ORDER BY f.created_at DESC`

  const feedback = await queryAll<any>(c.env.DB, query, params)

  // Fetch all comments for these items
  const feedbackIds = feedback.map((f: any) => f.id)
  const allComments: Record<number, any[]> = {}

  for (const fId of feedbackIds) {
    const comments = await queryAll<any>(
      c.env.DB,
      `SELECT fc.message, fc.is_admin, fc.created_at, p.voornaam, p.achternaam
       FROM feedback_comments fc
       LEFT JOIN profiles p ON p.user_id = fc.user_id
       WHERE fc.feedback_id = ?
       ORDER BY fc.created_at ASC`,
      [fId]
    )
    allComments[fId] = comments || []
  }

  // Build AI-ready export structure
  const exportData = {
    _meta: {
      export_type: 'animato_feedback_export',
      version: '2.0',
      exported_at: new Date().toISOString(),
      filter: { status: statusFilter, type: typeFilter },
      total_items: feedback.length,
      instructions_for_ai: `Dit is een export van feedback items (bugs en feature requests) voor de Animato Koor website (https://animato-live.pages.dev). 
Elke bug bevat de pagina-URL waar het probleem zich voordoet, een beschrijving, browser-informatie (indien beschikbaar), en de conversatie tussen admin en melder.
Wanneer je een bug oplost:
1. Gebruik de 'url' veld om te bepalen welke pagina/route affected is
2. Gebruik 'browser_info' voor environment context
3. Lees de 'conversation' voor extra context en verduidelijkingen
4. Na het oplossen, roep POST /api/admin/feedback/bulk-status aan met status 'hertesten' zodat de melder kan hertesten
Items met status 'meer_info_nodig' hebben onvoldoende informatie - deze moeten eerst beantwoord worden door de melder.`
    },
    items: feedback.map((item: any) => ({
      id: item.id,
      type: item.type,
      type_label: item.type === 'bug' ? 'Bug Report' : item.type === 'feature' ? 'Feature Request' : 'Other',
      status: item.status,
      status_label: getStatusLabel(item.status),
      reported_by: {
        name: `${item.voornaam || ''} ${item.achternaam || ''}`.trim() || 'Onbekend',
        email: item.email || null
      },
      page_url: item.url || null,
      description: item.message,
      browser_info: item.browser_info || null,
      has_screenshot: !!item.screenshot,
      admin_notes: item.admin_notes || null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      conversation: allComments[item.id]?.map((c: any) => ({
        from: c.is_admin ? 'admin' : `${c.voornaam || ''} ${c.achternaam || ''}`.trim() || 'gebruiker',
        message: c.message,
        timestamp: c.created_at
      })) || []
    }))
  }

  return c.json(exportData, 200, {
    'Content-Disposition': `attachment; filename="animato-feedback-export-${new Date().toISOString().slice(0,10)}.json"`,
    'Content-Type': 'application/json; charset=utf-8'
  })
})

// Markdown Export - human-readable summary for AI context
app.get('/api/admin/feedback/export/markdown', async (c) => {
  const statusFilter = c.req.query('status') || 'actionable'
  const typeFilter = c.req.query('type') || 'all'

  let query = `SELECT f.*, u.email, p.voornaam, p.achternaam,
     (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE 1=1`
  const params: any[] = []

  if (statusFilter === 'actionable') {
    query += ` AND f.status NOT IN ('resolved', 'rejected')`
  } else if (statusFilter !== 'all') {
    query += ` AND f.status = ?`
    params.push(statusFilter)
  }
  if (typeFilter !== 'all') { query += ` AND f.type = ?`; params.push(typeFilter) }
  query += ` ORDER BY f.status ASC, f.created_at DESC`

  const feedback = await queryAll<any>(c.env.DB, query, params)

  // Fetch comments for each item
  let md = `# Animato Feedback Export\n`
  md += `> Geëxporteerd op ${new Date().toISOString()}\n`
  md += `> Filter: status=${statusFilter}, type=${typeFilter}\n`
  md += `> Totaal: ${feedback.length} items\n\n`
  md += `---\n\n`

  // Group by status
  const grouped: Record<string, any[]> = {}
  for (const item of feedback) {
    if (!grouped[item.status]) grouped[item.status] = []
    grouped[item.status].push(item)
  }

  for (const [status, items] of Object.entries(grouped)) {
    md += `## ${getStatusIcon(status)} ${getStatusLabel(status)} (${items.length})\n\n`

    for (const item of items) {
      const typeEmoji = item.type === 'bug' ? '🐛' : item.type === 'feature' ? '💡' : '📝'
      md += `### ${typeEmoji} #${item.id} — ${item.type === 'bug' ? 'Bug' : item.type === 'feature' ? 'Feature Request' : 'Other'}\n\n`
      md += `- **Melder**: ${item.voornaam || ''} ${item.achternaam || ''} (${item.email || 'geen email'})\n`
      md += `- **Pagina**: ${item.url || 'niet opgegeven'}\n`
      md += `- **Datum**: ${item.created_at}\n`
      if (item.browser_info) md += `- **Browser**: ${item.browser_info}\n`
      md += `- **Screenshot**: ${item.screenshot ? 'Ja (beschikbaar in admin panel)' : 'Nee'}\n`
      md += `\n**Beschrijving:**\n> ${item.message.replace(/\n/g, '\n> ')}\n\n`

      if (item.admin_notes) {
        md += `**Admin notities:**\n> ${item.admin_notes}\n\n`
      }

      // Fetch and add comments
      const comments = await queryAll<any>(
        c.env.DB,
        `SELECT fc.message, fc.is_admin, fc.created_at, p.voornaam, p.achternaam
         FROM feedback_comments fc
         LEFT JOIN profiles p ON p.user_id = fc.user_id
         WHERE fc.feedback_id = ?
         ORDER BY fc.created_at ASC`,
        [item.id]
      )

      if (comments && comments.length > 0) {
        md += `**Conversatie (${comments.length} berichten):**\n\n`
        for (const cm of comments) {
          const who = cm.is_admin ? '🛡️ Admin' : `👤 ${cm.voornaam || ''} ${cm.achternaam || ''}`.trim()
          md += `- **${who}** (${cm.created_at}): ${cm.message}\n`
        }
        md += `\n`
      }

      md += `---\n\n`
    }
  }

  return c.text(md, 200, {
    'Content-Disposition': `attachment; filename="animato-feedback-export-${new Date().toISOString().slice(0,10)}.md"`,
    'Content-Type': 'text/markdown; charset=utf-8'
  })
})

// =============================================================================
// BULK STATUS UPDATE - After AI resolves bugs, set status to 'hertesten'
// =============================================================================
app.post('/api/admin/feedback/bulk-status', async (c) => {
  try {
    const body = await c.req.json()
    const ids = body.ids as number[]
    const status = body.status as string
    const adminNote = body.admin_note as string || null

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'IDs array is verplicht' }, 400)
    }

    const validStatuses = ['open', 'in_progress', 'meer_info_nodig', 'hertesten', 'resolved', 'rejected']
    if (!validStatuses.includes(status)) {
      return c.json({ error: `Ongeldige status. Kies uit: ${validStatuses.join(', ')}` }, 400)
    }

    let updated = 0
    for (const id of ids) {
      let sql = `UPDATE feedback SET status = ?, updated_at = CURRENT_TIMESTAMP`
      const params: any[] = [status]
      if (adminNote) {
        sql += `, admin_notes = COALESCE(admin_notes || '\n', '') || ?`
        params.push(`[${new Date().toISOString()}] ${adminNote}`)
      }
      sql += ` WHERE id = ?`
      params.push(id)
      await execute(c.env.DB, sql, params)
      updated++
    }

    return c.json({ success: true, updated, status })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// =============================================================================
// ASK FOR MORE INFO - Send info request to reporter, change status
// =============================================================================
app.post('/api/admin/feedback/ask-info', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.json()
    const feedbackId = body.feedback_id as number
    const question = (body.question as string || '').trim()

    if (!feedbackId || !question) {
      return c.json({ error: 'Feedback ID en vraag zijn verplicht' }, 400)
    }

    // Add admin comment with the question
    await execute(
      c.env.DB,
      `INSERT INTO feedback_comments (feedback_id, user_id, message, is_admin) VALUES (?, ?, ?, 1)`,
      [feedbackId, user.id, question]
    )

    // Update status to 'meer_info_nodig'
    await execute(
      c.env.DB,
      `UPDATE feedback SET status = 'meer_info_nodig', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [feedbackId]
    )

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// =============================================================================
// UPDATE SINGLE FEEDBACK STATUS (enhanced)
// =============================================================================
app.post('/api/admin/feedback/update', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const status = body.status as string
  const id = body.id as string

  const validStatuses = ['open', 'in_progress', 'meer_info_nodig', 'hertesten', 'resolved', 'rejected']
  if (!validStatuses.includes(status)) {
    return c.redirect('/admin/feedback')
  }

  // Auto-assign: bij in_progress / hertesten / meer_info_nodig wordt de huidige admin
  // automatisch toegewezen als er nog niemand toegewezen is. Zo weet je achteraf
  // wie het opvolgde of moest hertesten.
  const autoAssignStatuses = ['in_progress', 'hertesten', 'meer_info_nodig']
  if (autoAssignStatuses.includes(status)) {
    await execute(
      c.env.DB,
      `UPDATE feedback
         SET status = ?,
             assigned_to = COALESCE(assigned_to, ?),
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, user.id, id]
    )
  } else {
    await execute(
      c.env.DB,
      "UPDATE feedback SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, id]
    )
  }
  // Behoud filter na status-wijziging zodat admin niet uit zijn filter geknikkerd wordt
  const ref = c.req.header('referer') || '/admin/feedback'
  return c.redirect(ref)
})

// =============================================================================
// ASSIGN FEEDBACK TO ADMIN (or unassign)
// =============================================================================
app.post('/api/admin/feedback/assign', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const id = body.id as string
  const assignedToRaw = body.assigned_to as string

  let assignedTo: number | null = null
  if (assignedToRaw === 'me') {
    assignedTo = user.id
  } else if (assignedToRaw === '' || assignedToRaw === 'null' || assignedToRaw === 'unassign') {
    assignedTo = null
  } else if (/^\d+$/.test(assignedToRaw)) {
    assignedTo = parseInt(assignedToRaw, 10)
  }

  await execute(
    c.env.DB,
    "UPDATE feedback SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [assignedTo, id]
  )
  const ref = c.req.header('referer') || '/admin/feedback'
  return c.redirect(ref)
})

// =============================================================================
// MAIN ADMIN FEEDBACK PAGE
// =============================================================================
app.get('/admin/feedback', async (c) => {
  const user = c.get('user') as SessionUser
  const statusFilter = c.req.query('status') || 'all'
  const typeFilter = c.req.query('type') || 'all'
  const ageFilter = c.req.query('age') || 'all'  // today|week|month|quarter|older|actionable
  const sortFilter = c.req.query('sort') || 'newest' // newest|oldest
  // Toewijzing-filter: 'all' | 'mine' | 'unassigned' | numeric admin id | 'mine_hertesten' shortcut
  const assignedFilter = c.req.query('assigned') || 'all'

  let query = `SELECT f.*, u.email, p.voornaam, p.achternaam,
     a.email as assigned_email, ap.voornaam as assigned_voornaam, ap.achternaam as assigned_achternaam,
     (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count,
     (SELECT MAX(fc.created_at) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as last_comment_at
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN users a ON a.id = f.assigned_to
     LEFT JOIN profiles ap ON ap.user_id = f.assigned_to
     WHERE 1=1`
  const params: any[] = []

  if (statusFilter !== 'all') { query += ` AND f.status = ?`; params.push(statusFilter) }
  if (typeFilter !== 'all') { query += ` AND f.type = ?`; params.push(typeFilter) }

  // Toewijzing-filter
  if (assignedFilter === 'mine') {
    query += ` AND f.assigned_to = ?`
    params.push(user.id)
  } else if (assignedFilter === 'mine_hertesten') {
    query += ` AND f.assigned_to = ? AND f.status = 'hertesten'`
    params.push(user.id)
  } else if (assignedFilter === 'unassigned') {
    query += ` AND f.assigned_to IS NULL`
  } else if (/^\d+$/.test(assignedFilter)) {
    query += ` AND f.assigned_to = ?`
    params.push(parseInt(assignedFilter, 10))
  }

  // Leeftijd-filter (alleen relevant op openstaande items, behalve 'all')
  if (ageFilter === 'today')   query += ` AND julianday('now') - julianday(f.created_at) < 1`
  if (ageFilter === 'week')    query += ` AND julianday('now') - julianday(f.created_at) >= 1 AND julianday('now') - julianday(f.created_at) < 7`
  if (ageFilter === 'month')   query += ` AND julianday('now') - julianday(f.created_at) >= 7 AND julianday('now') - julianday(f.created_at) < 30`
  if (ageFilter === 'quarter') query += ` AND julianday('now') - julianday(f.created_at) >= 30 AND julianday('now') - julianday(f.created_at) < 90`
  if (ageFilter === 'older')   query += ` AND julianday('now') - julianday(f.created_at) >= 90`
  // 'actionable' filter: alleen open/in_progress/meer_info/hertesten
  if (ageFilter === 'actionable' && statusFilter === 'all') {
    query += ` AND f.status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten')`
  }

  query += sortFilter === 'oldest' ? ` ORDER BY f.created_at ASC` : ` ORDER BY f.created_at DESC`

  const feedback = await queryAll(c.env.DB, query, params)

  // Lijst van alle admins voor toewijzing-dropdown + filter
  const allAdmins = await queryAll<any>(c.env.DB, `
    SELECT u.id, u.email, p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.role = 'admin' AND u.status = 'actief'
    ORDER BY p.voornaam, p.achternaam
  `)

  // Counts voor "mijn tickets" KPI's
  const myStats = await queryOne<any>(c.env.DB, `
    SELECT
      COUNT(*) as my_total,
      SUM(CASE WHEN status = 'hertesten' THEN 1 ELSE 0 END) as my_hertesten,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as my_in_progress,
      SUM(CASE WHEN status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten') THEN 1 ELSE 0 END) as my_actionable
    FROM feedback WHERE assigned_to = ?
  `, [user.id])

  // Niet-toegewezen openstaande items (interessante indicator)
  const unassignedOpen = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) as cnt FROM feedback
    WHERE assigned_to IS NULL
      AND status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten')
  `)

  // Count per status for badges
  const counts = await queryAll<any>(c.env.DB, `SELECT status, COUNT(*) as cnt FROM feedback GROUP BY status`)
  const countMap: Record<string,number> = {}
  for (const r of counts) countMap[r.status] = r.cnt

  // Count actionable (for export badge)
  const actionableCount = (countMap['open'] || 0) + (countMap['in_progress'] || 0) + (countMap['meer_info_nodig'] || 0) + (countMap['hertesten'] || 0)

  // ============================================================
  // DASHBOARD STATS — overzicht van bugs/ideas + verloop over tijd
  // ============================================================
  // 1. Totalen per type (bugs vs features vs other)
  const typeCounts = await queryAll<any>(c.env.DB, `SELECT type, COUNT(*) as cnt FROM feedback GROUP BY type`)
  const typeMap: Record<string, number> = { bug: 0, feature: 0, other: 0 }
  for (const r of typeCounts) typeMap[r.type] = r.cnt

  // 2. Type x Status kruistabel (hoeveel bugs zijn open, hoeveel features in progress, etc.)
  const crossStats = await queryAll<any>(c.env.DB,
    `SELECT type, status, COUNT(*) as cnt FROM feedback GROUP BY type, status`)
  const crossMap: Record<string, Record<string, number>> = {}
  for (const r of crossStats) {
    if (!crossMap[r.type]) crossMap[r.type] = {}
    crossMap[r.type][r.status] = r.cnt
  }

  // 3. Tijd-distributie: hoe lang staan ACTIONABLE items al open?
  //    Berekend obv created_at — geeft buckets: <1d, 1-7d, 7-30d, 30-90d, 90+d
  const ageDistro = await queryAll<any>(c.env.DB, `
    SELECT
      CASE
        WHEN julianday('now') - julianday(created_at) < 1 THEN 'today'
        WHEN julianday('now') - julianday(created_at) < 7 THEN 'week'
        WHEN julianday('now') - julianday(created_at) < 30 THEN 'month'
        WHEN julianday('now') - julianday(created_at) < 90 THEN 'quarter'
        ELSE 'older'
      END as bucket,
      COUNT(*) as cnt
    FROM feedback
    WHERE status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten')
    GROUP BY bucket`)
  const ageMap: Record<string, number> = { today: 0, week: 0, month: 0, quarter: 0, older: 0 }
  for (const r of ageDistro) ageMap[r.bucket] = r.cnt

  // 4. Gemiddelde resolutie-tijd voor opgeloste items (resolved/rejected)
  //    in dagen: updated_at - created_at
  const avgResolution = await queryOne<any>(c.env.DB, `
    SELECT
      AVG(julianday(updated_at) - julianday(created_at)) as avg_days,
      MIN(julianday(updated_at) - julianday(created_at)) as min_days,
      MAX(julianday(updated_at) - julianday(created_at)) as max_days,
      COUNT(*) as resolved_count
    FROM feedback
    WHERE status IN ('resolved', 'rejected')
      AND updated_at IS NOT NULL`)

  // 5. Gemiddelde leeftijd van openstaande items (in dagen)
  const avgOpenAge = await queryOne<any>(c.env.DB, `
    SELECT AVG(julianday('now') - julianday(created_at)) as avg_days
    FROM feedback
    WHERE status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten')`)

  // 6. Top 5 oudste openstaande items
  const oldestOpen = await queryAll<any>(c.env.DB, `
    SELECT f.id, f.type, f.status, f.message, f.created_at,
      julianday('now') - julianday(f.created_at) as age_days,
      p.voornaam, p.achternaam
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE f.status IN ('open', 'in_progress', 'meer_info_nodig', 'hertesten')
    ORDER BY f.created_at ASC
    LIMIT 5`)

  // 7. Trend: nieuwe items per week (laatste 12 weken)
  const trendRaw = await queryAll<any>(c.env.DB, `
    SELECT
      strftime('%Y-%W', created_at) as week_key,
      DATE(created_at, 'weekday 0', '-7 days') as week_start,
      COUNT(*) as new_count,
      SUM(CASE WHEN type = 'bug' THEN 1 ELSE 0 END) as bug_count,
      SUM(CASE WHEN type = 'feature' THEN 1 ELSE 0 END) as feature_count
    FROM feedback
    WHERE julianday('now') - julianday(created_at) < 84
    GROUP BY week_key
    ORDER BY week_start ASC`)

  // 8. Recent activiteit: items met updates in laatste 7 dagen
  const recentActivity = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) as cnt FROM feedback
    WHERE julianday('now') - julianday(updated_at) < 7
      AND updated_at != created_at`)

  // 9. Nieuw deze week
  const newThisWeek = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) as cnt FROM feedback
    WHERE julianday('now') - julianday(created_at) < 7`)

  // 10. Resolved deze week
  const resolvedThisWeek = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) as cnt FROM feedback
    WHERE status IN ('resolved', 'rejected')
      AND julianday('now') - julianday(updated_at) < 7`)

  const totalCount = (countMap['open'] || 0) + (countMap['in_progress'] || 0) + (countMap['meer_info_nodig'] || 0)
                   + (countMap['hertesten'] || 0) + (countMap['resolved'] || 0) + (countMap['rejected'] || 0)

  // Helper voor relatieve tijd
  function fmtDays(d: number | null | undefined): string {
    if (d == null) return '—'
    const days = Math.round(d * 10) / 10
    if (days < 1) return Math.round(d * 24) + 'u'
    if (days < 30) return days + 'd'
    return Math.round(days / 30 * 10) / 10 + 'm'
  }

  // Helper voor filter URLs vanuit dashboard
  function filterUrl(opts: { status?: string; type?: string; age?: string; sort?: string; assigned?: string }): string {
    const params = new URLSearchParams()
    params.set('status', opts.status ?? 'all')
    params.set('type', opts.type ?? 'all')
    if (opts.age && opts.age !== 'all') params.set('age', opts.age)
    if (opts.sort) params.set('sort', opts.sort)
    if (opts.assigned && opts.assigned !== 'all') params.set('assigned', opts.assigned)
    return '/admin/feedback?' + params.toString() + '#feedback-list'
  }

  // Is er een actief dashboard-filter?
  const hasActiveFilter = statusFilter !== 'all' || typeFilter !== 'all' || ageFilter !== 'all' || sortFilter !== 'newest' || assignedFilter !== 'all'

  // Helper: label voor assigned-filter banner
  function assignedFilterLabel(val: string): string {
    if (val === 'mine') return 'Mijn tickets'
    if (val === 'mine_hertesten') return 'Mijn hertesten'
    if (val === 'unassigned') return 'Niet toegewezen'
    if (/^\d+$/.test(val)) {
      const a = allAdmins.find((x: any) => x.id === parseInt(val, 10))
      return a ? `Toegewezen aan ${a.voornaam || a.email}` : `Admin #${val}`
    }
    return val
  }

  return c.html(
    <Layout title="Beta Feedback" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="feedback" />
        <div class="flex-1 p-8">
          {/* Header with export buttons */}
          <div class="flex flex-wrap items-start justify-between gap-4 mb-2">
            <div>
              <h1 class="text-3xl font-bold text-gray-900">
                <i class="fas fa-bug text-animato-primary mr-3"></i>
                Beta Feedback
              </h1>
              <p class="text-gray-500 mt-1">{feedback.length} item(s) gevonden</p>
            </div>
            <div class="flex flex-wrap gap-2">
              {/* Export dropdown */}
              <div class="relative" id="export-dropdown-container">
                <button
                  onclick="document.getElementById('export-menu').classList.toggle('hidden')"
                  class="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition shadow-sm flex items-center gap-2"
                >
                  <i class="fas fa-file-export"></i>
                  Export
                  {actionableCount > 0 && (
                    <span class="bg-white text-indigo-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{actionableCount}</span>
                  )}
                  <i class="fas fa-chevron-down text-xs ml-1"></i>
                </button>
                <div id="export-menu" class="hidden absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 py-2">
                  <div class="px-4 py-2 border-b">
                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Export voor AI (Genspark)</p>
                  </div>
                  <a
                    href="/api/admin/feedback/export/json?status=actionable"
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    target="_blank"
                  >
                    <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <i class="fas fa-code text-blue-600"></i>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-gray-900">JSON Export (alle open)</p>
                      <p class="text-xs text-gray-500">Gestructureerd voor AI bug-fixing</p>
                    </div>
                  </a>
                  <a
                    href="/api/admin/feedback/export/markdown?status=actionable"
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    target="_blank"
                  >
                    <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <i class="fab fa-markdown text-green-600"></i>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-gray-900">Markdown Export (alle open)</p>
                      <p class="text-xs text-gray-500">Leesbaar overzicht + context</p>
                    </div>
                  </a>
                  <div class="border-t my-1"></div>
                  <div class="px-4 py-2 border-b">
                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gefilterd op huidige selectie</p>
                  </div>
                  <a
                    href={`/api/admin/feedback/export/json?status=${statusFilter}&type=${typeFilter}`}
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    target="_blank"
                  >
                    <div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <i class="fas fa-filter text-gray-600"></i>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-gray-900">JSON (huidige filter)</p>
                      <p class="text-xs text-gray-500">Status: {statusFilter}, Type: {typeFilter}</p>
                    </div>
                  </a>
                  <a
                    href={`/api/admin/feedback/export/markdown?status=${statusFilter}&type=${typeFilter}`}
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    target="_blank"
                  >
                    <div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <i class="fab fa-markdown text-gray-600"></i>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-gray-900">Markdown (huidige filter)</p>
                      <p class="text-xs text-gray-500">Status: {statusFilter}, Type: {typeFilter}</p>
                    </div>
                  </a>
                </div>
              </div>
              {/* Bulk hertesten button */}
              <button
                onclick="bulkSetHertesten()"
                id="bulk-hertesten-btn"
                class="hidden px-4 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition shadow-sm flex items-center gap-2"
              >
                <i class="fas fa-sync-alt"></i>
                <span id="bulk-hertesten-label">Hertesten</span>
              </button>
            </div>
          </div>

          {/* ============================================================
              DASHBOARD — Overzicht & verloop over tijd
              ============================================================ */}
          <details open class="mb-6 bg-gradient-to-br from-indigo-50 via-white to-purple-50 rounded-xl shadow-sm border border-indigo-100">
            <summary class="cursor-pointer px-5 py-4 font-semibold text-gray-800 flex items-center gap-2 hover:bg-white/50 rounded-t-xl">
              <i class="fas fa-chart-line text-indigo-600"></i>
              <span>Dashboard — overzicht & trends</span>
              <span class="text-xs text-gray-500 font-normal ml-2">(klik om in/uit te klappen)</span>
            </summary>
            <div class="p-5 pt-0 space-y-5">

              {/* "Mijn tickets" rij — admin-specifieke KPI cards (alleen als er iets toegewezen is) */}
              {(myStats?.my_total > 0 || (unassignedOpen?.cnt || 0) > 0) && (
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
                  <a href={filterUrl({ assigned: 'mine_hertesten' })} class={`rounded-lg p-4 shadow-sm border-l-4 border-purple-500 transition cursor-pointer block ${
                    (myStats?.my_hertesten || 0) > 0
                      ? 'bg-gradient-to-br from-purple-50 to-pink-50 hover:shadow-md ring-1 ring-purple-200'
                      : 'bg-white hover:shadow-md'
                  }`}>
                    <p class="text-xs text-purple-700 uppercase tracking-wide font-semibold flex items-center gap-1">
                      <i class="fas fa-rotate"></i> Mijn hertesten
                    </p>
                    <p class="text-2xl font-bold text-purple-800">{myStats?.my_hertesten || 0}</p>
                    <p class="text-xs text-gray-500 mt-1">
                      {(myStats?.my_hertesten || 0) > 0 ? 'jij moet (her)testen →' : 'niets te hertesten 🎉'}
                    </p>
                  </a>
                  <a href={filterUrl({ assigned: 'mine' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-indigo-400 hover:shadow-md hover:bg-indigo-50 transition cursor-pointer block">
                    <p class="text-xs text-indigo-700 uppercase tracking-wide font-semibold flex items-center gap-1">
                      <i class="fas fa-user-tag"></i> Mijn tickets
                    </p>
                    <p class="text-2xl font-bold text-indigo-800">{myStats?.my_total || 0}</p>
                    <p class="text-xs text-gray-500 mt-1">{myStats?.my_actionable || 0} openstaand →</p>
                  </a>
                  <a href={filterUrl({ assigned: 'mine', status: 'in_progress' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-blue-400 hover:shadow-md hover:bg-blue-50 transition cursor-pointer block">
                    <p class="text-xs text-blue-700 uppercase tracking-wide font-semibold flex items-center gap-1">
                      <i class="fas fa-spinner"></i> Mijn in behandeling
                    </p>
                    <p class="text-2xl font-bold text-blue-800">{myStats?.my_in_progress || 0}</p>
                    <p class="text-xs text-gray-500 mt-1">onder werk bij jou →</p>
                  </a>
                  <a href={filterUrl({ assigned: 'unassigned' })} class={`rounded-lg p-4 shadow-sm border-l-4 transition cursor-pointer block ${
                    (unassignedOpen?.cnt || 0) > 0
                      ? 'border-amber-500 bg-amber-50 hover:shadow-md'
                      : 'border-gray-300 bg-white hover:shadow-md'
                  }`}>
                    <p class="text-xs text-amber-700 uppercase tracking-wide font-semibold flex items-center gap-1">
                      <i class="fas fa-question-circle"></i> Niet toegewezen
                    </p>
                    <p class="text-2xl font-bold text-amber-800">{unassignedOpen?.cnt || 0}</p>
                    <p class="text-xs text-gray-500 mt-1">openstaand zonder eigenaar →</p>
                  </a>
                </div>
              )}

              {/* KPI cards row — klikbaar, filter de lijst */}
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <a href={filterUrl({ status: 'all', type: 'all' })} class="bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-gray-300 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Totaal</p>
                  <p class="text-2xl font-bold text-gray-900">{totalCount}</p>
                  <p class="text-xs text-gray-400 mt-1">{typeMap.bug} bugs · {typeMap.feature} ideeën</p>
                </a>
                <a href={filterUrl({ status: 'open' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-yellow-400 hover:shadow-md hover:bg-yellow-50 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Open</p>
                  <p class="text-2xl font-bold text-yellow-700">{countMap['open'] || 0}</p>
                  <p class="text-xs text-gray-400 mt-1">wachten op behandeling</p>
                </a>
                <a href={filterUrl({ status: 'in_progress' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-blue-400 hover:shadow-md hover:bg-blue-50 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">In behandeling</p>
                  <p class="text-2xl font-bold text-blue-700">{countMap['in_progress'] || 0}</p>
                  <p class="text-xs text-gray-400 mt-1">onder werk</p>
                </a>
                <a href={filterUrl({ status: 'hertesten' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-purple-400 hover:shadow-md hover:bg-purple-50 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Hertesten</p>
                  <p class="text-2xl font-bold text-purple-700">{countMap['hertesten'] || 0}</p>
                  <p class="text-xs text-gray-400 mt-1">wacht op tester</p>
                </a>
                <a href={filterUrl({ status: 'resolved' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-green-400 hover:shadow-md hover:bg-green-50 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Opgelost</p>
                  <p class="text-2xl font-bold text-green-700">{countMap['resolved'] || 0}</p>
                  <p class="text-xs text-gray-400 mt-1">{countMap['rejected'] || 0} afgewezen</p>
                </a>
                <a href={filterUrl({ status: 'meer_info_nodig' })} class="bg-white rounded-lg p-4 shadow-sm border-l-4 border-orange-400 hover:shadow-md hover:bg-orange-50 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Meer info</p>
                  <p class="text-2xl font-bold text-orange-700">{countMap['meer_info_nodig'] || 0}</p>
                  <p class="text-xs text-gray-400 mt-1">gevraagd aan melder</p>
                </a>
              </div>

              {/* Tweede rij: tijd-metrics — klikbaar */}
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <a href={filterUrl({ age: 'actionable', sort: 'oldest' })} class="bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-amber-300 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <i class="fas fa-hourglass-half text-amber-500"></i> Gem. leeftijd openstaand
                  </p>
                  <p class="text-2xl font-bold text-gray-900 mt-1">{fmtDays(avgOpenAge?.avg_days)}</p>
                  <p class="text-xs text-gray-400 mt-1">over {actionableCount} items · oudste eerst →</p>
                </a>
                <a href={filterUrl({ status: 'resolved', sort: 'newest' })} class="bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <i class="fas fa-stopwatch text-green-500"></i> Gem. doorlooptijd (opgelost)
                  </p>
                  <p class="text-2xl font-bold text-gray-900 mt-1">{fmtDays(avgResolution?.avg_days)}</p>
                  <p class="text-xs text-gray-400 mt-1">
                    min {fmtDays(avgResolution?.min_days)} · max {fmtDays(avgResolution?.max_days)} ({avgResolution?.resolved_count || 0} items) →
                  </p>
                </a>
                <a href={filterUrl({ age: 'week' })} class="bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-300 transition cursor-pointer block">
                  <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <i class="fas fa-bolt text-indigo-500"></i> Activiteit (7 dagen)
                  </p>
                  <p class="text-2xl font-bold text-gray-900 mt-1">
                    +{newThisWeek?.cnt || 0} <span class="text-sm font-normal text-gray-500">nieuw</span>
                  </p>
                  <p class="text-xs text-gray-400 mt-1">
                    {recentActivity?.cnt || 0} updates · {resolvedThisWeek?.cnt || 0} afgesloten →
                  </p>
                </a>
              </div>

              {/* Status distributie als horizontale stacked bar */}
              <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Statusverdeling</p>
                {totalCount > 0 ? (
                  <>
                    <div class="flex h-8 rounded-full overflow-hidden border border-gray-200">
                      {STATUS_CONFIG.filter(s => s.val !== 'all').map(s => {
                        const cnt = countMap[s.val] || 0
                        if (cnt === 0) return null
                        const pct = (cnt / totalCount) * 100
                        const colors: Record<string, string> = {
                          open: 'bg-yellow-400 hover:bg-yellow-500',
                          meer_info_nodig: 'bg-orange-400 hover:bg-orange-500',
                          in_progress: 'bg-blue-500 hover:bg-blue-600',
                          hertesten: 'bg-purple-500 hover:bg-purple-600',
                          resolved: 'bg-green-500 hover:bg-green-600',
                          rejected: 'bg-red-400 hover:bg-red-500'
                        }
                        return (
                          <a
                            href={filterUrl({ status: s.val })}
                            class={`${colors[s.val] || 'bg-gray-400'} flex items-center justify-center text-white text-xs font-semibold transition cursor-pointer`}
                            style={`width: ${pct}%`}
                            title={`${s.label}: ${cnt} (${pct.toFixed(1)}%) — klik om te filteren`}
                          >
                            {pct >= 8 ? cnt : ''}
                          </a>
                        )
                      })}
                    </div>
                    <div class="flex flex-wrap gap-3 mt-2 text-xs">
                      {STATUS_CONFIG.filter(s => s.val !== 'all' && (countMap[s.val] || 0) > 0).map(s => {
                        const colors: Record<string, string> = {
                          open: 'bg-yellow-400',
                          meer_info_nodig: 'bg-orange-400',
                          in_progress: 'bg-blue-500',
                          hertesten: 'bg-purple-500',
                          resolved: 'bg-green-500',
                          rejected: 'bg-red-400'
                        }
                        return (
                          <a href={filterUrl({ status: s.val })} class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 hover:underline">
                            <span class={`w-3 h-3 rounded-sm ${colors[s.val] || 'bg-gray-400'}`}></span>
                            {s.label} ({countMap[s.val]})
                          </a>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p class="text-sm text-gray-400">Nog geen feedback items</p>
                )}
              </div>

              {/* Type x Status kruistabel + leeftijd-buckets naast elkaar */}
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Type × Status kruistabel */}
                <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                  <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                    <i class="fas fa-th text-indigo-500 mr-1"></i> Type × Status
                  </p>
                  <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                      <thead>
                        <tr class="text-gray-500 border-b">
                          <th class="text-left py-1 pr-2">Type</th>
                          <th class="text-center py-1 px-1" title="Open">🟡</th>
                          <th class="text-center py-1 px-1" title="Meer info">🔶</th>
                          <th class="text-center py-1 px-1" title="In behandeling">🔵</th>
                          <th class="text-center py-1 px-1" title="Hertesten">🔁</th>
                          <th class="text-center py-1 px-1" title="Opgelost">✅</th>
                          <th class="text-center py-1 px-1" title="Afgewezen">❌</th>
                          <th class="text-center py-1 pl-2 font-bold">Tot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { key: 'bug', label: '🐛 Bug', total: typeMap.bug },
                          { key: 'feature', label: '💡 Idee', total: typeMap.feature },
                          { key: 'other', label: '📝 Anders', total: typeMap.other }
                        ].filter(r => r.total > 0).map(row => {
                          const cm = crossMap[row.key] || {}
                          // Helper voor cellen — klikbare link wanneer count > 0, anders dash
                          const cell = (statusVal: string, extraCls = '') => {
                            const cnt = cm[statusVal] || 0
                            if (cnt === 0) return <td class={`text-center py-1.5 px-1 text-gray-300 ${extraCls}`}>—</td>
                            return (
                              <td class={`text-center py-1.5 px-1 ${extraCls}`}>
                                <a href={filterUrl({ status: statusVal, type: row.key })} class="hover:underline hover:font-bold inline-block px-1.5 py-0.5 rounded hover:bg-gray-100">
                                  {cnt}
                                </a>
                              </td>
                            )
                          }
                          return (
                            <tr class="border-b border-gray-50">
                              <td class="py-1.5 pr-2 font-medium text-gray-700">
                                <a href={filterUrl({ type: row.key })} class="hover:underline">{row.label}</a>
                              </td>
                              {cell('open')}
                              {cell('meer_info_nodig')}
                              {cell('in_progress')}
                              {cell('hertesten')}
                              {cell('resolved', 'text-green-700')}
                              {cell('rejected', 'text-red-600')}
                              <td class="text-center py-1.5 pl-2 font-bold text-gray-900">
                                <a href={filterUrl({ type: row.key })} class="hover:underline">{row.total}</a>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Leeftijd-buckets van openstaande items */}
                <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                  <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                    <i class="fas fa-clock text-amber-500 mr-1"></i> Hoe lang staan openstaande items al open?
                  </p>
                  {actionableCount > 0 ? (
                    <div class="space-y-2">
                      {[
                        { key: 'today', label: '< 1 dag', color: 'bg-green-400 hover:bg-green-500' },
                        { key: 'week', label: '1 – 7 dagen', color: 'bg-lime-400 hover:bg-lime-500' },
                        { key: 'month', label: '7 – 30 dagen', color: 'bg-yellow-400 hover:bg-yellow-500' },
                        { key: 'quarter', label: '30 – 90 dagen', color: 'bg-orange-400 hover:bg-orange-500' },
                        { key: 'older', label: '> 90 dagen ⚠️', color: 'bg-red-400 hover:bg-red-500' }
                      ].map(b => {
                        const cnt = ageMap[b.key] || 0
                        const pct = actionableCount > 0 ? (cnt / actionableCount) * 100 : 0
                        // Wrapper-link als er items zijn; anders 'leeg' div
                        const url = filterUrl({ age: b.key })
                        return cnt > 0 ? (
                          <a href={url} class="flex items-center gap-2 group hover:bg-gray-50 -mx-2 px-2 py-1 rounded transition" title={`Toon de ${cnt} item(s) in deze leeftijdsgroep`}>
                            <span class="text-xs text-gray-600 group-hover:text-gray-900 w-28 flex-shrink-0">{b.label}</span>
                            <div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden relative">
                              <div
                                class={`${b.color} h-full transition-all rounded-full flex items-center px-2`}
                                style={`width: ${Math.max(pct, 2)}%`}
                              >
                                {pct >= 15 && <span class="text-xs font-semibold text-white">{cnt}</span>}
                              </div>
                              {pct < 15 && (
                                <span class="absolute left-2 top-0 h-full flex items-center text-xs font-semibold text-gray-700">{cnt}</span>
                              )}
                            </div>
                            <span class="text-xs text-gray-500 group-hover:text-gray-900 w-12 text-right">{pct.toFixed(0)}%</span>
                          </a>
                        ) : (
                          <div class="flex items-center gap-2 opacity-50">
                            <span class="text-xs text-gray-600 w-28 flex-shrink-0">{b.label}</span>
                            <div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden"></div>
                            <span class="text-xs text-gray-500 w-12 text-right">0%</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p class="text-sm text-gray-400">Geen openstaande items 🎉</p>
                  )}
                </div>
              </div>

              {/* Trend: nieuwe items per week + Top 5 langst openstaand */}
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Trend bar chart (laatste 12 weken) */}
                <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                  <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                    <i class="fas fa-chart-bar text-indigo-500 mr-1"></i> Nieuwe items — laatste 12 weken
                  </p>
                  {trendRaw.length > 0 ? (
                    (() => {
                      const maxCnt = Math.max(...trendRaw.map((r: any) => r.new_count))
                      return (
                        <>
                          <div class="flex items-end gap-1 h-32 border-b border-gray-200 pb-1">
                            {trendRaw.map((w: any) => {
                              const bugH = maxCnt > 0 ? (w.bug_count / maxCnt) * 100 : 0
                              const featH = maxCnt > 0 ? (w.feature_count / maxCnt) * 100 : 0
                              const wkLabel = w.week_start ? new Date(w.week_start).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' }) : ''
                              return (
                                <div class="flex-1 flex flex-col items-center gap-0.5 group relative">
                                  <div
                                    class="w-full bg-gradient-to-t from-blue-500 to-blue-300 rounded-t hover:from-blue-600 hover:to-blue-400 transition cursor-pointer"
                                    style={`height: ${featH}%; min-height: ${w.feature_count > 0 ? '2px' : '0'}`}
                                    title={`${wkLabel}: ${w.feature_count} ideeën`}
                                  ></div>
                                  <div
                                    class="w-full bg-gradient-to-t from-red-500 to-red-300 hover:from-red-600 hover:to-red-400 transition cursor-pointer"
                                    style={`height: ${bugH}%; min-height: ${w.bug_count > 0 ? '2px' : '0'}`}
                                    title={`${wkLabel}: ${w.bug_count} bugs`}
                                  ></div>
                                  <div class="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-10">
                                    {wkLabel}: {w.new_count}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <div class="flex justify-between mt-1 text-[10px] text-gray-400">
                            {trendRaw.map((w: any, i: number) => (
                              <span class={i % 2 === 0 ? '' : 'invisible'}>
                                {w.week_start ? new Date(w.week_start).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' }) : ''}
                              </span>
                            ))}
                          </div>
                          <div class="flex gap-3 mt-2 text-xs text-gray-600">
                            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-red-400"></span>Bugs</span>
                            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-blue-400"></span>Ideeën</span>
                          </div>
                        </>
                      )
                    })()
                  ) : (
                    <p class="text-sm text-gray-400">Geen activiteit in de laatste 12 weken</p>
                  )}
                </div>

                {/* Top 5 oudste openstaand */}
                <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                  <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                    <i class="fas fa-fire text-red-500 mr-1"></i> Top 5 langst openstaand
                  </p>
                  {oldestOpen.length > 0 ? (
                    <ol class="space-y-2">
                      {oldestOpen.map((item: any, idx: number) => {
                        const days = Math.round(item.age_days)
                        const isUrgent = days > 30
                        return (
                          <li class="flex items-start gap-2">
                            <span class={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              idx === 0 ? 'bg-red-100 text-red-700' :
                              idx === 1 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>{idx + 1}</span>
                            <a
                              href={`#feedback-${item.id}`}
                              class="flex-1 min-w-0 hover:bg-gray-50 rounded px-1 py-0.5 transition"
                            >
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs">{item.type === 'bug' ? '🐛' : item.type === 'feature' ? '💡' : '📝'}</span>
                                <span class={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getStatusColor(item.status)}`}>
                                  {getStatusLabel(item.status)}
                                </span>
                                <span class={`text-xs font-bold ${isUrgent ? 'text-red-600' : 'text-gray-500'}`}>
                                  {days}d {isUrgent && '🔥'}
                                </span>
                              </div>
                              <p class="text-xs text-gray-700 truncate mt-0.5">#{item.id} — {item.message}</p>
                              {(item.voornaam || item.achternaam) && (
                                <p class="text-[10px] text-gray-400">{item.voornaam} {item.achternaam}</p>
                              )}
                            </a>
                          </li>
                        )
                      })}
                    </ol>
                  ) : (
                    <p class="text-sm text-gray-400">Geen openstaande items 🎉</p>
                  )}
                </div>
              </div>
            </div>
          </details>

          {/* Anchor voor scroll-naar-lijst vanuit dashboard */}
          <div id="feedback-list"></div>

          {/* Actief filter banner — toont wanneer er een filter actief is vanuit het dashboard */}
          {hasActiveFilter && (
            <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                <i class="fas fa-filter text-indigo-600"></i>
                <span class="text-sm text-indigo-900 font-semibold">Actieve filter:</span>
                {statusFilter !== 'all' && (
                  <span class="px-2 py-0.5 rounded-full bg-white border border-indigo-300 text-xs font-semibold text-indigo-800">
                    Status: {getStatusLabel(statusFilter)}
                  </span>
                )}
                {typeFilter !== 'all' && (
                  <span class="px-2 py-0.5 rounded-full bg-white border border-indigo-300 text-xs font-semibold text-indigo-800">
                    Type: {typeFilter === 'bug' ? '🐛 Bug' : typeFilter === 'feature' ? '💡 Idee' : '📝 Anders'}
                  </span>
                )}
                {ageFilter !== 'all' && (
                  <span class="px-2 py-0.5 rounded-full bg-white border border-indigo-300 text-xs font-semibold text-indigo-800">
                    Leeftijd: {
                      ageFilter === 'today' ? '< 1 dag' :
                      ageFilter === 'week' ? '1 – 7 dagen' :
                      ageFilter === 'month' ? '7 – 30 dagen' :
                      ageFilter === 'quarter' ? '30 – 90 dagen' :
                      ageFilter === 'older' ? '> 90 dagen' :
                      ageFilter === 'actionable' ? 'Alle openstaande' : ageFilter
                    }
                  </span>
                )}
                {sortFilter !== 'newest' && (
                  <span class="px-2 py-0.5 rounded-full bg-white border border-indigo-300 text-xs font-semibold text-indigo-800">
                    Sortering: oudste eerst
                  </span>
                )}
                {assignedFilter !== 'all' && (
                  <span class="px-2 py-0.5 rounded-full bg-purple-100 border border-purple-300 text-xs font-semibold text-purple-800">
                    <i class="fas fa-user-tag mr-1"></i>{assignedFilterLabel(assignedFilter)}
                  </span>
                )}
                <span class="text-xs text-indigo-700">→ {feedback.length} resultaat(en)</span>
              </div>
              <a href="/admin/feedback" class="px-3 py-1 bg-white border border-indigo-300 rounded-lg text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition">
                <i class="fas fa-xmark mr-1"></i> Filter wissen
              </a>
            </div>
          )}

          {/* Toewijzing-filter — admin kan filteren op zijn eigen tickets */}
          <div class="bg-white rounded-lg shadow-sm p-4 mb-3 flex flex-wrap gap-2 items-center">
            <span class="text-sm font-medium text-gray-600 mr-1">
              <i class="fas fa-user-tag text-indigo-500 mr-1"></i>Toegewezen:
            </span>
            {[
              { val: 'all', label: 'Alle', icon: '🌐', count: null },
              { val: 'mine', label: 'Mijn tickets', icon: '👤', count: myStats?.my_total || 0 },
              { val: 'mine_hertesten', label: 'Mijn hertesten', icon: '🔁', count: myStats?.my_hertesten || 0, highlight: true },
              { val: 'unassigned', label: 'Niet toegewezen', icon: '❓', count: unassignedOpen?.cnt || 0 },
            ].map(opt => (
              <a
                href={filterUrl({ status: statusFilter, type: typeFilter, age: ageFilter, sort: sortFilter, assigned: opt.val })}
                class={`px-3 py-1.5 rounded-full text-xs font-semibold border transition flex items-center gap-1.5 ${
                  assignedFilter === opt.val
                    ? (opt.highlight
                        ? 'bg-purple-600 text-white border-purple-600 ring-2 ring-purple-300'
                        : 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300')
                    : (opt.highlight && opt.count
                        ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                        : 'bg-gray-100 text-gray-700 border-transparent hover:border-gray-300')
                }`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
                {opt.count !== null && (
                  <span class={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    assignedFilter === opt.val ? 'bg-white/20' : 'bg-white border'
                  }`}>{opt.count}</span>
                )}
              </a>
            ))}
            {/* Dropdown voor specifieke andere admin */}
            {allAdmins.length > 1 && (
              <div class="ml-auto flex items-center gap-2">
                <span class="text-xs text-gray-500">Andere admin:</span>
                <select
                  onchange={`if(this.value) window.location.href = this.value;`}
                  class="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                >
                  <option value="">— kies admin —</option>
                  {allAdmins.filter((a: any) => a.id !== user.id).map((a: any) => (
                    <option
                      value={filterUrl({ status: statusFilter, type: typeFilter, age: ageFilter, sort: sortFilter, assigned: String(a.id) })}
                      selected={assignedFilter === String(a.id)}
                    >
                      {a.voornaam || a.email} {a.achternaam || ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Filter bar - enhanced with new statuses */}
          <div class="bg-white rounded-lg shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-center">
            <span class="text-sm font-medium text-gray-600">Status:</span>
            {STATUS_CONFIG.map(opt => (
              <a
                href={filterUrl({ status: opt.val, type: typeFilter, age: ageFilter, sort: sortFilter, assigned: assignedFilter })}
                class={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  statusFilter === opt.val
                    ? 'border-animato-primary ring-2 ring-animato-primary ring-offset-1 ' + opt.color
                    : 'border-transparent hover:border-gray-300 ' + opt.color
                }`}
              >
                {opt.icon && <span class="mr-1">{opt.icon}</span>}
                {opt.label}
                {opt.val !== 'all' && countMap[opt.val] ? <span class="ml-1 opacity-70">({countMap[opt.val]})</span> : null}
              </a>
            ))}
            <div class="ml-auto flex items-center gap-2">
              <span class="text-sm font-medium text-gray-600">Type:</span>
              {[
                { val: 'all', label: 'Alles' },
                { val: 'bug', label: '🐛 Bug' },
                { val: 'feature', label: '💡 Idee' },
              ].map(opt => (
                <a
                  href={filterUrl({ status: statusFilter, type: opt.val, age: ageFilter, sort: sortFilter, assigned: assignedFilter })}
                  class={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    typeFilter === opt.val
                      ? 'bg-animato-primary text-white border-animato-primary'
                      : 'bg-gray-100 text-gray-700 border-transparent hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </a>
              ))}
            </div>
          </div>

          {/* Feedback items */}
          <div class="space-y-4">
            {feedback.map((item: any) => (
              <div class={`bg-white rounded-lg shadow p-5 border-l-4 ${
                item.status === 'hertesten' ? 'border-purple-400' :
                item.status === 'meer_info_nodig' ? 'border-orange-400' :
                item.type === 'bug' ? 'border-red-400' :
                item.type === 'feature' ? 'border-blue-400' : 'border-gray-400'
              }`} id={`feedback-${item.id}`}>
                <div class="flex justify-between items-start gap-4">
                  {/* Left: info */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                      {/* Checkbox for bulk select */}
                      <input
                        type="checkbox"
                        class="feedback-checkbox w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        value={item.id}
                        onchange="updateBulkButton()"
                      />
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.type === 'bug' ? 'bg-red-100 text-red-800' :
                        item.type === 'feature' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.type === 'bug' ? '🐛 Bug' : item.type === 'feature' ? '💡 Idee' : '📝 Anders'}
                      </span>
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(item.status)}`}>
                        {getStatusIcon(item.status)} {getStatusLabel(item.status)}
                      </span>
                      {item.comment_count > 0 && (
                        <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                          <i class="fas fa-comments mr-1"></i>{item.comment_count} {item.comment_count === 1 ? 'reactie' : 'reacties'}
                        </span>
                      )}
                      {item.assigned_to && (
                        <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          item.assigned_to === user.id
                            ? 'bg-purple-100 text-purple-800 ring-1 ring-purple-300'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        }`} title={`Toegewezen aan ${item.assigned_voornaam || item.assigned_email || 'admin'}`}>
                          <i class="fas fa-user-tag mr-1"></i>
                          {item.assigned_to === user.id ? 'Mij' : (item.assigned_voornaam || item.assigned_email || 'admin')}
                        </span>
                      )}
                      <span class="text-xs text-gray-400">
                        {item.voornaam} {item.achternaam} — {new Date(item.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p class="text-sm text-gray-800 mb-1 ml-6">{item.message}</p>
                    {item.url && (
                      <a href={item.url} target="_blank" class="text-xs text-blue-500 hover:underline break-all ml-6">
                        <i class="fas fa-link mr-1"></i>{item.url}
                      </a>
                    )}
                    {item.browser_info && (
                      <p class="text-xs text-gray-400 ml-6 mt-1">
                        <i class="fas fa-globe mr-1"></i>{item.browser_info}
                      </p>
                    )}
                  </div>
                  {/* Right: status selector + actions */}
                  <div class="shrink-0 flex flex-col items-end gap-2">
                    <form action="/api/admin/feedback/update" method="POST">
                      <input type="hidden" name="id" value={item.id} />
                      <select name="status" onchange="this.form.submit()" class="text-xs border rounded p-1.5 bg-gray-50">
                        <option value="open" selected={item.status === 'open'}>🟡 Open</option>
                        <option value="meer_info_nodig" selected={item.status === 'meer_info_nodig'}>🔶 Meer info nodig</option>
                        <option value="in_progress" selected={item.status === 'in_progress'}>🔵 In Behandeling</option>
                        <option value="hertesten" selected={item.status === 'hertesten'}>🔁 Hertesten</option>
                        <option value="resolved" selected={item.status === 'resolved'}>✅ Opgelost</option>
                        <option value="rejected" selected={item.status === 'rejected'}>❌ Afgewezen</option>
                      </select>
                    </form>

                    {/* Toewijzing — admin selector */}
                    <form action="/api/admin/feedback/assign" method="POST" class="flex items-center gap-1">
                      <input type="hidden" name="id" value={item.id} />
                      <select
                        name="assigned_to"
                        onchange="this.form.submit()"
                        class={`text-xs border rounded p-1.5 ${
                          item.assigned_to === user.id ? 'bg-purple-50 border-purple-300 text-purple-800 font-semibold' :
                          item.assigned_to ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
                          'bg-gray-50 text-gray-500'
                        }`}
                        title="Wijs toe aan een admin"
                      >
                        <option value="unassign" selected={!item.assigned_to}>👤 Niet toegewezen</option>
                        <option value="me" selected={item.assigned_to === user.id}>⭐ Mijzelf</option>
                        {allAdmins.filter((a: any) => a.id !== user.id).map((a: any) => (
                          <option value={String(a.id)} selected={item.assigned_to === a.id}>
                            👤 {a.voornaam || a.email} {a.achternaam || ''}
                          </option>
                        ))}
                      </select>
                    </form>

                    {/* Quick actions */}
                    <div class="flex gap-1">
                      <button
                        onclick={`askForMoreInfo(${item.id}, '${(item.voornaam || 'Gebruiker').replace(/'/g, "\\'")}')` }
                        class="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded hover:bg-orange-100 transition border border-orange-200"
                        title="Vraag meer informatie aan de melder"
                      >
                        <i class="fas fa-question-circle"></i> Info vragen
                      </button>

                    </div>
                  </div>
                </div>
                {/* Screenshot */}
                {item.screenshot && (
                  <div class="mt-3 ml-6">
                    <p class="text-xs text-gray-400 mb-1"><i class="fas fa-image mr-1"></i>Screenshot</p>
                    <img
                      src={item.screenshot}
                      alt="Screenshot"
                      class="max-h-48 rounded border border-gray-200 cursor-pointer hover:opacity-90 transition"
                      onclick="document.getElementById('screenshot-modal-img').src=this.src; document.getElementById('screenshot-modal').classList.remove('hidden');"
                    />
                  </div>
                )}

                {/* Conversation panel (auto-shown when there are comments) */}
                <div id={`conv-panel-${item.id}`} class={`${item.comment_count > 0 ? '' : 'hidden'} mt-4 border-t pt-4 ml-6`}>
                  <div id={`conv-messages-${item.id}`} class="space-y-3 mb-3 max-h-64 overflow-y-auto">
                    <div class="text-center text-xs text-gray-400 py-2">
                      <i class="fas fa-spinner fa-spin mr-1"></i> Berichten laden...
                    </div>
                  </div>
                  {/* Reply form */}
                  <div class="flex gap-2">
                    <input
                      type="text"
                      id={`conv-input-${item.id}`}
                      placeholder="Vraag om meer info, of geef een reactie..."
                      class="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      onkeydown={`if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); sendAdminComment(${item.id})}`}
                    />
                    <button
                      onclick={`sendAdminComment(${item.id})`}
                      class="px-4 py-2 bg-animato-primary text-white text-sm font-semibold rounded-lg hover:bg-animato-secondary transition flex items-center gap-1"
                    >
                      <i class="fas fa-paper-plane"></i>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {feedback.length === 0 && (
              <div class="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                <i class="fas fa-inbox text-4xl mb-3"></i>
                <p>Nog geen feedback ontvangen.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Screenshot lightbox modal */}
      <div id="screenshot-modal" class="fixed inset-0 bg-black bg-opacity-75 z-50 hidden flex items-center justify-center p-4" onclick="this.classList.add('hidden')">
        <div class="max-w-4xl max-h-full">
          <img id="screenshot-modal-img" src="" alt="Screenshot" class="max-w-full max-h-screen rounded shadow-2xl" />
          <p class="text-white text-center text-sm mt-2 opacity-60">Klik ergens om te sluiten</p>
        </div>
      </div>

      {/* Ask More Info Modal */}
      <div id="ask-info-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg" onclick="event.stopPropagation()">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold text-gray-900">
                <i class="fas fa-question-circle text-orange-500 mr-2"></i>
                Meer informatie vragen
              </h3>
              <button onclick="closeAskInfoModal()" class="text-gray-400 hover:text-gray-600">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>
            <p class="text-sm text-gray-500 mb-3">
              Stuur een bericht aan <span id="ask-info-reporter" class="font-semibold text-gray-700"></span>.
              De status wordt automatisch naar <span class="font-semibold text-orange-600">"Meer info nodig"</span> gezet.
            </p>
            <input type="hidden" id="ask-info-feedback-id" />
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-1">Snelkeuze</label>
              <div class="flex flex-wrap gap-2">
                <button onclick="setQuickQuestion('Kun je beschrijven welke stappen je nam voordat dit probleem optrad?')" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">📋 Stappen beschrijven</button>
                <button onclick="setQuickQuestion('Op welk apparaat/browser gebruik je de site?')" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">📱 Apparaat/browser</button>
                <button onclick="setQuickQuestion('Kun je een screenshot toevoegen van het probleem?')" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">📸 Screenshot vragen</button>
                <button onclick="setQuickQuestion('Komt dit probleem elke keer voor, of alleen soms?')" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">🔄 Frequentie</button>
                <button onclick="setQuickQuestion('Kun je wat meer context geven over je idee? Wat is het concrete probleem dat je wilt oplossen?')" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">💡 Meer context (idee)</button>
              </div>
            </div>
            <textarea
              id="ask-info-question"
              placeholder="Typ je vraag hier..."
              class="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
              rows="4"
            ></textarea>
            <div class="flex justify-end gap-2 mt-4">
              <button onclick="closeAskInfoModal()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">
                Annuleren
              </button>
              <button onclick="submitAskInfo()" id="ask-info-submit-btn" class="px-6 py-2 bg-orange-500 text-white text-sm font-semibold rounded-lg hover:bg-orange-600 transition flex items-center gap-2">
                <i class="fas fa-paper-plane"></i>
                Verstuur & zet op "Meer info nodig"
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* JavaScript */}
      <script dangerouslySetInnerHTML={{__html: `
        const loadedConversations = {};

        // ===================== CONVERSATION FUNCTIONS =====================
        // Auto-load conversations that are already visible (items with comments)
        document.querySelectorAll('[id^="conv-panel-"]').forEach(function(panel) {
          if (!panel.classList.contains('hidden')) {
            const feedbackId = parseInt(panel.id.replace('conv-panel-', ''));
            if (feedbackId && !loadedConversations[feedbackId]) {
              loadConversation(feedbackId);
            }
          }
        });

        async function loadConversation(feedbackId) {
          const container = document.getElementById('conv-messages-' + feedbackId);
          try {
            const res = await fetch('/api/feedback/' + feedbackId + '/comments');
            if (!res.ok) throw new Error('Fout bij laden');
            const data = await res.json();
            loadedConversations[feedbackId] = true;
            
            if (!data.comments || data.comments.length === 0) {
              container.innerHTML = '<div class="text-center text-xs text-gray-400 py-3"><i class="fas fa-comment-slash mr-1"></i> Nog geen berichten. Stel een vraag aan de melder!</div>';
              return;
            }
            
            container.innerHTML = data.comments.map(function(c) {
              const isAdmin = c.is_admin === 1;
              const name = (c.voornaam || '') + ' ' + (c.achternaam || '');
              const date = new Date(c.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
              
              if (isAdmin) {
                return '<div class="flex justify-end">' +
                  '<div class="max-w-[80%] bg-animato-primary bg-opacity-10 rounded-lg rounded-br-sm px-3 py-2 border border-animato-primary border-opacity-20">' +
                    '<div class="flex items-center gap-2 mb-0.5">' +
                      '<span class="text-xs font-semibold text-animato-primary"><i class="fas fa-shield-alt mr-1"></i>Admin</span>' +
                      '<span class="text-xs text-gray-400">' + date + '</span>' +
                    '</div>' +
                    '<p class="text-sm text-gray-800">' + escapeHtml(c.message) + '</p>' +
                  '</div>' +
                '</div>';
              } else {
                return '<div class="flex justify-start">' +
                  '<div class="max-w-[80%] bg-gray-100 rounded-lg rounded-bl-sm px-3 py-2">' +
                    '<div class="flex items-center gap-2 mb-0.5">' +
                      '<span class="text-xs font-semibold text-gray-700"><i class="fas fa-user mr-1"></i>' + escapeHtml(name.trim() || 'Gebruiker') + '</span>' +
                      '<span class="text-xs text-gray-400">' + date + '</span>' +
                    '</div>' +
                    '<p class="text-sm text-gray-800">' + escapeHtml(c.message) + '</p>' +
                  '</div>' +
                '</div>';
              }
            }).join('');
            
            container.scrollTop = container.scrollHeight;
          } catch(e) {
            container.innerHTML = '<div class="text-center text-xs text-red-400 py-2"><i class="fas fa-exclamation-triangle mr-1"></i> Kon berichten niet laden.</div>';
          }
        }

        async function sendAdminComment(feedbackId) {
          const input = document.getElementById('conv-input-' + feedbackId);
          const message = input.value.trim();
          if (!message) return;
          
          input.disabled = true;
          
          try {
            const res = await fetch('/api/feedback/' + feedbackId + '/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: message })
            });
            
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Fout bij versturen');
            }
            
            input.value = '';
            loadedConversations[feedbackId] = false;
            loadConversation(feedbackId);
          } catch(e) {
            alert('Fout: ' + e.message);
          } finally {
            input.disabled = false;
            input.focus();
          }
        }

        // ===================== ASK FOR MORE INFO =====================
        function askForMoreInfo(feedbackId, reporterName) {
          document.getElementById('ask-info-feedback-id').value = feedbackId;
          document.getElementById('ask-info-reporter').textContent = reporterName;
          document.getElementById('ask-info-question').value = '';
          document.getElementById('ask-info-modal').classList.remove('hidden');
        }

        function closeAskInfoModal() {
          document.getElementById('ask-info-modal').classList.add('hidden');
        }

        function setQuickQuestion(text) {
          const textarea = document.getElementById('ask-info-question');
          textarea.value = text;
          textarea.focus();
        }

        async function submitAskInfo() {
          const feedbackId = document.getElementById('ask-info-feedback-id').value;
          const question = document.getElementById('ask-info-question').value.trim();
          if (!question) { alert('Vul een vraag in.'); return; }

          const btn = document.getElementById('ask-info-submit-btn');
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Versturen...';

          try {
            const res = await fetch('/api/admin/feedback/ask-info', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedback_id: parseInt(feedbackId), question: question })
            });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Fout bij versturen');
            }
            closeAskInfoModal();
            location.reload();
          } catch(e) {
            alert('Fout: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Verstuur & zet op "Meer info nodig"';
          }
        }

        // ===================== BULK OPERATIONS =====================
        function updateBulkButton() {
          const checked = document.querySelectorAll('.feedback-checkbox:checked');
          const btn = document.getElementById('bulk-hertesten-btn');
          const label = document.getElementById('bulk-hertesten-label');
          if (checked.length > 0) {
            btn.classList.remove('hidden');
            btn.classList.add('flex');
            label.textContent = 'Hertesten (' + checked.length + ')';
          } else {
            btn.classList.add('hidden');
            btn.classList.remove('flex');
          }
        }

        async function bulkSetHertesten() {
          const checked = document.querySelectorAll('.feedback-checkbox:checked');
          const ids = Array.from(checked).map(cb => parseInt(cb.value));
          if (ids.length === 0) return;

          if (!confirm('Zet ' + ids.length + ' item(s) op "Hertesten"? De melders worden gevraagd te hertesten.')) return;

          try {
            const res = await fetch('/api/admin/feedback/bulk-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: ids, status: 'hertesten', admin_note: 'Bug is verholpen door AI - graag hertesten' })
            });
            if (!res.ok) throw new Error('Fout bij bulk update');
            location.reload();
          } catch(e) {
            alert('Fout: ' + e.message);
          }
        }

        // ===================== EXPORT DROPDOWN CLOSE =====================
        document.addEventListener('click', function(e) {
          const container = document.getElementById('export-dropdown-container');
          const menu = document.getElementById('export-menu');
          if (container && menu && !container.contains(e.target)) {
            menu.classList.add('hidden');
          }
        });

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      `}} />
    </Layout>
  )
})

export default app
