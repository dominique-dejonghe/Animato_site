import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

import { createMolliePayment } from '../utils/mollie'
import { sendEmail } from '../utils/email'

const app = new Hono()

// Auth Middleware
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

// === OVERVIEW ===
app.get('/admin/lidgelden', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  // Get current season
  const settingsRes = await queryAll(db, "SELECT * FROM system_settings WHERE key = 'current_season'")
  const currentSeason = settingsRes[0]?.value || '2025-2026'

  // Get memberships for this season
  const memberships = await queryAll(db, `
    SELECT um.*, u.email, p.voornaam, p.achternaam
    FROM user_memberships um
    JOIN membership_years my ON um.year_id = my.id
    JOIN users u ON um.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE my.season = ?
    ORDER BY p.achternaam
  `, [currentSeason])

  // Get active users WITHOUT membership for this season (to add them)
  const usersWithoutMembership = await queryAll(db, `
    SELECT u.id, u.email, p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE u.status = 'actief' 
    AND u.id NOT IN (
      SELECT um.user_id 
      FROM user_memberships um
      JOIN membership_years my ON um.year_id = my.id
      WHERE my.season = ?
    )
    ORDER BY p.achternaam
  `, [currentSeason])

  return c.html(
    <Layout title="Lidgelden Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="finance" />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-3xl font-bold text-gray-900">
              <i class="fas fa-euro-sign text-animato-primary mr-3"></i>
              Lidgelden {currentSeason}
            </h1>
            <button onclick="document.getElementById('addModal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90">
              <i class="fas fa-plus mr-2"></i> Lidmaatschap Toekennen
            </button>
          </div>

          {/* Stats Cards */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div class="bg-white p-4 rounded shadow border-l-4 border-blue-500">
              <p class="text-gray-500 text-sm">Totaal Leden</p>
              <p class="text-2xl font-bold">{memberships.length}</p>
            </div>
            <div class="bg-white p-4 rounded shadow border-l-4 border-green-500">
              <p class="text-gray-500 text-sm">Betaald</p>
              <p class="text-2xl font-bold">{memberships.filter((m: any) => m.status === 'paid').length}</p>
            </div>
            <div class="bg-white p-4 rounded shadow border-l-4 border-red-500">
              <p class="text-gray-500 text-sm">Openstaand</p>
              <p class="text-2xl font-bold">€ {memberships.filter((m: any) => m.status === 'pending').reduce((acc: number, m: any) => acc + m.amount, 0).toFixed(2)}</p>
            </div>
          </div>

          {/* Table */}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <table class="w-full">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-6 py-3 text-left font-medium text-gray-500">Lid</th>
                  <th class="px-6 py-3 text-left font-medium text-gray-500">Formule</th>
                  <th class="px-6 py-3 text-left font-medium text-gray-500">Bedrag</th>
                  <th class="px-6 py-3 text-left font-medium text-gray-500">Status</th>
                  <th class="px-6 py-3 text-right font-medium text-gray-500">Actie</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                {memberships.map((m: any) => (
                  <tr>
                    <td class="px-6 py-4">
                      <div class="font-medium text-gray-900">{m.voornaam} {m.achternaam}</div>
                      <div class="text-sm text-gray-500">{m.email}</div>
                    </td>
                    <td class="px-6 py-4">
                      {m.type === 'full' ? (
                        <span class="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-1 rounded">
                          <i class="fas fa-print mr-1"></i> +Partituren
                        </span>
                      ) : (
                        <span class="bg-gray-100 text-gray-800 text-xs font-semibold px-2 py-1 rounded">Basis</span>
                      )}
                    </td>
                    <td class="px-6 py-4 font-mono">€ {m.amount.toFixed(2)}</td>
                    <td class="px-6 py-4">
                      {m.status === 'paid' ? (
                        <span class="text-green-600 font-semibold"><i class="fas fa-check mr-1"></i> Betaald</span>
                      ) : (
                        <span class="text-amber-600 font-semibold"><i class="fas fa-clock mr-1"></i> Openstaand</span>
                      )}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <div class="flex flex-col gap-2 items-end">
                        {m.status === 'paid' ? (
                          <form action="/api/admin/lidgelden/status" method="POST" class="inline">
                            <input type="hidden" name="membership_id" value={m.id} />
                            <input type="hidden" name="status" value="pending" />
                            <button class="text-amber-600 hover:text-amber-800 text-sm font-medium" title="Markeer als onbetaald">
                              <i class="fas fa-undo mr-1"></i> Reset
                            </button>
                          </form>
                        ) : (
                          <>
                            <form action="/api/admin/lidgelden/status" method="POST" class="inline">
                              <input type="hidden" name="membership_id" value={m.id} />
                              <input type="hidden" name="status" value="paid" />
                              <button class="text-green-600 hover:text-green-800 text-sm font-medium" title="Markeer als handmatig betaald">
                                <i class="fas fa-check-circle mr-1"></i> Betaald
                              </button>
                            </form>
                            <form action="/api/admin/lidgelden/send-link" method="POST" class="inline">
                              <input type="hidden" name="membership_id" value={m.id} />
                              <button class="text-blue-600 hover:text-blue-800 text-sm font-medium" title="Stuur betaallink per email">
                                <i class="fas fa-envelope mr-1"></i> Stuur Link
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      <div id="addModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-xl font-bold mb-4">Lidmaatschap Toekennen</h3>
          <form action="/api/admin/lidgelden/create" method="POST">
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1">Lid</label>
              <select name="user_id" class="w-full border rounded p-2" required>
                {usersWithoutMembership.map((u: any) => (
                  <option value={u.id}>{u.voornaam} {u.achternaam} ({u.email})</option>
                ))}
              </select>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1">Formule</label>
              <select name="type" class="w-full border rounded p-2" required>
                <option value="basis">Alleen Lidgeld (€25)</option>
                <option value="full">Lidgeld + Partituren (€65)</option>
              </select>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" onclick="document.getElementById('addModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Aanmaken</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
})

// === ACTIONS ===

app.post('/api/admin/lidgelden/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // 1. Get prices
  const settings = await queryAll(db, "SELECT * FROM system_settings")
  const kv = settings.reduce((acc: any, curr: any) => ({...acc, [curr.key]: curr.value}), {})
  
  const baseFee = parseFloat(kv.membership_fee_base || '25')
  const paperFee = parseFloat(kv.membership_fee_paper || '40')
  const currentSeason = kv.current_season || '2025-2026'

  // 2. Get year ID
  let year = await queryOne<any>(db, "SELECT id FROM membership_years WHERE season = ?", [currentSeason])
  if (!year) {
    // Create year if missing
    await execute(db, "INSERT INTO membership_years (season) VALUES (?)", [currentSeason])
    year = await queryOne<any>(db, "SELECT id FROM membership_years WHERE season = ?", [currentSeason])
  }

  // 3. Calculate amount
  const amount = body.type === 'full' ? (baseFee + paperFee) : baseFee

  // 4. Create record
  // TODO: Create REAL Mollie payment here if key exists
  const mockMollieId = 'tr_' + Math.random().toString(36).substr(2, 9)
  
  await execute(db, `
    INSERT INTO user_memberships (user_id, year_id, type, amount, status, mollie_payment_id)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `, [body.user_id, year.id, body.type, amount, mockMollieId])

  return c.redirect('/admin/lidgelden')
})

// Toggle Status (Paid/Pending)
app.post('/api/admin/lidgelden/status', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  await execute(db, `
    UPDATE user_memberships 
    SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END 
    WHERE id = ?
  `, [body.status, body.status, body.membership_id])

  return c.redirect('/admin/lidgelden')
})

// Send Payment Link
app.post('/api/admin/lidgelden/send-link', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  // Get membership details
  const membership = await queryOne<any>(db, `
    SELECT um.*, u.email, p.voornaam, my.season
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    JOIN membership_years my ON um.year_id = my.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.id = ?
  `, [body.membership_id])

  if (!membership || membership.status === 'paid') return c.redirect('/admin/lidgelden')

  // Generate Payment Link (if not exists)
  const siteUrl = c.env.SITE_URL || 'https://animato.be'
  let paymentUrl = membership.mollie_payment_url

  if (!paymentUrl) {
    const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
      amount: membership.amount,
      description: `Lidgeld Animato ${membership.season} - ${membership.type}`,
      redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
      webhookUrl: `${siteUrl}/api/webhooks/mollie`,
      metadata: {
        membership_id: membership.id,
        type: 'membership'
      }
    })
    
    paymentUrl = payment.checkoutUrl
    
    // Save URL
    await execute(db, `UPDATE user_memberships SET mollie_payment_url = ? WHERE id = ?`, [paymentUrl, membership.id])
  }

  // Send Email
  const emailHtml = `
    <h1>Betaalverzoek Lidgeld ${membership.season}</h1>
    <p>Beste ${membership.voornaam},</p>
    <p>Hierbij ontvang je de betaallink voor je lidmaatschap (${membership.type === 'full' ? 'Met Partituren' : 'Basis'}).</p>
    <p><strong>Bedrag: €${membership.amount.toFixed(2)}</strong></p>
    <p>
      <a href="${paymentUrl}" style="background-color: #00A9CE; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Betaal nu via Mollie
      </a>
    </p>
    <p>Of kopieer deze link: ${paymentUrl}</p>
    <p>Met muzikale groet,<br>Het Bestuur</p>
  `

  await sendEmail({
    to: membership.email,
    subject: `Lidgeld ${membership.season} - Betaalverzoek`,
    html: emailHtml
  }, c.env.RESEND_API_KEY)

  return c.redirect('/admin/lidgelden?sent=true')
})

app.post('/api/admin/lidgelden/remind', async (c) => {
  // In a real app, this would send an email with the payment link
  return c.redirect('/admin/lidgelden?sent=true')
})

export default app
