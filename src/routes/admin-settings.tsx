import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { getMollieMode, validateMollieApiKey } from '../utils/mollie'
import { getMollieApiKey, invalidateMollieApiKeyCache } from '../utils/mollie-config'
import { getSiteUrl } from '../utils/site-url'

const app = new Hono()

// Middleware – scoped to /admin/* and /api/admin/* only
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
}
// SCOPE-FIX 2026-06-17: was /admin/* — te breed.
app.use('/admin/settings', adminAuthMiddleware)
app.use('/admin/settings/*', adminAuthMiddleware)
app.use('/api/admin/settings', adminAuthMiddleware)
app.use('/api/admin/settings/*', adminAuthMiddleware)

app.get('/admin/settings', async (c) => {
  const user = c.get('user')

  const settings = await queryAll(c.env.DB, "SELECT * FROM system_settings")
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value
    return acc
  }, {})

  // Bepaal actieve Mollie-status (zonder échte API-call, puur modus-check)
  const activeMollieKey = await getMollieApiKey(c.env)
  const mollieMode = getMollieMode(activeMollieKey)

  // Effectieve site-URL voor de webhook info-box (zelfde helper als overal: DB → env → request-origin → fallback)
  const effectiveSiteUrl = await getSiteUrl(c)

  const mollieStatusBadge = {
    live:    { label: 'LIVE',    color: 'bg-green-100 text-green-800 border-green-300',  icon: 'fa-circle-check' },
    test:    { label: 'TEST',    color: 'bg-amber-100 text-amber-800 border-amber-300',  icon: 'fa-vial' },
    mock:    { label: 'MOCK',    color: 'bg-gray-100 text-gray-700 border-gray-300',      icon: 'fa-flask' },
    invalid: { label: 'ONGELDIG', color: 'bg-red-100 text-red-800 border-red-300',        icon: 'fa-triangle-exclamation' },
  }[mollieMode]

  return c.html(
    <Layout title="Instellingen" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="settings" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
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
                      <label class="block text-sm font-medium text-gray-700 mb-1">Basis Lidgeld (Zonder Partituren) (€)</label>
                      <input type="number" step="0.01" name="membership_fee_base" value={settingsMap.membership_fee_base} class="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Partituren Toeslag (Extra) (€)</label>
                      <input type="number" step="0.01" name="membership_fee_paper" value={settingsMap.membership_fee_paper} class="w-full border rounded px-3 py-2" />
                      <p class="text-xs text-gray-500">Totaal 'Met Partituren' = Basis + Toeslag</p>
                    </div>
                  </div>
                  
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Prijs per pagina (Losse verkoop) (€)</label>
                    <input type="number" step="0.01" name="price_per_page" value={settingsMap.price_per_page} class="w-full border rounded px-3 py-2" />
                  </div>

                  <div class="border-t pt-4 mt-4">
                    <div class="flex items-center justify-between mb-2">
                      <label class="block text-sm font-medium text-gray-700">
                        <i class="fab fa-cc-amazon-pay text-blue-600 mr-1"></i> Mollie API-key
                      </label>
                      <span class={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${mollieStatusBadge.color}`}>
                        <i class={`fas ${mollieStatusBadge.icon}`}></i>
                        {mollieStatusBadge.label}
                      </span>
                    </div>
                    <input
                      type="password"
                      name="mollie_api_key"
                      placeholder="test_... of live_..."
                      value={settingsMap.mollie_api_key || ''}
                      autocomplete="off"
                      class="w-full border rounded px-3 py-2 font-mono text-sm"
                    />
                    <p class="text-xs text-gray-500 mt-1">
                      Verkrijg je key via <a href="https://my.mollie.com/dashboard/developers/api-keys" target="_blank" class="text-animato-primary hover:underline">Mollie Dashboard → Developers → API keys</a>.
                      {mollieMode === 'mock' && (
                        <span class="block mt-1 text-amber-700"><i class="fas fa-info-circle mr-1"></i>Geen echte key actief — betalingen worden gesimuleerd (mock-modus).</span>
                      )}
                      {mollieMode === 'test' && (
                        <span class="block mt-1 text-amber-700"><i class="fas fa-vial mr-1"></i>Test-modus actief. Geen echt geld. Gebruik testkaarten (zie Mollie-docs).</span>
                      )}
                      {mollieMode === 'live' && (
                        <span class="block mt-1 text-green-700"><i class="fas fa-check-circle mr-1"></i>Live-modus. Echte betalingen worden verwerkt.</span>
                      )}
                    </p>
                    <div class="mt-2 flex gap-2">
                      <button
                        type="button"
                        onclick="testMollieKey()"
                        class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded border border-gray-300"
                      >
                        <i class="fas fa-plug mr-1"></i>Test connectie
                      </button>
                      <span id="mollie-test-result" class="text-xs"></span>
                    </div>
                  </div>

                  {/* Webhook-URL info */}
                  <div class="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
                    <div class="font-semibold mb-1"><i class="fas fa-link mr-1"></i>Webhook URL (info voor Mollie-configuratie)</div>
                    <code class="block bg-white border border-blue-100 px-2 py-1 rounded font-mono text-[11px] break-all">
                      {effectiveSiteUrl}/api/webhooks/mollie
                    </code>
                    <p class="mt-1 opacity-80">Mollie gebruikt deze URL automatisch per betaling — geen aparte configuratie nodig in het Mollie-dashboard, tenzij je expliciet een vast adres wenst. Bovenstaande URL wordt afgeleid van de instelling "Publieke Site URL" hierboven (sectie Algemeen).</p>
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
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      <i class="fas fa-globe-europe text-gray-500 mr-1"></i>
                      Publieke Site URL
                    </label>
                    <input
                      type="url"
                      name="site_url"
                      value={settingsMap.site_url || ''}
                      placeholder="https://www.gemengdkooranimato.be"
                      class="w-full border rounded px-3 py-2 font-mono text-sm"
                    />
                    <p class="text-xs text-gray-500 mt-1">
                      Wordt gebruikt voor Mollie redirect-URLs, webhook-URLs en e-mail-links.
                      Laat leeg om automatisch het huidige domein te detecteren.
                      Voorbeeld: <code class="bg-gray-100 px-1 rounded">https://www.gemengdkooranimato.be</code>
                    </p>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Contact Email (Notificaties)</label>
                    <input type="email" name="contact_email" value={settingsMap.contact_email} placeholder="info@gemengdkooranimato.be" class="w-full border rounded px-3 py-2" />
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

                  <h3 class="font-medium text-gray-900 pt-2">Beta Testing</h3>
                  <div class="flex items-center">
                    <input type="checkbox" id="beta_features" name="beta_features" value="1" checked={settingsMap.beta_features === '1'} class="h-4 w-4 text-animato-primary border-gray-300 rounded" />
                    <label for="beta_features" class="ml-2 block text-sm text-gray-700">
                      Activeer Beta Feedback Bubbel (zichtbaar voor iedereen)
                    </label>
                  </div>

                  <button type="submit" class="bg-animato-secondary text-white px-4 py-2 rounded hover:bg-opacity-90 w-full mt-4">
                    Opslaan
                  </button>
                </div>
              </form>
            </div>

            {/* Hero / Homepage Settings */}
            <div class="bg-white rounded-lg shadow-md p-6 lg:col-span-2">
              <h2 class="text-xl font-semibold mb-4 border-b pb-2">
                <i class="fas fa-film text-purple-600 mr-2"></i>
                Hero (Homepage Banner / Video)
              </h2>
              <p class="text-sm text-gray-600 mb-4">
                Pas de video, titel en ondertitel aan op de homepage. Wijzigingen zijn direct zichtbaar.
              </p>

              <form method="POST" action="/api/admin/settings/update">
                <input type="hidden" name="section" value="hero" />
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Video Type</label>
                    <select name="hero_video_type" class="w-full border rounded px-3 py-2">
                      <option value="youtube" selected={settingsMap.hero_video_type !== 'mp4'}>YouTube</option>
                      <option value="mp4" selected={settingsMap.hero_video_type === 'mp4'}>MP4 (R2 / extern)</option>
                    </select>
                    <p class="text-xs text-gray-500 mt-1">Kies welk type bron je wil gebruiken.</p>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">YouTube Video ID</label>
                    <input type="text" name="hero_video_id" value={settingsMap.hero_video_id || 'oXLw5RC0lNo'} placeholder="bv. oXLw5RC0lNo" class="w-full border rounded px-3 py-2 font-mono text-sm" />
                    <p class="text-xs text-gray-500 mt-1">Enkel het ID (na <code>v=</code>), niet de volledige URL.</p>
                  </div>

                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-1">MP4 / Video URL (alleen bij type = MP4)</label>
                    <input type="url" name="hero_video_url" value={settingsMap.hero_video_url || ''} placeholder="https://r2.example.com/hero.mp4" class="w-full border rounded px-3 py-2" />
                    <p class="text-xs text-gray-500 mt-1">Bij voorkeur een MP4 in Cloudflare R2 of een andere CDN. Laat leeg bij YouTube.</p>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Start (seconden) — YouTube loop</label>
                    <input type="number" min="0" name="hero_video_start_sec" value={settingsMap.hero_video_start_sec || '6'} class="w-full border rounded px-3 py-2" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Einde (seconden) — YouTube loop</label>
                    <input type="number" min="0" name="hero_video_end_sec" value={settingsMap.hero_video_end_sec || '240'} class="w-full border rounded px-3 py-2" />
                  </div>

                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Hero Titel</label>
                    <input type="text" name="hero_titel" value={settingsMap.hero_titel || 'Gemengd Koor Animato'} class="w-full border rounded px-3 py-2" />
                  </div>

                  <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Hero Subtitel</label>
                    <input type="text" name="hero_subtitel" value={settingsMap.hero_subtitel || 'Koor met passie • Samen musiceren sinds 1988'} class="w-full border rounded px-3 py-2" />
                  </div>
                </div>

                <button type="submit" class="mt-4 bg-purple-600 text-white px-4 py-2 rounded hover:bg-opacity-90">
                  <i class="fas fa-save mr-1"></i> Hero opslaan
                </button>
                <a href="/" target="_blank" class="ml-2 text-sm text-animato-primary hover:underline">
                  <i class="fas fa-external-link-alt mr-1"></i>Bekijk homepage
                </a>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Mollie connectie-test script */}
      <script dangerouslySetInnerHTML={{ __html: `
        async function testMollieKey() {
          const input = document.querySelector('input[name="mollie_api_key"]');
          const result = document.getElementById('mollie-test-result');
          const key = (input?.value || '').trim();
          result.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-500"></i> Testen...';
          try {
            const fd = new FormData();
            if (key) fd.append('api_key', key);
            const res = await fetch('/api/admin/settings/test-mollie', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.valid) {
              const modeColors = { live: 'text-green-700', test: 'text-amber-700', mock: 'text-gray-700' };
              const color = modeColors[data.mode] || 'text-green-700';
              result.innerHTML = '<span class="' + color + '"><i class="fas fa-check-circle"></i> OK — modus: <strong>' + data.mode.toUpperCase() + '</strong></span>';
            } else {
              result.innerHTML = '<span class="text-red-700"><i class="fas fa-times-circle"></i> ' + (data.error || 'Ongeldig') + '</span>';
            }
          } catch (e) {
            result.innerHTML = '<span class="text-red-700"><i class="fas fa-times-circle"></i> Netwerkfout</span>';
          }
        }
      ` }} />
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
    keys = ['site_name', 'site_url', 'contact_email', 'contact_phone', 'social_facebook', 'social_instagram', 'social_youtube', 'beta_features']
  } else if (body.section === 'hero') {
    keys = ['hero_video_type', 'hero_video_id', 'hero_video_url', 'hero_video_start_sec', 'hero_video_end_sec', 'hero_titel', 'hero_subtitel']
  }

  for (const key of keys) {
    let value = body[key]
    if (key === 'beta_features') {
        value = value === '1' ? '1' : '0' // Checkbox logic: if present it's 1, else it's undefined (handled below) or we force 0 if unchecked?
        // Form post: unchecked checkboxes are not sent. So we need to handle it.
        // But the loop only iterates if body[key] !== undefined.
        // Strategy: 'beta_features' will be missing if unchecked. 
        // We should check if it's general section and handle checkboxes explicitly.
    }
    
    if (value !== undefined) {
      await execute(db, `
        INSERT INTO system_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `, [key, value])
    }
  }
  
  // Handle unchecked checkbox for beta_features
  if (body.section === 'general' && body.beta_features === undefined) {
     await execute(db, `INSERT INTO system_settings (key, value) VALUES ('beta_features', '0') ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`, [])
  }

  // Invalidate cache zodat de volgende request direct de nieuwe key gebruikt
  invalidateMollieApiKeyCache()

  return c.redirect('/admin/settings?success=1')
})

// Mollie connectie-test endpoint
app.post('/api/admin/settings/test-mollie', async (c) => {
  try {
    const body = await c.req.parseBody().catch(() => ({}))
    // Als er een key in de body zit, test die; anders gebruik de actieve
    let keyToTest = String((body as any).api_key || '').trim()
    if (!keyToTest) {
      keyToTest = await getMollieApiKey(c.env)
    }
    const result = await validateMollieApiKey(keyToTest)
    return c.json(result)
  } catch (err: any) {
    return c.json({ valid: false, error: err?.message || 'Onbekende fout' }, 500)
  }
})

export default app
