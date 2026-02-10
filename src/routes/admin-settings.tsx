import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono()

// Middleware voor admin check (hergebruik van admin-bestanden logica)
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden') // Alleen admins!
  c.set('user', user)
  await next()
})

app.get('/admin/settings', async (c) => {
  const user = c.get('user')
  
  const settings = await queryAll(c.env.DB, "SELECT * FROM system_settings")
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value
    return acc
  }, {})

  return c.html(
    <Layout title="Instellingen" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="settings" />
        <div class="flex-1 p-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-6">
            <i class="fas fa-cogs text-animato-primary mr-3"></i>
            Systeem Instellingen
          </h1>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Financial Settings */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-semibold mb-4 border-b pb-2">
                <i class="fas fa-euro-sign text-green-600 mr-2"></i>
                Financiële Instellingen
              </h2>
              
              <form method="POST" action="/api/admin/settings/update">
                <input type="hidden" name="section" value="finance" />
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Huidig Seizoen</label>
                    <input type="text" name="current_season" value={settingsMap.current_season} class="w-full border rounded px-3 py-2" />
                    <p class="text-xs text-gray-500">Gebruikt voor nieuwe lidmaatschappen (bv. 2025-2026)</p>
                  </div>

                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Basis Lidgeld (€)</label>
                      <input type="number" step="0.01" name="membership_fee_base" value={settingsMap.membership_fee_base} class="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Papier Toeslag (€)</label>
                      <input type="number" step="0.01" name="membership_fee_paper" value={settingsMap.membership_fee_paper} class="w-full border rounded px-3 py-2" />
                    </div>
                  </div>
                  
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Prijs per pagina (Losse verkoop) (€)</label>
                    <input type="number" step="0.01" name="price_per_page" value={settingsMap.price_per_page} class="w-full border rounded px-3 py-2" />
                  </div>

                  <div class="border-t pt-4 mt-4">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Mollie API Key</label>
                    <input type="password" name="mollie_api_key" placeholder="live_..." value={settingsMap.mollie_api_key || ''} class="w-full border rounded px-3 py-2" />
                    <p class="text-xs text-gray-500">Vereist voor betaallinks. Laat leeg om te behouden.</p>
                  </div>

                  <button type="submit" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-opacity-90 w-full">
                    Opslaan
                  </button>
                </div>
              </form>
            </div>

            {/* General Site Settings */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-semibold mb-4 border-b pb-2">
                <i class="fas fa-globe text-blue-600 mr-2"></i>
                Algemene Instellingen
              </h2>
              
              <form method="POST" action="/api/admin/settings/update">
                <input type="hidden" name="section" value="general" />
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Site Naam</label>
                    <input type="text" name="site_name" value={settingsMap.site_name || 'Gemengd Koor Animato'} class="w-full border rounded px-3 py-2" />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Contact Email (Notificaties)</label>
                    <input type="email" name="contact_email" value={settingsMap.contact_email} placeholder="info@animato.be" class="w-full border rounded px-3 py-2" />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Contact Telefoon</label>
                    <input type="text" name="contact_phone" value={settingsMap.contact_phone} placeholder="+32 470 12 34 56" class="w-full border rounded px-3 py-2" />
                  </div>

                  <h3 class="font-medium text-gray-900 pt-2">Social Media Links</h3>
                  <div class="grid grid-cols-1 gap-2">
                    <div class="flex items-center">
                      <i class="fab fa-facebook w-8 text-blue-600"></i>
                      <input type="url" name="social_facebook" value={settingsMap.social_facebook} placeholder="Facebook URL" class="flex-1 border rounded px-3 py-2" />
                    </div>
                    <div class="flex items-center">
                      <i class="fab fa-instagram w-8 text-pink-600"></i>
                      <input type="url" name="social_instagram" value={settingsMap.social_instagram} placeholder="Instagram URL" class="flex-1 border rounded px-3 py-2" />
                    </div>
                    <div class="flex items-center">
                      <i class="fab fa-youtube w-8 text-red-600"></i>
                      <input type="url" name="social_youtube" value={settingsMap.social_youtube} placeholder="YouTube URL" class="flex-1 border rounded px-3 py-2" />
                    </div>
                  </div>

                  <button type="submit" class="bg-animato-secondary text-white px-4 py-2 rounded hover:bg-opacity-90 w-full mt-4">
                    Opslaan
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

app.post('/api/admin/settings/update', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // Define allowed keys per section to prevent pollution
  let keys: string[] = []
  if (body.section === 'finance') {
    keys = ['current_season', 'membership_fee_base', 'membership_fee_paper', 'price_per_page', 'mollie_api_key']
  } else if (body.section === 'general') {
    keys = ['site_name', 'contact_email', 'contact_phone', 'social_facebook', 'social_instagram', 'social_youtube']
  }

  for (const key of keys) {
    if (body[key] !== undefined) { // Check undefined to allow empty strings (clearing values)
      // Upsert logic
      await execute(db, `
        INSERT INTO system_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `, [key, body[key]])
    }
  }

  return c.redirect('/admin/settings?success=1')
})

export default app
