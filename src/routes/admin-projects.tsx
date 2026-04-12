import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireRole } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware: Require admin or moderator
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// PROJECT DASHBOARD
// =====================================================

app.get('/admin/projects', async (c) => {
  const user = c.get('user') as SessionUser

  // Get all projects with optional event info
  const projects = await queryAll(
    c.env.DB,
    `SELECT p.*, e.titel as event_titel, e.start_at, e.type as event_type,
            (SELECT COUNT(*) FROM concert_project_tasks WHERE project_id = p.id) as total_tasks,
            (SELECT COUNT(*) FROM concert_project_tasks WHERE project_id = p.id AND status = 'done') as completed_tasks
     FROM concert_projects p
     LEFT JOIN events e ON e.id = p.event_id
     ORDER BY p.created_at DESC`
  )

  // Get available events (concerts + other) that can be linked
  const availableEvents = await queryAll(
    c.env.DB,
    `SELECT id, titel, start_at, type 
     FROM events 
     WHERE id NOT IN (SELECT event_id FROM concert_projects WHERE event_id IS NOT NULL)
     ORDER BY start_at DESC`
  )

  return c.html(
    <Layout title="Projecten" user={user}>
      <div class="flex min-h-screen bg-gray-100">
        {/* Sidebar (simplified for brevity, normally imported) */}
        <AdminSidebar activeSection="projects" />

        {/* Main Content */}
        <div class="flex-1 p-8 overflow-y-auto">
          <div class="flex justify-between items-center mb-8">
            <h1 class="text-3xl font-bold text-gray-800" style="font-family: 'Playfair Display', serif;">
              Projecten
            </h1>
          </div>

          {/* Quick Stats */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
              <div class="text-gray-500 text-sm font-semibold uppercase">Lopende Projecten</div>
              <div class="text-3xl font-bold text-gray-800 mt-2">
                {projects.filter((p: any) => p.status === 'in_uitvoering').length}
              </div>
            </div>
            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-500">
              <div class="text-gray-500 text-sm font-semibold uppercase">In Planning</div>
              <div class="text-3xl font-bold text-gray-800 mt-2">
                {projects.filter((p: any) => p.status === 'planning').length}
              </div>
            </div>
            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
              <div class="text-gray-500 text-sm font-semibold uppercase">Afgerond</div>
              <div class="text-3xl font-bold text-gray-800 mt-2">
                {projects.filter((p: any) => p.status === 'afgerond').length}
              </div>
            </div>
          </div>

          {/* Projects List */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden mb-8">
            <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 class="text-lg font-semibold text-gray-700">Projecten Overzicht</h3>
              
              {/* Create Project Modal Trigger */}
              <button onclick="document.getElementById('create-project-modal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-animato-secondary transition text-sm">
                <i class="fas fa-plus mr-2"></i>Nieuw Project Starten
              </button>
            </div>

            {projects.length > 0 ? (
              <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Taken voortgang</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget Balans</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acties</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  {projects.map((project: any) => {
                    const progress = project.total_tasks > 0 
                      ? Math.round((project.completed_tasks / project.total_tasks) * 100) 
                      : 0;
                    
                    const balans = (project.werkelijke_inkomsten || 0) - (project.werkelijke_uitgaven || 0);
                    
                    return (
                      <tr class="hover:bg-gray-50 cursor-pointer" onclick={`window.location.href='/admin/projects/${project.id}'`}>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <div class="flex items-center">
                            <div class={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                              project.categorie === 'concert' ? 'bg-purple-100 text-purple-600' :
                              project.categorie === 'evenement' ? 'bg-blue-100 text-blue-600' :
                              project.categorie === 'organisatie' ? 'bg-amber-100 text-amber-600' :
                              project.categorie === 'financieel' ? 'bg-green-100 text-green-600' :
                              project.categorie === 'communicatie' ? 'bg-pink-100 text-pink-600' :
                              project.categorie === 'materiaal' ? 'bg-indigo-100 text-indigo-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              <i class={`fas ${
                                project.categorie === 'concert' ? 'fa-music' :
                                project.categorie === 'evenement' ? 'fa-calendar-star' :
                                project.categorie === 'organisatie' ? 'fa-bus' :
                                project.categorie === 'financieel' ? 'fa-euro-sign' :
                                project.categorie === 'communicatie' ? 'fa-bullhorn' :
                                project.categorie === 'materiaal' ? 'fa-box' :
                                'fa-tasks'
                              }`}></i>
                            </div>
                            <div class="ml-4">
                              <div class="text-sm font-medium text-gray-900">{project.titel}</div>
                              <div class="text-sm text-gray-500">
                                {project.event_titel ? (
                                  <span><i class="fas fa-link text-xs mr-1"></i>{project.event_titel}</span>
                                ) : (
                                  <span class="italic">Losstaand project</span>
                                )}
                                {project.start_at && (
                                  <span class="ml-2 text-xs">
                                    ({new Date(project.start_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <span class={`px-2 py-1 text-xs rounded-full font-medium ${
                            project.categorie === 'concert' ? 'bg-purple-100 text-purple-700' :
                            project.categorie === 'evenement' ? 'bg-blue-100 text-blue-700' :
                            project.categorie === 'organisatie' ? 'bg-amber-100 text-amber-700' :
                            project.categorie === 'financieel' ? 'bg-green-100 text-green-700' :
                            project.categorie === 'communicatie' ? 'bg-pink-100 text-pink-700' :
                            project.categorie === 'materiaal' ? 'bg-indigo-100 text-indigo-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {project.categorie || 'algemeen'}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <span class={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            project.status === 'in_uitvoering' ? 'bg-blue-100 text-blue-800' :
                            project.status === 'afgerond' ? 'bg-green-100 text-green-800' :
                            project.status === 'geannuleerd' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {project.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap align-middle">
                          <div class="w-full bg-gray-200 rounded-full h-2.5 max-w-[100px]">
                            <div class="bg-blue-600 h-2.5 rounded-full" style={`width: ${progress}%`}></div>
                          </div>
                          <div class="text-xs text-gray-500 mt-1">
                            {project.completed_tasks} / {project.total_tasks} voltooid ({progress}%)
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <div class={`text-sm font-medium ${balans >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {balans >= 0 ? '+' : ''}€ {balans.toFixed(2)}
                          </div>
                          <div class="text-xs text-gray-500">
                            Uit: € {project.werkelijke_uitgaven?.toFixed(2) || '0.00'} | In: € {project.werkelijke_inkomsten?.toFixed(2) || '0.00'}
                          </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <a href={`/admin/projects/${project.id}`} class="text-animato-primary hover:text-animato-secondary mr-3">
                            Beheren <i class="fas fa-arrow-right ml-1"></i>
                          </a>
                          <button onclick={`openDeleteModal('/api/admin/projects/${project.id}/delete')`} class="text-red-600 hover:text-red-800">
                            <i class="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <div class="p-8 text-center text-gray-500">
                <i class="fas fa-clipboard-list text-4xl mb-3 text-gray-300"></i>
                <p>Nog geen projecten gestart.</p>
                <p class="text-sm mt-2">Start een project — gekoppeld aan een concert/event, of losstaand (bijv. busreis, ledenwerving).</p>
                <button onclick="document.getElementById('create-project-modal').classList.remove('hidden')" class="mt-4 bg-animato-primary text-white px-6 py-2 rounded-lg hover:bg-animato-secondary transition">
                  <i class="fas fa-plus mr-2"></i>Start je eerste project
                </button>
              </div>
            )}
          </div>

          {/* Create Project Modal */}
          <div id="create-project-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('create-project-modal').classList.add('hidden')"></div>
              <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                      Start Nieuw Project
                    </h3>
                    <form action="/api/admin/projects/create" method="POST">
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Project Titel</label>
                        <input type="text" name="titel" required placeholder="bv. Organisatie Busreis, Lenteconcert 2026, Ledenwerving..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
                        <select name="categorie" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                          <option value="algemeen">Algemeen</option>
                          <option value="concert">Concert</option>
                          <option value="evenement">Evenement / Uitstap</option>
                          <option value="organisatie">Organisatie (busreis, teambuilding...)</option>
                          <option value="financieel">Financieel (sponsoring, fondsenwerving...)</option>
                          <option value="communicatie">Communicatie (website, flyers...)</option>
                          <option value="materiaal">Materiaal (uniformen, partituren...)</option>
                        </select>
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                          Koppel aan activiteit <span class="text-gray-400 font-normal">(optioneel)</span>
                        </label>
                        <select name="event_id" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                          <option value="">Geen — losstaand project</option>
                          {availableEvents.length > 0 && (
                            <optgroup label="Beschikbare activiteiten">
                              {availableEvents.map((evt: any) => (
                                <option value={evt.id}>
                                  {evt.type === 'concert' ? '🎵' : evt.type === 'repetitie' ? '🎼' : '📅'} {evt.titel} ({new Date(evt.start_at).toLocaleDateString('nl-BE')})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <p class="text-xs text-gray-400 mt-1">Koppel optioneel aan een concert of event uit de agenda</p>
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving <span class="text-gray-400 font-normal">(optioneel)</span></label>
                        <textarea name="beschrijving" rows={2} placeholder="Korte beschrijving van het project..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary"></textarea>
                      </div>
                      <div class="flex justify-end gap-3 mt-6">
                        <button type="button" onclick="document.getElementById('create-project-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                        <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Start Project</button>
                      </div>
                    </form>
                  </div>
                </div>
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
                        Bevestig Verwijderen
                      </h3>
                      <div class="mt-2">
                        <p class="text-sm text-gray-500">
                          Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
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
                window.location.href = deleteUrl;
              }
              closeDeleteModal();
            });
          ` }} />

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// API: CREATE PROJECT
// =====================================================

app.get('/api/admin/projects/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')
  
  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
     VALUES (?, 'project_delete', 'project', ?, ?)`
  ).bind(user.id, id, JSON.stringify({ deleted_by: 'admin' })).run()

  // Delete everything related to project
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM concert_project_tasks WHERE project_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM concert_budget_items WHERE project_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM concert_projects WHERE id = ?').bind(id)
  ])

  return c.redirect('/admin/projects?success=deleted')
})

app.post('/api/admin/projects/create', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  
  try {
    const { titel, categorie, beschrijving } = body
    const event_id = body.event_id ? body.event_id : null
    
    // Create project
    const result = await c.env.DB.prepare(
      `INSERT INTO concert_projects (event_id, titel, categorie, status, beschrijving) 
       VALUES (?, ?, ?, 'planning', ?)`
    ).bind(event_id, titel, categorie || 'algemeen', beschrijving || null).run()

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'project_created', 'project', ?, ?)`
    ).bind(user.id, result.meta.last_row_id, JSON.stringify({ titel, categorie, event_id })).run()

    return c.redirect('/admin/projects?success=created')
  } catch (error) {
    console.error('Create project error:', error)
    return c.redirect('/admin/projects?error=create_failed')
  }
})

// =====================================================
// PROJECT DETAIL
// =====================================================

app.get('/admin/projects/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const projectId = c.req.param('id')
  const tab = c.req.query('tab') || 'dashboard'

  // Get project info
  const project = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, e.titel as event_titel, e.start_at, e.locatie, e.location_id, e.type as event_type
     FROM concert_projects p
     LEFT JOIN events e ON e.id = p.event_id
     WHERE p.id = ?`,
    [projectId]
  )

  if (!project) return c.redirect('/admin/projects?error=not_found')

  // Get tasks
  const tasks = await queryAll(
    c.env.DB,
    `SELECT t.*, u.id as user_id, p.voornaam, p.achternaam
     FROM concert_project_tasks t
     LEFT JOIN users u ON u.id = t.verantwoordelijke_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE t.project_id = ?
     ORDER BY 
       CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END,
       deadline ASC`,
    [projectId]
  )

  // Get budget items
  const budgetItems = await queryAll(
    c.env.DB,
    `SELECT * FROM concert_budget_items WHERE project_id = ? ORDER BY type, created_at`,
    [projectId]
  )

  // Get documents
  const documents = await queryAll(
    c.env.DB,
    `SELECT * FROM concert_project_documents WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  )

  // Get all users for assignment
  const users = await queryAll(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, u.role, u.stemgroep
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief'
     ORDER BY p.voornaam`
  )

  // Get available events for edit dropdown (current project's event + unassigned events)
  const availableEvents = await queryAll(
    c.env.DB,
    `SELECT id, titel, start_at, type 
     FROM events 
     WHERE id NOT IN (SELECT event_id FROM concert_projects WHERE event_id IS NOT NULL AND id != ?)
     ORDER BY start_at DESC`,
    [projectId]
  )

  return c.html(
    <Layout title={`Project: ${project.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-100">
        <aside class="w-64 bg-animato-secondary text-white hidden md:block flex-shrink-0">
           {/* Sidebar reused */}
           <div class="p-6">
            <h2 class="text-2xl font-bold" style="font-family: 'Playfair Display', serif;">Admin</h2>
          </div>
          <nav class="mt-4 px-4 space-y-2">
            <a href="/admin/projects" class="block py-2 px-4 rounded hover:bg-white hover:bg-opacity-10"><i class="fas fa-arrow-left mr-2"></i>Terug naar overzicht</a>
            <div class="border-t border-white border-opacity-20 my-2"></div>
            <a href={`/admin/projects/${projectId}?tab=dashboard`} class={`block py-2 px-4 rounded ${tab === 'dashboard' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-tachometer-alt mr-2"></i>Dashboard
            </a>
            <a href={`/admin/projects/${projectId}?tab=tasks`} class={`block py-2 px-4 rounded ${tab === 'tasks' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-check-double mr-2"></i>Taken
            </a>
            <a href={`/admin/projects/${projectId}?tab=budget`} class={`block py-2 px-4 rounded ${tab === 'budget' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-euro-sign mr-2"></i>Budget
            </a>
            <a href={`/admin/projects/${projectId}?tab=documents`} class={`block py-2 px-4 rounded ${tab === 'documents' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-file-alt mr-2"></i>Documenten
            </a>
          </nav>
        </aside>

        <div class="flex-1 p-8 overflow-y-auto">
          {/* Header */}
          <div class="mb-8">
            <div class="flex items-center justify-between">
               <div>
                  <h1 class="text-3xl font-bold text-gray-800 flex items-center gap-3" style="font-family: 'Playfair Display', serif;">
                    {project.titel}
                    <button onclick="document.getElementById('edit-project-modal').classList.remove('hidden')" class="text-gray-400 hover:text-animato-primary text-xl transition">
                      <i class="fas fa-edit"></i>
                    </button>
                  </h1>
                  <p class="text-gray-600 mt-1 flex items-center flex-wrap gap-2">
                    <span class={`px-2 py-0.5 text-xs rounded-full font-medium ${
                      project.categorie === 'concert' ? 'bg-purple-100 text-purple-700' :
                      project.categorie === 'evenement' ? 'bg-blue-100 text-blue-700' :
                      project.categorie === 'organisatie' ? 'bg-amber-100 text-amber-700' :
                      project.categorie === 'financieel' ? 'bg-green-100 text-green-700' :
                      project.categorie === 'communicatie' ? 'bg-pink-100 text-pink-700' :
                      project.categorie === 'materiaal' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {project.categorie || 'algemeen'}
                    </span>
                    {project.event_titel && (
                      <span>
                        <i class="fas fa-link text-xs mr-1"></i>
                        {project.event_titel}
                      </span>
                    )}
                    {project.start_at && (
                      <span>
                        <i class="fas fa-calendar mr-1"></i>
                        {new Date(project.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    )}
                    {project.locatie && (
                      <span>
                        <i class="fas fa-map-marker-alt mr-1"></i>
                        {project.locatie}
                      </span>
                    )}
                    {!project.event_titel && (
                      <span class="italic text-gray-400">Losstaand project</span>
                    )}
                  </p>
               </div>
               <div class="flex gap-2 items-center">
                  <span class={`px-4 py-2 rounded-full font-bold uppercase text-sm ${
                    project.status === 'in_uitvoering' ? 'bg-blue-100 text-blue-800' :
                    project.status === 'afgerond' ? 'bg-green-100 text-green-800' :
                    project.status === 'geannuleerd' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {project.status.replace('_', ' ')}
                  </span>
                  <button 
                    onclick={`openDeleteModal('/api/admin/projects/${projectId}/delete')`}
                    class="ml-2 bg-red-100 text-red-700 hover:bg-red-200 p-2 rounded-full transition"
                    title="Project verwijderen"
                  >
                    <i class="fas fa-trash"></i>
                  </button>
               </div>
            </div>
          </div>

          {/* Edit Project Modal */}
          <div id="edit-project-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-project-modal').classList.add('hidden')"></div>
              <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                      Project Bewerken
                    </h3>
                    <form action={`/api/admin/projects/${projectId}/update`} method="POST">
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Project Titel</label>
                        <input type="text" name="titel" value={project.titel} required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                      </div>
                      <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
                          <select name="status" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                            <option value="planning" selected={project.status === 'planning'}>In Planning</option>
                            <option value="in_uitvoering" selected={project.status === 'in_uitvoering'}>In Uitvoering</option>
                            <option value="afgerond" selected={project.status === 'afgerond'}>Afgerond</option>
                            <option value="geannuleerd" selected={project.status === 'geannuleerd'}>Geannuleerd</option>
                          </select>
                        </div>
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
                          <select name="categorie" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                            <option value="algemeen" selected={project.categorie === 'algemeen'}>Algemeen</option>
                            <option value="concert" selected={project.categorie === 'concert'}>Concert</option>
                            <option value="evenement" selected={project.categorie === 'evenement'}>Evenement / Uitstap</option>
                            <option value="organisatie" selected={project.categorie === 'organisatie'}>Organisatie</option>
                            <option value="financieel" selected={project.categorie === 'financieel'}>Financieel</option>
                            <option value="communicatie" selected={project.categorie === 'communicatie'}>Communicatie</option>
                            <option value="materiaal" selected={project.categorie === 'materiaal'}>Materiaal</option>
                          </select>
                        </div>
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                          Koppel aan activiteit <span class="text-gray-400 font-normal">(optioneel)</span>
                        </label>
                        <select name="event_id" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                          <option value="">Geen — losstaand project</option>
                          {availableEvents.map((evt: any) => (
                            <option value={evt.id} selected={evt.id === project.event_id}>
                              {evt.type === 'concert' ? '\ud83c\udfb5' : evt.type === 'repetitie' ? '\ud83c\udfbc' : '\ud83d\udcc5'} {evt.titel} ({new Date(evt.start_at).toLocaleDateString('nl-BE')})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div class="flex justify-end gap-3 mt-6">
                        <button type="button" onclick="document.getElementById('edit-project-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                        <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* DASHBOARD TAB */}
          {tab === 'dashboard' && (
            <div class="space-y-6">
               <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Task Stats */}
                  <div class="bg-white p-6 rounded-lg shadow border-t-4 border-blue-500">
                     <h3 class="text-gray-500 text-sm font-semibold uppercase">Taken</h3>
                     <div class="flex items-end mt-2">
                        <span class="text-3xl font-bold text-gray-800">
                           {tasks.filter((t: any) => t.status === 'done').length}
                        </span>
                        <span class="text-gray-500 ml-2 mb-1">/ {tasks.length}</span>
                     </div>
                     <div class="mt-4 w-full bg-gray-200 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full" style={`width: ${tasks.length > 0 ? (tasks.filter((t: any) => t.status === 'done').length / tasks.length) * 100 : 0}%`}></div>
                     </div>
                  </div>

                  {/* Budget Stats */}
                  <div class="bg-white p-6 rounded-lg shadow border-t-4 border-green-500">
                     <h3 class="text-gray-500 text-sm font-semibold uppercase">Budget Resultaat</h3>
                     <div class="flex items-end mt-2">
                        <span class={`text-3xl font-bold ${(project.werkelijke_inkomsten - project.werkelijke_uitgaven) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                           € {(project.werkelijke_inkomsten - project.werkelijke_uitgaven).toFixed(2)}
                        </span>
                     </div>
                     <div class="text-xs text-gray-500 mt-2">
                        Verwacht: € {(project.budget_inkomsten - project.budget_uitgaven).toFixed(2)}
                     </div>
                  </div>
                  
                  {/* Days left */}
                  <div class="bg-white p-6 rounded-lg shadow border-t-4 border-purple-500">
                     <h3 class="text-gray-500 text-sm font-semibold uppercase">
                       {project.start_at ? 'Dagen te gaan' : 'Project Status'}
                     </h3>
                     <div class="mt-2 text-3xl font-bold text-gray-800">
                        {project.start_at 
                          ? Math.ceil((new Date(project.start_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                          : <span class="text-lg capitalize">{(project.status || 'planning').replace('_', ' ')}</span>
                        }
                     </div>
                     <div class="text-xs text-gray-500 mt-2">
                        {project.start_at ? 'Tot eventdatum' : 'Losstaand project — geen einddatum'}
                     </div>
                  </div>
               </div>
               
               {/* Recent Tasks */}
               <div class="bg-white rounded-lg shadow p-6">
                  <h3 class="text-lg font-bold mb-4">Recente Activiteit & Taken</h3>
                  {tasks.slice(0, 5).map((task: any) => (
                    <div class="flex items-center justify-between py-3 border-b last:border-0">
                       <div class="flex items-center">
                          <span class={`w-3 h-3 rounded-full mr-3 ${
                             task.status === 'done' ? 'bg-green-500' : 
                             task.status === 'in_progress' ? 'bg-blue-500' :
                             task.status === 'blocked' ? 'bg-red-500' : 'bg-gray-300'
                          }`}></span>
                          <div>
                             <div class="font-medium text-gray-900">{task.titel}</div>
                             <div class="text-xs text-gray-500">
                                {task.voornaam ? `Verantwoordelijke: ${task.voornaam} ${task.achternaam}` : 'Niet toegewezen'} • 
                                Deadline: {task.deadline ? new Date(task.deadline).toLocaleDateString() : 'Geen'}
                             </div>
                          </div>
                       </div>
                       <span class={`px-2 py-1 text-xs rounded ${
                          task.prioriteit === 'urgent' ? 'bg-red-100 text-red-800' :
                          task.prioriteit === 'hoog' ? 'bg-orange-100 text-orange-800' :
                          'bg-gray-100 text-gray-800'
                       }`}>
                          {task.prioriteit}
                       </span>
                    </div>
                  ))}
                  <div class="mt-4 text-center">
                     <a href={`/admin/projects/${projectId}?tab=tasks`} class="text-animato-primary font-medium hover:underline">Alle taken bekijken</a>
                  </div>
               </div>
            </div>
          )}

          {/* TASKS TAB */}
          {tab === 'tasks' && (
             <div class="space-y-6">
                <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow">
                   <h3 class="text-lg font-bold">Takenlijst</h3>
                   <button onclick="document.getElementById('add-task-modal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-animato-secondary text-sm">
                      <i class="fas fa-plus mr-2"></i>Taak Toevoegen
                   </button>
                </div>
                
                <div class="bg-white rounded-lg shadow overflow-hidden">
                   <table class="min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-50">
                         <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Taak</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wie</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deadline</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prioriteit</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                         </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-200 bg-white">
                         {tasks.map((task: any) => (
                            <tr>
                               <td class="px-6 py-4">
                                  <div class="text-sm font-medium text-gray-900">{task.titel}</div>
                                  {task.beschrijving && <div class="text-xs text-gray-500">{task.beschrijving}</div>}
                               </td>
                               <td class="px-6 py-4 text-sm text-gray-500">
                                  {task.voornaam ? (
                                     <div class="flex items-center">
                                        <div class="w-6 h-6 rounded-full bg-animato-primary text-white flex items-center justify-center text-xs mr-2">
                                           {task.voornaam[0]}{task.achternaam[0]}
                                        </div>
                                        {task.voornaam}
                                     </div>
                                  ) : '-'}
                               </td>
                               <td class="px-6 py-4 text-sm text-gray-500">
                                  {task.deadline ? new Date(task.deadline).toLocaleDateString('nl-BE') : '-'}
                               </td>
                               <td class="px-6 py-4">
                                  <span class={`px-2 py-1 text-xs rounded-full ${
                                     task.prioriteit === 'urgent' ? 'bg-red-100 text-red-800' :
                                     task.prioriteit === 'hoog' ? 'bg-orange-100 text-orange-800' :
                                     task.prioriteit === 'medium' ? 'bg-blue-100 text-blue-800' :
                                     'bg-gray-100 text-gray-800'
                                  }`}>
                                     {task.prioriteit}
                                  </span>
                               </td>
                               <td class="px-6 py-4">
                                  <form action="/api/admin/projects/tasks/status" method="POST" onchange="this.submit()">
                                     <input type="hidden" name="task_id" value={task.id} />
                                     <input type="hidden" name="project_id" value={projectId} />
                                     <select name="status" class={`text-xs rounded border-0 py-1 pl-2 pr-6 ring-1 ring-inset ${
                                        task.status === 'done' ? 'ring-green-600 text-green-700 bg-green-50' : 
                                        task.status === 'blocked' ? 'ring-red-600 text-red-700 bg-red-50' : 
                                        'ring-gray-300 text-gray-700'
                                     }`}>
                                        <option value="todo" selected={task.status === 'todo'}>Te doen</option>
                                        <option value="in_progress" selected={task.status === 'in_progress'}>Bezig</option>
                                        <option value="blocked" selected={task.status === 'blocked'}>Geblokkeerd</option>
                                        <option value="done" selected={task.status === 'done'}>Klaar</option>
                                     </select>
                                  </form>
                               </td>
                               <td class="px-6 py-4 text-right text-sm">
                                  <button 
                                    onclick={`openEditTaskModal(${JSON.stringify(task).replace(/"/g, '&quot;')})`}
                                    class="text-blue-600 hover:text-blue-900 mr-3"
                                  >
                                    <i class="fas fa-edit"></i>
                                  </button>
                                  <button onclick={`openDeleteModal('/api/admin/projects/tasks/${task.id}/delete?project_id=${projectId}')`} class="text-gray-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>

                 {/* Add Task Modal */}
                 <div id="add-task-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                   <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                     <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-task-modal').classList.add('hidden')"></div>
                     <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                     <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                       <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                         <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                           <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                             Nieuwe Taak
                           </h3>
                           <form action="/api/admin/projects/tasks/create" method="POST">
                             <input type="hidden" name="project_id" value={projectId} />
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                               <input type="text" name="titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                               <textarea name="beschrijving" rows="3" placeholder="Geef meer uitleg over deze taak..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary"></textarea>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                               <input type="date" name="deadline" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Toewijzen aan</label>
                               <select name="verantwoordelijke_id" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="">Niemand</option>
                                 {users.map((u: any) => (
                                   <option value={u.id}>{u.voornaam} {u.achternaam} ({u.role})</option>
                                 ))}
                               </select>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Prioriteit</label>
                               <select name="prioriteit" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="laag">Laag</option>
                                 <option value="medium" selected>Medium</option>
                                 <option value="hoog">Hoog</option>
                                 <option value="urgent">Urgent</option>
                               </select>
                             </div>
                             <div class="flex justify-end gap-3 mt-6">
                               <button type="button" onclick="document.getElementById('add-task-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                               <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                             </div>
                           </form>
                         </div>
                       </div>
                     </div>
                   </div>
                 </div>

                 {/* Edit Task Modal */}
                 <div id="edit-task-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                   <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                     <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-task-modal').classList.add('hidden')"></div>
                     <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                     <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                       <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                         <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                           <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                             Taak Bewerken
                           </h3>
                           <form id="edit-task-form" method="POST">
                             <input type="hidden" name="project_id" value={projectId} />
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                               <input type="text" name="titel" id="edit-task-titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                               <textarea name="beschrijving" id="edit-task-beschrijving" rows="2" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary"></textarea>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                               <input type="date" name="deadline" id="edit-task-deadline" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Toewijzen aan</label>
                               <select name="verantwoordelijke_id" id="edit-task-verantwoordelijke" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="">Niemand</option>
                                 {users.map((u: any) => (
                                   <option value={u.id}>{u.voornaam} {u.achternaam} ({u.role})</option>
                                 ))}
                               </select>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Prioriteit</label>
                               <select name="prioriteit" id="edit-task-prioriteit" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="laag">Laag</option>
                                 <option value="medium">Medium</option>
                                 <option value="hoog">Hoog</option>
                                 <option value="urgent">Urgent</option>
                               </select>
                             </div>
                             <div class="flex justify-end gap-3 mt-6">
                               <button type="button" onclick="document.getElementById('edit-task-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                               <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                             </div>
                           </form>
                         </div>
                       </div>
                     </div>
                   </div>
                 </div>
             </div>
          )}

          {/* BUDGET TAB */}
          {tab === 'budget' && (
             <div class="space-y-6">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div class="bg-white p-6 rounded-lg shadow">
                      <h3 class="text-gray-500 text-sm font-semibold uppercase mb-4">Inkomsten</h3>
                      <div class="flex justify-between items-end mb-2">
                         <span class="text-3xl font-bold text-green-600">€ {project.werkelijke_inkomsten?.toFixed(2) || '0.00'}</span>
                         <span class="text-sm text-gray-500">van verwacht € {project.budget_inkomsten?.toFixed(2) || '0.00'}</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                         <div class="bg-green-500 h-2 rounded-full" style={`width: ${Math.min((project.werkelijke_inkomsten / (project.budget_inkomsten || 1)) * 100, 100)}%`}></div>
                      </div>
                   </div>
                   <div class="bg-white p-6 rounded-lg shadow">
                      <h3 class="text-gray-500 text-sm font-semibold uppercase mb-4">Uitgaven</h3>
                      <div class="flex justify-between items-end mb-2">
                         <span class="text-3xl font-bold text-red-600">€ {project.werkelijke_uitgaven?.toFixed(2) || '0.00'}</span>
                         <span class="text-sm text-gray-500">van budget € {project.budget_uitgaven?.toFixed(2) || '0.00'}</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                         <div class="bg-red-500 h-2 rounded-full" style={`width: ${Math.min((project.werkelijke_uitgaven / (project.budget_uitgaven || 1)) * 100, 100)}%`}></div>
                      </div>
                   </div>
                </div>

                <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow">
                   <h3 class="text-lg font-bold">Budget Items</h3>
                   <button onclick="document.getElementById('add-budget-modal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-animato-secondary text-sm">
                      <i class="fas fa-plus mr-2"></i>Item Toevoegen
                   </button>
                </div>

                <div class="bg-white rounded-lg shadow overflow-hidden">
                   <table class="min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-50">
                         <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Omschrijving</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Verwacht</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Werkelijk</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Betaald</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                         </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-200 bg-white">
                         {budgetItems.map((item: any) => (
                            <tr>
                               <td class="px-6 py-4">
                                  <span class={`px-2 py-1 text-xs rounded ${item.type === 'inkomst' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                     {item.type}
                                  </span>
                               </td>
                               <td class="px-6 py-4">
                                  <div class="text-sm font-medium text-gray-900">{item.omschrijving}</div>
                                  <div class="text-xs text-gray-500">{item.categorie}</div>
                               </td>
                               <td class="px-6 py-4 text-right text-sm text-gray-500">€ {item.verwacht_bedrag.toFixed(2)}</td>
                               <td class="px-6 py-4 text-right text-sm font-medium text-gray-900">€ {item.werkelijk_bedrag.toFixed(2)}</td>
                               <td class="px-6 py-4 text-center">
                                  {item.betaald ? <i class="fas fa-check text-green-500"></i> : <i class="fas fa-clock text-yellow-500"></i>}
                               </td>
                               <td class="px-6 py-4 text-right">
                                  <button 
                                    onclick={`openEditBudgetModal(${JSON.stringify(item).replace(/"/g, '&quot;')})`}
                                    class="text-blue-600 hover:text-blue-900 mr-3"
                                  >
                                    <i class="fas fa-edit"></i>
                                  </button>
                                  <button onclick={`openDeleteModal('/api/admin/projects/budget/${item.id}/delete?project_id=${projectId}')`} class="text-gray-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>

                {/* Add Budget Modal */}
                <div id="add-budget-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                   <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                     <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-budget-modal').classList.add('hidden')"></div>
                     <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                     <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                       <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                         <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                           <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                             Budget Item Toevoegen
                           </h3>
                           <form action="/api/admin/projects/budget/create" method="POST">
                             <input type="hidden" name="project_id" value={projectId} />
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                               <select name="type" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="uitgave">Uitgave</option>
                                 <option value="inkomst">Inkomst</option>
                               </select>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Omschrijving</label>
                               <input type="text" name="omschrijving" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
                               <input type="text" name="categorie" placeholder="bv. Catering, Marketing" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Verwacht Bedrag (€)</label>
                               <input type="number" step="0.01" name="verwacht_bedrag" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="flex justify-end gap-3 mt-6">
                               <button type="button" onclick="document.getElementById('add-budget-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                               <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                             </div>
                           </form>
                         </div>
                       </div>
                     </div>
                   </div>
                 </div>

                 {/* Edit Budget Modal */}
                 <div id="edit-budget-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                   <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                     <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-budget-modal').classList.add('hidden')"></div>
                     <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                     <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                       <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                         <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                           <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                             Budget Item Bewerken
                           </h3>
                           <form id="edit-budget-form" method="POST">
                             <input type="hidden" name="project_id" value={projectId} />
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                               <select name="type" id="edit-budget-type" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="uitgave">Uitgave</option>
                                 <option value="inkomst">Inkomst</option>
                               </select>
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Omschrijving</label>
                               <input type="text" name="omschrijving" id="edit-budget-omschrijving" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
                               <input type="text" name="categorie" id="edit-budget-categorie" placeholder="bv. Catering, Marketing" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="grid grid-cols-2 gap-4 mb-3">
                               <div>
                                 <label class="block text-sm font-medium text-gray-700 mb-1">Verwacht (€)</label>
                                 <input type="number" step="0.01" name="verwacht_bedrag" id="edit-budget-verwacht" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                               </div>
                               <div>
                                 <label class="block text-sm font-medium text-gray-700 mb-1">Werkelijk (€)</label>
                                 <input type="number" step="0.01" name="werkelijk_bedrag" id="edit-budget-werkelijk" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                               </div>
                             </div>
                             <div class="mb-3 flex items-center bg-gray-50 p-3 rounded-lg">
                               <input type="checkbox" name="betaald" id="edit-budget-betaald" class="h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded" />
                               <label for="edit-budget-betaald" class="ml-2 block text-sm text-gray-900 font-medium">Reeds betaald / ontvangen</label>
                             </div>
                             <div class="mb-3" id="edit-budget-betaaldatum-container">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Betaaldatum</label>
                               <input type="date" name="betaaldatum" id="edit-budget-betaaldatum" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             
                             <div class="flex justify-end gap-3 mt-6">
                               <button type="button" onclick="document.getElementById('edit-budget-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                               <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                             </div>
                           </form>
                         </div>
                       </div>
                     </div>
                   </div>
                 </div>
             </div>
          )}

          {/* DOCUMENTS TAB */}
          {tab === 'documents' && (
             <div class="space-y-6">
                <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow">
                   <h3 class="text-lg font-bold">Project Documenten</h3>
                   <button onclick="document.getElementById('add-document-modal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-animato-secondary text-sm">
                      <i class="fas fa-plus mr-2"></i>Document Toevoegen
                   </button>
                </div>

                <div class="bg-white rounded-lg shadow overflow-hidden">
                   {documents.length > 0 ? (
                     <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                           <tr>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Naam</th>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                           </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 bg-white">
                           {documents.map((doc: any) => (
                              <tr>
                                 <td class="px-6 py-4">
                                    <div class="flex items-center">
                                      <i class={`fas fa-file-${doc.file_type === 'pdf' ? 'pdf text-red-500' : doc.file_type === 'doc' ? 'word text-blue-500' : doc.file_type === 'excel' ? 'excel text-green-500' : 'alt text-gray-400'} mr-3 text-lg`}></i>
                                      <div class="text-sm font-medium text-gray-900">
                                        <a href={doc.file_url} target="_blank" class="hover:text-animato-primary hover:underline">{doc.name}</a>
                                      </div>
                                    </div>
                                 </td>
                                 <td class="px-6 py-4 text-sm text-gray-500 uppercase">{doc.file_type}</td>
                                 <td class="px-6 py-4 text-sm text-gray-500">
                                    {new Date(doc.created_at).toLocaleDateString('nl-BE')}
                                 </td>
                                 <td class="px-6 py-4 text-right">
                                    <a href={doc.file_url} target="_blank" class="text-blue-600 hover:text-blue-900 mr-3">
                                      <i class="fas fa-external-link-alt"></i>
                                    </a>
                                    <button onclick={`openDeleteModal('/api/admin/projects/documents/${doc.id}/delete?project_id=${projectId}')`} class="text-gray-400 hover:text-red-600">
                                      <i class="fas fa-trash"></i>
                                    </button>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                   ) : (
                     <div class="p-8 text-center text-gray-500">
                       <i class="fas fa-folder-open text-4xl mb-3 text-gray-300"></i>
                       <p>Nog geen documenten toegevoegd.</p>
                     </div>
                   )}
                </div>

                {/* Add Document Modal */}
                <div id="add-document-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                   <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                     <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-document-modal').classList.add('hidden')"></div>
                     <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                     <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                       <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                         <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                           <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                             Document Toevoegen
                           </h3>
                           <form action="/api/admin/projects/documents/create" method="POST">
                             <input type="hidden" name="project_id" value={projectId} />
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Naam Document</label>
                               <input type="text" name="name" required placeholder="bv. Draaiboek Lenteconcert" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">URL / Link</label>
                               <input type="url" name="file_url" required placeholder="https://..." class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                             </div>
                             <div class="mb-3">
                               <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                               <select name="file_type" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                 <option value="link">Link</option>
                                 <option value="pdf">PDF</option>
                                 <option value="doc">Word / Doc</option>
                                 <option value="excel">Excel / Sheet</option>
                                 <option value="image">Afbeelding</option>
                                 <option value="other">Anders</option>
                               </select>
                             </div>
                             <div class="flex justify-end gap-3 mt-6">
                               <button type="button" onclick="document.getElementById('add-document-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                               <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                             </div>
                           </form>
                         </div>
                       </div>
                     </div>
                   </div>
                 </div>
             </div>
          )}

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
                        Bevestig Verwijderen
                      </h3>
                      <div class="mt-2">
                        <p class="text-sm text-gray-500">
                          Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
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
            let deleteUrl = null;

            function openDeleteModal(url) {
              deleteUrl = url;
              document.getElementById('deleteModal').classList.remove('hidden');
            }

            function closeDeleteModal() {
              deleteUrl = null;
              document.getElementById('deleteModal').classList.add('hidden');
            }

            function openEditTaskModal(task) {
              document.getElementById('edit-task-form').action = '/api/admin/projects/tasks/' + task.id + '/update';
              document.getElementById('edit-task-titel').value = task.titel;
              document.getElementById('edit-task-beschrijving').value = task.beschrijving || '';
              document.getElementById('edit-task-deadline').value = task.deadline ? task.deadline.split('T')[0] : '';
              
              const respSelect = document.getElementById('edit-task-verantwoordelijke');
              if (respSelect) respSelect.value = task.verantwoordelijke_id || '';
              
              const priorSelect = document.getElementById('edit-task-prioriteit');
              if (priorSelect) priorSelect.value = task.prioriteit || 'medium';
              
              document.getElementById('edit-task-modal').classList.remove('hidden');
            }

            function openEditBudgetModal(item) {
              document.getElementById('edit-budget-form').action = '/api/admin/projects/budget/' + item.id + '/update';
              document.getElementById('edit-budget-type').value = item.type;
              document.getElementById('edit-budget-omschrijving').value = item.omschrijving;
              document.getElementById('edit-budget-categorie').value = item.categorie;
              document.getElementById('edit-budget-verwacht').value = item.verwacht_bedrag;
              document.getElementById('edit-budget-werkelijk').value = item.werkelijk_bedrag || 0;
              document.getElementById('edit-budget-betaald').checked = !!item.betaald;
              document.getElementById('edit-budget-betaaldatum').value = item.betaaldatum ? item.betaaldatum.split('T')[0] : '';
              
              document.getElementById('edit-budget-modal').classList.remove('hidden');
            }

            document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
              if (deleteUrl) {
                window.location.href = deleteUrl;
              }
              closeDeleteModal();
            });
          ` }} />

        </div>
      </div>
    </Layout>
  )
})

app.post('/api/admin/projects/:id/update', async (c) => {
  const projectId = c.req.param('id')
  const body = await c.req.parseBody()
  const { titel, status, categorie } = body
  const event_id = body.event_id ? body.event_id : null
  
  await c.env.DB.prepare(
    `UPDATE concert_projects SET titel = ?, status = ?, event_id = ?, categorie = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(titel, status, event_id, categorie || 'algemeen', projectId).run()

  return c.redirect(`/admin/projects/${projectId}?tab=dashboard`)
})

// =====================================================
// API: DOCUMENTS
// =====================================================

app.post('/api/admin/projects/documents/create', async (c) => {
  const body = await c.req.parseBody()
  const { project_id, name, file_url, file_type } = body
  
  await c.env.DB.prepare(
    `INSERT INTO concert_project_documents (project_id, name, file_url, file_type)
     VALUES (?, ?, ?, ?)`
  ).bind(project_id, name, file_url, file_type).run()

  return c.redirect(`/admin/projects/${project_id}?tab=documents`)
})

app.get('/api/admin/projects/documents/:id/delete', async (c) => {
  const id = c.req.param('id')
  const projectId = c.req.query('project_id')
  
  await c.env.DB.prepare('DELETE FROM concert_project_documents WHERE id = ?').bind(id).run()
  return c.redirect(`/admin/projects/${projectId}?tab=documents`)
})

// =====================================================
// API: TASKS & BUDGET
// =====================================================

app.post('/api/admin/projects/tasks/create', async (c) => {
  const body = await c.req.parseBody()
  const { project_id, titel, beschrijving, deadline, verantwoordelijke_id, prioriteit } = body
  
  await c.env.DB.prepare(
    `INSERT INTO concert_project_tasks (project_id, titel, beschrijving, deadline, verantwoordelijke_id, prioriteit)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(project_id, titel, beschrijving || null, deadline || null, verantwoordelijke_id || null, prioriteit).run()

  return c.redirect(`/admin/projects/${project_id}?tab=tasks`)
})

app.post('/api/admin/projects/tasks/status', async (c) => {
  const body = await c.req.parseBody()
  const { task_id, project_id, status } = body
  
  await c.env.DB.prepare(
    `UPDATE concert_project_tasks SET status = ? WHERE id = ?`
  ).bind(status, task_id).run()

  return c.redirect(`/admin/projects/${project_id}?tab=tasks`)
})

app.post('/api/admin/projects/budget/create', async (c) => {
  const body = await c.req.parseBody()
  const { project_id, type, omschrijving, categorie, verwacht_bedrag } = body
  
  // Insert item
  await c.env.DB.prepare(
    `INSERT INTO concert_budget_items (project_id, type, omschrijving, categorie, verwacht_bedrag)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(project_id, type, omschrijving, categorie, verwacht_bedrag).run()

  // Update project totals
  if (type === 'inkomst') {
    await c.env.DB.prepare(`UPDATE concert_projects SET budget_inkomsten = budget_inkomsten + ? WHERE id = ?`).bind(verwacht_bedrag, project_id).run()
  } else {
    await c.env.DB.prepare(`UPDATE concert_projects SET budget_uitgaven = budget_uitgaven + ? WHERE id = ?`).bind(verwacht_bedrag, project_id).run()
  }

  return c.redirect(`/admin/projects/${project_id}?tab=budget`)
})

app.get('/api/admin/projects/tasks/:id/delete', async (c) => {
  const id = c.req.param('id')
  const projectId = c.req.query('project_id')
  
  await c.env.DB.prepare('DELETE FROM concert_project_tasks WHERE id = ?').bind(id).run()
  return c.redirect(`/admin/projects/${projectId}?tab=tasks`)
})

app.get('/api/admin/projects/budget/:id/delete', async (c) => {
  const id = c.req.param('id')
  const projectId = c.req.query('project_id')
  
  // Get item to update totals
  const item = await queryOne<any>(c.env.DB, 'SELECT * FROM concert_budget_items WHERE id = ?', [id])
  
  if (item) {
    await c.env.DB.prepare('DELETE FROM concert_budget_items WHERE id = ?').bind(id).run()
    
    // Update totals
    if (item.type === 'inkomst') {
      await c.env.DB.prepare('UPDATE concert_projects SET budget_inkomsten = budget_inkomsten - ? WHERE id = ?').bind(item.verwacht_bedrag, projectId).run()
    } else {
      await c.env.DB.prepare('UPDATE concert_projects SET budget_uitgaven = budget_uitgaven - ? WHERE id = ?').bind(item.verwacht_bedrag, projectId).run()
    }
  }
  
  return c.redirect(`/admin/projects/${projectId}?tab=budget`)
})

app.post('/api/admin/projects/tasks/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const { project_id, titel, deadline, verantwoordelijke_id, prioriteit, beschrijving } = body
  
  await c.env.DB.prepare(
    `UPDATE concert_project_tasks 
     SET titel = ?, deadline = ?, verantwoordelijke_id = ?, prioriteit = ?, beschrijving = ?
     WHERE id = ?`
  ).bind(titel, deadline || null, verantwoordelijke_id || null, prioriteit, beschrijving, id).run()

  return c.redirect(`/admin/projects/${project_id}?tab=tasks`)
})

app.post('/api/admin/projects/budget/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const { project_id, type, omschrijving, categorie, verwacht_bedrag, werkelijk_bedrag, betaald, betaaldatum } = body

  // Get old item to adjust totals
  const oldItem = await queryOne<any>(c.env.DB, 'SELECT * FROM concert_budget_items WHERE id = ?', [id])
  
  if (oldItem) {
    // Update item
    await c.env.DB.prepare(
      `UPDATE concert_budget_items 
       SET type = ?, omschrijving = ?, categorie = ?, verwacht_bedrag = ?, werkelijk_bedrag = ?, betaald = ?, betaaldatum = ?
       WHERE id = ?`
    ).bind(type, omschrijving, categorie, verwacht_bedrag, werkelijk_bedrag || 0, betaald ? 1 : 0, betaaldatum || null, id).run()

    // Adjust project totals
    // 1. Revert old values
    if (oldItem.type === 'inkomst') {
      await c.env.DB.prepare('UPDATE concert_projects SET budget_inkomsten = budget_inkomsten - ?, werkelijke_inkomsten = werkelijke_inkomsten - ? WHERE id = ?')
        .bind(oldItem.verwacht_bedrag, oldItem.werkelijk_bedrag || 0, project_id).run()
    } else {
      await c.env.DB.prepare('UPDATE concert_projects SET budget_uitgaven = budget_uitgaven - ?, werkelijke_uitgaven = werkelijke_uitgaven - ? WHERE id = ?')
        .bind(oldItem.verwacht_bedrag, oldItem.werkelijk_bedrag || 0, project_id).run()
    }

    // 2. Add new values
    if (type === 'inkomst') {
       await c.env.DB.prepare('UPDATE concert_projects SET budget_inkomsten = budget_inkomsten + ?, werkelijke_inkomsten = werkelijke_inkomsten + ? WHERE id = ?')
        .bind(verwacht_bedrag, werkelijk_bedrag || 0, project_id).run()
    } else {
       await c.env.DB.prepare('UPDATE concert_projects SET budget_uitgaven = budget_uitgaven + ?, werkelijke_uitgaven = werkelijke_uitgaven + ? WHERE id = ?')
        .bind(verwacht_bedrag, werkelijk_bedrag || 0, project_id).run()
    }
  }

  return c.redirect(`/admin/projects/${project_id}?tab=budget`)
})

export default app
