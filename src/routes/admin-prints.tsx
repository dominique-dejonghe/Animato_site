import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { sendEmail } from '../utils/email'

const app = new Hono()

// ---------- AUTH MIDDLEWARE ----------
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

// ---------- HELPERS ----------
const VALID_STATUS = ['pending', 'ready', 'completed'] as const
const VALID_PAYMENT = ['pending', 'paid', 'refunded'] as const
type Status = typeof VALID_STATUS[number]
type Payment = typeof VALID_PAYMENT[number]

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('nl-BE') } catch { return s }
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('nl-BE') } catch { return s }
}

// =============================================================
// DASHBOARD — Te Printen / Klaar voor Afhalen / Historiek
// =============================================================
app.get('/admin/prints', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const view = (c.req.query('view') || 'todo') as 'todo' | 'ready' | 'history'
  const q = (c.req.query('q') || '').trim()
  const onlyUnpaid = c.req.query('onlyUnpaid') === '1'

  let statusFilter = "pr.status = 'pending'"
  if (view === 'ready') statusFilter = "pr.status = 'ready'"
  if (view === 'history') statusFilter = "pr.status = 'completed'"

  // Search/filter
  const params: any[] = []
  let extra = ''
  if (q) {
    extra += ` AND (
      LOWER(COALESCE(p.voornaam,'') || ' ' || COALESCE(p.achternaam,'')) LIKE ?
      OR LOWER(u.email) LIKE ?
      OR LOWER(COALESCE(w.titel,'')) LIKE ?
      OR LOWER(COALESCE(m.titel,'')) LIKE ?
    )`
    const pat = `%${q.toLowerCase()}%`
    params.push(pat, pat, pat, pat)
  }
  if (onlyUnpaid) {
    extra += ` AND pr.cost > 0 AND COALESCE(pr.payment_status,'pending') != 'paid' AND COALESCE(pr.is_subscription_covered,0) = 0`
  }

  const requests = await queryAll<any>(db, `
    SELECT pr.*,
           u.email, p.voornaam, p.achternaam,
           m.titel as material_titel, m.page_count,
           w.titel as werk_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE ${statusFilter} ${extra}
    ORDER BY pr.created_at DESC
  `, params)

  const counts = await queryOne<any>(db, `
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as todo,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as history,
      SUM(CASE WHEN cost > 0 AND COALESCE(payment_status,'pending') != 'paid' AND COALESCE(is_subscription_covered,0) = 0 AND status != 'completed' THEN 1 ELSE 0 END) as unpaid
    FROM print_requests
  `)

  // Voor de nieuw/edit-modals: lijst van leden en werken
  const allUsers = await queryAll<any>(db, `
    SELECT u.id, u.email, p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    ORDER BY p.voornaam, p.achternaam, u.email
  `)
  const allWorks = await queryAll<any>(db, `
    SELECT id, titel FROM works ORDER BY titel
  `)
  const allMaterials = await queryAll<any>(db, `
    SELECT id, piece_id, titel, page_count FROM materials WHERE piece_id IS NOT NULL ORDER BY piece_id, titel
  `)

  return c.html(
    <Layout title="Printservice" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="prints" />
        <div class="flex-1 p-8">
          <div class="flex items-start justify-between mb-6 gap-4 flex-wrap">
            <h1 class="text-3xl font-bold text-gray-900">
              <i class="fas fa-print text-animato-primary mr-3"></i>
              Printservice &amp; Distributie
            </h1>
            <button
              type="button"
              onclick="document.getElementById('newReqModal').classList.remove('hidden')"
              class="bg-animato-primary hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition shadow"
            >
              <i class="fas fa-plus mr-2"></i> Nieuwe aanvraag
            </button>
          </div>

          {/* Tabs */}
          <div class="flex space-x-2 mb-4 flex-wrap gap-y-2">
            <a href="/admin/prints?view=todo" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'todo' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-inbox mr-2"></i> Te Printen
              <span class={`ml-2 px-2 rounded-full text-xs ${view === 'todo' ? 'bg-white bg-opacity-20' : 'bg-gray-200'}`}>{counts?.todo || 0}</span>
            </a>
            <a href="/admin/prints?view=ready" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'ready' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-box-open mr-2"></i> Klaar voor Afhalen
              <span class={`ml-2 px-2 rounded-full text-xs ${view === 'ready' ? 'bg-white bg-opacity-20' : 'bg-gray-200'}`}>{counts?.ready || 0}</span>
            </a>
            <a href="/admin/prints?view=history" class={`px-4 py-2 rounded-lg font-semibold flex items-center ${view === 'history' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              <i class="fas fa-history mr-2"></i> Historiek
              <span class={`ml-2 px-2 rounded-full text-xs ${view === 'history' ? 'bg-white bg-opacity-20' : 'bg-gray-200'}`}>{counts?.history || 0}</span>
            </a>
            {(counts?.unpaid || 0) > 0 && (
              <span class="px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-semibold flex items-center ml-auto">
                <i class="fas fa-exclamation-triangle mr-2"></i>
                {counts.unpaid} aanvraag(en) met openstaande betaling
              </span>
            )}
          </div>

          {/* Zoek + filter */}
          <form method="GET" action="/admin/prints" class="bg-white rounded-lg shadow p-3 mb-4 flex flex-wrap gap-2 items-center">
            <input type="hidden" name="view" value={view} />
            <div class="flex-1 min-w-[200px] relative">
              <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
              <input
                type="text" name="q" value={q}
                placeholder="Zoek op naam, e-mail, werk of materiaal…"
                class="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
              />
            </div>
            <label class="flex items-center gap-2 text-sm bg-gray-50 px-3 py-2 rounded-lg cursor-pointer">
              <input type="checkbox" name="onlyUnpaid" value="1" checked={onlyUnpaid} class="rounded" />
              <span>Alleen onbetaald</span>
            </label>
            <button type="submit" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900">
              Filteren
            </button>
            {(q || onlyUnpaid) && (
              <a href={`/admin/prints?view=${view}`} class="text-sm text-gray-500 hover:text-gray-800 underline">Reset</a>
            )}
          </form>

          {/* Bulk action bar (alleen op 'todo' view) */}
          {view === 'todo' && requests.length > 0 && (
            <form id="bulkForm" method="POST" action="/api/admin/prints/bulk-mark-ready" class="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-3 hidden" data-bulk-bar>
              <span class="text-sm text-blue-900 font-semibold"><span data-bulk-count>0</span> geselecteerd</span>
              <button type="submit" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-semibold">
                <i class="fas fa-print mr-1"></i> Markeer alle als klaar &amp; mail
              </button>
              <button type="button" onclick="window.__clearBulk()" class="text-sm text-blue-700 hover:text-blue-900 underline ml-auto">Deselecteer</button>
            </form>
          )}

          {/* List */}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            {requests.length === 0 ? (
              <div class="p-12 text-center text-gray-500">
                <i class="fas fa-check-circle text-4xl mb-3 text-gray-300"></i>
                <p>Geen aanvragen in deze lijst.</p>
                {(q || onlyUnpaid) && <p class="text-sm mt-2">Misschien filter resetten?</p>}
              </div>
            ) : (
              <table class="w-full">
                <thead class="bg-gray-50">
                  <tr>
                    {view === 'todo' && (
                      <th class="px-3 py-3 w-8 text-center">
                        <input type="checkbox" onclick="window.__toggleAllBulk(this)" class="rounded" title="Alles selecteren" />
                      </th>
                    )}
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lid</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kosten</th>
                    {view !== 'todo' && (
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status sinds</th>
                    )}
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acties</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  {requests.map((req: any) => {
                    const isPaid = req.payment_status === 'paid' || req.is_subscription_covered
                    const naam = `${req.voornaam || ''} ${req.achternaam || ''}`.trim() || req.email
                    return (
                      <tr class="hover:bg-gray-50 transition">
                        {view === 'todo' && (
                          <td class="px-3 py-4 text-center">
                            <input type="checkbox" form="bulkForm" name="ids" value={req.id} onclick="window.__updateBulkCount()" class="rounded" />
                          </td>
                        )}
                        <td class="px-6 py-4 text-sm text-gray-600">{fmtDate(req.created_at)}</td>
                        <td class="px-6 py-4">
                          <div class="text-sm font-bold text-gray-900">{naam}</div>
                          <div class="text-xs text-gray-500">{req.email}</div>
                        </td>
                        <td class="px-6 py-4">
                          <div class="text-sm text-gray-900">{req.werk_titel || <em class="text-gray-400">— geen werk —</em>}</div>
                          <div class="text-xs text-gray-500">
                            {req.material_titel || 'Gehele werk'}
                            {req.page_count ? ` (${req.page_count} p.)` : ''}
                          </div>
                          {req.opmerking && (
                            <div class="mt-1 text-xs bg-yellow-50 text-yellow-800 p-1 rounded inline-block max-w-md">
                              <i class="fas fa-comment mr-1"></i> {req.opmerking}
                            </div>
                          )}
                        </td>
                        <td class="px-6 py-4">
                          <div class="text-sm font-mono">
                            {Number(req.cost) > 0 ? `€ ${Number(req.cost).toFixed(2)}` : 'Gratis'}
                          </div>
                          <div class={`text-xs ${isPaid ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}`}>
                            {req.is_subscription_covered ? <span><i class="fas fa-infinity mr-1"></i>Abonnement</span> : (req.payment_status === 'paid' ? <span><i class="fas fa-check-circle mr-1"></i>Betaald</span> : (req.payment_status === 'refunded' ? <span><i class="fas fa-undo mr-1"></i>Terugbetaald</span> : <span><i class="fas fa-clock mr-1"></i>Nog betalen</span>))}
                          </div>
                        </td>
                        {view !== 'todo' && (
                          <td class="px-6 py-4 text-xs text-gray-600">
                            {view === 'ready' && <span>Klaar: {fmtDateTime(req.ready_at)}</span>}
                            {view === 'history' && <span>Afgerond: {fmtDateTime(req.completed_at)}</span>}
                          </td>
                        )}
                        <td class="px-6 py-4 text-right">
                          <div class="flex justify-end gap-1 flex-wrap">
                            {view === 'todo' && (
                              <form action="/api/admin/prints/mark-ready" method="POST" class="inline">
                                <input type="hidden" name="id" value={req.id} />
                                <button type="submit" class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition" title="Markeer als geprint en stuur e-mail">
                                  <i class="fas fa-print mr-1"></i> Klaar &amp; Mailen
                                </button>
                              </form>
                            )}
                            {view === 'ready' && (
                              <>
                                <form action="/api/admin/prints/resend-email" method="POST" class="inline">
                                  <input type="hidden" name="id" value={req.id} />
                                  <button type="submit" class="bg-amber-500 text-white px-2 py-1 rounded text-sm hover:bg-amber-600 transition" title="Mail opnieuw versturen">
                                    <i class="fas fa-envelope"></i>
                                  </button>
                                </form>
                                <form action="/api/admin/prints/mark-completed" method="POST" class="inline">
                                  <input type="hidden" name="id" value={req.id} />
                                  <button type="submit" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition" title="Markeer als opgehaald">
                                    <i class="fas fa-check mr-1"></i> Overhandigd
                                  </button>
                                </form>
                              </>
                            )}
                            {view === 'history' && (
                              <form action="/api/admin/prints/reopen" method="POST" class="inline">
                                <input type="hidden" name="id" value={req.id} />
                                <button type="submit" class="bg-gray-500 text-white px-2 py-1 rounded text-sm hover:bg-gray-600 transition" title="Heropen aanvraag">
                                  <i class="fas fa-undo"></i>
                                </button>
                              </form>
                            )}
                            {!isPaid && Number(req.cost) > 0 && req.status !== 'completed' && (
                              <form action="/api/admin/prints/payment-reminder" method="POST" class="inline">
                                <input type="hidden" name="id" value={req.id} />
                                <button type="submit" class="bg-red-500 text-white px-2 py-1 rounded text-sm hover:bg-red-600 transition" title="Stuur betaalherinnering">
                                  <i class="fas fa-euro-sign"></i>
                                </button>
                              </form>
                            )}
                            <button
                              type="button"
                              onclick={`window.__editPrint(${req.id})`}
                              class="bg-gray-200 text-gray-800 px-2 py-1 rounded text-sm hover:bg-gray-300 transition"
                              title="Bewerken"
                              data-print-row={req.id}
                              data-print-json={JSON.stringify({
                                id: req.id,
                                user_id: req.user_id,
                                work_id: req.work_id,
                                material_id: req.material_id,
                                opmerking: req.opmerking || '',
                                status: req.status,
                                cost: Number(req.cost) || 0,
                                is_subscription_covered: req.is_subscription_covered ? 1 : 0,
                                payment_status: req.payment_status || 'pending'
                              })}
                            >
                              <i class="fas fa-edit"></i>
                            </button>
                            <form action="/api/admin/prints/delete" method="POST" class="inline" onsubmit="return confirm('Aanvraag definitief verwijderen?')">
                              <input type="hidden" name="id" value={req.id} />
                              <button type="submit" class="bg-red-600 text-white px-2 py-1 rounded text-sm hover:bg-red-700 transition" title="Verwijderen">
                                <i class="fas fa-trash"></i>
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ============ NIEUW-MODAL ============ */}
      <div id="newReqModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between p-4 border-b">
            <h2 class="text-xl font-bold"><i class="fas fa-plus-circle text-animato-primary mr-2"></i>Nieuwe printaanvraag</h2>
            <button type="button" onclick="document.getElementById('newReqModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
          </div>
          <form method="POST" action="/api/admin/prints/create" class="p-4 space-y-4">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Lid <span class="text-red-500">*</span></label>
              <select name="user_id" required class="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">— Selecteer lid —</option>
                {allUsers.map((u: any) => (
                  <option value={u.id}>{(u.voornaam || '') + ' ' + (u.achternaam || '')} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Werk</label>
              <select name="work_id" id="newReqWork" class="w-full border border-gray-300 rounded-lg px-3 py-2" onchange="window.__filterMaterials(this.value, 'newReqMaterial')">
                <option value="">— Geen werk gekoppeld —</option>
                {allWorks.map((w: any) => (
                  <option value={w.id}>{w.titel}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Materiaal (optioneel — leeg = volledig werk)</label>
              <select name="material_id" id="newReqMaterial" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">— Volledig werk —</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Kostprijs (€)</label>
                <input type="number" step="0.01" min="0" name="cost" value="0" class="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Betaalstatus</label>
                <select name="payment_status" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="pending">Nog betalen</option>
                  <option value="paid">Betaald</option>
                  <option value="refunded">Terugbetaald</option>
                </select>
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_subscription_covered" value="1" class="rounded" />
              <span>Gedekt door abonnement (geen aparte betaling nodig)</span>
            </label>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Opmerking</label>
              <textarea name="opmerking" rows={2} class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Bv. dubbelzijdig, in mapje, ..."></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onclick="document.getElementById('newReqModal').classList.add('hidden')" class="px-4 py-2 text-gray-600 hover:text-gray-900">Annuleren</button>
              <button type="submit" class="bg-animato-primary hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold">
                <i class="fas fa-save mr-2"></i>Aanvraag aanmaken
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ============ EDIT-MODAL ============ */}
      <div id="editReqModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between p-4 border-b">
            <h2 class="text-xl font-bold"><i class="fas fa-edit text-animato-primary mr-2"></i>Aanvraag bewerken</h2>
            <button type="button" onclick="document.getElementById('editReqModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
          </div>
          <form method="POST" action="/api/admin/prints/update" class="p-4 space-y-4">
            <input type="hidden" name="id" id="editReqId" />
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Lid</label>
              <select name="user_id" id="editReqUser" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                {allUsers.map((u: any) => (
                  <option value={u.id}>{(u.voornaam || '') + ' ' + (u.achternaam || '')} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Werk</label>
              <select name="work_id" id="editReqWork" class="w-full border border-gray-300 rounded-lg px-3 py-2" onchange="window.__filterMaterials(this.value, 'editReqMaterial')">
                <option value="">— Geen werk gekoppeld —</option>
                {allWorks.map((w: any) => (
                  <option value={w.id}>{w.titel}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Materiaal</label>
              <select name="material_id" id="editReqMaterial" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">— Volledig werk —</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                <select name="status" id="editReqStatus" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="pending">Te printen</option>
                  <option value="ready">Klaar voor afhalen</option>
                  <option value="completed">Afgerond</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Betaalstatus</label>
                <select name="payment_status" id="editReqPayment" class="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="pending">Nog betalen</option>
                  <option value="paid">Betaald</option>
                  <option value="refunded">Terugbetaald</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Kostprijs (€)</label>
              <input type="number" step="0.01" min="0" name="cost" id="editReqCost" class="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_subscription_covered" id="editReqSub" value="1" class="rounded" />
              <span>Gedekt door abonnement</span>
            </label>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Opmerking</label>
              <textarea name="opmerking" id="editReqOpm" rows={2} class="w-full border border-gray-300 rounded-lg px-3 py-2"></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onclick="document.getElementById('editReqModal').classList.add('hidden')" class="px-4 py-2 text-gray-600 hover:text-gray-900">Annuleren</button>
              <button type="submit" class="bg-animato-primary hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold">
                <i class="fas fa-save mr-2"></i>Opslaan
              </button>
            </div>
          </form>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{__html: `
        // === Materiaal-dropdown filteren op gekozen werk ===
        const ALL_MATERIALS = ${JSON.stringify(allMaterials)};
        window.__filterMaterials = function(workId, targetId) {
          const sel = document.getElementById(targetId);
          if (!sel) return;
          const current = sel.value;
          sel.innerHTML = '<option value="">— Volledig werk —</option>';
          const wid = parseInt(workId);
          if (!wid) return;
          ALL_MATERIALS.filter(m => m.piece_id === wid).forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.titel + (m.page_count ? ' (' + m.page_count + ' p.)' : '');
            if (String(m.id) === String(current)) opt.selected = true;
            sel.appendChild(opt);
          });
        };

        // === Edit modal vullen ===
        window.__editPrint = function(id) {
          const btn = document.querySelector('[data-print-row="' + id + '"]');
          if (!btn) return;
          const data = JSON.parse(btn.getAttribute('data-print-json'));
          document.getElementById('editReqId').value = data.id;
          document.getElementById('editReqUser').value = data.user_id || '';
          document.getElementById('editReqWork').value = data.work_id || '';
          window.__filterMaterials(data.work_id, 'editReqMaterial');
          setTimeout(() => {
            document.getElementById('editReqMaterial').value = data.material_id || '';
          }, 10);
          document.getElementById('editReqStatus').value = data.status || 'pending';
          document.getElementById('editReqPayment').value = data.payment_status || 'pending';
          document.getElementById('editReqCost').value = data.cost || 0;
          document.getElementById('editReqSub').checked = !!data.is_subscription_covered;
          document.getElementById('editReqOpm').value = data.opmerking || '';
          document.getElementById('editReqModal').classList.remove('hidden');
        };

        // === Bulk select ===
        function getBulkCheckboxes() {
          return Array.from(document.querySelectorAll('input[form="bulkForm"][name="ids"]'));
        }
        window.__updateBulkCount = function() {
          const bar = document.querySelector('[data-bulk-bar]');
          if (!bar) return;
          const n = getBulkCheckboxes().filter(c => c.checked).length;
          bar.querySelector('[data-bulk-count]').textContent = n;
          if (n > 0) bar.classList.remove('hidden'); else bar.classList.add('hidden');
        };
        window.__toggleAllBulk = function(master) {
          getBulkCheckboxes().forEach(c => { c.checked = master.checked; });
          window.__updateBulkCount();
        };
        window.__clearBulk = function() {
          getBulkCheckboxes().forEach(c => { c.checked = false; });
          window.__updateBulkCount();
        };

        // Close modals on backdrop click
        ['newReqModal','editReqModal'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); });
        });
      `}} />
    </Layout>
  )
})

// =============================================================
// CREATE
// =============================================================
app.post('/api/admin/prints/create', async (c) => {
  const body = await c.req.parseBody()
  const user_id = parseInt(String(body.user_id || ''))
  if (!user_id) return c.redirect('/admin/prints?view=todo')

  const work_id = body.work_id ? parseInt(String(body.work_id)) : null
  const material_id = body.material_id ? parseInt(String(body.material_id)) : null
  const cost = parseFloat(String(body.cost || '0')) || 0
  const payment_status = VALID_PAYMENT.includes(String(body.payment_status) as Payment)
    ? String(body.payment_status) : 'pending'
  const is_sub = body.is_subscription_covered ? 1 : 0
  const opmerking = String(body.opmerking || '').trim() || null

  await execute(c.env.DB, `
    INSERT INTO print_requests
      (user_id, work_id, material_id, opmerking, status, cost, is_subscription_covered, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [user_id, work_id, material_id, opmerking, cost, is_sub, payment_status])

  return c.redirect('/admin/prints?view=todo')
})

