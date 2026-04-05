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
// MEETINGS DASHBOARD
// =====================================================

app.get('/admin/meetings', async (c) => {
  const user = c.get('user') as SessionUser

  // Get upcoming meetings
  const upcomingMeetings = await queryAll(
    c.env.DB,
    `SELECT m.*, datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) as start_at,
            (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id AND status = 'aanwezig') as present_count,
            (SELECT COUNT(*) FROM meeting_agenda_items WHERE meeting_id = m.id) as agenda_count
     FROM meetings m
     WHERE datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) >= datetime('now')
     ORDER BY m.datum ASC, m.start_tijd ASC`
  )

  // Get past meetings
  const pastMeetings = await queryAll(
    c.env.DB,
    `SELECT m.*, datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) as start_at,
            (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id AND status = 'present') as present_count
     FROM meetings m
     WHERE datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) < datetime('now')
     ORDER BY m.datum DESC, m.start_tijd DESC
     LIMIT 10`
  )

  // Get open action items across all meetings
  const openActions = await queryAll(
    c.env.DB,
    `SELECT a.*, m.titel as meeting_titel, datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) as meeting_date,
            u.id as user_id, p.voornaam, p.achternaam
     FROM meeting_action_items a
     JOIN meetings m ON m.id = a.meeting_id
     LEFT JOIN users u ON u.id = a.verantwoordelijke_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE a.status != 'done'
     ORDER BY a.deadline ASC`
  )

  return c.html(
    <Layout title="Vergaderingen" user={user}>
      <div class="flex min-h-screen bg-gray-100">
        {/* Sidebar */}
        <AdminSidebar activeSection="meetings" />

        {/* Main Content */}
        <div class="flex-1 p-8 overflow-y-auto">
          <div class="flex justify-between items-center mb-8">
            <h1 class="text-3xl font-bold text-gray-800" style="font-family: 'Playfair Display', serif;">
              Vergaderingen
            </h1>
            <button onclick="document.getElementById('create-meeting-modal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:bg-animato-secondary transition shadow-md">
              <i class="fas fa-plus mr-2"></i>Nieuwe Vergadering
            </button>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Meetings */}
            <div class="lg:col-span-2 space-y-8">
              
              {/* Upcoming Meetings */}
              <div class="bg-white rounded-lg shadow-md overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <h3 class="text-lg font-semibold text-gray-700">Aankomende Vergaderingen</h3>
                  <span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">{upcomingMeetings.length}</span>
                </div>
                {upcomingMeetings.length > 0 ? (
                  <div class="divide-y divide-gray-200">
                    {upcomingMeetings.map((meeting: any) => (
                      <div class="p-6 hover:bg-gray-50 transition">
                        <div class="flex justify-between items-start">
                          <div>
                            <h4 class="text-xl font-bold text-gray-900 mb-1">
                              <a href={`/admin/meetings/${meeting.id}`} class="hover:text-animato-primary">{meeting.titel}</a>
                            </h4>
                            <div class="text-sm text-gray-600 mb-2">
                              <i class="far fa-calendar-alt mr-2 w-4"></i>
                              {new Date(meeting.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                              <span class="mx-2">|</span>
                              <i class="far fa-clock mr-2 w-4"></i>
                              {new Date(meeting.start_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div class="text-sm text-gray-500">
                              <i class="fas fa-map-marker-alt mr-2 w-4"></i>
                              {meeting.locatie || 'Geen locatie'}
                            </div>
                          </div>
                          <div class="flex flex-col items-end gap-2">
                            <span class={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${
                              meeting.status === 'gepland' ? 'bg-blue-100 text-blue-800' :
                              meeting.status === 'bezig' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {meeting.status}
                            </span>
                            <a href={`/admin/meetings/${meeting.id}`} class="text-animato-primary text-sm hover:underline">
                              Details <i class="fas fa-arrow-right ml-1"></i>
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div class="p-8 text-center text-gray-500">
                    <p>Geen geplande vergaderingen.</p>
                  </div>
                )}
              </div>

              {/* Past Meetings */}
              <div class="bg-white rounded-lg shadow-md overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <h3 class="text-lg font-semibold text-gray-700">Afgelopen Vergaderingen</h3>
                </div>
                {pastMeetings.length > 0 ? (
                  <div class="divide-y divide-gray-200">
                    {pastMeetings.map((meeting: any) => (
                      <div class="p-4 hover:bg-gray-50 transition flex justify-between items-center">
                        <div>
                          <div class="font-medium text-gray-900">{meeting.titel}</div>
                          <div class="text-sm text-gray-500">
                            {new Date(meeting.start_at).toLocaleDateString('nl-BE')}
                          </div>
                        </div>
                        <a href={`/admin/meetings/${meeting.id}`} class="text-gray-400 hover:text-animato-primary">
                          <i class="fas fa-chevron-right"></i>
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div class="p-6 text-center text-gray-500 text-sm">
                    <p>Geen historiek beschikbaar.</p>
                  </div>
                )}
              </div>

            </div>

            {/* Right Column: Action Items */}
            <div class="lg:col-span-1">
              <div class="bg-white rounded-lg shadow-md overflow-hidden h-full">
                <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <h3 class="text-lg font-semibold text-gray-700">Openstaande Actiepunten</h3>
                </div>
                <div class="overflow-y-auto max-h-[600px]">
                  {openActions.length > 0 ? (
                    <div class="divide-y divide-gray-200">
                      {openActions.map((action: any) => (
                        <div class="p-4 hover:bg-gray-50 transition">
                          <div class="flex items-start gap-3">
                            <div class={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                              action.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-400'
                            }`}></div>
                            <div>
                              <p class="text-sm font-medium text-gray-900">{action.beschrijving}</p>
                              <div class="flex items-center gap-2 mt-1">
                                {action.voornaam && (
                                  <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                    {action.voornaam} {action.achternaam?.charAt(0)}.
                                  </span>
                                )}
                                <span class="text-xs text-gray-400">
                                  {action.deadline ? `DL: ${new Date(action.deadline).toLocaleDateString('nl-BE', {day: 'numeric', month: 'numeric'})}` : ''}
                                </span>
                              </div>
                              <div class="text-xs text-gray-400 mt-1">
                                Uit: {action.meeting_titel}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div class="p-8 text-center text-gray-500">
                      <i class="fas fa-check-circle text-4xl text-green-100 mb-3 block"></i>
                      <p>Alles is afgehandeld!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Create Meeting Modal */}
          <div id="create-meeting-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('create-meeting-modal').classList.add('hidden')"></div>
              <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                      Nieuwe Vergadering
                    </h3>
                    <form action="/api/admin/meetings/create" method="POST">
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                        <input type="text" name="titel" required placeholder="bv. Bestuursvergadering Januari" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                        <select name="type" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                          <option value="bestuur">Bestuursvergadering</option>
                          <option value="algemeen">Algemene Vergadering</option>
                          <option value="werkgroep">Werkgroep</option>
                          <option value="anders">Anders</option>
                        </select>
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Datum & Tijd</label>
                        <input type="datetime-local" name="start_at" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                      </div>
                      <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Locatie</label>
                        <input type="text" name="locatie" placeholder="bv. Parochiezaal of Zoom" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                      </div>
                      <div class="flex justify-end gap-3 mt-6">
                        <button type="button" onclick="document.getElementById('create-meeting-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                        <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Aanmaken</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// MEETING DETAIL
// =====================================================

app.get('/admin/meetings/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const meetingId = c.req.param('id')
  const tab = c.req.query('tab') || 'agenda'

  // Get meeting details
  const meeting = await queryOne<any>(
    c.env.DB,
    `SELECT *, datetime(datum || ' ' || COALESCE(start_tijd, '00:00')) as start_at FROM meetings WHERE id = ?`,
    [meetingId]
  )

  if (!meeting) return c.redirect('/admin/meetings?error=not_found')

  // Get participants
  const participants = await queryAll(
    c.env.DB,
    `SELECT mp.*, u.email, p.voornaam, p.achternaam, u.role
     FROM meeting_participants mp
     JOIN users u ON u.id = mp.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE mp.meeting_id = ?
     ORDER BY p.achternaam`,
    [meetingId]
  )

  // Get agenda items
  const agendaItems = await queryAll(
    c.env.DB,
    `SELECT * FROM meeting_agenda_items WHERE meeting_id = ? ORDER BY volgorde ASC`,
    [meetingId]
  )

  // Get minutes
  const minutes = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM meeting_minutes WHERE meeting_id = ?`,
    [meetingId]
  )

  // Get action items
  const actionItems = await queryAll(
    c.env.DB,
    `SELECT a.*, p.voornaam, p.achternaam
     FROM meeting_action_items a
     LEFT JOIN users u ON u.id = a.verantwoordelijke_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE a.meeting_id = ?
     ORDER BY a.created_at DESC`,
    [meetingId]
  )
  
  // Get all users for assignment
  const users = await queryAll(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, u.role
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief'
     ORDER BY p.voornaam`
  )

  return c.html(
    <Layout title={`Vergadering: ${meeting.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-100">
        <aside class="w-64 bg-animato-secondary text-white hidden md:block flex-shrink-0">
          <div class="p-6">
            <h2 class="text-2xl font-bold" style="font-family: 'Playfair Display', serif;">Admin</h2>
          </div>
          <nav class="mt-4 px-4 space-y-2">
            <a href="/admin/meetings" class="block py-2 px-4 rounded hover:bg-white hover:bg-opacity-10"><i class="fas fa-arrow-left mr-2"></i>Terug naar overzicht</a>
            <div class="border-t border-white border-opacity-20 my-2"></div>
            <a href={`/admin/meetings/${meetingId}?tab=agenda`} class={`block py-2 px-4 rounded ${tab === 'agenda' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-list-ol mr-2"></i>Agenda
            </a>
            <a href={`/admin/meetings/${meetingId}?tab=minutes`} class={`block py-2 px-4 rounded ${tab === 'minutes' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-pen-fancy mr-2"></i>Notulen
            </a>
            <a href={`/admin/meetings/${meetingId}?tab=actions`} class={`block py-2 px-4 rounded ${tab === 'actions' ? 'bg-white bg-opacity-20 font-semibold' : 'hover:bg-white hover:bg-opacity-10'}`}>
              <i class="fas fa-check-square mr-2"></i>Actiepunten
            </a>
          </nav>
        </aside>

        <div class="flex-1 p-8 overflow-y-auto">
          {/* Header */}
          <div class="mb-8">
             <div class="flex justify-between items-start">
               <div>
                 <h1 class="text-3xl font-bold text-gray-800" style="font-family: 'Playfair Display', serif;">
                    {meeting.titel}
                    <button onclick="document.getElementById('edit-meeting-modal').classList.remove('hidden')" class="ml-3 text-gray-400 hover:text-animato-primary text-xl">
                      <i class="fas fa-edit"></i>
                    </button>
                 </h1>
                 <p class="text-gray-600 mt-2 flex items-center gap-4">
                    <span><i class="far fa-calendar-alt mr-2"></i>{new Date(meeting.start_at).toLocaleDateString('nl-BE')}</span>
                    <span><i class="far fa-clock mr-2"></i>{new Date(meeting.start_at).toLocaleTimeString('nl-BE', {hour: '2-digit', minute:'2-digit'})}</span>
                    <span><i class="fas fa-map-marker-alt mr-2"></i>{meeting.locatie}</span>
                 </p>
               </div>
               <div class="flex gap-2">
                  {meeting.status !== 'afgerond' && (
                    <form action="/api/admin/meetings/status" method="POST">
                       <input type="hidden" name="meeting_id" value={meetingId} />
                       <input type="hidden" name="status" value="afgerond" />
                       <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition shadow">
                          <i class="fas fa-check mr-2"></i>Afronden
                       </button>
                    </form>
                  )}
                  <button 
                    onclick={`openDeleteModal('delete-meeting-form')`}
                    class="bg-red-100 text-red-700 px-4 py-2 rounded hover:bg-red-200 transition shadow"
                    title="Vergadering verwijderen"
                  >
                    <i class="fas fa-trash"></i>
                  </button>
                  <form id="delete-meeting-form" action={`/api/admin/meetings/${meetingId}/delete`} method="POST" class="hidden"></form>
               </div>
             </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Left: Main Content (Tabs) */}
             <div class="lg:col-span-2 space-y-6">
                
                {/* AGENDA TAB */}
                {tab === 'agenda' && (
                   <div class="bg-white rounded-lg shadow-md p-6">
                      <div class="flex justify-between items-center mb-6">
                         <h2 class="text-xl font-bold text-gray-800">Agenda</h2>
                         <button onclick="document.getElementById('add-agenda-modal').classList.remove('hidden')" class="text-animato-primary hover:text-animato-secondary">
                            <i class="fas fa-plus-circle mr-1"></i> Punt toevoegen
                         </button>
                      </div>

                      {agendaItems.length > 0 ? (
                         <div class="space-y-4">
                            {agendaItems.map((item: any, index: number) => (
                               <div class="flex items-start gap-4 p-4 border rounded-lg bg-gray-50">
                                  <div class="flex-shrink-0 w-8 h-8 bg-white border rounded-full flex items-center justify-center font-bold text-gray-500">
                                     {index + 1}
                                  </div>
                                  <div class="flex-1">
                                     <h4 class="font-semibold text-gray-900">{item.titel}</h4>
                                     {item.beschrijving && <p class="text-sm text-gray-600 mt-1">{item.beschrijving}</p>}
                                     <div class="flex gap-3 mt-2 text-xs text-gray-500">
                                        {item.duration_minutes && <span><i class="far fa-clock mr-1"></i>{item.duration_minutes} min</span>}
                                        {item.presenter && <span><i class="far fa-user mr-1"></i>{item.presenter}</span>}
                                     </div>
                                  </div>
                                  <form id={`delete-agenda-${item.id}`} action={`/api/admin/meetings/agenda/${item.id}/delete`} method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)">
                                    <input type="hidden" name="meeting_id" value={meetingId} />
                                    <button type="submit" class="text-gray-400 hover:text-red-500"><i class="fas fa-trash"></i></button>
                                  </form>
                               </div>
                            ))}
                         </div>
                      ) : (
                         <div class="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                            Nog geen agendapunten.
                         </div>
                      )}

                      {/* Add Agenda Modal */}
                      <div id="add-agenda-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                          <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-agenda-modal').classList.add('hidden')"></div>
                          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                          <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                              <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                                <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                                  Agendapunt Toevoegen
                                </h3>
                                <form action="/api/admin/meetings/agenda/create" method="POST">
                                  <input type="hidden" name="meeting_id" value={meetingId} />
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                                    <input type="text" name="titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                                    <textarea name="beschrijving" rows={2} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary"></textarea>
                                  </div>
                                  <div class="flex gap-4 mb-3">
                                     <div class="flex-1">
                                       <label class="block text-sm font-medium text-gray-700 mb-1">Duur (min)</label>
                                       <input type="number" name="duration" value="15" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                     </div>
                                     <div class="flex-1">
                                       <label class="block text-sm font-medium text-gray-700 mb-1">Spreker</label>
                                       <select name="presenter" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                         <option value="">Selecteer...</option>
                                         {users.map((u: any) => (
                                           <option value={u.id}>{u.voornaam} {u.achternaam}</option>
                                         ))}
                                       </select>
                                     </div>
                                  </div>
                                  <div class="flex justify-end gap-3 mt-6">
                                    <button type="button" onclick="document.getElementById('add-agenda-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                                    <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Toevoegen</button>
                                  </div>
                                </form>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                   </div>
                )}

                {/* MINUTES TAB */}
                {tab === 'minutes' && (
                   <div class="space-y-6">
                      {/* AI Assistant Section */}
                      <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-sm border border-blue-100 p-6">
                        <div class="flex items-start gap-4">
                          <div class="bg-white p-3 rounded-full shadow-sm text-animato-primary">
                            <i class="fas fa-robot text-2xl"></i>
                          </div>
                          <div class="flex-1">
                            <h3 class="text-lg font-bold text-gray-800 mb-1">AI Vergadering Assistent</h3>
                            <p class="text-sm text-gray-600 mb-4">
                              Upload een audio-opname van de vergadering. De AI zal deze transcriberen, samenvatten tot notulen én de actiepunten eruit halen.
                            </p>
                            
                            <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                              <input 
                                type="file" 
                                id="audioUpload" 
                                accept="audio/*,video/*,m4a,mp3,wav"
                                class="block w-full text-sm text-gray-500
                                  file:mr-4 file:py-2 file:px-4
                                  file:rounded-full file:border-0
                                  file:text-sm file:font-semibold
                                  file:bg-blue-100 file:text-blue-700
                                  hover:file:bg-blue-200"
                              />
                              <button 
                                id="analyzeBtn"
                                type="button" 
                                onclick="analyzeAudio()"
                                class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition shadow flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <i class="fas fa-magic"></i>
                                <span>Verwerk Opname</span>
                              </button>
                            </div>

                            {/* Loading State */}
                            <div id="aiLoading" class="hidden mt-4">
                              <div class="flex items-center gap-3 text-indigo-700 bg-indigo-50 px-4 py-2 rounded-lg">
                                <i class="fas fa-circle-notch fa-spin"></i>
                                <span id="loadingText">Bezig met luisteren en analyseren... dit kan even duren.</span>
                              </div>
                            </div>

                            {/* Error State */}
                            <div id="aiError" class="hidden mt-4 text-red-600 bg-red-50 px-4 py-2 rounded-lg text-sm"></div>

                            {/* Suggestions Area (Hidden by default) */}
                            <div id="aiSuggestions" class="hidden mt-6 border-t border-blue-200 pt-4">
                              <h4 class="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <i class="fas fa-lightbulb text-yellow-500"></i> Gevonden Actiepunten
                              </h4>
                              <div id="actionSuggestionsList" class="space-y-2 mb-4">
                                {/* Actions injected here */}
                              </div>
                              <p class="text-xs text-gray-500 italic">
                                * Klik op "Toevoegen" om een actiepunt direct in het systeem te zetten. De notulen zijn hieronder alvast ingevuld.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="bg-white rounded-lg shadow-md p-6">
                          <div class="flex justify-between items-center mb-6">
                             <h2 class="text-xl font-bold text-gray-800">Notulen Editor</h2>
                          </div>
                          <form action="/api/admin/meetings/minutes/save" method="POST">
                             <input type="hidden" name="meeting_id" value={meetingId} />
                             <div class="mb-4">
                                <textarea id="minutesContent" name="content" rows={20} class="w-full p-4 border border-gray-300 rounded-lg shadow-sm focus:ring-animato-primary focus:border-animato-primary font-mono text-sm leading-relaxed" placeholder="# Notulen van de vergadering...">{minutes?.notulen || ''}</textarea>
                             </div>
                             <div class="flex justify-between items-center bg-gray-50 p-4 rounded-lg">
                                <div class="flex items-center gap-2">
                                   <input type="checkbox" id="is_published" name="is_published" value="1" checked={minutes?.goedgekeurd === 1} class="rounded text-animato-primary focus:ring-animato-primary" />
                                   <label for="is_published" class="text-sm text-gray-700">Markeer als definitief</label>
                                </div>
                                <button type="submit" class="bg-animato-primary text-white px-6 py-2 rounded hover:bg-animato-secondary shadow">
                                   <i class="fas fa-save mr-2"></i>Opslaan
                                </button>
                             </div>
                          </form>
                       </div>
                   </div>
                )}

                {/* ACTIONS TAB */}
                {tab === 'actions' && (
                   <div class="bg-white rounded-lg shadow-md p-6">
                      <div class="flex justify-between items-center mb-6">
                         <h2 class="text-xl font-bold text-gray-800">Actiepunten</h2>
                         <button onclick="document.getElementById('add-action-modal').classList.remove('hidden')" class="text-animato-primary hover:text-animato-secondary">
                            <i class="fas fa-plus-circle mr-1"></i> Actie toevoegen
                         </button>
                      </div>

                      <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                           <thead class="bg-gray-50">
                              <tr>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actiepunt</th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wie</th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deadline</th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                 <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                              </tr>
                           </thead>
                           <tbody class="divide-y divide-gray-200">
                              {actionItems.map((action: any) => (
                                 <tr>
                                    <td class="px-4 py-3 text-sm text-gray-900">
                                       <span class="font-medium">{action.titel}</span>
                                       {action.beschrijving && action.beschrijving !== '' && (
                                         <p class="text-xs text-gray-500 mt-0.5">{action.beschrijving}</p>
                                       )}
                                    </td>
                                    <td class="px-4 py-3 text-sm text-gray-500">{action.voornaam || '-'}</td>
                                    <td class="px-4 py-3 text-sm text-gray-500">{action.deadline ? new Date(action.deadline).toLocaleDateString('nl-BE') : '-'}</td>
                                    <td class="px-4 py-3">
                                       <form action="/api/admin/meetings/actions/status" method="POST" onchange="this.submit()">
                                          <input type="hidden" name="action_id" value={action.id} />
                                          <input type="hidden" name="meeting_id" value={meetingId} />
                                          <select name="status" class={`text-xs rounded border-0 py-1 pl-2 pr-6 ring-1 ring-inset ${
                                             action.status === 'done' ? 'ring-green-600 text-green-700 bg-green-50' : 
                                             'ring-gray-300 text-gray-700'
                                          }`}>
                                             <option value="open" selected={action.status === 'open'}>Te doen</option>
                                             <option value="in_progress" selected={action.status === 'in_progress'}>Bezig</option>
                                             <option value="done" selected={action.status === 'done'}>Klaar</option>
                                          </select>
                                       </form>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                       <form id={`delete-action-${action.id}`} action={`/api/admin/meetings/actions/${action.id}/delete`} method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)">
                                          <input type="hidden" name="meeting_id" value={meetingId} />
                                          <button type="submit" class="text-gray-400 hover:text-red-500"><i class="fas fa-trash"></i></button>
                                       </form>
                                    </td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                      </div>

                      {/* Add Action Modal */}
                      <div id="add-action-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                          <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-action-modal').classList.add('hidden')"></div>
                          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                          <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                              <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                                <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                                  Actiepunt Toevoegen
                                </h3>
                                <form action="/api/admin/meetings/actions/create" method="POST">
                                  <input type="hidden" name="meeting_id" value={meetingId} />
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                                    <input type="text" name="titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" placeholder="Korte titel" />
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                                    <input type="text" name="beschrijving" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" placeholder="Details..." />
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Verantwoordelijke</label>
                                    <select name="verantwoordelijke_id" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                      <option value="">Selecteer...</option>
                                      {users.map((u: any) => (
                                        <option value={u.id}>{u.voornaam} {u.achternaam}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                                    <input type="date" name="deadline" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                  </div>
                                  <div class="flex justify-end gap-3 mt-6">
                                    <button type="button" onclick="document.getElementById('add-action-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                                    <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Toevoegen</button>
                                  </div>
                                </form>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                   </div>
                )}

             </div>

             {/* Right: Sidebar Info */}
             <div class="space-y-6">
                <div class="bg-white rounded-lg shadow-md p-6">
                   <h3 class="font-bold text-gray-800 mb-4 border-b pb-2">Aanwezigen</h3>
                   <div class="max-h-60 overflow-y-auto space-y-2">
                      {participants.map((p: any) => (
                         <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-700">{p.voornaam} {p.achternaam}</span>
                            <form action="/api/admin/meetings/attendance" method="POST" onchange="this.submit()">
                               <input type="hidden" name="meeting_id" value={meetingId} />
                               <input type="hidden" name="user_id" value={p.user_id} />
                               <select name="status" class={`text-xs border-0 py-0 pl-1 pr-6 rounded ${
                                  p.status === 'aanwezig' ? 'text-green-600 font-bold' :
                                  p.status === 'afwezig' ? 'text-red-500' : 'text-gray-500'
                               }`}>
                                  <option value="uitgenodigd" selected={p.status === 'uitgenodigd'}>Genodigd</option>
                                  <option value="aanwezig" selected={p.status === 'aanwezig'}>Aanwezig</option>
                                  <option value="afwezig" selected={p.status === 'afwezig'}>Afwezig</option>
                                  <option value="geexcuseerd" selected={p.status === 'geexcuseerd'}>Verontsch.</option>
                               </select>
                            </form>
                            <form id={`delete-participant-${p.user_id}`} action="/api/admin/meetings/participants/remove" method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)" class="ml-2">
                                <input type="hidden" name="meeting_id" value={meetingId} />
                                <input type="hidden" name="user_id" value={p.user_id} />
                                <button type="submit" class="text-gray-400 hover:text-red-500"><i class="fas fa-times"></i></button>
                            </form>
                         </div>
                      ))}
                   </div>
                   <div class="mt-4 pt-3 border-t">
                      <button onclick="document.getElementById('add-participant-modal').classList.remove('hidden')" class="text-sm text-animato-primary hover:underline w-full text-center">
                         + Deelnemers uitnodigen
                      </button>
                   </div>
                </div>

                {/* Add Participant Modal */}
                <div id="add-participant-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                  <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                    <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('add-participant-modal').classList.add('hidden')"></div>
                    <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                    <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                      <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                          <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                            Deelnemer Uitnodigen
                          </h3>
                          <form action="/api/admin/meetings/participants/add" method="POST">
                            <input type="hidden" name="meeting_id" value={meetingId} />
                            <div class="mb-4">
                              <label class="block text-sm font-medium text-gray-700 mb-1">Selecteer Lid</label>
                              <select name="user_id" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary h-40" multiple>
                                {users.filter((u: any) => !participants.find((p: any) => p.user_id === u.id)).map((u: any) => (
                                  <option value={u.id}>{u.voornaam} {u.achternaam}</option>
                                ))}
                              </select>
                              <p class="text-xs text-gray-500 mt-2">Houd CTRL ingedrukt om meerdere te selecteren</p>
                            </div>
                            <div class="flex justify-end gap-3 mt-6">
                              <button type="button" onclick="document.getElementById('add-participant-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Toevoegen</button>
                            </div>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Edit Meeting Modal */}
                <div id="edit-meeting-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                  <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                    <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-meeting-modal').classList.add('hidden')"></div>
                    <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                    <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-animato-primary">
                      <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                          <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                            Vergadering Bewerken
                          </h3>
                          <form action={`/api/admin/meetings/${meetingId}/update`} method="POST">
                            <div class="mb-4">
                              <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                              <input type="text" name="titel" value={meeting.titel} required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                            </div>
                            <div class="mb-4">
                              <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                              <select name="type" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                <option value="bestuur" selected={meeting.type === 'bestuur'}>Bestuursvergadering</option>
                                <option value="algemeen" selected={meeting.type === 'algemeen'}>Algemene Vergadering</option>
                                <option value="werkgroep" selected={meeting.type === 'werkgroep'}>Werkgroep</option>
                                <option value="anders" selected={meeting.type === 'anders'}>Anders</option>
                              </select>
                            </div>
                            <div class="mb-4">
                              <label class="block text-sm font-medium text-gray-700 mb-1">Datum & Tijd</label>
                              <input type="datetime-local" name="start_at" value={meeting.start_at} required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                            </div>
                            <div class="mb-4">
                              <label class="block text-sm font-medium text-gray-700 mb-1">Locatie</label>
                              <input type="text" name="locatie" value={meeting.locatie} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                            </div>
                            <div class="flex justify-end gap-3 mt-6">
                              <button type="button" onclick="document.getElementById('edit-meeting-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Opslaan</button>
                            </div>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

             </div>
          </div>
        </div>
      </div>

      {/* Script for AI Analysis */}
      <script dangerouslySetInnerHTML={{
        __html: `
          async function analyzeAudio() {
            const fileInput = document.getElementById('audioUpload');
            const file = fileInput.files[0];
            if (!file) {
              alert('Selecteer eerst een audiobestand.');
              return;
            }

            const btn = document.getElementById('analyzeBtn');
            const loading = document.getElementById('aiLoading');
            const errorDiv = document.getElementById('aiError');
            const suggestions = document.getElementById('aiSuggestions');
            const loadingText = document.getElementById('loadingText');

            // Reset UI
            btn.disabled = true;
            loading.classList.remove('hidden');
            errorDiv.classList.add('hidden');
            suggestions.classList.add('hidden');
            loadingText.innerText = 'Bezig met uploaden en transcriberen... (dit kan even duren)';

            const formData = new FormData();
            formData.append('audio', file);

            try {
              const response = await fetch('/api/admin/meetings/analyze-audio', {
                method: 'POST',
                body: formData
              });

              if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Er ging iets mis bij de verwerking (' + response.status + ').');
              }

              loadingText.innerText = 'Analyseren en samenvatten...';
              
              const data = await response.json();
              
              // Fill minutes
              const textArea = document.getElementById('minutesContent');
              if (textArea) {
                textArea.value = data.minutes; 
              }

              // Show actions
              const list = document.getElementById('actionSuggestionsList');
              list.innerHTML = '';
              
              if (data.actions && data.actions.length > 0) {
                data.actions.forEach((action, index) => {
                  const div = document.createElement('div');
                  div.className = 'flex items-center justify-between bg-white p-3 rounded border border-gray-200 shadow-sm';
                  div.innerHTML = \`
                    <div class="flex-1">
                      <p class="font-medium text-gray-900">\${action.titel}</p>
                      <p class="text-xs text-gray-500">\${action.beschrijving || ''}</p>
                      <div class="flex gap-2 mt-1 text-xs text-gray-400">
                        <span><i class="fas fa-user"></i> \${action.wie || '?'}</span>
                        <span><i class="fas fa-calendar"></i> \${action.deadline || '?'}</span>
                      </div>
                    </div>
                    <button 
                      onclick="addActionSuggestion(this, \${index})" 
                      class="ml-3 bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded text-sm font-medium transition"
                      data-titel="\${action.titel}"
                      data-desc="\${action.beschrijving}"
                      data-wie="\${action.wie}"
                      data-deadline="\${action.deadline}"
                    >
                      Toevoegen
                    </button>
                  \`;
                  list.appendChild(div);
                });
                suggestions.classList.remove('hidden');
              } else {
                 const div = document.createElement('div');
                 div.className = 'text-gray-500 text-sm italic';
                 div.innerText = 'Geen specifieke actiepunten gevonden.';
                 list.appendChild(div);
                 suggestions.classList.remove('hidden');
              }

            } catch (err) {
              console.error(err);
              errorDiv.innerText = err.message;
              errorDiv.classList.remove('hidden');
            } finally {
              loading.classList.add('hidden');
              btn.disabled = false;
            }
          }

          async function addActionSuggestion(btn, index) {
            const titel = btn.dataset.titel;
            const beschrijving = btn.dataset.desc;
            
            btn.disabled = true;
            btn.innerText = 'Bezig...';

            const meetingId = window.location.pathname.split('/').pop();

            const formData = new FormData();
            formData.append('meeting_id', meetingId);
            formData.append('titel', titel);
            formData.append('beschrijving', beschrijving);

            try {
              const res = await fetch('/api/admin/meetings/actions/create', {
                method: 'POST',
                body: formData,
                redirect: 'manual'
              });
              
              btn.className = 'ml-3 bg-gray-100 text-gray-400 px-3 py-1 rounded text-sm font-medium cursor-default';
              btn.innerText = 'Toegevoegd ✓';
              btn.onclick = null;
              
            } catch (e) {
              console.error(e);
              btn.className = 'ml-3 bg-gray-100 text-gray-400 px-3 py-1 rounded text-sm font-medium cursor-default';
              btn.innerText = 'Toegevoegd?';
            }
          }
        `
      }} />
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
        let deleteFormId = null;

        function openDeleteModal(formId) {
          deleteFormId = formId;
          document.getElementById('deleteModal').classList.remove('hidden');
        }

        function closeDeleteModal() {
          deleteFormId = null;
          document.getElementById('deleteModal').classList.add('hidden');
        }

        document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
          if (deleteFormId) {
            document.getElementById(deleteFormId).submit();
          }
          closeDeleteModal();
        });
      ` }} />
    </Layout>
  )
})

// =====================================================
// API ROUTES
// =====================================================

app.post('/api/admin/meetings/create', async (c) => {
  const body = await c.req.parseBody()
  const { titel, type, start_at, locatie } = body
  
  // Split datetime-local (YYYY-MM-DDTHH:MM) into datum and start_tijd
  const dateObj = new Date(start_at as string)
  const datum = start_at ? (start_at as string).split('T')[0] : new Date().toISOString().split('T')[0]
  const start_tijd = start_at ? (start_at as string).split('T')[1] : '20:00'
  
  const result = await c.env.DB.prepare(
    `INSERT INTO meetings (titel, type, datum, start_tijd, locatie, status) VALUES (?, ?, ?, ?, ?, 'gepland')`
  ).bind(titel, type, datum, start_tijd, locatie).run()

  return c.redirect('/admin/meetings')
})

app.post('/api/admin/meetings/agenda/create', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, titel, beschrijving, duration, presenter } = body
  
  // Get max order
  const maxOrder = await queryOne<any>(c.env.DB, `SELECT MAX(volgorde) as max FROM meeting_agenda_items WHERE meeting_id = ?`, [meeting_id])
  const nextOrder = (maxOrder?.max || 0) + 1

  await c.env.DB.prepare(
    `INSERT INTO meeting_agenda_items (meeting_id, titel, beschrijving, duur_minuten, presentator_id, volgorde)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(meeting_id, titel, beschrijving, duration, presenter || null, nextOrder).run()

  return c.redirect(`/admin/meetings/${meeting_id}?tab=agenda`)
})

app.post('/api/admin/meetings/actions/create', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, titel, beschrijving, verantwoordelijke_id, deadline } = body
  
  await c.env.DB.prepare(
    `INSERT INTO meeting_action_items (meeting_id, titel, beschrijving, verantwoordelijke_id, deadline)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(meeting_id, titel, beschrijving || '', verantwoordelijke_id || null, deadline || null).run()

  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

app.post('/api/admin/meetings/actions/status', async (c) => {
  const body = await c.req.parseBody()
  const { action_id, meeting_id, status } = body
  
  await c.env.DB.prepare(`UPDATE meeting_action_items SET status = ? WHERE id = ?`).bind(status, action_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

app.post('/api/admin/meetings/attendance', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, user_id, status } = body
  
  await c.env.DB.prepare(`UPDATE meeting_participants SET status = ? WHERE meeting_id = ? AND user_id = ?`).bind(status, meeting_id, user_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=agenda`) // Stay on page
})

app.post('/api/admin/meetings/participants/add', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, user_id } = body // user_id can be array or string
  
  const userIds = Array.isArray(user_id) ? user_id : [user_id]
  
  const stmt = c.env.DB.prepare(`INSERT INTO meeting_participants (meeting_id, user_id, status) VALUES (?, ?, 'uitgenodigd')`)
  const batch = userIds.map(id => stmt.bind(meeting_id, id))
  
  await c.env.DB.batch(batch)
  return c.redirect(`/admin/meetings/${meeting_id}`)
})

app.post('/api/admin/meetings/minutes/save', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, content, is_published } = body
  const goedgekeurd = is_published ? 1 : 0

  // Check if exists
  const exists = await queryOne<any>(c.env.DB, `SELECT id FROM meeting_minutes WHERE meeting_id = ?`, [meeting_id])
  
  if (exists) {
     await c.env.DB.prepare(`UPDATE meeting_minutes SET notulen = ?, goedgekeurd = ? WHERE meeting_id = ?`).bind(content, goedgekeurd, meeting_id).run()
  } else {
     await c.env.DB.prepare(`INSERT INTO meeting_minutes (meeting_id, notulen, goedgekeurd) VALUES (?, ?, ?)`).bind(meeting_id, content, goedgekeurd).run()
  }

  return c.redirect(`/admin/meetings/${meeting_id}?tab=minutes`)
})

app.post('/api/admin/meetings/status', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, status } = body
  
  await c.env.DB.prepare(`UPDATE meetings SET status = ? WHERE id = ?`).bind(status, meeting_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}`)
})

app.post('/api/admin/meetings/:id/update', async (c) => {
  const meetingId = c.req.param('id')
  const body = await c.req.parseBody()
  const { titel, type, start_at, locatie } = body
  
  const dateObj = new Date(start_at as string)
  const datum = start_at ? (start_at as string).split('T')[0] : null
  const start_tijd = start_at ? (start_at as string).split('T')[1] : null

  await c.env.DB.prepare(
    `UPDATE meetings SET titel = ?, type = ?, datum = ?, start_tijd = ?, locatie = ? WHERE id = ?`
  ).bind(titel, type, datum, start_tijd, locatie, meetingId).run()

  return c.redirect(`/admin/meetings/${meetingId}`)
})

app.post('/api/admin/meetings/:id/delete', async (c) => {
  const meetingId = c.req.param('id')
  
  await c.env.DB.prepare(`DELETE FROM meetings WHERE id = ?`).bind(meetingId).run()
  
  // Cascade delete logic ideally happens in DB or here manually if no FK constraints
  await c.env.DB.prepare(`DELETE FROM meeting_participants WHERE meeting_id = ?`).bind(meetingId).run()
  await c.env.DB.prepare(`DELETE FROM meeting_agenda_items WHERE meeting_id = ?`).bind(meetingId).run()
  await c.env.DB.prepare(`DELETE FROM meeting_action_items WHERE meeting_id = ?`).bind(meetingId).run()
  await c.env.DB.prepare(`DELETE FROM meeting_minutes WHERE meeting_id = ?`).bind(meetingId).run()

  return c.redirect('/admin/meetings')
})

app.post('/api/admin/meetings/agenda/:id/delete', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const meeting_id = body.meeting_id

  await c.env.DB.prepare(`DELETE FROM meeting_agenda_items WHERE id = ?`).bind(id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=agenda`)
})

app.post('/api/admin/meetings/actions/:id/delete', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const meeting_id = body.meeting_id

  await c.env.DB.prepare(`DELETE FROM meeting_action_items WHERE id = ?`).bind(id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

app.post('/api/admin/meetings/participants/remove', async (c) => {
  const body = await c.req.parseBody()
  const { meeting_id, user_id } = body
  
  await c.env.DB.prepare(`DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id = ?`).bind(meeting_id, user_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}`)
})

app.post('/api/admin/meetings/analyze-audio', async (c) => {
  const body = await c.req.parseBody()
  const audioFile = body['audio']

  if (!audioFile || !(audioFile instanceof File)) {
    return c.json({ error: 'Geen geldig audiobestand ontvangen' }, 400)
  }

  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: 'Server configuratie fout: Geen OpenAI API Key gevonden.' }, 500)
  }

  // 1. Transcribe with Whisper
  const formData = new FormData()
  formData.append('file', audioFile)
  formData.append('model', 'whisper-1')
  formData.append('language', 'nl')

  // Note: Cloudflare Workers fetch handles FormData automatically with correct boundary
  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`
    },
    body: formData
  })

  if (!whisperRes.ok) {
    const err = await whisperRes.text()
    console.error('Whisper API Error:', err)
    return c.json({ error: 'Fout bij transcriptie (Whisper): ' + err }, 500)
  }

  const whisperData = await whisperRes.json()
  const transcript = whisperData.text

  // 2. Analyze with GPT-4o
  const prompt = `
    Je bent een professionele notulist voor een koor. 
    Hieronder volgt een transcript van een vergadering.
    
    Opdracht:
    1. Maak een heldere, gestructureerde samenvatting (notulen) in Markdown stijl (maar gebruik geen markdown headers #, gebruik wel bulletpoints en witregels). Focus op beslissingen en belangrijke discussies.
    2. Extraheer een lijst van concrete actiepunten.
    
    Transcript:
    "${transcript}"

    Geef het antwoord puur als JSON in dit formaat:
    {
      "minutes": "De notulen tekst...",
      "actions": [
        { "titel": "Korte titel", "beschrijving": "Wat moet er gebeuren?", "wie": "Naam (indien genoemd, anders leeg)", "deadline": "YYYY-MM-DD (indien genoemd, anders leeg)" }
      ]
    }
  `

  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    })
  })

  if (!gptRes.ok) {
     const err = await gptRes.text()
     console.error('GPT API Error:', err)
     return c.json({ error: 'Fout bij analyse (GPT): ' + err }, 500)
  }

  const gptData = await gptRes.json()
  const content = JSON.parse(gptData.choices[0].message.content)

  return c.json(content)
})

export default app
