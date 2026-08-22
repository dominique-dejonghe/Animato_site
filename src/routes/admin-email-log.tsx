// =====================================================
// /admin/email-log — log van elke Resend-mail
// =====================================================
// Zie migratie 0114_email_log.sql voor het schema.
// Elke sendEmail() in src/utils/email.ts schrijft één rij (status = sent/failed/skipped).
// Filters: category (dropdown), status (dropdown), recipient (text), datum-range.
// Pagineren: 100 per pagina.
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { formatBrusselsDateTime } from '../utils/time'
import type { Bindings, SessionUser } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Auth — admin-only (log bevat mail-adressen, dus niet voor bestuur-in-brede-zin)
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) return c.redirect('/leden')
  c.set('user', user)
  await next()
}
app.use('/admin/email-log', adminAuthMiddleware)
app.use('/admin/email-log/*', adminAuthMiddleware)

// Human-readable labels voor de category-dropdown en de tabel
const CATEGORY_LABELS: Record<string, string> = {
  ticket_confirmation: '🎫 Ticket bevestiging',
  ticket_resend: '📮 Ticket opnieuw',
  password_reset: '🔑 Wachtwoord reset',
  contact_form: '✉️ Contact formulier',
  word_lid: '👥 Word lid',
  admin_notification: '🔔 Admin notificatie',
  weekly_report: '📊 Weekrapport',
  waitlist_notification: '⏳ Wachtlijst',
  activity_invitation: '🎉 Activiteit uitnodiging',
  feedback_reply: '💬 Feedback',
  newsletter: '📰 Nieuwsbrief',
  lidgeld_reminder: '💶 Lidgeld herinnering',
  other: '❓ Overige',
}
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS)

const STATUS_LABELS: Record<string, string> = {
  sent: '✅ Verstuurd',
  failed: '❌ Mislukt',
  skipped: '⏭️ Overgeslagen',
}

