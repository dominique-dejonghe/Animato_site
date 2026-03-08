import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono()

// Middleware
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

// === OVERVIEW ===
app.get('/admin/communicatie', async (c) => {
  const user = c.get('user')
  const templates = await queryAll(c.env.DB, "SELECT * FROM message_templates ORDER BY category, title")

  return c.html(
    <Layout title="Communicatie Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="communications" />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-envelope-open-text text-animato-primary"></i>
                Bericht Templates
              </h1>
              <p class="text-gray-600 mt-1">Standaard berichten voor emails en notificaties</p>
            </div>
            <button onclick="document.getElementById('editModal').classList.remove('hidden'); resetForm();" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90">
              <i class="fas fa-plus mr-2"></i> Nieuw Template
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((tpl: any) => (
              <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition">
                <div class="flex justify-between items-start mb-2">
                  <span class={`px-2 py-1 text-xs rounded font-bold uppercase ${
                    tpl.category === 'payment' ? 'bg-green-100 text-green-800' :
                    tpl.category === 'event' ? 'bg-purple-100 text-purple-800' :
                    tpl.category === 'reminder' ? 'bg-amber-100 text-amber-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {tpl.category}
                  </span>
                  <div class="flex gap-2">
                    <button onclick={`editTemplate(${JSON.stringify(tpl)})`} class="text-gray-400 hover:text-blue-600">
                      <i class="fas fa-edit"></i>
                    </button>
                    <form action="/api/admin/communicatie/delete" method="POST" onsubmit="return confirm('Verwijderen?')" class="inline">
                      <input type="hidden" name="id" value={tpl.id} />
                      <button class="text-gray-400 hover:text-red-600">
                        <i class="fas fa-trash"></i>
                      </button>
                    </form>
                  </div>
                </div>
                <h3 class="font-bold text-lg mb-1">{tpl.title}</h3>
                <p class="text-sm text-gray-600 mb-3 truncate">{tpl.subject || '(Geen onderwerp)'}</p>
                <div class="text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded truncate">
                  {tpl.variables ? JSON.parse(tpl.variables).join(', ') : 'Geen variabelen'}
                </div>
              </div>
            ))}
          </div>

          {/* Modal */}
          <div id="editModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <h3 class="text-xl font-bold mb-4" id="modalTitle">Nieuw Template</h3>
              <form action="/api/admin/communicatie/save" method="POST">
                <input type="hidden" name="id" id="tplId" />
                
                <div class="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label class="block text-sm font-medium mb-1">Interne Titel</label>
                    <input type="text" name="title" id="tplTitle" class="w-full border rounded p-2" required />
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-1">Categorie</label>
                    <select name="category" id="tplCategory" class="w-full border rounded p-2">
                      <option value="general">Algemeen</option>
                      <option value="payment">Betaling</option>
                      <option value="event">Evenement</option>
                      <option value="reminder">Herinnering</option>
                    </select>
                  </div>
                </div>

                <div class="mb-4">
                  <label class="block text-sm font-medium mb-1">Email Onderwerp</label>
                  <input type="text" name="subject" id="tplSubject" class="w-full border rounded p-2" />
                </div>

                <div class="mb-4">
                  <label class="block text-sm font-medium mb-1">Beschikbare Variabelen (JSON Array)</label>
                  <input type="text" name="variables" id="tplVariables" class="w-full border rounded p-2 font-mono text-sm" placeholder='["{{naam}}", "{{bedrag}}"]' />
                  <p class="text-xs text-gray-500 mt-1">Lijst van placeholders die in de tekst vervangen kunnen worden.</p>
                </div>

                <div class="mb-6">
                  <label class="block text-sm font-medium mb-1">Inhoud (Markdown/HTML)</label>
                  <textarea name="body" id="tplBody" rows={10} class="w-full border rounded p-2 font-mono text-sm" required></textarea>
                </div>

                <div class="flex justify-end gap-2">
                  <button type="button" onclick="document.getElementById('editModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
                  <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Opslaan</button>
                </div>
              </form>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            function resetForm() {
              document.getElementById('modalTitle').innerText = 'Nieuw Template';
              document.getElementById('tplId').value = '';
              document.getElementById('tplTitle').value = '';
              document.getElementById('tplSubject').value = '';
              document.getElementById('tplVariables').value = '[]';
              document.getElementById('tplBody').value = '';
              document.getElementById('tplCategory').value = 'general';
            }

            function editTemplate(tpl) {
              document.getElementById('modalTitle').innerText = 'Template Bewerken';
              document.getElementById('tplId').value = tpl.id;
              document.getElementById('tplTitle').value = tpl.title;
              document.getElementById('tplSubject').value = tpl.subject || '';
              document.getElementById('tplVariables').value = tpl.variables || '[]';
              document.getElementById('tplBody').value = tpl.body;
              document.getElementById('tplCategory').value = tpl.category;
              document.getElementById('editModal').classList.remove('hidden');
            }
          ` }} />

        </div>
      </div>
    </Layout>
  )
})

// === API ===

app.post('/api/admin/communicatie/save', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  if (body.id) {
    await execute(db, `
      UPDATE message_templates 
      SET title=?, subject=?, body=?, category=?, variables=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, [body.title, body.subject, body.body, body.category, body.variables, body.id])
  } else {
    await execute(db, `
      INSERT INTO message_templates (title, subject, body, category, variables)
      VALUES (?, ?, ?, ?, ?)
    `, [body.title, body.subject, body.body, body.category, body.variables])
  }

  return c.redirect('/admin/communicatie')
})

app.post('/api/admin/communicatie/delete', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, "DELETE FROM message_templates WHERE id=?", [body.id])
  return c.redirect('/admin/communicatie')
})

export default app
