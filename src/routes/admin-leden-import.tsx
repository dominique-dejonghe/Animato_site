import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryOne, execute } from '../utils/db'
import type { Bindings, SessionUser } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { hashPassword } from '../utils/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/admin/*', requireAuth)
app.use('/admin/*', requireRole('admin', 'moderator'))

// =====================================================
// VOORBEELD CSV DOWNLOADEN
// =====================================================

app.get('/admin/leden/import/voorbeeld', (c) => {
  const csv = [
    'Voornaam,Achternaam,Email,Stemgroep,Telefoon,Adres',
    'Jan,Janssen,jan.janssen@voorbeeld.be,T,0471234567,Kerkstraat 1 Brussel',
    'Marie,Pieters,marie.pieters@voorbeeld.be,S,0487654321,Stationslaan 5 Gent',
    'Luc,Vermeersch,luc.vermeersch@voorbeeld.be,B,,',
    'Els,De Smedt,els.desmedt@voorbeeld.be,A,0499111222,',
  ].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leden-import-voorbeeld.csv"',
    },
  })
})

// =====================================================
// IMPORT PAGE - COPY-PASTE AANPAK (geen XLSX dependency!)
// =====================================================

app.get('/admin/leden/import', async (c) => {
  const user = c.get('user') as SessionUser

  return c.html(
    <Layout
      title="Leden Importeren"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Leden', href: '/admin/leden' },
        { label: 'Importeren', href: '/admin/leden/import' },
      ]}
    >
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="leden" />
        <div class="flex-1 p-8 max-w-6xl">

          <div class="mb-6 flex justify-between items-center">
            <div>
              <h1 class="text-3xl font-bold text-gray-900">
                <i class="fas fa-file-import text-animato-primary mr-3"></i>
                Leden Importeren
              </h1>
              <p class="text-gray-600 mt-1">Plak data vanuit Excel, Google Sheets, of typ het handmatig in.</p>
            </div>
            <div class="flex gap-2">
              <a href="/admin/leden/import/voorbeeld" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
                <i class="fas fa-download mr-2"></i> CSV voorbeeld
              </a>
              <a href="/admin/leden" class="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50 text-sm">
                <i class="fas fa-arrow-left mr-2"></i> Terug
              </a>
            </div>
          </div>

          {/* Instructies */}
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p class="text-sm text-blue-800 font-semibold mb-2">
              <i class="fas fa-info-circle mr-2"></i>Hoe werkt het?
            </p>
            <ol class="text-xs text-blue-700 space-y-1 list-decimal list-inside mb-3">
              <li>Open je Excel of Google Sheets bestand</li>
              <li>Selecteer de rijen die je wilt importeren <strong>(inclusief de koprij)</strong></li>
              <li>Kopieer (Ctrl+C) en plak (Ctrl+V) in het tekstvak hieronder</li>
              <li>De preview verschijnt automatisch — controleer de data</li>
              <li>Klik <strong>"Importeer"</strong></li>
            </ol>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-blue-700 border-t border-blue-200 pt-2">
              <span><strong>Voornaam</strong> — verplicht</span>
              <span><strong>Achternaam</strong> — verplicht</span>
              <span><strong>Email</strong> — verplicht, uniek</span>
              <span>Stemgroep — S, A, T of B</span>
              <span>Telefoon — optioneel</span>
              <span>Adres — optioneel</span>
            </div>
            <p class="text-xs text-blue-600 mt-2">
              Standaard wachtwoord: <strong>Animato2025!</strong> — leden wijzigen dit na eerste login.
            </p>
          </div>

          {/* Textarea voor copy-paste */}
          <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div class="flex justify-between items-center mb-3">
              <label class="block text-sm font-medium text-gray-700">
                <i class="fas fa-paste mr-2 text-animato-primary"></i>
                Plak hier je ledendata
              </label>
              <div class="flex gap-2">
                <button type="button" id="loadExampleBtn" class="text-xs text-blue-600 hover:text-blue-800 underline">
                  Voorbeeld laden
                </button>
                <button type="button" id="clearBtn" class="text-xs text-red-600 hover:text-red-800 underline">
                  Wissen
                </button>
              </div>
            </div>
            <textarea
              id="pasteArea"
              rows={8}
              placeholder={"Plak hier je data vanuit Excel of Google Sheets...\n\nVoorbeeld (tab-gescheiden):\nVoornaam\tAchternaam\tEmail\tStemgroep\nJan\tJanssen\tjan@test.be\tT\nMarie\tPieters\tmarie@test.be\tS"}
              class="w-full border border-gray-300 rounded-lg p-4 font-mono text-sm focus:ring-2 focus:ring-animato-primary focus:border-animato-primary resize-y"
              spellcheck={false}
            ></textarea>
            <p class="text-xs text-gray-400 mt-2">
              Scheidingsteken wordt automatisch gedetecteerd: tab (vanuit Excel/Sheets), komma (CSV), of puntkomma.
              Eerste rij = kolomnamen.
            </p>
          </div>

          {/* Status bericht */}
          <div id="statusMessage" class="hidden mb-6 p-4 rounded text-sm"></div>

          {/* Preview tabel */}
          <div id="preview-section" class="hidden bg-white rounded-lg shadow-sm p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="font-bold text-gray-800">
                <i class="fas fa-eye mr-2 text-gray-400"></i>
                Preview <span id="preview-count" class="text-gray-400 font-normal text-sm"></span>
              </h3>
              <button
                id="importBtn"
                disabled
                class="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition font-semibold"
              >
                <i class="fas fa-check mr-2"></i> Importeer
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
                  <tr>
                    <th class="px-4 py-2 text-left w-8">#</th>
                    <th class="px-4 py-2 text-left">Status</th>
                    <th class="px-4 py-2 text-left">Voornaam</th>
                    <th class="px-4 py-2 text-left">Achternaam</th>
                    <th class="px-4 py-2 text-left">Email</th>
                    <th class="px-4 py-2 text-left">Stem</th>
                    <th class="px-4 py-2 text-left">Telefoon</th>
                    <th class="px-4 py-2 text-left">Adres</th>
                  </tr>
                </thead>
                <tbody id="previewTable" class="divide-y divide-gray-100"></tbody>
              </table>
            </div>
          </div>

          {/* Resultaat sectie */}
          <div id="resultSection" class="hidden bg-white rounded-lg shadow-sm p-6 mt-6">
            <div id="resultContent"></div>
          </div>

        </div>
      </div>

      {/* Extern JS bestand - geen inline script nodig, geen escaping problemen */}
      <script src="/static/js/leden-import.js"></script>
    </Layout>
  )
})

