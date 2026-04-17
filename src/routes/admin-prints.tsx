import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { sendEmail } from '../utils/email'

const app = new Hono()

// Auth Middleware – scoped to /admin/* and /api/admin/* only
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

// === DASHBOARD ===
app.get('/admin/prints', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const view = c.req.query('view') || 'todo' // todo, ready, history

  let statusFilter = "pr.status = 'pending'"
  if (view === 'ready') statusFilter = "pr.status = 'ready'"
  if (view === 'history') statusFilter = "pr.status = 'completed'"

  const requests = await queryAll(db, `
    SELECT pr.*, 
           u.email, p.voornaam, p.achternaam,
           m.titel as material_titel, m.page_count,
           w.titel as werk_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE ${statusFilter}
    ORDER BY pr.created_at DESC
  `)

  // Get counts for tabs
  const counts = await queryOne<any>(db, `
    SELECT 
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as todo,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as history
    FROM print_requests
  `)

  return c.html(
    <Layout title="Printservice" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="prints" />
        <div class="flex-1 p-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-6">
            <i class="fas fa-print text-animato-primary mr-3"></i>
            Printservice & Distributie
          </h1>

          {/* Tabs */}
          <div class="flex space-x-4 mb-6">
            <a href="/admin/prints?view=todo" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'todo' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-inbox mr-2"></i> Te Printen
              <span class="ml-2 bg-white bg-opacity-20 px-2 rounded-full text-xs">{counts?.todo || 0}</span>
            </a>
            <a href="/admin/prints?view=ready" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'ready' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-box-open mr-2"></i> Klaar voor Afhalen
              <span class="ml-2 bg-white bg-opacity-20 px-2 rounded-full text-xs">{counts?.ready || 0}</span>
            </a>
            <a href="/admin/prints?view=history" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'history' ? 'bg-gray-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-history mr-2"></i> Historiek
            </a>
          </div>

          {/* List */}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            {requests.length === 0 ? (
              <div class="p-12 text-center text-gray-500">
                <i class="fas fa-check-circle text-4xl mb-3 text-gray-300"></i>
                <p>Geen aanvragen in deze lijst.</p>
              </div>
            ) : (
              <table class="w-full">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lid</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kosten</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  {requests.map((req: any) => (
                    <tr>
                      <td class="px-6 py-4 text-sm text-gray-600">
                        {new Date(req.created_at).toLocaleDateString('nl-BE')}
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm font-bold text-gray-900">{req.voornaam} {req.achternaam}</div>
                        <div class="text-xs text-gray-500">{req.email}</div>
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm text-gray-900">{req.werk_titel}</div>
                        <div class="text-xs text-gray-500">
                          {req.material_titel || 'Gehele werk'} 
                          {req.page_count ? ` (${req.page_count} p.)` : ''}
                        </div>
                        {req.opmerking && (
                          <div class="mt-1 text-xs bg-yellow-50 text-yellow-800 p-1 rounded inline-block">
                            <i class="fas fa-comment mr-1"></i> {req.opmerking}
                          </div>
                        )}
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm font-mono">
                          {req.cost > 0 ? `€ ${req.cost.toFixed(2)}` : 'Gratis'}
                        </div>
                        <div class="text-xs text-gray-500">
                          {req.is_subscription_covered ? 'Abonnement' : (req.payment_status === 'paid' ? 'Betaald' : 'Nog betalen')}
                        </div>
                      </td>
                      <td class="px-6 py-4 text-right">
                        {view === 'todo' && (
                          <form action="/api/admin/prints/mark-ready" method="POST">
                            <input type="hidden" name="id" value={req.id} />
                            <button type="submit" class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition" title="Markeer als geprint en stuur e-mail">
                              <i class="fas fa-print mr-1"></i> Klaar & Mailen
                            </button>
                          </form>
                        )}
                        {view === 'ready' && (
                          <form action="/api/admin/prints/mark-completed" method="POST">
                            <input type="hidden" name="id" value={req.id} />
                            <button type="submit" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition" title="Markeer als opgehaald">
                              <i class="fas fa-check mr-1"></i> Overhandigd
                            </button>
                          </form>
                        )}
                        {view === 'history' && (
                          <span class="text-gray-400 text-sm italic">Afgerond</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

// === ACTIONS ===

// 1. Markeer als Klaar & Stuur Email
app.post('/api/admin/prints/mark-ready', async (c) => {
  const body = await c.req.parseBody()
  const id = body.id
  const db = c.env.DB

  // Get request details for email
  const req = await queryOne<any>(db, `
    SELECT pr.*, u.email, p.voornaam, w.titel as werk_titel, m.titel as mat_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE pr.id = ?
  `, [id])

  if (!req) return c.redirect('/admin/prints')

  // Update status
  await execute(db, "UPDATE print_requests SET status = 'ready' WHERE id = ?", [id])

  // Send Email
  const costMsg = req.cost > 0 ? `De kosten hiervoor bedragen €${req.cost.toFixed(2)}.` : "De kosten vallen binnen je abonnement."
  const item = req.mat_titel ? `${req.werk_titel} - ${req.mat_titel}` : req.werk_titel

  const emailHtml = `
    <h1>Je printaanvraag ligt klaar!</h1>
    <p>Beste ${req.voornaam},</p>
    <p>Goed nieuws! De papieren versie van <strong>${item}</strong> is geprint en ligt voor je klaar.</p>
    <p>Je kunt deze ophalen bij de volgende repetitie (in het bakje van de bibliothecaris).</p>
    <p>${costMsg}</p>
    <p>Veel zingplezier!</p>
    <p><em>Het Animato Team</em></p>
  `

  await sendEmail({
    to: req.email,
    subject: `🖨️ Klaar voor afhalen: ${item}`,
    html: emailHtml
  }, c.env.RESEND_API_KEY)

  return c.redirect('/admin/prints?view=todo')
})

// 2. Markeer als Afgehandeld (Opgehaald)
app.post('/api/admin/prints/mark-completed', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, "UPDATE print_requests SET status = 'completed' WHERE id = ?", [body.id])
  return c.redirect('/admin/prints?view=ready')
})

export default app
