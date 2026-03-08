import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryOne, execute } from '../utils/db'
import type { Bindings, SessionUser } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { hashPassword } from '../utils/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// VOORBEELD EXCEL DOWNLOADEN
// =====================================================

app.get('/admin/leden/import/voorbeeld', (c) => {
  // Geeft een CSV terug als voorbeeldbestand
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
// IMPORT PAGE
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
              <p class="text-gray-600 mt-1">Upload een Excel (.xlsx) of CSV bestand om meerdere leden tegelijk toe te voegen.</p>
            </div>
            <div class="flex gap-2">
              <a href="/admin/leden/import/voorbeeld" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
                <i class="fas fa-download mr-2"></i> Voorbeeld downloaden
              </a>
              <a href="/admin/leden" class="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50 text-sm">
                <i class="fas fa-arrow-left mr-2"></i> Terug
              </a>
            </div>
          </div>

          {/* Info box */}
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p class="text-sm text-blue-800 font-semibold mb-2"><i class="fas fa-info-circle mr-2"></i>Verwachte kolommen in je bestand:</p>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-blue-700">
              <span><strong>Voornaam</strong> — verplicht</span>
              <span><strong>Achternaam</strong> — verplicht</span>
              <span><strong>Email</strong> — verplicht, uniek</span>
              <span>Stemgroep — S, A, T of B</span>
              <span>Telefoon — optioneel</span>
              <span>Adres — optioneel</span>
            </div>
            <p class="text-xs text-blue-600 mt-2">
              Standaard wachtwoord voor geïmporteerde leden: <strong>Animato2025!</strong> — laat hen dit zelf wijzigen na eerste login.
            </p>
          </div>

          {/* Upload zone */}
          <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3">Selecteer bestand (.xlsx of .csv)</label>
            <div id="drop-zone" class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-animato-primary transition">
              <i class="fas fa-cloud-upload-alt text-4xl text-gray-300 mb-3"></i>
              <p class="text-gray-500 mb-2">Sleep je bestand hierheen of klik om te kiezen</p>
              <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" class="hidden" />
              <button type="button" onclick="document.getElementById('fileInput').click()" class="bg-animato-primary text-white px-6 py-2 rounded hover:bg-animato-secondary transition text-sm">
                <i class="fas fa-folder-open mr-2"></i> Bestand kiezen
              </button>
              <p id="file-name" class="text-xs text-gray-400 mt-3">Geen bestand geselecteerd</p>
            </div>
            <div id="statusMessage" class="hidden mt-4 p-4 rounded text-sm"></div>
          </div>

          {/* Preview tabel */}
          <div id="preview-section" class="hidden bg-white rounded-lg shadow-sm p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="font-bold text-gray-800">Preview <span id="preview-count" class="text-gray-400 font-normal text-sm"></span></h3>
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
                    <th class="px-4 py-2 text-left">Status</th>
                    <th class="px-4 py-2 text-left">Voornaam</th>
                    <th class="px-4 py-2 text-left">Achternaam</th>
                    <th class="px-4 py-2 text-left">Email</th>
                    <th class="px-4 py-2 text-left">Stem</th>
                    <th class="px-4 py-2 text-left">Telefoon</th>
                  </tr>
                </thead>
                <tbody id="previewTable" class="divide-y divide-gray-100"></tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      {/* XLSX lokaal geladen — geen CDN afhankelijkheid */}
      <script src="/static/js/xlsx.full.min.js"></script>
      <script dangerouslySetInnerHTML={{ __html: `
        // Wacht tot XLSX geladen is
        window.addEventListener('load', function() {
          initImport();
        });

        function initImport() {
          var statusMessage = document.getElementById('statusMessage');
          var fileInput = document.getElementById('fileInput');
          var previewTable = document.getElementById('previewTable');
          var importBtn = document.getElementById('importBtn');
          var previewSection = document.getElementById('preview-section');
          var previewCount = document.getElementById('preview-count');
          var fileName = document.getElementById('file-name');
          var dropZone = document.getElementById('drop-zone');
          var parsedData = [];

          if (typeof XLSX === 'undefined') {
            showStatus('bg-red-50 text-red-700 border border-red-200',
              '⚠️ Excel bibliotheek kon niet geladen worden. Ververs de pagina (Ctrl+F5).');
            return;
          }

          // File input change
          fileInput.addEventListener('change', function(e) {
            var file = e.target.files[0];
            if (file) processFile(file);
          });

          // Drag & drop
          dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            dropZone.classList.add('border-animato-primary', 'bg-blue-50');
          });
          dropZone.addEventListener('dragleave', function() {
            dropZone.classList.remove('border-animato-primary', 'bg-blue-50');
          });
          dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.classList.remove('border-animato-primary', 'bg-blue-50');
            var file = e.dataTransfer.files[0];
            if (file) processFile(file);
          });

          function processFile(file) {
            fileName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            var reader = new FileReader();
            reader.onload = function(e) {
              try {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: 'array' });
                var sheet = workbook.Sheets[workbook.SheetNames[0]];
                var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                if (rows.length === 0) {
                  showStatus('bg-red-50 text-red-700 border border-red-200', '⚠️ Geen rijen gevonden in het bestand. Controleer of het bestand data bevat.');
                  return;
                }
                parseRows(rows);
              } catch(err) {
                showStatus('bg-red-50 text-red-700 border border-red-200', '⚠️ Fout bij lezen van bestand: ' + err.message);
              }
            };
            reader.onerror = function() {
              showStatus('bg-red-50 text-red-700 border border-red-200', '⚠️ Kon het bestand niet lezen.');
            };
            reader.readAsArrayBuffer(file);
          }

          function normalizeKey(key) {
            return key.toString().toLowerCase().trim()
              .replace(/\\s+/g, ' ')
              .replace(/[^a-z0-9 ]/g, '');
          }

          function getField(row, candidates) {
            var keys = Object.keys(row);
            for (var i = 0; i < candidates.length; i++) {
              for (var j = 0; j < keys.length; j++) {
                if (normalizeKey(keys[j]) === candidates[i]) {
                  var val = row[keys[j]];
                  return val !== undefined && val !== null ? String(val).trim() : '';
                }
              }
            }
            return '';
          }

          function parseRows(rows) {
            parsedData = [];
            previewTable.innerHTML = '';
            var valid = 0, invalid = 0;

            rows.forEach(function(row) {
              var item = {
                voornaam:   getField(row, ['voornaam', 'first name', 'firstname', 'naam']),
                achternaam: getField(row, ['achternaam', 'familienaam', 'last name', 'lastname', 'familynaam']),
                email:      getField(row, ['email', 'e-mail', 'mail', 'emailadres']),
                stemgroep:  getField(row, ['stemgroep', 'stem', 'voice', 'part']),
                telefoon:   getField(row, ['telefoon', 'gsm', 'tel', 'phone', 'mobile']),
                adres:      getField(row, ['adres', 'address', 'straat']),
                errors: []
              };

              // Validatie
              if (!item.voornaam) item.errors.push('Geen voornaam');
              if (!item.achternaam) item.errors.push('Geen achternaam');
              if (!item.email || !item.email.includes('@')) item.errors.push('Ongeldig email');

              // Stemgroep normaliseren
              var s = item.stemgroep.toUpperCase();
              if (s.startsWith('S')) item.stemgroep = 'S';
              else if (s.startsWith('A')) item.stemgroep = 'A';
              else if (s.startsWith('T')) item.stemgroep = 'T';
              else if (s.startsWith('B')) item.stemgroep = 'B';
              else item.stemgroep = '';

              item.isValid = item.errors.length === 0;
              if (item.isValid) valid++; else invalid++;

              parsedData.push(item);

              // Render rij
              var tr = document.createElement('tr');
              tr.className = item.isValid ? 'hover:bg-green-50' : 'bg-red-50';
              var statusCell = item.isValid
                ? '<td class="px-4 py-2"><span class="text-green-600 text-xs font-semibold">✓ OK</span></td>'
                : '<td class="px-4 py-2"><span class="text-red-600 text-xs font-semibold" title="' + item.errors.join(', ') + '">✗ ' + item.errors[0] + '</span></td>';
              tr.innerHTML = statusCell
                + '<td class="px-4 py-2">' + (item.voornaam || '<span class=\\'text-red-400 italic\\'>leeg</span>') + '</td>'
                + '<td class="px-4 py-2">' + (item.achternaam || '<span class=\\'text-red-400 italic\\'>leeg</span>') + '</td>'
                + '<td class="px-4 py-2">' + (item.email || '<span class=\\'text-red-400 italic\\'>leeg</span>') + '</td>'
                + '<td class="px-4 py-2">' + (item.stemgroep || '—') + '</td>'
                + '<td class="px-4 py-2">' + (item.telefoon || '—') + '</td>';
              previewTable.appendChild(tr);
            });

            previewSection.classList.remove('hidden');
            previewCount.textContent = '(' + rows.length + ' rijen: ' + valid + ' geldig, ' + invalid + ' ongeldig)';

            if (valid > 0) {
              importBtn.disabled = false;
              importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Importeer ' + valid + ' leden';
              showStatus('bg-green-50 text-green-700 border border-green-200',
                '✓ ' + rows.length + ' rijen ingelezen. ' + valid + ' geldig en klaar om te importeren.');
            } else {
              importBtn.disabled = true;
              showStatus('bg-red-50 text-red-700 border border-red-200',
                '⚠️ Geen geldige rijen. Kolomnamen herkend? Download het voorbeeldbestand om de juiste structuur te zien.');
            }
          }

          // Import knop
          importBtn.addEventListener('click', async function() {
            var validData = parsedData.filter(function(d) { return d.isValid; });
            if (validData.length === 0) return;

            importBtn.disabled = true;
            importBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Bezig met importeren...';
            showStatus('bg-blue-50 text-blue-700 border border-blue-200', '⏳ Importeren... even geduld.');

            try {
              var response = await fetch('/api/admin/leden/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leden: validData })
              });

              var result = await response.json();

              if (result.success) {
                showStatus('bg-green-50 text-green-700 border border-green-200',
                  '✓ Import geslaagd! ' + result.imported + ' leden aangemaakt, ' + result.skipped + ' overgeslagen (bestond al).'
                  + (result.errors.length > 0 ? ' Fouten: ' + result.errors.join(', ') : ''));
                importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Klaar!';
                setTimeout(function() { window.location.href = '/admin/leden'; }, 2500);
              } else {
                showStatus('bg-red-50 text-red-700 border border-red-200', '⚠️ Fout: ' + result.error);
                importBtn.disabled = false;
                importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Opnieuw proberen';
              }
            } catch(err) {
              showStatus('bg-red-50 text-red-700 border border-red-200', '⚠️ Netwerkfout: ' + err.message);
              importBtn.disabled = false;
              importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Opnieuw proberen';
            }
          });

          function showStatus(classes, message) {
            statusMessage.className = 'mt-4 p-4 rounded text-sm ' + classes;
            statusMessage.textContent = message;
            statusMessage.classList.remove('hidden');
          }
        }
      `}} />
    </Layout>
  )
})