// =====================================================
// IMPORT API - ROBUUST MET VOLLEDIGE ERROR HANDLING
// =====================================================

app.post('/api/admin/leden/import', async (c) => {
  try {
    const user = c.get('user') as SessionUser
    const body = await c.req.json()
    const leden = body.leden

    if (!leden || !Array.isArray(leden)) {
      return c.json({ success: false, error: 'Geen geldige data ontvangen' }, 400)
    }

    if (leden.length === 0) {
      return c.json({ success: false, error: 'Geen leden in de data gevonden' }, 400)
    }

    if (leden.length > 500) {
      return c.json({ success: false, error: 'Maximum 500 leden per import' }, 400)
    }

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    // Hash het standaard wachtwoord eenmaal
    let defaultPasswordHash: string
    try {
      defaultPasswordHash = await hashPassword('Animato2025!')
    } catch (hashErr: any) {
      console.error('hashPassword failed:', hashErr)
      return c.json({ success: false, error: 'Wachtwoord generatie mislukt. Probeer later opnieuw.' }, 500)
    }

    for (const lid of leden) {
      try {
        // Valideer verplichte velden
        const voornaam = (lid.voornaam || '').trim()
        const achternaam = (lid.achternaam || '').trim()
        const email = (lid.email || '').toLowerCase().trim()

        if (!voornaam || !achternaam || !email) {
          errors.push((email || 'onbekend') + ' — ontbrekende verplichte velden')
          continue
        }

        if (!email.includes('@')) {
          errors.push(email + ' — ongeldig emailadres')
          continue
        }

        // Check of email al bestaat
        const exists = await queryOne(c.env.DB, 'SELECT id FROM users WHERE email = ?', [email])
        if (exists) {
          skipped++
          continue
        }

        // Normaliseer stemgroep — alleen S/A/T/B of null (NIET empty string!)
        const rawStem = (lid.stemgroep || '').toUpperCase().trim()
        let stemgroep: string | null = null
        if (rawStem === 'S' || rawStem.startsWith('SOPR')) stemgroep = 'S'
        else if (rawStem === 'A' || rawStem.startsWith('ALT') || rawStem.startsWith('MEZZO')) stemgroep = 'A'
        else if (rawStem === 'T' || rawStem.startsWith('TEN')) stemgroep = 'T'
        else if (rawStem === 'B' || rawStem.startsWith('BAS') || rawStem.startsWith('BARI')) stemgroep = 'B'
        // Anders: null (geen stemgroep)

        // Insert user
        const userRes = await execute(c.env.DB, `
          INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified)
          VALUES (?, ?, 'lid', ?, 'actief', 1)
        `, [email, defaultPasswordHash, stemgroep])

        const newUserId = userRes.meta.last_row_id

        if (!newUserId) {
          errors.push(email + ' — gebruiker aangemaakt maar geen ID teruggekregen')
          continue
        }

        // Insert profile — eenvoudig, alleen basiskkolommen die zeker bestaan
        await execute(c.env.DB, `
          INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, adres, lid_sinds)
          VALUES (?, ?, ?, ?, ?, DATE('now'))
        `, [
          newUserId,
          voornaam,
          achternaam,
          lid.telefoon ? lid.telefoon.trim() : null,
          lid.adres ? lid.adres.trim() : null
        ])

        imported++
      } catch (e: any) {
        console.error('Import error for ' + (lid.email || 'unknown') + ':', e.message || e)
        errors.push((lid.email || 'onbekend') + ' — ' + (e.message || 'onbekende fout'))
      }
    }

    // Audit log — niet fataal als dit faalt
    try {
      await execute(c.env.DB, `
        INSERT INTO audit_logs (user_id, actie, entity_type, meta)
        VALUES (?, 'import_leden', 'user', ?)
      `, [user.id, JSON.stringify({ imported, skipped, errors: errors.length, total: leden.length })])
    } catch (auditErr: any) {
      console.error('Audit log error:', auditErr)
    }

    return c.json({ success: true, imported, skipped, errors })
  } catch (topErr: any) {
    console.error('Import top-level error:', topErr)
    return c.json({ success: false, error: 'Serverfout: ' + (topErr.message || 'onbekende fout') }, 500)
  }
})

export default app
