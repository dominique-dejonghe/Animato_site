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
  const selectedSeasonId = c.req.query('season_id')

  // Get all seasons
  const seasons = await queryAll(db, "SELECT * FROM membership_years ORDER BY start_date DESC")
  
  // Determine active season (selected or most recent)
  let activeSeason = null
  if (selectedSeasonId) {
    activeSeason = seasons.find((s: any) => s.id == selectedSeasonId)
  } else {
    activeSeason = seasons.find((s: any) => s.is_active) || seasons[0]
  }

  // If no seasons exist yet, activeSeason might be null
  const memberships = activeSeason ? await queryAll(db, `
    SELECT um.*, u.email, p.voornaam, p.achternaam
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.year_id = ?
    ORDER BY p.achternaam
  `, [activeSeason.id]) : []

  // Get active users WITHOUT membership for this season (to add them manually or bulk)
  const usersWithoutMembership = activeSeason ? await queryAll(db, `
    SELECT u.id, u.email, p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE u.status = 'actief' 
    AND u.id NOT IN (
      SELECT um.user_id 
      FROM user_memberships um
      WHERE um.year_id = ?
    )
    ORDER BY p.achternaam
  `, [activeSeason.id]) : []

  // Calculate totals
  const totalAmount = memberships.reduce((acc: number, m: any) => acc + m.amount, 0)
  const paidAmount = memberships.filter((m: any) => m.status === 'paid').reduce((acc: number, m: any) => acc + m.amount, 0)
  const openAmount = memberships.filter((m: any) => m.status === 'pending').reduce((acc: number, m: any) => acc + m.amount, 0)

  return c.html(
    <Layout title="Lidgelden Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="finance" />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-euro-sign text-animato-primary"></i>
                Lidgelden Beheer
              </h1>
              <p class="text-gray-600 mt-1">Beheer seizoenen en betalingen</p>
            </div>
            <div class="flex gap-2">
              <button onclick="document.getElementById('createSeasonModal').classList.remove('hidden')" class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50">
                <i class="fas fa-calendar-plus mr-2"></i> Nieuw Seizoen
              </button>
              {activeSeason && (
                <button onclick="document.getElementById('addModal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90">
                  <i class="fas fa-plus mr-2"></i> Lidmaatschap Toekennen
                </button>
              )}
            </div>
          </div>

          {/* Season Selector */}
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <label class="font-medium text-gray-700">Selecteer Seizoen:</label>
              <select 
                class="border-gray-300 rounded-md shadow-sm focus:border-animato-primary focus:ring focus:ring-animato-primary focus:ring-opacity-50"
                onchange="window.location.href = '/admin/lidgelden?season_id=' + this.value"
              >
                {seasons.map((s: any) => (
                  <option value={s.id} selected={activeSeason && s.id === activeSeason.id}>
                    {s.season} ({s.is_active ? 'Actief' : 'Archief'})
                  </option>
                ))}
                {seasons.length === 0 && <option>Geen seizoenen gevonden</option>}
              </select>
            </div>
            {activeSeason && (
              <div class="text-sm text-gray-500">
                Periode: {new Date(activeSeason.start_date).toLocaleDateString('nl-BE')} - {new Date(activeSeason.end_date).toLocaleDateString('nl-BE')}
              </div>
            )}
          </div>

          {activeSeason ? (
            <>
              {/* Season Settings */}
              <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6">
                 <div class="flex justify-between items-center mb-2">
                    <h3 class="font-bold text-gray-800">Seizoen Instellingen</h3>
                    <button onclick="document.getElementById('editSeasonModal').classList.remove('hidden')" class="text-blue-600 hover:underline text-sm">
                        <i class="fas fa-edit"></i> Bewerk Prijzen & Details
                    </button>
                 </div>
                 <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><span class="text-gray-500">Naam:</span> <span class="font-medium">{activeSeason.season}</span></div>
                    <div><span class="text-gray-500">Status:</span> <span class={`font-medium ${activeSeason.is_active ? 'text-green-600' : 'text-gray-500'}`}>{activeSeason.is_active ? 'Actief' : 'Gearchiveerd'}</span></div>
                    <div><span class="text-gray-500">Basis Lidgeld:</span> <span class="font-medium">€ {activeSeason.fee_base.toFixed(2)}</span></div>
                    <div><span class="text-gray-500">Full Lidgeld:</span> <span class="font-medium">€ {activeSeason.fee_full.toFixed(2)}</span></div>
                 </div>
              </div>

              {/* Stats Cards */}
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div class="bg-white p-4 rounded shadow border-l-4 border-blue-500">
                  <p class="text-gray-500 text-sm">Totaal Leden</p>
                  <p class="text-2xl font-bold">{memberships.length}</p>
                </div>
                <div class="bg-white p-4 rounded shadow border-l-4 border-green-500">
                  <p class="text-gray-500 text-sm">Betaald ({memberships.filter((m: any) => m.status === 'paid').length})</p>
                  <p class="text-2xl font-bold">€ {paidAmount.toFixed(2)}</p>
                </div>
                <div class="bg-white p-4 rounded shadow border-l-4 border-amber-500">
                  <p class="text-gray-500 text-sm">Openstaand ({memberships.filter((m: any) => m.status === 'pending').length})</p>
                  <p class="text-2xl font-bold">€ {openAmount.toFixed(2)}</p>
                </div>
                <div class="bg-white p-4 rounded shadow border-l-4 border-gray-500 flex flex-col justify-center items-start">
                   <p class="text-gray-500 text-sm mb-1">Actie</p>
                   <form action="/api/admin/lidgelden/generate-bulk" method="POST" onsubmit="return confirm('Weet je zeker dat je lidmaatschappen wilt genereren voor ALLE actieve leden zonder lidmaatschap?');">
                      <input type="hidden" name="season_id" value={activeSeason.id} />
                      <button type="submit" class="text-sm bg-gray-800 text-white px-3 py-1 rounded hover:bg-gray-700 w-full text-center" disabled={usersWithoutMembership.length === 0}>
                        <i class="fas fa-magic mr-1"></i> Genereer ({usersWithoutMembership.length})
                      </button>
                   </form>
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
                    {memberships.length > 0 ? memberships.map((m: any) => (
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
                            <div class="flex flex-col">
                                <span class="text-green-600 font-semibold"><i class="fas fa-check mr-1"></i> Betaald</span>
                                <span class="text-xs text-gray-400">{new Date(m.paid_at).toLocaleDateString('nl-BE')}</span>
                            </div>
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
                    )) : (
                        <tr>
                            <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                                Geen lidmaatschappen gevonden voor dit seizoen.
                                <br/>
                                <button onclick="document.querySelector('form[action=\'/api/admin/lidgelden/generate-bulk\'] button').click()" class="text-animato-primary hover:underline mt-2">
                                    Genereer automatisch voor alle actieve leden
                                </button>
                            </td>
                        </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <i class="fas fa-calendar-times text-yellow-500 text-4xl mb-4"></i>
              <h3 class="text-xl font-bold text-gray-900 mb-2">Geen Seizoenen Gevonden</h3>
              <p class="text-gray-600 mb-4">Maak eerst een nieuw seizoen aan om te beginnen.</p>
              <button onclick="document.getElementById('createSeasonModal').classList.remove('hidden')" class="bg-animato-primary text-white px-6 py-2 rounded hover:opacity-90">
                <i class="fas fa-calendar-plus mr-2"></i> Nieuw Seizoen Aanmaken
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Membership Modal */}
      {activeSeason && (
        <div id="addModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="text-xl font-bold mb-4">Lidmaatschap Toekennen ({activeSeason.season})</h3>
            <form action="/api/admin/lidgelden/create" method="POST">
              <input type="hidden" name="year_id" value={activeSeason.id} />
              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Lid</label>
                <select name="user_id" class="w-full border rounded p-2" required>
                  {usersWithoutMembership.map((u: any) => (
                    <option value={u.id}>{u.voornaam} {u.achternaam} ({u.email})</option>
                  ))}
                  {usersWithoutMembership.length === 0 && <option disabled selected>Alle actieve leden hebben al een lidmaatschap</option>}
                </select>
              </div>
              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Formule</label>
                <select name="type" class="w-full border rounded p-2" required>
                  <option value="basis">Basis Lidgeld (€{activeSeason.fee_base})</option>
                  <option value="full">Lidgeld + Partituren (€{activeSeason.fee_full})</option>
                </select>
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="document.getElementById('addModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
                <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded" disabled={usersWithoutMembership.length === 0}>Aanmaken</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Season Modal */}
      {activeSeason && (
        <div id="editSeasonModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="text-xl font-bold mb-4">Seizoen Bewerken ({activeSeason.season})</h3>
            <form action="/api/admin/seasons/update" method="POST">
              <input type="hidden" name="id" value={activeSeason.id} />
              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Seizoen Naam</label>
                <input type="text" name="season" value={activeSeason.season} class="w-full border rounded p-2" required />
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Start Datum</label>
                  <input type="date" name="start_date" value={activeSeason.start_date.split('T')[0]} class="w-full border rounded p-2" required />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Eind Datum</label>
                  <input type="date" name="end_date" value={activeSeason.end_date.split('T')[0]} class="w-full border rounded p-2" required />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Basis Lidgeld (€)</label>
                  <input type="number" step="0.01" name="fee_base" value={activeSeason.fee_base} class="w-full border rounded p-2" required />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Full Lidgeld (€)</label>
                  <input type="number" step="0.01" name="fee_full" value={activeSeason.fee_full} class="w-full border rounded p-2" required />
                </div>
              </div>
              <div class="mb-4">
                 <label class="flex items-center gap-2">
                   <input type="checkbox" name="is_active" value="1" checked={activeSeason.is_active === 1} />
                   <span class="text-sm font-medium">Instellen als actief seizoen</span>
                 </label>
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="document.getElementById('editSeasonModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
                <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Opslaan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Season Modal */}
      <div id="createSeasonModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-xl font-bold mb-4">Nieuw Seizoen Aanmaken</h3>
          <form action="/api/admin/seasons/create" method="POST">
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1">Seizoen Naam</label>
              <input type="text" name="season" placeholder="bv. 2026-2027" class="w-full border rounded p-2" required />
            </div>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-medium mb-1">Start Datum</label>
                <input type="date" name="start_date" class="w-full border rounded p-2" required />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Eind Datum</label>
                <input type="date" name="end_date" class="w-full border rounded p-2" required />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-medium mb-1">Basis Lidgeld (€)</label>
                <input type="number" step="0.01" name="fee_base" value="25.00" class="w-full border rounded p-2" required />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Full Lidgeld (€)</label>
                <input type="number" step="0.01" name="fee_full" value="65.00" class="w-full border rounded p-2" required />
              </div>
            </div>
            <div class="mb-4">
               <label class="flex items-center gap-2">
                 <input type="checkbox" name="is_active" value="1" checked />
                 <span class="text-sm font-medium">Instellen als actief seizoen</span>
               </label>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" onclick="document.getElementById('createSeasonModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Aanmaken</button>
            </div>
          </form>
        </div>
      </div>

    </Layout>
  )
})

// === API ACTIONS ===

// Update Season
app.post('/api/admin/seasons/update', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  const isActive = body.is_active ? 1 : 0

  if (isActive) {
    // Deactivate other seasons
    await execute(db, "UPDATE membership_years SET is_active = 0 WHERE id != ?", [body.id])
  }

  await execute(db, `
    UPDATE membership_years 
    SET season = ?, start_date = ?, end_date = ?, fee_base = ?, fee_full = ?, is_active = ?
    WHERE id = ?
  `, [body.season, body.start_date, body.end_date, body.fee_base, body.fee_full, isActive, body.id])

  // Update system setting if active
  if (isActive) {
      await execute(db, "INSERT INTO system_settings (key, value) VALUES ('current_season', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [body.season, body.season])
  }

  return c.redirect('/admin/lidgelden?season_id=' + body.id)
})

// Create Season
app.post('/api/admin/seasons/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  const isActive = body.is_active ? 1 : 0

  if (isActive) {
    // Deactivate other seasons
    await execute(db, "UPDATE membership_years SET is_active = 0")
  }

  await execute(db, `
    INSERT INTO membership_years (season, start_date, end_date, fee_base, fee_full, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [body.season, body.start_date, body.end_date, body.fee_base, body.fee_full, isActive])

  // Update system setting for current_season just in case other parts of the app rely on it
  if (isActive) {
      await execute(db, "INSERT INTO system_settings (key, value) VALUES ('current_season', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [body.season, body.season])
  }

  return c.redirect('/admin/lidgelden')
})

// Create Single Membership
app.post('/api/admin/lidgelden/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // Get year details for fees
  const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [body.year_id])
  if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

  const amount = body.type === 'full' ? year.fee_full : year.fee_base
  const mockMollieId = 'tr_' + Math.random().toString(36).substr(2, 9)
  
  await execute(db, `
    INSERT INTO user_memberships (user_id, year_id, type, amount, status, mollie_payment_id)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `, [body.user_id, body.year_id, body.type, amount, mockMollieId])

  return c.redirect('/admin/lidgelden?season_id=' + body.year_id)
})

// Generate Bulk Memberships
app.post('/api/admin/lidgelden/generate-bulk', async (c) => {
    const body = await c.req.parseBody()
    const db = c.env.DB
    const yearId = body.season_id

    // Get year details
    const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [yearId])
    if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

    // Get all active users who don't have a membership for this year
    const users = await queryAll(db, `
        SELECT id FROM users 
        WHERE status = 'actief' 
        AND id NOT IN (SELECT user_id FROM user_memberships WHERE year_id = ?)
    `, [yearId])

    if (users.length === 0) return c.redirect('/admin/lidgelden?season_id=' + yearId + '&msg=no_users')

    // Prepare batch inserts
    // Default to 'full' membership for now, or maybe 'basis'? Let's go with 'full' as safer default or maybe add logic?
    // User requested "bulk generation". Let's assume 'full' is the standard for choir members usually.
    // Actually, usually members are 'full'.
    const type = 'full' 
    const amount = year.fee_full

    // We'll do a loop for now as D1 batching in Hono might be tricky with `execute`.
    // Loop is fine for < 100 members.
    for (const u of users) {
        const mockMollieId = 'tr_' + Math.random().toString(36).substr(2, 9)
        await execute(db, `
            INSERT INTO user_memberships (user_id, year_id, type, amount, status, mollie_payment_id)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `, [u.id, yearId, type, amount, mockMollieId])
    }

    return c.redirect('/admin/lidgelden?season_id=' + yearId + '&success=bulk_generated&count=' + users.length)
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

  // Get referer to redirect back to correct season
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