// =====================================================
// IMPORT API
// =====================================================

app.post('/api/admin/leden/import', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.json()
  const leden = body.leden

  if (!leden || !Array.isArray(leden)) {
    return c.json({ success: false, error: 'Geen geldige data ontvangen' }, 400)
  }

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  const defaultPasswordHash = await hashPassword('Animato2025!')

  for (const lid of leden) {
    try {
      const exists = await queryOne(c.env.DB, 'SELECT id FROM users WHERE email = ?', [lid.email])
      if (exists) { skipped++; continue }

      const userRes = await execute(c.env.DB, `
        INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified)
        VALUES (?, ?, 'lid', ?, 'actief', 1)
      `, [lid.email, defaultPasswordHash, lid.stemgroep || null])

      const newUserId = userRes.meta.last_row_id

      await execute(c.env.DB, `
        INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, adres, gemeente, stad)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [newUserId, lid.voornaam, lid.achternaam, lid.telefoon || null, lid.adres || null, null, null])

      imported++
    } catch (e: any) {
      console.error('Import error for ' + lid.email, e)
      errors.push(lid.email + ' (' + e.message + ')')
    }
  }

  await execute(c.env.DB, `
    INSERT INTO audit_logs (user_id, actie, entity_type, meta)
    VALUES (?, 'import_leden', 'user', ?)
  `, [user.id, JSON.stringify({ imported, skipped, errors: errors.length, total: leden.length })])

  return c.json({ success: true, imported, skipped, errors })
})

export default app