app.get('/admin/email-log', async (c) => {
  const user = c.get('user') as SessionUser
  const db = c.env.DB

  const category = (c.req.query('category') || '').trim()
  const status = (c.req.query('status') || '').trim()
  const search = (c.req.query('q') || '').trim()
  const dateFrom = (c.req.query('from') || '').trim()
  const dateTo = (c.req.query('to') || '').trim()
  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1)
  const perPage = 100
  const offset = (page - 1) * perPage

  // Filter opbouwen
  const where: string[] = []
  const args: any[] = []
  if (category && CATEGORY_KEYS.includes(category)) {
    where.push('category = ?')
    args.push(category)
  }
  if (status && ['sent', 'failed', 'skipped'].includes(status)) {
    where.push('status = ?')
    args.push(status)
  }
  if (search) {
    where.push('(recipient LIKE ? OR subject LIKE ?)')
    args.push(`%${search}%`, `%${search}%`)
  }
  if (dateFrom) {
    where.push("sent_at >= ?")
    args.push(dateFrom + ' 00:00:00')
  }
  if (dateTo) {
    where.push("sent_at <= ?")
    args.push(dateTo + ' 23:59:59')
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // Total + rows
  const totalRow = await queryOne<any>(db, `SELECT COUNT(*) AS n FROM email_log ${whereClause}`, args)
  const total = (totalRow?.n as number) || 0

  const rows = await queryAll<any>(db, `
    SELECT id, recipient, subject, category, status,
           resend_message_id, error_message,
           from_address, attachments_count,
           related_entity_type, related_entity_id,
           sent_at
    FROM email_log
    ${whereClause}
    ORDER BY sent_at DESC
    LIMIT ? OFFSET ?
  `, [...args, perPage, offset])

  // Statistieken (over gefilterde set) — snel overzicht bovenaan
  const statsRow = await queryOne<any>(db, `
    SELECT
      SUM(CASE WHEN status = 'sent'    THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM email_log
    ${whereClause}
  `, args)

  // Category-counts voor overzicht (all-time, geen filter — anders is de dropdown misleidend)
  const catCounts = await queryAll<any>(db, `
    SELECT category, COUNT(*) AS n FROM email_log
    GROUP BY category ORDER BY n DESC
  `)
  const catCountMap = new Map<string, number>(catCounts.map((r: any) => [r.category, r.n]))

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (status) params.set('status', status)
    if (search) params.set('q', search)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '' || v === null || v === undefined) params.delete(k)
      else params.set(k, String(v))
    }
    const s = params.toString()
    return s ? `?${s}` : ''
  }

  return c.html(
    <Layout title="Email Log — Admin" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar user={user} activePage="email-log" />
        <main class="flex-1 p-4 md:p-8 min-w-0">
          <div class="max-w-7xl mx-auto">
            <div class="mb-6">
              <h1 class="text-3xl font-bold text-animato-secondary mb-1" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-envelope-open-text mr-2 text-animato-primary"></i>
                Email log
              </h1>
              <p class="text-gray-600 text-sm">
                Elke mail die Animato via <strong>Resend</strong> verstuurt (tickets, wachtwoord-resets, notificaties …).
                Deze log ontstond op vraag van Dominique — mails vertrekken niet via een eigen mailbox,
                dus zonder log is er geen manier om te bevestigen dat een ticket effectief buitengegaan is.
              </p>
            </div>

            {/* Statistieken */}
            <div class="grid grid-cols-3 gap-3 mb-6">
              <div class="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
                <div class="text-xs uppercase text-gray-500 font-semibold">Verstuurd</div>
                <div class="text-3xl font-bold text-green-700">{statsRow?.sent || 0}</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
                <div class="text-xs uppercase text-gray-500 font-semibold">Mislukt</div>
                <div class="text-3xl font-bold text-red-700">{statsRow?.failed || 0}</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4 border-l-4 border-gray-400">
                <div class="text-xs uppercase text-gray-500 font-semibold">Overgeslagen</div>
                <div class="text-3xl font-bold text-gray-700">{statsRow?.skipped || 0}</div>
              </div>
            </div>

            {/* Filter-bar */}
            <form method="get" class="bg-white rounded-lg shadow p-4 mb-4">
              <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Categorie</label>
                  <select name="category" class="w-full border-gray-300 rounded-md text-sm">
                    <option value="">Alle ({total > 0 ? '…' : 0})</option>
                    {CATEGORY_KEYS.map(k => (
                      <option value={k} selected={category === k}>
                        {CATEGORY_LABELS[k]} ({catCountMap.get(k) || 0})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Status</label>
                  <select name="status" class="w-full border-gray-300 rounded-md text-sm">
                    <option value="">Alle</option>
                    <option value="sent" selected={status === 'sent'}>{STATUS_LABELS.sent}</option>
                    <option value="failed" selected={status === 'failed'}>{STATUS_LABELS.failed}</option>
                    <option value="skipped" selected={status === 'skipped'}>{STATUS_LABELS.skipped}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Zoek (email/onderwerp)</label>
                  <input type="text" name="q" value={search} placeholder="naam@…"
                         class="w-full border-gray-300 rounded-md text-sm" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Van</label>
                  <input type="date" name="from" value={dateFrom} class="w-full border-gray-300 rounded-md text-sm" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-700 mb-1">Tot</label>
                  <input type="date" name="to" value={dateTo} class="w-full border-gray-300 rounded-md text-sm" />
                </div>
              </div>
              <div class="flex justify-between items-center mt-3">
                <div class="text-xs text-gray-600">
                  <strong>{total}</strong> resultaten • Pagina {page} van {totalPages}
                </div>
                <div class="flex gap-2">
                  <a href="/admin/email-log" class="text-xs text-gray-500 hover:text-gray-700 underline">Reset</a>
                  <button type="submit"
                          class="bg-animato-primary text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-opacity-90">
                    <i class="fas fa-filter mr-1"></i> Filter
                  </button>
                </div>
              </div>
            </form>

            {/* Tabel */}
            <div class="bg-white rounded-lg shadow overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-gray-100 text-gray-700">
                    <tr>
                      <th class="px-3 py-2 text-left font-semibold">Tijdstip</th>
                      <th class="px-3 py-2 text-left font-semibold">Categorie</th>
                      <th class="px-3 py-2 text-left font-semibold">Naar</th>
                      <th class="px-3 py-2 text-left font-semibold">Onderwerp</th>
                      <th class="px-3 py-2 text-center font-semibold">Status</th>
                      <th class="px-3 py-2 text-center font-semibold" title="Aantal bijlagen">📎</th>
                      <th class="px-3 py-2 text-left font-semibold">Resend ID / Fout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colspan={7} class="px-4 py-12 text-center text-gray-400 italic">
                          Geen mails gevonden met deze filter. Als de log leeg is: sinds deze migratie
                          worden ALLE nieuwe Resend-mails gelogd — oudere mails staan hier niet in.
                        </td>
                      </tr>
                    )}
                    {rows.map((r: any) => {
                      const statusColor = r.status === 'sent' ? 'bg-green-100 text-green-800'
                        : r.status === 'failed' ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-700'
                      return (
                        <tr class="border-t border-gray-100 hover:bg-gray-50">
                          <td class="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                            {formatBrusselsDateTime(r.sent_at)}
                          </td>
                          <td class="px-3 py-2 text-xs whitespace-nowrap">
                            {CATEGORY_LABELS[r.category] || r.category}
                          </td>
                          <td class="px-3 py-2">
                            <span class="font-mono text-xs">{r.recipient}</span>
                          </td>
                          <td class="px-3 py-2 max-w-md truncate" title={r.subject}>
                            {r.subject}
                          </td>
                          <td class="px-3 py-2 text-center">
                            <span class={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusColor}`}>
                              {STATUS_LABELS[r.status] || r.status}
                            </span>
                          </td>
                          <td class="px-3 py-2 text-center text-xs text-gray-600">
                            {r.attachments_count > 0 ? r.attachments_count : ''}
                          </td>
                          <td class="px-3 py-2 text-xs">
                            {r.status === 'sent' && r.resend_message_id && (
                              <code class="text-gray-500" title="Zoek deze ID in het Resend dashboard voor bounce/complaint status">
                                {r.resend_message_id.substring(0, 12)}…
                              </code>
                            )}
                            {r.status !== 'sent' && r.error_message && (
                              <span class="text-red-600" title={r.error_message}>
                                {r.error_message.substring(0, 60)}
                                {r.error_message.length > 60 ? '…' : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginatie */}
            {totalPages > 1 && (
              <div class="flex justify-center items-center gap-2 mt-4">
                {page > 1 && (
                  <a href={qs({ page: page - 1 })}
                     class="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50">
                    <i class="fas fa-chevron-left mr-1"></i> Vorige
                  </a>
                )}
                <span class="text-sm text-gray-600 px-3">
                  Pagina <strong>{page}</strong> van <strong>{totalPages}</strong>
                </span>
                {page < totalPages && (
                  <a href={qs({ page: page + 1 })}
                     class="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50">
                    Volgende <i class="fas fa-chevron-right ml-1"></i>
                  </a>
                )}
              </div>
            )}

            <p class="text-xs text-gray-500 mt-6 italic">
              💡 Bijhouden: dit log bevat enkel metadata (geen mail-inhoud). Resend zelf houdt bounce &amp;
              complaint-info bij per Message ID — kopieer het ID hierboven en zoek het in
              het <a href="https://resend.com/emails" target="_blank" class="underline">Resend dashboard</a>.
            </p>
          </div>
        </main>
      </div>
    </Layout>
  )
})

export default app