// =============================================================
// UPDATE (edit modal)
// =============================================================
app.post('/api/admin/prints/update', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (!id) return c.redirect('/admin/prints')

  const user_id = body.user_id ? parseInt(String(body.user_id)) : null
  const work_id = body.work_id ? parseInt(String(body.work_id)) : null
  const material_id = body.material_id ? parseInt(String(body.material_id)) : null
  const cost = parseFloat(String(body.cost || '0')) || 0
  const status = VALID_STATUS.includes(String(body.status) as Status)
    ? String(body.status) : 'pending'
  const payment_status = VALID_PAYMENT.includes(String(body.payment_status) as Payment)
    ? String(body.payment_status) : 'pending'
  const is_sub = body.is_subscription_covered ? 1 : 0
  const opmerking = String(body.opmerking || '').trim() || null

  // Read current state to detect status changes for audit timestamps
  const current = await queryOne<any>(c.env.DB, `SELECT status, ready_at, completed_at FROM print_requests WHERE id = ?`, [id])
  if (!current) return c.redirect('/admin/prints')

  let readyAtSet = ''
  let completedAtSet = ''
  if (status === 'ready' && current.status !== 'ready' && !current.ready_at) {
    readyAtSet = `, ready_at = CURRENT_TIMESTAMP`
  }
  if (status === 'completed' && current.status !== 'completed' && !current.completed_at) {
    completedAtSet = `, completed_at = CURRENT_TIMESTAMP`
  }

  await execute(c.env.DB, `
    UPDATE print_requests
    SET user_id = ?, work_id = ?, material_id = ?, opmerking = ?,
        status = ?, cost = ?, is_subscription_covered = ?, payment_status = ?,
        updated_at = CURRENT_TIMESTAMP
        ${readyAtSet} ${completedAtSet}
    WHERE id = ?
  `, [user_id, work_id, material_id, opmerking, status, cost, is_sub, payment_status, id])

  return c.redirect(`/admin/prints?view=${status === 'completed' ? 'history' : (status === 'ready' ? 'ready' : 'todo')}`)
})

