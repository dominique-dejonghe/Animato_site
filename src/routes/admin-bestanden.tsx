import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireRole, type SessionUser } from '../middleware/auth'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono()

// Apply admin authentication – scoped to /admin/* and /api/admin/* only
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  
  if (!token) {
    return c.redirect('/inloggen?redirect=' + encodeURIComponent(c.req.url))
  }

  const jwtSecret = c.env.JWT_SECRET
  const user = await verifyToken(token, jwtSecret)

  if (!user) {
    return c.redirect('/inloggen?redirect=' + encodeURIComponent(c.req.url))
  }

  if (user.role !== 'admin' && user.role !== 'moderator') {
    return c.html(`
      <!DOCTYPE html>
      <html lang="nl">
      <head>
        <meta charset="UTF-8">
        <title>Geen toegang</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 flex items-center justify-center min-h-screen">
        <div class="text-center px-4">
          <h1 class="text-6xl font-bold text-red-300 mb-4">403</h1>
          <h2 class="text-2xl font-semibold text-gray-700 mb-4">Geen toegang</h2>
          <p class="text-gray-600 mb-8">Je hebt geen rechten om deze pagina te bekijken.</p>
          <a href="/leden" class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition">
            Terug naar ledenportaal
          </a>
        </div>
      </body>
      </html>
    `, 403)
  }

  c.set('user', user)
  await next()
}
app.use('/admin/*', adminAuthMiddleware)
app.use('/api/admin/*', adminAuthMiddleware)

