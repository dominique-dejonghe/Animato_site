import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import type { Bindings, SessionUser } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware - admin only
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

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
  const body = await c.req.parseBody()
  const status = body.status as string
  const id = body.id as string

  const validStatuses = ['open', 'in_progress', 'meer_info_nodig', 'hertesten', 'resolved', 'rejected']
  if (!validStatuses.includes(status)) {
    return c.redirect('/admin/feedback')
  }

  await execute(c.env.DB, "UPDATE feedback SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id])
  return c.redirect('/admin/feedback')
})

// =============================================================================
// MAIN ADMIN FEEDBACK PAGE
// =============================================================================
app.get('/admin/feedback', async (c) => {
  const user = c.get('user') as SessionUser
  const statusFilter = c.req.query('status') || 'all'
  const typeFilter = c.req.query('type') || 'all'

  let query = `SELECT f.*, u.email, p.voornaam, p.achternaam,
     (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count,
     (SELECT MAX(fc.created_at) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as last_comment_at
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE 1=1`
  const params: any[] = []

  if (statusFilter !== 'all') { query += ` AND f.status = ?`; params.push(statusFilter) }
  if (typeFilter !== 'all') { query += ` AND f.type = ?`; params.push(typeFilter) }
  query += ` ORDER BY f.created_at DESC`

  const feedback = await queryAll(c.env.DB, query, params)

  // Count per status for badges
  const counts = await queryAll<any>(c.env.DB, `SELECT status, COUNT(*) as cnt FROM feedback GROUP BY status`)
  const countMap: Record<string,number> = {}
  for (const r of counts) countMap[r.status] = r.cnt

  // Count actionable (for export badge)
  const actionableCount = (countMap['open'] || 0) + (countMap['in_progress'] || 0) + (countMap['meer_info_nodig'] || 0) + (countMap['hertesten'] || 0)

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

          {/* Filter bar - enhanced with new statuses */}
          <div class="bg-white rounded-lg shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-center">
            <span class="text-sm font-medium text-gray-600">Status:</span>
            {STATUS_CONFIG.map(opt => (
              <a
                href={`/admin/feedback?status=${opt.val}&type=${typeFilter}`}
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
                  href={`/admin/feedback?status=${statusFilter}&type=${opt.val}`}
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
