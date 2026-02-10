import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
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
app.get('/admin/activities', async (c) => {
  const user = c.get('user')
  
  const activities = await queryAll(c.env.DB, `
    SELECT a.*, e.titel, e.start_at, e.locatie,
           (SELECT COUNT(*) FROM activity_registrations ar WHERE ar.activity_id = a.id) as registration_count,
           (SELECT SUM(1 + ar.guest_count) FROM activity_registrations ar WHERE ar.activity_id = a.id) as total_heads
    FROM activities a
    JOIN events e ON a.event_id = e.id
    ORDER BY e.start_at DESC
  `)

  return c.html(
    <Layout title="Activiteiten Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="activities" />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-3xl font-bold text-gray-900">
              <i class="fas fa-glass-cheers text-animato-primary mr-3"></i>
              Activiteiten & Jaarfeest
            </h1>
            <a href="/admin/activities/new" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90">
              <i class="fas fa-plus mr-2"></i> Nieuwe Activiteit
            </a>
          </div>

          <div class="grid gap-6">
            {activities.map((act: any) => (
              <div class="bg-white rounded-lg shadow p-6 flex flex-col md:flex-row justify-between items-start md:items-center">
                <div>
                  <h3 class="text-xl font-bold text-gray-900 mb-1">{act.titel}</h3>
                  <div class="text-gray-600 text-sm mb-2">
                    <i class="far fa-calendar mr-2"></i> {new Date(act.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
                    <span class="mx-2">•</span>
                    <i class="fas fa-map-marker-alt mr-2"></i> {act.locatie}
                  </div>
                  <div class="flex gap-4 mt-2">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <i class="fas fa-euro-sign mr-1"></i> €{act.price_member} (lid) / €{act.price_guest} (gast)
                    </span>
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <i class="fas fa-users mr-1"></i> {act.registration_count} inschrijvingen ({act.total_heads || 0} personen)
                    </span>
                  </div>
                </div>
                <div class="mt-4 md:mt-0 flex gap-2">
                  <a href={`/admin/activities/${act.id}`} class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
                    <i class="fas fa-list mr-2"></i> Details & Uitnodigen
                  </a>
                </div>
              </div>
            ))}
            {activities.length === 0 && (
              <div class="bg-white rounded-lg shadow p-12 text-center text-gray-500">
                <i class="fas fa-calendar-plus text-4xl mb-3 text-gray-300"></i>
                <p>Nog geen activiteiten gepland. Maak er een aan!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

// === CREATE / EDIT ROUTES ===

// GET Create
app.get('/admin/activities/new', async (c) => {
  const user = c.get('user')
  const locations = await queryAll(c.env.DB, "SELECT naam FROM locations ORDER BY naam")
  
  return c.html(
    <Layout title="Nieuwe Activiteit" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="activities" />
        <div class="flex-1 p-8">
          <h1 class="text-2xl font-bold mb-6">Nieuwe Activiteit / Jaarfeest</h1>
          <ActivityForm locations={locations} />
        </div>
      </div>
    </Layout>
  )
})

// GET Edit
app.get('/admin/activities/:id/edit', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  
  const locations = await queryAll(c.env.DB, "SELECT naam FROM locations ORDER BY naam")
  const activity = await queryOne<any>(c.env.DB, `
    SELECT a.*, e.titel, e.start_at, e.locatie, e.beschrijving, e.id as event_id
    FROM activities a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `, [id])

  if (!activity) return c.redirect('/admin/activities')

  // Fetch custom fields
  const customFields = await queryAll(c.env.DB, `
    SELECT * FROM activity_custom_fields WHERE activity_id = ? ORDER BY sort_order
  `, [id])

  return c.html(
    <Layout title={`Bewerk ${activity.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="activities" />
        <div class="flex-1 p-8">
          <h1 class="text-2xl font-bold mb-6">Activiteit Bewerken</h1>
          <ActivityForm locations={locations} activity={activity} customFields={customFields} />
        </div>
      </div>
    </Layout>
  )
})

// Helper: Form Component (Inline for now)
function ActivityForm({ locations, activity, customFields = [] }: { locations: any[], activity?: any, customFields?: any[] }) {
  const action = activity ? `/api/admin/activities/${activity.id}/update` : '/api/admin/activities/create'
  const startAt = activity ? new Date(activity.start_at).toISOString().slice(0, 16) : ''
  const deadline = activity?.deadline ? new Date(activity.deadline).toISOString().split('T')[0] : ''

  // Serialize customFields to JSON for the script
  const initialFields = JSON.stringify(customFields)

  return (
    <form action={action} method="POST" class="bg-white rounded-lg shadow-md p-6 max-w-3xl" onsubmit="return prepareCustomFields()">
      {/* Event Details */}
      <h3 class="text-lg font-semibold border-b pb-2 mb-4">1. Algemene Info</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium mb-1">Titel</label>
          <input type="text" name="titel" required value={activity?.titel || ''} placeholder="bv. Jaarfeest 2026" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Datum & Tijd</label>
          <input type="datetime-local" name="start_at" required value={startAt} class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Locatie</label>
          <select name="locatie" class="w-full border rounded px-3 py-2">
            <option value="">-- Kies een locatie --</option>
            {locations.map((loc: any) => (
              <option value={loc.naam} selected={activity?.locatie === loc.naam}>{loc.naam}</option>
            ))}
            <option value="other" selected={activity && !locations.find((l:any) => l.naam === activity.locatie)}>Andere locatie...</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Afbeelding (Upload)</label>
          <div class="flex items-center gap-2">
            <input type="file" id="image_upload" accept="image/*" class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            <input type="hidden" name="image_url" id="image_url" value={activity?.image_url || ''} />
          </div>
          <div id="image_preview" class={`mt-2 ${activity?.image_url ? '' : 'hidden'}`}>
            <img src={activity?.image_url || ''} alt="Preview" class="h-20 w-auto rounded border" />
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
            document.getElementById('image_upload').addEventListener('change', function(e) {
              const file = e.target.files[0];
              if (!file) return;
              
              const reader = new FileReader();
              reader.onload = function(e) {
                document.getElementById('image_url').value = e.target.result;
                const img = document.querySelector('#image_preview img');
                img.src = e.target.result;
                document.getElementById('image_preview').classList.remove('hidden');
              };
              reader.readAsDataURL(file);
            });
          ` }} />
        </div>
      </div>

      {/* Activity Details */}
      <h3 class="text-lg font-semibold border-b pb-2 mb-4 mt-6">2. Inschrijfdetails</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium mb-1">Prijs per Lid (€)</label>
          <input type="number" step="0.01" name="price_member" value={activity?.price_member || '0.00'} class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Prijs per Gast (€)</label>
          <input type="number" step="0.01" name="price_guest" value={activity?.price_guest || '0.00'} class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Deadline Inschrijven</label>
          <input type="date" name="deadline" value={deadline} class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Max. aantal gasten per lid</label>
          <select name="max_guests" class="w-full border rounded px-3 py-2">
            <option value="0" selected={activity?.max_guests === 0}>Geen gasten (Alleen leden)</option>
            <option value="1" selected={!activity || activity.max_guests === 1}>1 Partner/Gast</option>
            <option value="2" selected={activity?.max_guests === 2}>Max 2 gasten</option>
            <option value="99" selected={activity?.max_guests > 2}>Onbeperkt</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-medium mb-1">Uitnodigingstekst (voor email & pagina)</label>
          <textarea name="intro_text" rows={4} class="w-full border rounded px-3 py-2" placeholder="Beste leden, we nodigen jullie graag uit...">{activity?.intro_text || ''}</textarea>
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-medium mb-1">Betaalinstructies (Indien betalend)</label>
          <textarea name="payment_instruction" rows={3} class="w-full border rounded px-3 py-2" placeholder="bv. Overschrijven op BE12... met mededeling 'Naam + Jaarfeest' of QR code link">{activity?.payment_instruction || ''}</textarea>
          <p class="text-xs text-gray-500 mt-1">Deze tekst wordt getoond na inschrijving als er betaald moet worden.</p>
        </div>
      </div>

      {/* Custom Fields Section */}
      <h3 class="text-lg font-semibold border-b pb-2 mb-4 mt-6">3. Extra Vragen (Formulier)</h3>
      <div id="custom-fields-container" class="space-y-4 mb-4">
        {/* Fields will be rendered here by JS */}
      </div>
      
      <button type="button" onclick="addCustomField()" class="text-sm text-animato-primary hover:underline font-medium flex items-center mb-6">
        <i class="fas fa-plus-circle mr-1"></i> Veld toevoegen
      </button>

      <input type="hidden" name="custom_fields_json" id="custom_fields_json" value="" />

      <script dangerouslySetInnerHTML={{ __html: `
        let fields = ${initialFields};
        
        function renderFields() {
          const container = document.getElementById('custom-fields-container');
          container.innerHTML = '';
          
          if (fields.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500 italic">Geen extra vragen ingesteld.</p>';
            return;
          }

          fields.forEach((field, index) => {
            const div = document.createElement('div');
            div.className = 'bg-gray-50 p-4 rounded border relative group';
            div.innerHTML = \`
              <button type="button" onclick="removeField(\${index})" class="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors">
                <i class="fas fa-trash"></i>
              </button>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium mb-1 uppercase text-gray-500">Veld Label (Vraag)</label>
                  <input type="text" value="\${field.label || ''}" onchange="updateField(\${index}, 'label', this.value)" class="w-full border rounded px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="bv. Vegetarisch?" required />
                </div>
                <div>
                  <label class="block text-xs font-medium mb-1 uppercase text-gray-500">Type Veld</label>
                  <select onchange="updateField(\${index}, 'field_type', this.value)" class="w-full border rounded px-2 py-1 text-sm bg-white">
                    <option value="text" \${field.field_type === 'text' ? 'selected' : ''}>Tekstveld (Kort)</option>
                    <option value="textarea" \${field.field_type === 'textarea' ? 'selected' : ''}>Tekstvak (Lang)</option>
                    <option value="select" \${field.field_type === 'select' ? 'selected' : ''}>Keuzelijst (Dropdown)</option>
                    <option value="radio" \${field.field_type === 'radio' ? 'selected' : ''}>Keuzerondjes (Radio)</option>
                    <option value="checkbox" \${field.field_type === 'checkbox' ? 'selected' : ''}>Aanvinkvakje (Checkbox)</option>
                  </select>
                </div>
                \${['select', 'radio'].includes(field.field_type) ? \`
                  <div class="md:col-span-2">
                    <label class="block text-xs font-medium mb-1 uppercase text-gray-500">Opties (komma gescheiden)</label>
                    <input type="text" value="\${field.options || ''}" onchange="updateField(\${index}, 'options', this.value)" class="w-full border rounded px-2 py-1 text-sm" placeholder="Optie A, Optie B, Optie C" />
                    <p class="text-xs text-gray-400 mt-1">Scheid opties met een komma.</p>
                  </div>
                \` : ''}
                <div class="md:col-span-2 flex items-center mt-1">
                  <input type="checkbox" id="req-\${index}" \${field.is_required ? 'checked' : ''} onchange="updateField(\${index}, 'is_required', this.checked)" class="mr-2 rounded text-blue-600 focus:ring-blue-500" />
                  <label for="req-\${index}" class="text-sm text-gray-700 cursor-pointer">Dit veld is verplicht</label>
                </div>
              </div>
            \`;
            container.appendChild(div);
          });
        }

        function addCustomField() {
          fields.push({ label: '', field_type: 'text', options: '', is_required: false });
          renderFields();
        }

        function removeField(index) {
          if(confirm('Weet je zeker dat je dit veld wilt verwijderen?')) {
            fields.splice(index, 1);
            renderFields();
          }
        }

        function updateField(index, key, value) {
          fields[index][key] = value;
          renderFields(); 
        }

        function prepareCustomFields() {
          document.getElementById('custom_fields_json').value = JSON.stringify(fields);
          return true;
        }

        // Initial render
        renderFields();
      ` }} />

      <div class="flex justify-end gap-3 mt-6 border-t pt-4">
        <a href="/admin/activities" class="px-4 py-2 border rounded hover:bg-gray-50 text-gray-700">Annuleren</a>
        <button type="submit" class="bg-animato-primary text-white px-6 py-2 rounded hover:opacity-90 shadow-sm font-medium">
          {activity ? 'Wijzigingen Opslaan' : 'Activiteit Aanmaken'}
        </button>
      </div>
    </form>
  )
}

// === DETAILS & REGISTRATIONS ===
app.get('/admin/activities/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  
  // Get Activity
  const activity = await queryOne<any>(c.env.DB, `
    SELECT a.*, e.titel, e.start_at, e.locatie
    FROM activities a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `, [id])

  if (!activity) return c.redirect('/admin/activities')

  // Get Registrations with custom answers
  const registrations = await queryAll(c.env.DB, `
    SELECT ar.*, u.email, p.voornaam, p.achternaam
    FROM activity_registrations ar
    JOIN users u ON ar.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE ar.activity_id = ?
    ORDER BY p.achternaam
  `, [id])

  // Enhance registrations with custom answers
  for (const reg of registrations) {
    reg.answers = await queryAll(c.env.DB, `
      SELECT aca.value, acf.label
      FROM activity_custom_answers aca
      JOIN activity_custom_fields acf ON aca.field_id = acf.id
      WHERE aca.registration_id = ?
    `, [reg.id])
  }

  // Stats
  const totalMoney = registrations.reduce((acc: number, r: any) => acc + (r.amount || 0), 0)
  const totalHeads = registrations.reduce((acc: number, r: any) => acc + 1 + (r.guest_count || 0), 0)

  // Invitation Stats
  let inviteStats = { total: 0, sent: 0, seen: 0 }
  
  try {
    const inviteStatsResult = await queryOne<any>(c.env.DB, `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'seen' THEN 1 ELSE 0 END) as seen
      FROM activity_invitations
      WHERE activity_id = ?
    `, [id])
    
    if (inviteStatsResult) {
      inviteStats = {
        total: inviteStatsResult.total || 0,
        sent: inviteStatsResult.sent || 0,
        seen: inviteStatsResult.seen || 0
      }
    }
  } catch (err) {
    console.error('Error fetching invite stats:', err)
  }

  // Get ALL active members with full status details
  const allMembers = await queryAll(c.env.DB, `
    SELECT 
      u.id, u.email, p.voornaam, p.achternaam, u.stemgroep,
      ai.status as invite_status,
      ai.seen_at,
      ar.id as registration_id,
      ar.status as payment_status
    FROM users u
    JOIN profiles p ON u.id = p.user_id
    LEFT JOIN activity_invitations ai ON u.id = ai.user_id AND ai.activity_id = ?
    LEFT JOIN activity_registrations ar ON u.id = ar.user_id AND ar.activity_id = ?
    WHERE u.status = 'actief'
    ORDER BY p.achternaam, p.voornaam
  `, [id, id])

  return c.html(
    <Layout title={`Beheer ${activity.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="activities" />
        <div class="flex-1 p-8">
          <div class="mb-6 flex justify-between items-center">
            <div>
              <a href="/admin/activities" class="text-blue-600 hover:underline mb-2 inline-block">&larr; Terug naar overzicht</a>
              <h1 class="text-3xl font-bold text-gray-900">{activity.titel}</h1>
              <p class="text-gray-600">{new Date(activity.start_at).toLocaleDateString()} @ {activity.locatie}</p>
            </div>
            <a href={`/admin/activities/${activity.id}/edit`} class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition">
              <i class="fas fa-edit mr-2"></i> Bewerken
            </a>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-4 rounded shadow border-l-4 border-blue-500">
              <p class="text-sm text-gray-500">Inschrijvingen</p>
              <p class="text-2xl font-bold">{registrations.length} leden</p>
              <p class="text-xs text-gray-400">Totaal {totalHeads} personen</p>
            </div>
            <div class="bg-white p-4 rounded shadow border-l-4 border-green-500">
              <p class="text-sm text-gray-500">Ontvangen</p>
              <p class="text-2xl font-bold">€ {totalMoney.toFixed(2)}</p>
            </div>
            <div class="bg-white p-4 rounded shadow border-l-4 border-purple-500">
              <p class="text-sm text-gray-500">Uitnodigingen</p>
              <p class="text-2xl font-bold">{inviteStats.total}</p>
              <div class="flex gap-2 text-xs mt-1">
                <span class="text-gray-500"><i class="fas fa-envelope mr-1"></i> {inviteStats.sent}</span>
                <span class="text-blue-500"><i class="fas fa-eye mr-1"></i> {inviteStats.seen} geopend</span>
              </div>
            </div>
            <div class="bg-white p-4 rounded shadow flex items-center justify-center">
              <button onclick="document.getElementById('invite-modal').showModal()" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90 w-full transition shadow">
                <i class="fas fa-paper-plane mr-2"></i> Uitnodigingen Versturen
              </button>
            </div>
          </div>

          {/* Tabs for different views */}
          <div class="mb-6 border-b border-gray-200">
            <nav class="-mb-px flex space-x-8" aria-label="Tabs">
              <button onclick="switchTab('participants')" id="tab-participants" class="border-animato-primary text-animato-primary whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                Deelnemerslijst ({registrations.length})
              </button>
              <button onclick="switchTab('status')" id="tab-status" class="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                Status Overzicht (Alle Leden)
              </button>
            </nav>
          </div>

          {/* Tab 1: Deelnemerslijst (Detailed registration info) */}
          <div id="content-participants" class="bg-white rounded shadow overflow-hidden">
            <div class="px-6 py-4 bg-gray-50 border-b flex justify-between items-center">
               <h3 class="font-semibold text-gray-700">Geregistreerde Deelnemers</h3>
               <span class="text-xs text-gray-500">Wordt verwacht</span>
            </div>
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Naam</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gasten</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dieetwensen / Extra's</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                {registrations.map((reg: any) => (
                  <tr>
                    <td class="px-6 py-4">
                      <div class="font-medium text-gray-900">{reg.voornaam} {reg.achternaam}</div>
                      <div class="text-xs text-gray-500">{reg.email}</div>
                    </td>
                    <td class="px-6 py-4 text-sm">
                      {reg.guest_count > 0 ? `+ ${reg.guest_count} gast(en)` : 'Alleen'}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-600">
                      {reg.dietary_requirements && <div class="italic mb-1">"{reg.dietary_requirements}"</div>}
                      {reg.answers && reg.answers.map((ans: any) => (
                        <div class="text-xs">
                          <span class="font-medium">{ans.label}:</span> {ans.value}
                        </div>
                      ))}
                    </td>
                    <td class="px-6 py-4">
                      <span class={`px-2 py-1 text-xs rounded font-semibold ${reg.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {reg.status === 'paid' ? 'Betaald' : 'Nog niet betaald'}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm">
                      € {reg.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {registrations.length === 0 && (
                  <tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">Nog geen inschrijvingen.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tab 2: Status Overzicht (Invitation & Reg status for ALL members) */}
          <div id="content-status" class="bg-white rounded shadow overflow-hidden hidden">
             <div class="px-6 py-4 bg-gray-50 border-b flex justify-between items-center">
               <h3 class="font-semibold text-gray-700">Uitnodigingen & Status</h3>
               <input type="text" id="status-search" placeholder="Zoek lid..." class="border rounded px-2 py-1 text-sm" />
            </div>
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lid</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Stemgroep</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Uitnodiging</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Gelezen</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Ingeschreven</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200" id="status-table-body">
                {allMembers.map((m: any) => (
                  <tr class="hover:bg-gray-50 status-row">
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm font-medium text-gray-900">{m.voornaam} {m.achternaam}</div>
                      <div class="text-xs text-gray-500">{m.email}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      {m.stemgroep ? <span class="px-2 py-1 text-xs rounded bg-blue-50 text-blue-700">{m.stemgroep}</span> : '-'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      {m.invite_status ? (
                        <span class="text-green-600" title="Verstuurd"><i class="fas fa-check"></i> Verstuurd</span>
                      ) : (
                        <span class="text-gray-400" title="Nog niet verstuurd"><i class="fas fa-minus"></i></span>
                      )}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      {m.invite_status === 'seen' ? (
                        <span class="text-blue-600" title={`Geopend: ${new Date(m.seen_at).toLocaleString()}`}><i class="fas fa-eye"></i> Ja</span>
                      ) : (
                        <span class="text-gray-300"><i class="fas fa-eye-slash"></i></span>
                      )}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      {m.registration_id ? (
                        <span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                           <i class="fas fa-check mr-1"></i> Ja
                        </span>
                      ) : (
                        <span class="text-gray-400 text-xs">Nee</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            function switchTab(tab) {
              // Reset buttons
              document.getElementById('tab-participants').className = 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm';
              document.getElementById('tab-status').className = 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm';
              
              // Set active button
              document.getElementById('tab-' + tab).className = 'border-animato-primary text-animato-primary whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm';
              
              // Hide content
              document.getElementById('content-participants').classList.add('hidden');
              document.getElementById('content-status').classList.add('hidden');
              
              // Show active content
              document.getElementById('content-' + tab).classList.remove('hidden');
            }

            // Search functionality for status table
            document.getElementById('status-search')?.addEventListener('input', (e) => {
              const term = e.target.value.toLowerCase();
              document.querySelectorAll('.status-row').forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(term) ? 'table-row' : 'none';
              });
            });
          ` }} />

          {/* Invitation Modal */}
          <dialog id="invite-modal" class="p-0 rounded-lg shadow-xl w-full max-w-2xl backdrop:bg-gray-900/50">
            <div class="bg-white flex flex-col max-h-[80vh]">
              <div class="p-4 border-b flex justify-between items-center bg-gray-50">
                <h3 class="font-bold text-lg">Leden Selecteren</h3>
                <button onclick="document.getElementById('invite-modal').close()" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
              </div>
              
              <form action="/api/admin/activities/send-invites" method="POST" class="flex flex-col flex-1 overflow-hidden">
                <input type="hidden" name="activity_id" value={activity.id} />
                
                <div class="p-4 border-b bg-white z-10">
                   <input type="text" id="member-search" placeholder="Zoek op naam..." class="w-full border rounded px-3 py-2 text-sm mb-3" />
                   <div class="flex gap-2 text-xs">
                     <button type="button" id="btn-select-all" class="text-blue-600 hover:underline">Alles selecteren</button>
                     <span class="text-gray-300">|</span>
                     <button type="button" id="btn-select-new" class="text-blue-600 hover:underline">Alleen niet-uitgenodigden</button>
                     <span class="text-gray-300">|</span>
                     <button type="button" id="btn-deselect-all" class="text-gray-500 hover:underline">Alles wissen</button>
                   </div>
                </div>

                <div class="overflow-y-auto p-4 flex-1">
                  <div class="space-y-2" id="member-list">
                    {allMembers.map((m: any) => (
                      <label class="flex items-center p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200 cursor-pointer member-row">
                        <input type="checkbox" name="user_ids[]" value={m.id} 
                               class={`mr-3 rounded text-animato-primary focus:ring-animato-primary ${m.invite_status ? 'opacity-50' : ''}`} 
                               data-invited={m.invite_status ? '1' : '0'} 
                        />
                        <div class="flex-1">
                          <div class="font-medium text-gray-900">
                            {m.voornaam} {m.achternaam}
                            {m.invite_status && <span class="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Reeds uitgenodigd</span>}
                          </div>
                          <div class="text-xs text-gray-500 flex gap-2">
                            <span>{m.email}</span>
                            {m.stemgroep && <span class="bg-blue-50 text-blue-700 px-1.5 rounded">{m.stemgroep}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div class="p-4 border-t bg-gray-50 flex justify-end gap-3">
                  <button type="button" onclick="document.getElementById('invite-modal').close()" class="px-4 py-2 border rounded hover:bg-gray-100">Annuleren</button>
                  <button type="submit" class="bg-animato-primary text-white px-6 py-2 rounded hover:opacity-90 shadow-sm" onclick="return confirm('Geselecteerde leden uitnodigen?');">
                    Versturen
                  </button>
                </div>
              </form>
            </div>
            <script dangerouslySetInnerHTML={{ __html: `
              // Search functionality
              document.getElementById('member-search').addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('.member-row').forEach(row => {
                  const text = row.innerText.toLowerCase();
                  row.style.display = text.includes(term) ? 'flex' : 'none';
                });
              });

              // Select buttons
              document.getElementById('btn-select-all').addEventListener('click', () => {
                document.querySelectorAll('input[name="user_ids[]"]').forEach(cb => cb.checked = true);
              });

              document.getElementById('btn-deselect-all').addEventListener('click', () => {
                document.querySelectorAll('input[name="user_ids[]"]').forEach(cb => cb.checked = false);
              });
              
              document.getElementById('btn-select-new').addEventListener('click', () => {
                 document.querySelectorAll('input[name="user_ids[]"]').forEach(cb => {
                   // Only check if NOT already invited (data-invited == 0)
                   cb.checked = cb.getAttribute('data-invited') == '0';
                 });
              });
            ` }} />
          </dialog>
        </div>
      </div>
    </Layout>
  )
})

// === ACTIONS ===

// Create
app.post('/api/admin/activities/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // 1. Create Event
  // Calculate end_at (default to 3 hours after start if not specified)
  const startDate = new Date(body.start_at)
  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000) // +3 hours
  
  const eventRes = await execute(db, `
    INSERT INTO events (titel, type, start_at, end_at, locatie, beschrijving, doelgroep)
    VALUES (?, 'activiteit', ?, ?, ?, ?, 'leden')
  `, [body.titel, body.start_at, endDate.toISOString(), body.locatie, body.intro_text]) // Use intro text as description for now
  
  const eventId = eventRes.meta.last_row_id

  // 2. Create Activity Wrapper
  await execute(db, `
    INSERT INTO activities (event_id, price_member, price_guest, deadline, max_guests, intro_text, image_url, payment_instruction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    eventId, 
    parseFloat(String(body.price_member)), 
    parseFloat(String(body.price_guest)),
    body.deadline || null,
    parseInt(String(body.max_guests)),
    body.intro_text,
    body.image_url || null,
    body.payment_instruction || null
  ])

  return c.redirect('/admin/activities')
})

// Send Invitations
app.post('/api/admin/activities/send-invites', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  // Get activity info
  const activity = await queryOne<any>(db, `SELECT a.*, e.titel FROM activities a JOIN events e ON a.event_id = e.id WHERE a.id = ?`, [body.activity_id])
  
  let members = [];

  // Determine recipients
  // Hono parseBody: if one checkbox checked -> value is string. If multiple -> value is array. If none -> undefined.
  let selectedIds = body['user_ids[]'];
  
  if (selectedIds) {
    // Normalize to array
    const ids = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
    
    // Fetch specific members
    // Create placeholders string (?,?,?)
    const placeholders = ids.map(() => '?').join(',');
    
    members = await queryAll(db, `
      SELECT u.id, u.email, p.voornaam 
      FROM users u 
      JOIN profiles p ON u.id = p.user_id 
      WHERE u.id IN (${placeholders})
    `, ids);
    
  } else {
     // Legacy Fallback (or if nothing selected in form - strictly speaking the form should prevent this, but safe to fallback or empty)
     // To be safe: if user manually posted without selection, we do NOTHING or redirect with error. 
     // For this iteration, let's redirect with 0 invited if nothing selected.
     return c.redirect(`/admin/activities/${body.activity_id}?error=no_selection`)
  }

  const siteUrl = c.env.SITE_URL || 'https://animato.be'
  
  // In a real scenario, use a queue. For now, loop (limit 50 to avoid timeout)
  let count = 0
  // Note: we trust the user selection here, so we process all selected (up to a safe limit if needed, but let's try to process all selected)
  // If list is huge (e.g. > 50), might still timeout. 
  // Let's cap at 100 for safety in this sync handler.
  const SAFE_LIMIT = 100;
  
  for (const member of members.slice(0, SAFE_LIMIT)) {
    const emailHtml = `
      <h1>Uitnodiging: ${activity.titel}</h1>
      <p>Beste ${member.voornaam},</p>
      <p>We nodigen je van harte uit voor <strong>${activity.titel}</strong>!</p>
      <p>${activity.intro_text || 'Kom gezellig meedoen.'}</p>
      <p>
        <a href="${siteUrl}/leden/activiteiten/${activity.id}" style="background-color: #00A9CE; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          Schrijf je nu in
        </a>
      </p>
      <p>Tot dan,<br>Het Bestuur</p>
    `
    
    // Send email
    await sendEmail({
      to: member.email,
      subject: `Uitnodiging: ${activity.titel}`,
      html: emailHtml
    }, c.env.RESEND_API_KEY)

    // Log invitation (if not exists - though our selection allows duplicates if UI allows, DB constraint should handle or ignore)
    // We use INSERT OR IGNORE or simple INSERT and let it fail/succeed (activity_invitations usually has distinct constraint?)
    // Standard table usually: id, activity_id, user_id. 
    // Let's check if already invited to avoid double logging if user selected 'already invited' person
    
    const existing = await queryOne(db, "SELECT id FROM activity_invitations WHERE activity_id = ? AND user_id = ?", [activity.id, member.id]);
    
    if (!existing) {
        await execute(db, `INSERT INTO activity_invitations (activity_id, user_id, status) VALUES (?, ?, 'sent')`, [activity.id, member.id])
    } else {
        // Update status to sent again? Or leave as is. 
        // If re-inviting, maybe update status to 'sent' if it was something else.
        await execute(db, `UPDATE activity_invitations SET status = 'sent' WHERE id = ?`, [existing.id])
    }
    
    count++
  }

  return c.redirect(`/admin/activities/${body.activity_id}?invited=${count}`)
})

// Update
app.post('/api/admin/activities/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const db = c.env.DB

  // Get activity to find event_id
  const activity = await queryOne<any>(db, `SELECT event_id FROM activities WHERE id = ?`, [id])
  if (!activity) return c.redirect('/admin/activities')

  // Update Event
  const startDate = new Date(body.start_at)
  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)

  await execute(db, `
    UPDATE events 
    SET titel = ?, start_at = ?, end_at = ?, locatie = ?, beschrijving = ?
    WHERE id = ?
  `, [body.titel, body.start_at, endDate.toISOString(), body.locatie, body.intro_text, activity.event_id])

  // Update Activity
  await execute(db, `
    UPDATE activities 
    SET price_member = ?, price_guest = ?, deadline = ?, max_guests = ?, intro_text = ?, image_url = ?, payment_instruction = ?
    WHERE id = ?
  `, [
    parseFloat(String(body.price_member)), 
    parseFloat(String(body.price_guest)),
    body.deadline || null,
    parseInt(String(body.max_guests)),
    body.intro_text,
    body.image_url || null,
    body.payment_instruction || null,
    id
  ])

  // Update Custom Fields (Full overwrite for simplicity)
  await execute(db, `DELETE FROM activity_custom_fields WHERE activity_id = ?`, [id])
  
  const customFieldsJSON = body.custom_fields_json
  if (customFieldsJSON) {
    const fields = JSON.parse(String(customFieldsJSON))
    for (const [index, field] of fields.entries()) {
      await execute(db, `
        INSERT INTO activity_custom_fields (activity_id, label, field_type, options, is_required, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [id, field.label, field.field_type, field.options, field.is_required ? 1 : 0, index])
    }
  }

  return c.redirect(`/admin/activities/${id}`)
})

export default app