// =============================================================
// DELETE
// =============================================================
app.post('/api/admin/prints/delete', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (id) {
    await execute(c.env.DB, `DELETE FROM print_requests WHERE id = ?`, [id])
  }
  return c.redirect('/admin/prints')
})

// =============================================================
// REOPEN (historiek → todo)
// =============================================================
app.post('/api/admin/prints/reopen', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (id) {
    await execute(c.env.DB, `
      UPDATE print_requests
      SET status = 'pending', ready_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id])
  }
  return c.redirect('/admin/prints?view=todo')
})

// =============================================================
// MARK READY + email
// =============================================================
async function markReadyAndMail(c: any, id: number) {
  const db = c.env.DB
  const req = await queryOne<any>(db, `
    SELECT pr.*, u.email, p.voornaam, w.titel as werk_titel, m.titel as mat_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE pr.id = ?
  `, [id])
  if (!req) return false

  await execute(db, `
    UPDATE print_requests
    SET status = 'ready', ready_at = COALESCE(ready_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id])

  const costMsg = Number(req.cost) > 0
    ? `De kosten hiervoor bedragen €${Number(req.cost).toFixed(2)}.`
    : "De kosten vallen binnen je abonnement."
  const item = req.mat_titel ? `${req.werk_titel} - ${req.mat_titel}` : (req.werk_titel || 'je aanvraag')

  const emailHtml = `
    <h1>Je printaanvraag ligt klaar!</h1>
    <p>Beste ${req.voornaam || ''},</p>
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
  return true
}

app.post('/api/admin/prints/mark-ready', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (id) await markReadyAndMail(c, id)
  return c.redirect('/admin/prints?view=todo')
})

// =============================================================
// BULK MARK READY
// =============================================================
app.post('/api/admin/prints/bulk-mark-ready', async (c) => {
  const body = await c.req.parseBody()
  // parseBody returns either a single value or an array for repeated names
  const raw = body.ids
  const ids: number[] = Array.isArray(raw)
    ? raw.map(x => parseInt(String(x))).filter(n => !!n)
    : (raw ? [parseInt(String(raw))].filter(n => !!n) : [])

  for (const id of ids) {
    try { await markReadyAndMail(c, id) } catch (e) { console.error('bulk mark-ready failed for', id, e) }
  }
  return c.redirect('/admin/prints?view=ready')
})

// =============================================================
// RESEND READY-EMAIL
// =============================================================
app.post('/api/admin/prints/resend-email', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (!id) return c.redirect('/admin/prints?view=ready')

  const req = await queryOne<any>(c.env.DB, `
    SELECT pr.*, u.email, p.voornaam, w.titel as werk_titel, m.titel as mat_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE pr.id = ?
  `, [id])
  if (req) {
    const costMsg = Number(req.cost) > 0
      ? `De kosten hiervoor bedragen €${Number(req.cost).toFixed(2)}.`
      : "De kosten vallen binnen je abonnement."
    const item = req.mat_titel ? `${req.werk_titel} - ${req.mat_titel}` : (req.werk_titel || 'je aanvraag')
    await sendEmail({
      to: req.email,
      subject: `🖨️ Herinnering — klaar voor afhalen: ${item}`,
      html: `
        <h1>Vriendelijke herinnering 📬</h1>
        <p>Beste ${req.voornaam || ''},</p>
        <p>De papieren versie van <strong>${item}</strong> ligt nog steeds klaar voor je bij de bibliothecaris.</p>
        <p>${costMsg}</p>
        <p>Tot bij de volgende repetitie!</p>
        <p><em>Het Animato Team</em></p>
      `
    }, c.env.RESEND_API_KEY)
  }
  return c.redirect('/admin/prints?view=ready')
})

// =============================================================
// PAYMENT REMINDER
// =============================================================
app.post('/api/admin/prints/payment-reminder', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (!id) return c.redirect('/admin/prints')

  const req = await queryOne<any>(c.env.DB, `
    SELECT pr.*, u.email, p.voornaam, w.titel as werk_titel, m.titel as mat_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    WHERE pr.id = ?
  `, [id])
  if (req && Number(req.cost) > 0) {
    const item = req.mat_titel ? `${req.werk_titel} - ${req.mat_titel}` : (req.werk_titel || 'je printaanvraag')
    await sendEmail({
      to: req.email,
      subject: `💶 Openstaande betaling: ${item}`,
      html: `
        <h1>Even een vriendelijk seintje 💶</h1>
        <p>Beste ${req.voornaam || ''},</p>
        <p>Voor de printaanvraag <strong>${item}</strong> staat er nog een bedrag van <strong>€${Number(req.cost).toFixed(2)}</strong> open.</p>
        <p>Je kan dit cash afrekenen bij de bibliothecaris, of overschrijven naar de gekende rekening van Animato.</p>
        <p>Alvast bedankt!</p>
        <p><em>Het Animato Team</em></p>
      `
    }, c.env.RESEND_API_KEY)
  }
  return c.redirect(c.req.header('referer') || '/admin/prints')
})

// =============================================================
// MARK COMPLETED
// =============================================================
app.post('/api/admin/prints/mark-completed', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || ''))
  if (id) {
    await execute(c.env.DB, `
      UPDATE print_requests
      SET status = 'completed',
          completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id])
  }
  return c.redirect('/admin/prints?view=ready')
})

export default app