// ==========================================
// OVERVIEW PAGE - List all materials
// ==========================================
app.get('/admin/bestanden', async (c) => {
  const user = c.get('user') as SessionUser
  const { stemgroep, type, zoek } = c.req.query()
  
  // Build query with filters
  let query = `
    SELECT m.*, w.titel as werk_titel, w.componist, p.titel as piece_titel,
           u.email as uploader_email
    FROM materials m
    LEFT JOIN pieces p ON m.piece_id = p.id
    LEFT JOIN works w ON p.work_id = w.id
    LEFT JOIN users u ON m.upload_door = u.id
    WHERE m.is_actief = 1
  `
  const params: any[] = []
  
  // Search filter
  if (zoek && zoek.trim() !== '') {
    query += ` AND (
      m.titel LIKE ? OR 
      w.titel LIKE ? OR 
      w.componist LIKE ? OR 
      p.titel LIKE ? OR
      m.beschrijving LIKE ?
    )`
    const searchTerm = `%${zoek}%`
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
  }
  
  if (stemgroep && stemgroep !== 'alle') {
    query += ` AND m.stem = ?`
    params.push(stemgroep)
  }
  
  if (type && type !== 'alle') {
    query += ` AND m.type = ?`
    params.push(type)
  }
  
  query += ` ORDER BY w.componist, w.titel, p.nummer, m.stem, m.type`
  
  const materials = await queryAll(c.env.DB, query, params)
  
  return c.html(
    <Layout title="Bestanden Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="materials" />
        <div class="flex-1 min-w-0">
          <div class="max-w-7xl mx-auto px-4 py-8">
            {/* Header */}
        <div class="flex justify-between items-center mb-8">
          <div>
            <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-file-music mr-3"></i>
              Partituren & Oefenmateriaal
            </h1>
            <p class="text-gray-600">
              Beheer PDF partituren, audio tracks, video's en YouTube links
            </p>
          </div>
          <a
            href="/admin/bestanden/nieuw"
            class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition inline-flex items-center"
          >
            <i class="fas fa-plus mr-2"></i>
            Nieuw Bestand
          </a>
          <a
            href="/admin/bestanden/requests"
            class="ml-3 bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition inline-flex items-center"
          >
            <i class="fas fa-print mr-2"></i>
            Printaanvragen
          </a>
        </div>

        {/* Search & Filters */}
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <form method="GET" class="space-y-4">
            {/* Search Bar */}
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-search mr-2 text-animato-primary"></i>
                Zoeken
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  name="zoek"
                  value={c.req.query('zoek') || ''}
                  placeholder="Zoek op titel, componist, werk, beschrijving..."
                  class="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                />
                <button
                  type="submit"
                  class="bg-animato-primary text-white px-6 py-2 rounded-lg hover:bg-opacity-90 transition"
                >
                  <i class="fas fa-search mr-2"></i>
                  Zoek
                </button>
              </div>
            </div>

            {/* Filters Row */}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-music mr-2 text-blue-600"></i>
                  Stemgroep
                </label>
                <select
                  name="stemgroep"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  onchange="this.form.submit()"
                >
                  <option value="alle" selected={!stemgroep || stemgroep === 'alle'}>Alle stemmen</option>
                  <optgroup label="Vocaal">
                    <option value="S" selected={stemgroep === 'S'}>🎵 Sopraan</option>
                    <option value="A" selected={stemgroep === 'A'}>🎵 Alt</option>
                    <option value="T" selected={stemgroep === 'T'}>🎵 Tenor</option>
                    <option value="B" selected={stemgroep === 'B'}>🎵 Bas</option>
                    <option value="SA" selected={stemgroep === 'SA'}>🎵 SA</option>
                    <option value="TB" selected={stemgroep === 'TB'}>🎵 TB</option>
                    <option value="SATB" selected={stemgroep === 'SATB'}>🎵 SATB (Tutti)</option>
                  </optgroup>
                  <optgroup label="Instrumentaal">
                    <option value="piano" selected={stemgroep === 'piano'}>🎹 Piano</option>
                    <option value="orgel" selected={stemgroep === 'orgel'}>🎹 Orgel</option>
                    <option value="drums" selected={stemgroep === 'drums'}>🥁 Drums</option>
                  </optgroup>
                  <option value="algemeen" selected={stemgroep === 'algemeen'}>📚 Algemeen</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-file mr-2 text-purple-600"></i>
                  Bestandstype
                </label>
                <select
                  name="type"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  onchange="this.form.submit()"
                >
                  <option value="alle" selected={!type || type === 'alle'}>Alle formaten</option>
                  <option value="pdf" selected={type === 'pdf'}>📄 PDF Partituur</option>
                  <option value="audio" selected={type === 'audio'}>🎵 Audio Track (MP3)</option>
                  <option value="video" selected={type === 'video'}>🎬 Video (MP4)</option>
                  <option value="link" selected={type === 'link'}>🔗 YouTube/Externe Link</option>
                  <option value="zip" selected={type === 'zip'}>📦 ZIP Archief</option>
                </select>
              </div>

              <div class="flex items-end">
                <a
                  href="/admin/bestanden"
                  class="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition text-center"
                >
                  <i class="fas fa-times mr-2"></i>
                  Reset Alles
                </a>
              </div>
            </div>

            {/* Active Filters Display */}
            {(c.req.query('zoek') || (stemgroep && stemgroep !== 'alle') || (type && type !== 'alle')) && (
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-600 font-medium">Actieve filters:</span>
                {c.req.query('zoek') && (
                  <span class="bg-animato-primary bg-opacity-10 text-animato-primary px-3 py-1 rounded-full">
                    <i class="fas fa-search mr-1"></i>
                    "{c.req.query('zoek')}"
                  </span>
                )}
                {stemgroep && stemgroep !== 'alle' && (
                  <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
                    <i class="fas fa-music mr-1"></i>
                    {stemgroep}
                  </span>
                )}
                {type && type !== 'alle' && (
                  <span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
                    <i class="fas fa-file mr-1"></i>
                    {type.toUpperCase()}
                  </span>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Materials List */}
        {materials.length === 0 ? (
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-folder-open text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">Geen bestanden gevonden</h3>
            <p class="text-gray-500 mb-6">
              {stemgroep || type ? 'Probeer andere filters' : 'Upload je eerste partituur of oefentrack'}
            </p>
            <a
              href="/admin/bestanden/nieuw"
              class="inline-flex items-center bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-plus mr-2"></i>
              Nieuw Bestand
            </a>
          </div>
        ) : (
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Titel & Werk
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stem
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploader
                  </th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acties
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {materials.map((mat: any) => {
                  const stemLabel = {
                    'S': '🎵 Sopraan',
                    'A': '🎵 Alt',
                    'T': '🎵 Tenor',
                    'B': '🎵 Bas',
                    'SA': '🎵 SA',
                    'TB': '🎵 TB',
                    'SATB': '🎵 SATB (Tutti)',
                    'piano': '🎹 Piano',
                    'orgel': '🎹 Orgel',
                    'drums': '🥁 Drums',
                    'algemeen': '📚 Algemeen'
                  }[mat.stem] || mat.stem
                  
                  const typeIcon = {
                    'pdf': 'fa-file-pdf text-red-500',
                    'audio': 'fa-file-audio text-blue-500',
                    'video': 'fa-file-video text-purple-500',
                    'link': 'fa-youtube text-red-600',
                    'zip': 'fa-file-archive text-yellow-500'
                  }[mat.type] || 'fa-file'
                  
                  return (
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4">
                        <div class="flex items-start">
                          <i class={`fas ${typeIcon} text-2xl mr-3 mt-1`}></i>
                          <div>
                            <div class="font-semibold text-gray-900">
                              {mat.titel}
                            </div>
                            {mat.werk_titel && (
                              <div class="text-sm text-gray-600">
                                {mat.componist} - {mat.werk_titel}
                                {mat.piece_titel && ` (${mat.piece_titel})`}
                              </div>
                            )}
                            {mat.beschrijving && (
                              <div class="text-sm text-gray-500 mt-1">
                                {mat.beschrijving}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm">
                        {stemLabel}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                          {mat.type.toUpperCase()}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {mat.uploader_email || 'Onbekend'}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <a
                          href={mat.url}
                          target="_blank"
                          class="text-animato-primary hover:text-animato-secondary mr-4"
                          title="Bekijk/Download"
                        >
                          <i class="fas fa-external-link-alt"></i>
                        </a>
                        <a
                          href={`/admin/bestanden/${mat.id}/edit`}
                          class="text-blue-600 hover:text-blue-900 mr-4"
                          title="Bewerken"
                        >
                          <i class="fas fa-edit"></i>
                        </a>
                        <button
                          onclick={`openDeleteModal(${mat.id})`}
                          class="text-red-600 hover:text-red-900"
                          title="Verwijderen"
                        >
                          <i class="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
          <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-red-500">
            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <div class="sm:flex sm:items-start">
                <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                  <i class="fas fa-exclamation-triangle text-red-600"></i>
                </div>
                <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                  <h3 class="text-xl leading-6 font-bold text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                    Bestand Verwijderen
                  </h3>
                  <div class="mt-2">
                    <p class="text-sm text-gray-500">
                      Weet je zeker dat je dit bestand wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-lg border border-transparent shadow-md px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm transition">
                Verwijderen
              </button>
              <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition">
                Annuleren
              </button>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        let deleteId = null;

        function openDeleteModal(id) {
          deleteId = id;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteId = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteId) {
            fetch('/api/admin/bestanden/' + deleteId + '/delete', { method: 'POST' })
              .then(response => {
                if (response.ok) {
                  window.location.reload();
                } else {
                  alert('Er ging iets mis bij het verwijderen.');
                }
              })
              .catch(error => {
                console.error('Error:', error);
                alert('Er ging iets mis bij het verwijderen.');
              });
          }
          closeDeleteModal();
        });
      ` }} />
    </Layout>
  )
})

// ==========================================
// PRINT REQUESTS PAGE
// ==========================================
app.get('/admin/bestanden/requests', async (c) => {
  const user = c.get('user') as SessionUser
  
  const requests = await queryAll(c.env.DB, `
    SELECT pr.*, 
           u.email, p.voornaam, p.achternaam,
           m.titel as material_titel, m.type,
           w.titel as werk_titel
    FROM print_requests pr
    JOIN users u ON pr.user_id = u.id
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN works w ON pr.work_id = w.id
    LEFT JOIN materials m ON pr.material_id = m.id
    ORDER BY 
      CASE pr.status WHEN 'pending' THEN 1 ELSE 2 END,
      pr.created_at DESC
  `)

  return c.html(
    <Layout title="Printaanvragen" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="materials" />
        <div class="flex-1 min-w-0">
          <div class="max-w-7xl mx-auto px-4 py-8">
            <div class="flex justify-between items-center mb-8">
              <div>
                <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-print mr-3"></i>
                  Printaanvragen
                </h1>
                <p class="text-gray-600">
                  Beheer aanvragen voor geprinte partituren
                </p>
              </div>
              <a href="/admin/bestanden" class="text-animato-primary hover:text-animato-secondary">
                <i class="fas fa-arrow-left mr-2"></i> Terug naar bestanden
              </a>
            </div>

            <div class="bg-white rounded-lg shadow-md overflow-hidden">
              <table class="w-full">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Datum</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lid</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Werk / Bestand</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Opmerking</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actie</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 bg-white">
                  {requests.map((req: any) => (
                    <tr class={req.status === 'completed' ? 'bg-gray-50' : ''}>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(req.created_at).toLocaleDateString('nl-BE')}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-medium text-gray-900">{req.voornaam} {req.achternaam}</div>
                        <div class="text-xs text-gray-500">{req.email}</div>
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm text-gray-900 font-medium">{req.werk_titel}</div>
                        <div class="text-xs text-gray-500">{req.material_titel || 'Gehele werk'}</div>
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm text-gray-900 max-w-xs truncate" title={req.opmerking}>{req.opmerking || '-'}</div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          req.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                          req.status === 'completed' ? 'bg-green-100 text-green-800' : 
                          'bg-red-100 text-red-800'
                        }`}>
                          {req.status === 'pending' ? 'Te Printen' : req.status === 'completed' ? 'Geleverd' : 'Geannuleerd'}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {req.status === 'pending' && (
                          <form action={`/api/admin/bestanden/requests/${req.id}/complete`} method="POST" class="inline">
                            <button class="text-green-600 hover:text-green-900 mr-3" title="Markeer als geprint & geleverd">
                              <i class="fas fa-check"></i> Afhandelen
                            </button>
                          </form>
                        )}
                        <form action={`/api/admin/bestanden/requests/${req.id}/delete`} method="POST" class="inline" onsubmit="return confirm('Zeker weten?');">
                          <button class="text-red-600 hover:text-red-900" title="Verwijderen">
                            <i class="fas fa-trash"></i>
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {requests.length === 0 && (
                    <tr>
                      <td colspan="5" class="px-6 py-12 text-center text-gray-500">
                        <i class="fas fa-check-circle text-4xl text-gray-300 mb-3"></i>
                        <p>Geen openstaande printaanvragen</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

app.post('/api/admin/bestanden/requests/:id/complete', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare("UPDATE print_requests SET status = 'completed' WHERE id = ?").bind(id).run()
  return c.redirect('/admin/bestanden/requests')
})

app.post('/api/admin/bestanden/requests/:id/delete', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare("DELETE FROM print_requests WHERE id = ?").bind(id).run()
  return c.redirect('/admin/bestanden/requests')
})

// ==========================================
// CREATE NEW MATERIAL PAGE
// ==========================================
app.get('/admin/bestanden/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Get all works for dropdown
  const works = await queryAll(c.env.DB, `
    SELECT id, componist, titel
    FROM works
    ORDER BY componist, titel
  `)
  
  return c.html(
    <Layout title="Nieuw Bestand Toevoegen" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="materials" />
        <div class="flex-1 min-w-0">
          <div class="max-w-4xl mx-auto px-4 py-8">
            <div class="mb-8">
          <a href="/admin/bestanden" class="text-animato-primary hover:text-animato-secondary inline-flex items-center mb-4">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar overzicht
          </a>
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-file-upload mr-3"></i>
            Nieuw Bestand Toevoegen
          </h1>
          <p class="text-gray-600">
            Upload partituren, audio tracks, video's of voeg YouTube links toe
          </p>
        </div>

        <form method="POST" action="/api/admin/bestanden/create" class="space-y-6">
          {/* Work Selection or New Work */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              1. Muziekwerk
            </h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label class="flex items-center cursor-pointer">
                  <input type="radio" name="work_option" value="existing" checked onchange="toggleWorkFields()" class="mr-2" />
                  <span class="font-medium">Bestaand werk</span>
                </label>
              </div>
              <div>
                <label class="flex items-center cursor-pointer">
                  <input type="radio" name="work_option" value="new" onchange="toggleWorkFields()" class="mr-2" />
                  <span class="font-medium">Nieuw werk toevoegen</span>
                </label>
              </div>
            </div>

            <div id="existing_work_section">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Selecteer Werk
              </label>
              <select
                name="work_id"
                id="work_id"
                class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
              >
                <option value="">-- Selecteer een werk --</option>
                {works.map((w: any) => (
                  <option value={w.id}>{w.componist} - {w.titel}</option>
                ))}
              </select>
            </div>

            <div id="new_work_section" class="hidden space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Componist *
                </label>
                <input
                  type="text"
                  name="new_componist"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. Mozart, Bach, Verdi"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Werk Titel *
                </label>
                <input
                  type="text"
                  name="new_werk_titel"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. Requiem in D minor"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving Werk
                </label>
                <textarea
                  name="new_beschrijving"
                  rows={3}
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="Korte toelichting over het werk, context, etc."
                ></textarea>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Afbeelding URL (Optioneel)
                </label>
                <input
                  type="url"
                  name="new_image_url"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="https://example.com/image.jpg"
                />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Genre
                  </label>
                  <input
                    type="text"
                    name="new_genre"
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                    placeholder="bijv. Klassiek, Barok, Pop"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Jaar
                  </label>
                  <input
                    type="number"
                    name="new_jaar"
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                    placeholder="bijv. 1791"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Piece Details */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              2. Stuk/Deel (Optioneel)
            </h2>
            <p class="text-sm text-gray-600 mb-4">
              Vul dit in als het bestand hoort bij een specifiek deel van het werk (bijv. "Kyrie", "Dies Irae")
            </p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Deel Titel
                </label>
                <input
                  type="text"
                  name="piece_titel"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. Kyrie, Dies Irae"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Deel Nummer
                </label>
                <input
                  type="number"
                  name="piece_nummer"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. 1, 2, 3"
                />
              </div>
            </div>
          </div>

          {/* Material Details */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              3. Bestand Details
            </h2>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel Bestand *
                </label>
                <input
                  type="text"
                  name="material_titel"
                  required
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. Partituur Sopraan, Oefentrack Piano"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Stemgroep *
                  </label>
                  <select
                    name="stem"
                    required
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  >
                    <option value="">-- Selecteer stem --</option>
                    <option value="S">Sopraan</option>
                    <option value="A">Alt</option>
                    <option value="T">Tenor</option>
                    <option value="B">Bas</option>
                    <option value="SA">SA</option>
                    <option value="TB">TB</option>
                    <option value="SATB">SATB (Tutti)</option>
                    <option value="piano">Piano</option>
                    <option value="orgel">Orgel</option>
                    <option value="drums">Drums</option>
                    <option value="algemeen">Algemeen</option>
                  </select>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Type Bestand *
                  </label>
                  <select
                    name="type"
                    id="material_type"
                    required
                    onchange="toggleUploadFields()"
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  >
                    <option value="">-- Selecteer type --</option>
                    <option value="pdf">PDF Partituur</option>
                    <option value="audio">Audio Track (MP3)</option>
                    <option value="video">Video File (MP4)</option>
                    <option value="link">YouTube Link</option>
                    <option value="zip">ZIP Archief</option>
                  </select>
                </div>
              </div>

              {/* Page Count (Conditional for PDF) */}
              <div id="page_count_section" class="hidden">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Aantal Pagina's (voor prijsberekening)
                </label>
                <input
                  type="number"
                  name="page_count"
                  min="0"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="0"
                />
              </div>

              {/* File Upload Section */}
              <div id="file_upload_section" class="hidden">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Bestand Uploaden
                </label>
                <div class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    id="file_input"
                    name="file_upload"
                    accept=".pdf,.mp3,.mp4,.zip"
                    onchange="handleFileSelect(event)"
                    class="hidden"
                  />
                  <button
                    type="button"
                    onclick="document.getElementById('file_input').click()"
                    class="bg-animato-primary text-white px-6 py-2 rounded-lg hover:bg-opacity-90 transition"
                  >
                    <i class="fas fa-upload mr-2"></i>
                    Selecteer Bestand
                  </button>
                  <p class="text-sm text-gray-500 mt-2">
                    Max 8MB • PDF, MP3, MP4, ZIP
                  </p>
                  <div id="file_preview" class="hidden mt-4">
                    <div class="bg-gray-50 rounded-lg p-4 inline-block">
                      <i class="fas fa-file text-4xl text-gray-400"></i>
                      <p id="file_name" class="text-sm text-gray-700 mt-2"></p>
                      <p id="file_size" class="text-xs text-gray-500"></p>
                    </div>
                  </div>
                  <input type="hidden" name="file_data" id="file_data" />
                </div>
              </div>

              {/* URL Section */}
              <div id="url_section" class="hidden">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Of: Externe Link / YouTube URL
                </label>
                <input
                  type="url"
                  name="external_url"
                  id="external_url"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="https://youtube.com/watch?v=... of https://drive.google.com/..."
                />
                <p class="text-sm text-gray-500 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Voor bestanden &gt; 8MB: gebruik Google Drive, Dropbox, WeTransfer of YouTube
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving
                </label>
                <textarea
                  name="beschrijving"
                  rows={3}
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="Extra informatie over dit bestand"
                ></textarea>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Zichtbaar voor
                </label>
                <select
                  name="zichtbaar_voor"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="alle_leden">Alle Leden</option>
                  <option value="eigen_stem">Alleen Eigen Stem</option>
                  <option value="bestuur">Alleen Bestuur</option>
                </select>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div class="flex justify-end space-x-4">
            <a
              href="/admin/bestanden"
              class="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuleren
            </a>
            <button
              type="submit"
              class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-save mr-2"></i>
              Opslaan
            </button>
          </div>
        </form>

        {/* JavaScript */}
        <script dangerouslySetInnerHTML={{ __html: `
          function toggleWorkFields() {
            const option = document.querySelector('input[name="work_option"]:checked').value;
            const existingSection = document.getElementById('existing_work_section');
            const newSection = document.getElementById('new_work_section');
            
            if (option === 'existing') {
              existingSection.classList.remove('hidden');
              newSection.classList.add('hidden');
              document.getElementById('work_id').required = true;
              document.querySelector('input[name="new_componist"]').required = false;
              document.querySelector('input[name="new_werk_titel"]').required = false;
            } else {
              existingSection.classList.add('hidden');
              newSection.classList.remove('hidden');
              document.getElementById('work_id').required = false;
              document.querySelector('input[name="new_componist"]').required = true;
              document.querySelector('input[name="new_werk_titel"]').required = true;
            }
          }

          function toggleUploadFields() {
            const type = document.getElementById('material_type').value;
            const uploadSection = document.getElementById('file_upload_section');
            const urlSection = document.getElementById('url_section');
            const fileInput = document.getElementById('file_input');
            const urlInput = document.getElementById('external_url');
            
            if (type === 'link') {
              // YouTube/External link only - no file upload
              uploadSection.classList.add('hidden');
              urlSection.classList.remove('hidden');
              fileInput.required = false;
              urlInput.required = true;
            } else if (type) {
              // File upload + optional external link
              uploadSection.classList.remove('hidden');
              urlSection.classList.remove('hidden');
              fileInput.required = false; // Not required if external_url is provided
              urlInput.required = false;  // Optional alternative
            } else {
              uploadSection.classList.add('hidden');
              urlSection.classList.add('hidden');
              fileInput.required = false;
              urlInput.required = false;
            }

            // Show page count for PDF
            const pageSection = document.getElementById('page_count_section');
            if (type === 'pdf') {
              pageSection.classList.remove('hidden');
            } else {
              pageSection.classList.add('hidden');
            }
          }

          function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Validate file size (8MB max - SQLite limitation with base64 encoding)
            if (file.size > 8 * 1024 * 1024) {
              alert('Bestand is te groot. Maximaal 8MB toegestaan.\\n\\nVoor grotere bestanden kun je:\\n- YouTube links gebruiken (voor video)\\n- Externe hosting gebruiken (zoals Google Drive, Dropbox)\\n- Het bestand comprimeren');
              event.target.value = '';
              return;
            }

            // Show preview
            document.getElementById('file_preview').classList.remove('hidden');
            document.getElementById('file_name').textContent = file.name;
            document.getElementById('file_size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';

            // Read file as base64
            const reader = new FileReader();
            reader.onload = function(e) {
              document.getElementById('file_data').value = e.target.result;
            };
            reader.readAsDataURL(file);
          }
        ` }} />
          </div>
        </div>
      </div>
    </Layout>
  )
})

// ==========================================
// CREATE HANDLER
// ==========================================
app.post('/api/admin/bestanden/create', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  
  try {
    // 1. Handle work creation/selection
    let workId: number
    
    if (body.work_option === 'new') {
      // Create new work
      const result = await execute(c.env.DB,
        `INSERT INTO works (componist, titel, genre, jaar, beschrijving, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
        [body.new_componist, body.new_werk_titel, body.new_genre || null, body.new_jaar || null, body.new_beschrijving || null, body.new_image_url || null]
      )
      workId = result.meta.last_row_id
    } else {
      workId = parseInt(String(body.work_id))
    }

    // 2. Handle piece creation (if provided)
    let pieceId: number | null = null
    
    if (body.piece_titel) {
      const result = await execute(c.env.DB,
        `INSERT INTO pieces (work_id, titel, nummer) VALUES (?, ?, ?)`,
        [workId, body.piece_titel, body.piece_nummer || null]
      )
      pieceId = result.meta.last_row_id
    } else {
      // If no piece specified, create a default piece
      const work = await queryOne(c.env.DB, `SELECT titel FROM works WHERE id = ?`, [workId])
      const result = await execute(c.env.DB,
        `INSERT INTO pieces (work_id, titel, nummer) VALUES (?, ?, ?)`,
        [workId, work.titel, 1]
      )
      pieceId = result.meta.last_row_id
    }

    // 3. Handle file upload or URL
    let finalUrl: string
    let bestandsnaam: string | null = null
    let mimeType: string | null = null
    let grootte: number | null = null
    
    // Check if external URL is provided
    const externalUrl = body.external_url ? String(body.external_url).trim() : ''
    const fileData = body.file_data ? String(body.file_data) : ''
    
    if (body.type === 'link' || (externalUrl && !fileData)) {
      // External link (YouTube, Google Drive, etc.)
      if (!externalUrl) {
        throw new Error('Geen URL opgegeven')
      }
      finalUrl = externalUrl
      bestandsnaam = null
    } else if (externalUrl && fileData) {
      // Both provided - prefer external URL for large files
      finalUrl = externalUrl
      bestandsnaam = null
    } else if (fileData && fileData.startsWith('data:')) {
      // File upload (base64)
      finalUrl = fileData
      
      // Extract file info from data URL
      const matches = fileData.match(/^data:([^;]+);base64,(.+)$/)
      if (matches) {
        mimeType = matches[1]
        const base64Data = matches[2]
        grootte = Math.round(base64Data.length * 0.75) // Approximate file size
      }
      
      // Get filename from file input (if available)
      // Note: We can't easily get the original filename from base64, so we'll construct one
      const typeExt = {
        'pdf': '.pdf',
        'audio': '.mp3',
        'video': '.mp4',
        'zip': '.zip'
      }[String(body.type)] || ''
      bestandsnaam = `${body.material_titel}${typeExt}`.replace(/[^a-zA-Z0-9._-]/g, '_')
    } else {
      throw new Error('Geen bestand of URL opgegeven')
    }

    // 4. Create material record
    await execute(c.env.DB, `
      INSERT INTO materials (
        piece_id, stem, type, titel, bestandsnaam, url, mime_type,
        grootte_bytes, beschrijving, zichtbaar_voor, upload_door, page_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pieceId,
      body.stem,
      body.type,
      body.material_titel,
      bestandsnaam,
      finalUrl,
      mimeType,
      grootte,
      body.beschrijving || null,
      body.zichtbaar_voor || 'alle_leden',
      user.id,
      body.page_count ? parseInt(body.page_count) : 0
    ])

    // 5. Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'create', 'materials', ?, ?)
    `, [
      user.id,
      pieceId,
      JSON.stringify({ titel: body.material_titel, type: body.type, stem: body.stem })
    ])

    return c.redirect('/admin/bestanden')
    
  } catch (error) {
    console.error('Error creating material:', error)
    return c.text('Error: ' + (error as Error).message, 500)
  }
})

// ==========================================
// EDIT MATERIAL PAGE
// ==========================================
app.get('/admin/bestanden/:id/edit', async (c) => {
  const user = c.get('user') as SessionUser
  const materialId = parseInt(c.req.param('id'))
  
  // Get material with work and piece info
  const material = await queryOne(c.env.DB, `
    SELECT m.*, p.id as piece_id, p.titel as piece_titel, p.nummer as piece_nummer,
           w.id as work_id, w.componist, w.titel as werk_titel, w.genre, w.jaar, w.image_url as work_image
    FROM materials m
    LEFT JOIN pieces p ON m.piece_id = p.id
    LEFT JOIN works w ON p.work_id = w.id
    WHERE m.id = ?
  `, [materialId])
  
  if (!material) {
    return c.html(
      <Layout title="Bestand Niet Gevonden" user={user}>
        <div class="max-w-4xl mx-auto px-4 py-8">
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-exclamation-triangle text-6xl text-amber-500 mb-4"></i>
            <h2 class="text-2xl font-bold text-gray-900 mb-4">Bestand Niet Gevonden</h2>
            <p class="text-gray-600 mb-6">Het bestand dat je probeert te bewerken bestaat niet.</p>
            <a href="/admin/bestanden" class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition inline-flex items-center">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar Overzicht
            </a>
          </div>
        </div>
      </Layout>
    )
  }
  
  // Get all works for dropdown
  const works = await queryAll(c.env.DB, `
    SELECT id, componist, titel
    FROM works
    ORDER BY componist, titel
  `)
  
  return c.html(
    <Layout title={`Bewerken: ${material.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="materials" />
        <div class="flex-1 min-w-0">
          <div class="max-w-4xl mx-auto px-4 py-8">
            <div class="mb-8">
          <a href="/admin/bestanden" class="text-animato-primary hover:text-animato-secondary inline-flex items-center mb-4">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar overzicht
          </a>
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-edit mr-3"></i>
            Bestand Bewerken
          </h1>
          <p class="text-gray-600">
            Pas de details van dit bestand aan
          </p>
        </div>

        <form method="POST" action={`/api/admin/bestanden/${materialId}/update`} class="space-y-6">
          {/* Work Info (Read-only) */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              Gekoppeld Muziekwerk
            </h2>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-2">
                    <span class="font-medium">Componist:</span> {material.componist}
                  </p>
                  <p class="text-sm text-gray-600 mb-2">
                    <span class="font-medium">Werk:</span> {material.werk_titel}
                  </p>
                  {material.piece_titel && (
                    <p class="text-sm text-gray-600">
                      <span class="font-medium">Deel:</span> {material.piece_titel}
                      {material.piece_nummer && ` (nr. ${material.piece_nummer})`}
                    </p>
                  )}
                </div>
                {material.work_image && (
                  <img src={material.work_image} alt="Work Cover" class="w-16 h-16 object-cover rounded shadow-sm" />
                )}
              </div>
              
              {/* Edit Work Image Form */}
              <div class="mt-4 pt-4 border-t border-gray-200">
                <button 
                  type="button" 
                  onclick="document.getElementById('editWorkForm').classList.toggle('hidden')"
                  class="text-sm text-animato-primary hover:underline"
                >
                  <i class="fas fa-edit mr-1"></i> Bewerk Werk Afbeelding
                </button>
                
                <div id="editWorkForm" class="hidden mt-3">
                   <div class="flex gap-2">
                     <input 
                       type="url" 
                       id="work_image_input" 
                       value={material.work_image || ''}
                       placeholder="https://example.com/image.jpg"
                       class="flex-1 text-sm border border-gray-300 rounded px-2 py-1"
                     />
                     <button 
                       type="button"
                       onclick={`updateWorkImage(${material.work_id})`}
                       class="bg-animato-primary text-white text-sm px-3 py-1 rounded hover:bg-opacity-90"
                     >
                       Opslaan
                     </button>
                   </div>
                </div>
              </div>

              <p class="text-xs text-gray-500 mt-3">
                💡 Werk en deel details kunnen verder niet gewijzigd worden hier.
              </p>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            function updateWorkImage(workId) {
              const imageUrl = document.getElementById('work_image_input').value;
              fetch('/api/admin/works/' + workId + '/update-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: imageUrl })
              })
              .then(res => res.json())
              .then(data => {
                if(data.success) {
                  window.location.reload();
                } else {
                  alert('Error updating image');
                }
              });
            }
          ` }} />

          {/* Material Details */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              Bestand Details
            </h2>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel Bestand *
                </label>
                <input
                  type="text"
                  name="titel"
                  value={material.titel}
                  required
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="bijv. Partituur Sopraan, Oefentrack Piano"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Stemgroep *
                  </label>
                  <select
                    name="stem"
                    required
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  >
                    <option value="S" selected={material.stem === 'S'}>Sopraan</option>
                    <option value="A" selected={material.stem === 'A'}>Alt</option>
                    <option value="T" selected={material.stem === 'T'}>Tenor</option>
                    <option value="B" selected={material.stem === 'B'}>Bas</option>
                    <option value="SA" selected={material.stem === 'SA'}>SA</option>
                    <option value="TB" selected={material.stem === 'TB'}>TB</option>
                    <option value="SATB" selected={material.stem === 'SATB'}>SATB (Tutti)</option>
                    <option value="piano" selected={material.stem === 'piano'}>Piano</option>
                    <option value="orgel" selected={material.stem === 'orgel'}>Orgel</option>
                    <option value="drums" selected={material.stem === 'drums'}>Drums</option>
                    <option value="algemeen" selected={material.stem === 'algemeen'}>Algemeen</option>
                  </select>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Type Bestand *
                  </label>
                  <select
                    name="type"
                    required
                    class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  >
                    <option value="pdf" selected={material.type === 'pdf'}>PDF Partituur</option>
                    <option value="audio" selected={material.type === 'audio'}>Audio Track (MP3)</option>
                    <option value="video" selected={material.type === 'video'}>Video File (MP4)</option>
                    <option value="link" selected={material.type === 'link'}>YouTube Link</option>
                    <option value="zip" selected={material.type === 'zip'}>ZIP Archief</option>
                  </select>
                </div>
              </div>

              {/* Current File/URL Display */}
              <div class="bg-gray-50 rounded-lg p-4">
                <p class="text-sm font-medium text-gray-700 mb-2">
                  Huidig Bestand/URL:
                </p>
                {material.type === 'link' ? (
                  <a
                    href={material.url}
                    target="_blank"
                    class="text-animato-primary hover:text-animato-secondary text-sm break-all"
                  >
                    <i class="fas fa-external-link-alt mr-2"></i>
                    {material.url}
                  </a>
                ) : (
                  <div class="flex items-center gap-3">
                    <i class={`fas ${
                      material.type === 'pdf' ? 'fa-file-pdf text-red-500' :
                      material.type === 'audio' ? 'fa-file-audio text-blue-500' :
                      material.type === 'video' ? 'fa-file-video text-purple-500' :
                      'fa-file-archive text-yellow-500'
                    } text-3xl`}></i>
                    <div>
                      <p class="text-sm text-gray-700">{material.bestandsnaam || 'Bestand opgeslagen'}</p>
                      {material.grootte_bytes && (
                        <p class="text-xs text-gray-500">{(material.grootte_bytes / 1024 / 1024).toFixed(2)} MB</p>
                      )}
                    </div>
                  </div>
                )}
                <p class="text-xs text-gray-500 mt-2">
                  💡 Het bestand of de URL kan niet gewijzigd worden. Upload een nieuw bestand indien nodig.
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving
                </label>
                <textarea
                  name="beschrijving"
                  rows={3}
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                  placeholder="Extra informatie over dit bestand"
                >{material.beschrijving || ''}</textarea>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Zichtbaar voor
                </label>
                <select
                  name="zichtbaar_voor"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="alle_leden" selected={material.zichtbaar_voor === 'alle_leden'}>Alle Leden</option>
                  <option value="eigen_stem" selected={material.zichtbaar_voor === 'eigen_stem'}>Alleen Eigen Stem</option>
                  <option value="bestuur" selected={material.zichtbaar_voor === 'bestuur'}>Alleen Bestuur</option>
                </select>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  name="is_actief"
                  id="is_actief"
                  value="1"
                  checked={material.is_actief === 1}
                  class="h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded"
                />
                <label for="is_actief" class="ml-2 text-sm text-gray-700">
                  Bestand is actief (zichtbaar voor leden)
                </label>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div class="flex justify-between items-center pt-6 border-t border-gray-200">
            <button
              type="button"
              onclick={`openDeleteModal('/api/admin/bestanden/${materialId}/delete')`}
              class="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              <i class="fas fa-trash mr-2"></i>
              Verwijder Bestand
            </button>
            <div class="flex gap-3">
              <a
                href="/admin/bestanden"
                class="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Annuleren
              </a>
              <button
                type="submit"
                class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition"
              >
                <i class="fas fa-save mr-2"></i>
                Wijzigingen Opslaan
              </button>
            </div>
          </div>
        </form>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
          <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <div class="sm:flex sm:items-start">
                <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                  <i class="fas fa-exclamation-triangle text-red-600"></i>
                </div>
                <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                  <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                    Bevestig Verwijderen
                  </h3>
                  <div class="mt-2">
                    <p class="text-sm text-gray-500">
                      Weet je zeker dat je dit bestand wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm">
                Verwijderen
              </button>
              <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                Annuleren
              </button>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        let deleteUrl = null;

        function openDeleteModal(url) {
          deleteUrl = url;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteUrl = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteUrl) {
            fetch(deleteUrl, { method: 'POST' })
              .then(response => {
                if (response.ok) {
                  window.location.href = '/admin/bestanden';
                } else {
                  alert('Er ging iets mis bij het verwijderen.');
                }
              })
              .catch(error => {
                console.error('Error:', error);
                alert('Er ging iets mis bij het verwijderen.');
              });
          }
          closeDeleteModal();
        });
      ` }} />
    </Layout>
  )
})

// ==========================================
// UPDATE HANDLER
// ==========================================
app.post('/api/admin/bestanden/:id/update', async (c) => {
  const user = c.get('user') as SessionUser
  const materialId = parseInt(c.req.param('id'))
  const body = await c.req.parseBody()
  
  try {
    // Get current material for audit trail
    const oldMaterial = await queryOne(c.env.DB,
      `SELECT * FROM materials WHERE id = ?`,
      [materialId]
    )
    
    if (!oldMaterial) {
      return c.text('Bestand niet gevonden', 404)
    }

    // Update material
    const isActief = body.is_actief === '1' ? 1 : 0
    
    await execute(c.env.DB, `
      UPDATE materials
      SET titel = ?, stem = ?, type = ?, beschrijving = ?, 
          zichtbaar_voor = ?, is_actief = ?
      WHERE id = ?
    `, [
      body.titel,
      body.stem,
      body.type,
      body.beschrijving || null,
      body.zichtbaar_voor || 'alle_leden',
      isActief,
      materialId
    ])

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'update', 'materials', ?, ?)
    `, [
      user.id,
      materialId,
      JSON.stringify({ 
        old: { titel: oldMaterial.titel, stem: oldMaterial.stem },
        new: { titel: body.titel, stem: body.stem }
      })
    ])

    return c.redirect('/admin/bestanden')
    
  } catch (error) {
    console.error('Error updating material:', error)
    return c.text('Error: ' + (error as Error).message, 500)
  }
})

// ==========================================
// DELETE HANDLER
// ==========================================
app.post('/api/admin/bestanden/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const materialId = parseInt(c.req.param('id'))
  
  try {
    // Get material info for audit
    const material = await queryOne(c.env.DB,
      `SELECT * FROM materials WHERE id = ?`,
      [materialId]
    )
    
    if (!material) {
      return c.json({ error: 'Material niet gevonden' }, 404)
    }

    // Soft delete (set is_actief to 0)
    await execute(c.env.DB,
      `UPDATE materials SET is_actief = 0 WHERE id = ?`,
      [materialId]
    )

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (?, 'delete', 'materials', ?, ?)
    `, [
      user.id,
      materialId,
      JSON.stringify({ titel: material.titel, type: material.type })
    ])

    return c.json({ success: true })
    
  } catch (error) {
    console.error('Error deleting material:', error)
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// WORK IMAGE UPDATE HANDLER
// ==========================================
app.post('/api/admin/works/:id/update-image', async (c) => {
  const user = c.get('user') as SessionUser
  const workId = parseInt(c.req.param('id'))
  const body = await c.req.json()
  
  try {
    await execute(c.env.DB, 
      `UPDATE works SET image_url = ? WHERE id = ?`,
      [body.image_url || null, workId]
    )
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Error updating work image:', error)
    return c.json({ error: (error as Error).message }, 500)
  }
})

export default app
