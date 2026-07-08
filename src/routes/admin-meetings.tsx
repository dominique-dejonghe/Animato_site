import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { MemberPicker, MemberPickerScript } from '../components/MemberPicker'
import { TaskCommentsCollapsible, TaskCommentsScript } from '../components/TaskComments'
import { requireRole, requireBestuurslid } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'
import { formatBrusselsTime } from '../utils/time'
import { createNotification } from '../utils/notifications'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware: Require board member (admin, moderator, or bestuurslid)
app.use('/admin/*', requireBestuurslid)

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

  // Get open action items across all meetings — gesorteerd op prio dan deadline
  const openActions = await queryAll(
    c.env.DB,
    `SELECT a.*, m.titel as meeting_titel, datetime(m.datum || ' ' || COALESCE(m.start_tijd, '00:00')) as meeting_date,
            u.id as user_id, p.voornaam, p.achternaam,
            COALESCE(a.prioriteit, 2) as prioriteit
     FROM meeting_action_items a
     JOIN meetings m ON m.id = a.meeting_id
     LEFT JOIN users u ON u.id = a.verantwoordelijke_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE a.status != 'done'
     ORDER BY COALESCE(a.prioriteit, 2) ASC, a.deadline ASC`
  )

  return c.html(
    <Layout title="Vergaderingen" user={user}>
      <div class="flex min-h-screen bg-gray-100">
        {/* Sidebar */}
        <AdminSidebar activeSection="meetings" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />

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
                      // Hele card is klikbaar via onclick \u2014 we navigeren naar de detail-pagina
                      // bij klik ergens op de balk (behalve op de status-pill, die heeft cursor-default).
                      <div
                        class="p-6 hover:bg-gray-50 transition cursor-pointer"
                        onclick={`window.location.href='/admin/meetings/${meeting.id}'`}
                      >
                        <div class="flex justify-between items-start">
                          <div>
                            <h4 class="text-xl font-bold text-gray-900 mb-1 hover:text-animato-primary">
                              {meeting.titel}
                            </h4>
                            <div class="text-sm text-gray-600 mb-2">
                              <i class="far fa-calendar-alt mr-2 w-4"></i>
                              {new Date(meeting.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                              <span class="mx-2">|</span>
                              <i class="far fa-clock mr-2 w-4"></i>
                              {formatBrusselsTime(meeting.start_at)}
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
                            <span class="text-animato-primary text-sm">
                              Details <i class="fas fa-arrow-right ml-1"></i>
                            </span>
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
                      // Hele rij is klikbaar — niet alleen het chevron rechts
                      <a
                        href={`/admin/meetings/${meeting.id}`}
                        class="block p-4 hover:bg-gray-50 transition flex justify-between items-center group"
                      >
                        <div>
                          <div class="font-medium text-gray-900 group-hover:text-animato-primary">{meeting.titel}</div>
                          <div class="text-sm text-gray-500">
                            {new Date(meeting.start_at).toLocaleDateString('nl-BE')}
                          </div>
                        </div>
                        <span class="text-gray-400 group-hover:text-animato-primary transition">
                          <i class="fas fa-chevron-right"></i>
                        </span>
                      </a>
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
                            <div class="min-w-0 flex-1">
                              {/* Titel eerst (1-op-1 met /admin/meetings/:id?tab=actions),
                                  beschrijving als optionele subtekst */}
                              <p class="text-sm font-medium text-gray-900 break-words">{action.titel || action.beschrijving || '(zonder titel)'}</p>
                              {action.titel && action.beschrijving && (
                                <p class="text-xs text-gray-500 mt-0.5 break-words line-clamp-2">{action.beschrijving}</p>
                              )}
                              <div class="flex items-center gap-2 mt-1 flex-wrap">
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
  // Default-sortering: prioriteit ASC (hoog=1 eerst), dan created_at DESC.
  // Client-side JS doet de echte sortering bij klik op kolomheaders.
  const actionItems = await queryAll<any>(
    c.env.DB,
    `SELECT a.*, p.voornaam, p.achternaam,
            COALESCE(a.prioriteit, 2) as prioriteit
     FROM meeting_action_items a
     LEFT JOIN users u ON u.id = a.verantwoordelijke_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE a.meeting_id = ?
     ORDER BY COALESCE(a.prioriteit, 2) ASC, a.created_at DESC`,
    [meetingId]
  )

  // Comment counts per action item
  const commentCounts: Record<number, number> = {}
  try {
    const rows = await queryAll<any>(
      c.env.DB,
      `SELECT task_id, COUNT(*) as n
       FROM task_comments
       WHERE task_type = 'meeting_action' AND deleted_at IS NULL
         AND task_id IN (SELECT id FROM meeting_action_items WHERE meeting_id = ?)
       GROUP BY task_id`,
      [meetingId]
    )
    rows.forEach((r: any) => { commentCounts[Number(r.task_id)] = Number(r.n) })
  } catch (e) { /* ignore */ }
  
  // Get users for assignment - for board meetings, only show board members + admin/moderator
  const isBoardMeeting = meeting.type === 'bestuur'
  const users = await queryAll(
    c.env.DB,
    isBoardMeeting
      ? `SELECT u.id, p.voornaam, p.achternaam, u.role, u.is_bestuurslid
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.status = 'actief' AND (u.role IN ('admin', 'moderator') OR u.is_bestuurslid = 1)
         ORDER BY p.voornaam`
      : `SELECT u.id, p.voornaam, p.achternaam, u.role, u.is_bestuurslid
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
                    <span><i class="far fa-clock mr-2"></i>{formatBrusselsTime(meeting.start_at)}</span>
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
                         <ul id="agenda-items-list" class="space-y-4" data-meeting-id={meetingId}>
                            {agendaItems.map((item: any, index: number) => (
                               <li
                                  data-agenda-id={item.id}
                                  draggable={true}
                                  class="agenda-row flex items-start gap-3 p-4 border rounded-lg bg-gray-50 hover:bg-gray-100 transition cursor-move"
                               >
                                  <div class="flex-shrink-0 flex flex-col items-center gap-1 pt-1">
                                    <i class="fas fa-grip-vertical text-gray-400" title="Sleep om volgorde aan te passen"></i>
                                    <button
                                      type="button"
                                      onclick={`moveAgenda(${item.id}, -1)`}
                                      class={`text-gray-400 hover:text-animato-primary disabled:opacity-30 disabled:cursor-not-allowed`}
                                      disabled={index === 0}
                                      title="Een plaats omhoog"
                                    >
                                      <i class="fas fa-chevron-up text-xs"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onclick={`moveAgenda(${item.id}, 1)`}
                                      class="text-gray-400 hover:text-animato-primary disabled:opacity-30 disabled:cursor-not-allowed"
                                      disabled={index === agendaItems.length - 1}
                                      title="Een plaats omlaag"
                                    >
                                      <i class="fas fa-chevron-down text-xs"></i>
                                    </button>
                                  </div>
                                  <div class="flex-shrink-0 w-8 h-8 bg-white border rounded-full flex items-center justify-center font-bold text-gray-500 agenda-nr">
                                     {index + 1}
                                  </div>
                                  <div class="flex-1 min-w-0">
                                     <h4 class="font-semibold text-gray-900">{item.titel}</h4>
                                     {item.beschrijving && <p class="text-sm text-gray-600 mt-1">{item.beschrijving}</p>}
                                     <div class="flex gap-3 mt-2 text-xs text-gray-500">
                                        {item.duration_minutes && <span><i class="far fa-clock mr-1"></i>{item.duration_minutes} min</span>}
                                        {item.presenter && <span><i class="far fa-user mr-1"></i>{item.presenter}</span>}
                                     </div>
                                  </div>
                                  <div class="flex items-start gap-2 flex-shrink-0">
                                    <button
                                       type="button"
                                       data-agenda-id={item.id}
                                       data-agenda-titel={item.titel || ''}
                                       data-agenda-beschrijving={item.beschrijving || ''}
                                       data-agenda-duration={item.duur_minuten || ''}
                                       data-agenda-presenter={item.presentator_id || ''}
                                       onclick="openEditAgendaModalFromDataset(this)"
                                       class="text-blue-600 hover:text-blue-900"
                                       title="Agendapunt bewerken"
                                    >
                                       <i class="fas fa-edit"></i>
                                    </button>
                                    <form id={`delete-agenda-${item.id}`} action={`/api/admin/meetings/agenda/${item.id}/delete`} method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)">
                                      <input type="hidden" name="meeting_id" value={meetingId} />
                                      <button type="submit" class="text-gray-400 hover:text-red-500" title="Agendapunt verwijderen"><i class="fas fa-trash"></i></button>
                                    </form>
                                  </div>
                               </li>
                            ))}
                         </ul>
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
                                    <textarea name="beschrijving" rows={4} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary resize-y overflow-y-auto" style="min-height: 100px; max-height: 300px;"></textarea>
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

                      {/* Edit Agenda Modal */}
                      <div id="edit-agenda-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                          <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-agenda-modal').classList.add('hidden')"></div>
                          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                          <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-blue-500">
                            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                              <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                                <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                                  Agendapunt bewerken
                                </h3>
                                <form id="edit-agenda-form" method="POST">
                                  <input type="hidden" name="meeting_id" value={meetingId} />
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                                    <input type="text" name="titel" id="edit-agenda-titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                                    <textarea name="beschrijving" id="edit-agenda-beschrijving" rows={4} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary resize-y overflow-y-auto" style="min-height: 100px; max-height: 300px;"></textarea>
                                  </div>
                                  <div class="flex gap-4 mb-3">
                                     <div class="flex-1">
                                       <label class="block text-sm font-medium text-gray-700 mb-1">Duur (min)</label>
                                       <input type="number" name="duration" id="edit-agenda-duration" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                     </div>
                                     <div class="flex-1">
                                       <label class="block text-sm font-medium text-gray-700 mb-1">Spreker</label>
                                       <select name="presenter" id="edit-agenda-presenter" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                         <option value="">Selecteer...</option>
                                         {users.map((u: any) => (
                                           <option value={u.id}>{u.voornaam} {u.achternaam}</option>
                                         ))}
                                       </select>
                                     </div>
                                  </div>
                                  <div class="flex justify-end gap-3 mt-6">
                                    <button type="button" onclick="document.getElementById('edit-agenda-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                                    <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Wijzigingen opslaan</button>
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
                          <div class="flex justify-between items-center mb-6 flex-wrap gap-3">
                             <h2 class="text-xl font-bold text-gray-800">Notulen Editor</h2>
                             {agendaItems.length > 0 && (
                               <button
                                 type="button"
                                 onclick="insertAgendaTemplate()"
                                 class="inline-flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-sm font-semibold"
                                 title="Voeg de agendapunten toe als kop-structuur in de notulen"
                               >
                                 <i class="fas fa-list-ol"></i>
                                 Vul agendapunten in
                               </button>
                             )}
                          </div>

                          {/* Auto-template hint: tonen als notulen leeg zijn én er agendapunten bestaan */}
                          {agendaItems.length > 0 && !minutes?.notulen && (
                            <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-start gap-2">
                              <i class="fas fa-magic mt-0.5"></i>
                              <div>
                                <strong>Automatisch ingevuld:</strong> De {agendaItems.length} agendapunt{agendaItems.length === 1 ? '' : 'en'} {agendaItems.length === 1 ? 'is' : 'zijn'} alvast als structuur in de notulen geplaatst. Vul aan tijdens of na de vergadering en klik op <em>Opslaan</em>. Met de knop <em>Vul agendapunten in</em> kun je de structuur opnieuw genereren als je later agendapunten toevoegt.
                              </div>
                            </div>
                          )}

                          <form action="/api/admin/meetings/minutes/save" method="POST">
                             <input type="hidden" name="meeting_id" value={meetingId} />
                             <div class="mb-4">
                                <textarea id="minutesContent" name="content" rows={20} class="w-full p-4 border border-gray-300 rounded-lg shadow-sm focus:ring-animato-primary focus:border-animato-primary font-mono text-sm leading-relaxed" placeholder="# Notulen van de vergadering...">{minutes?.notulen || (agendaItems.length > 0 ? agendaItems.map((it: any, idx: number) => {
                                  const header = `${idx + 1}. ${it.titel}${it.duur_minuten ? ` (${it.duur_minuten} min)` : ''}`
                                  const sep = '-'.repeat(header.length)
                                  let block = `${header}\n${sep}\n`
                                  if (it.beschrijving) block += `\nAchtergrond: ${it.beschrijving}\n`
                                  block += `\nBespreking: \n\nBeslissing / actiepunten: \n\n`
                                  return block
                                }).join('\n') : '')}</textarea>
                             </div>

                             {/* Agendapunten template voor JS-injectie */}
                             <script
                               id="agenda-template-data"
                               type="application/json"
                               dangerouslySetInnerHTML={{ __html: JSON.stringify(agendaItems.map((it: any, idx: number) => ({
                                 nr: idx + 1,
                                 titel: it.titel,
                                 beschrijving: it.beschrijving || '',
                                 duur: it.duur_minuten || null
                               }))) }}
                             />
                             <script dangerouslySetInnerHTML={{ __html: `
                               window.insertAgendaTemplate = function() {
                                 var ta = document.getElementById('minutesContent');
                                 if (!ta) return;
                                 var data;
                                 try { data = JSON.parse(document.getElementById('agenda-template-data').textContent); } catch(e) { return; }
                                 if (!Array.isArray(data) || data.length === 0) return;

                                 var existing = (ta.value || '').trim();
                                 if (existing.length > 0) {
                                   if (!confirm('De notulen bevatten al tekst. Wil je deze vervangen door de agendapunten-structuur?\\n\\n(Klik Annuleren om de structuur ONDER de bestaande tekst toe te voegen.)')) {
                                     // Toevoegen onderaan ipv vervangen
                                     ta.value = existing + '\\n\\n' + buildTemplate(data);
                                     ta.dispatchEvent(new Event('input', { bubbles: true }));
                                     ta.focus();
                                     return;
                                   }
                                 }
                                 ta.value = buildTemplate(data);
                                 ta.dispatchEvent(new Event('input', { bubbles: true }));
                                 ta.focus();
                                 // Scroll naar boven van textarea
                                 ta.scrollTop = 0;
                                 ta.setSelectionRange(0, 0);
                               };

                               function buildTemplate(items) {
                                 var lines = [];
                                 items.forEach(function(it) {
                                   var header = it.nr + '. ' + it.titel;
                                   if (it.duur) header += ' (' + it.duur + ' min)';
                                   lines.push(header);
                                   lines.push('---'.repeat(Math.max(10, Math.ceil(header.length / 3))).slice(0, header.length));
                                   if (it.beschrijving) {
                                     lines.push('');
                                     lines.push('Achtergrond: ' + it.beschrijving);
                                   }
                                   lines.push('');
                                   lines.push('Bespreking: ');
                                   lines.push('');
                                   lines.push('Beslissing / actiepunten: ');
                                   lines.push('');
                                   lines.push('');
                                 });
                                 return lines.join('\\n');
                               }
                             ` }} />
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
                        <table class="min-w-full divide-y divide-gray-200" id="actiepunten-table">
                           <thead class="bg-gray-50">
                              <tr>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 transition" data-sort-col="prio" data-sort-type="number">
                                    Prio <i class="fas fa-sort text-gray-300 ml-1 sort-icon"></i>
                                 </th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 transition" data-sort-col="actiepunt" data-sort-type="string">
                                    Actiepunt <i class="fas fa-sort text-gray-300 ml-1 sort-icon"></i>
                                 </th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 transition" data-sort-col="wie" data-sort-type="string">
                                    Wie <i class="fas fa-sort text-gray-300 ml-1 sort-icon"></i>
                                 </th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 transition" data-sort-col="deadline" data-sort-type="number">
                                    Deadline <i class="fas fa-sort text-gray-300 ml-1 sort-icon"></i>
                                 </th>
                                 <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 transition" data-sort-col="status" data-sort-type="number">
                                    Status <i class="fas fa-sort text-gray-300 ml-1 sort-icon"></i>
                                 </th>
                                 <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actie</th>
                              </tr>
                           </thead>
                           <tbody class="divide-y divide-gray-200">
                              {actionItems.map((action: any) => {
                                const prio = Number(action.prioriteit) || 2
                                const prioLabel = prio === 1 ? 'Hoog' : prio === 3 ? 'Laag' : 'Normaal'
                                const prioClass = prio === 1 ? 'bg-red-100 text-red-700' : prio === 3 ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'
                                // Status-sort: open=1, in_progress=2, done=3 (zodat open eerst komt bij asc)
                                const statusSort = action.status === 'open' ? 1 : action.status === 'in_progress' ? 2 : 3
                                // Deadline-sort: timestamp (ms) — geen deadline = ver in de toekomst
                                const deadlineSort = action.deadline ? new Date(action.deadline).getTime() : 99999999999999
                                return (
                                 <tr
                                   data-sort-prio={prio}
                                   data-sort-actiepunt={(action.titel || '').toLowerCase()}
                                   data-sort-wie={(action.voornaam || '').toLowerCase()}
                                   data-sort-deadline={deadlineSort}
                                   data-sort-status={statusSort}
                                 >
                                    <td class="px-4 py-3 align-top">
                                       <form action="/api/admin/meetings/actions/prioriteit" method="POST" onchange="this.submit()" class="inline-block">
                                          <input type="hidden" name="action_id" value={action.id} />
                                          <input type="hidden" name="meeting_id" value={meetingId} />
                                          <select name="prioriteit" class={`text-xs rounded-full border-0 py-0.5 pl-2 pr-6 font-semibold ${prioClass}`} title="Prioriteit aanpassen">
                                             <option value="1" selected={prio === 1}>Hoog</option>
                                             <option value="2" selected={prio === 2}>Normaal</option>
                                             <option value="3" selected={prio === 3}>Laag</option>
                                          </select>
                                       </form>
                                    </td>
                                    <td class="px-4 py-3 text-sm text-gray-900 align-top">
                                       <span class="font-medium">{action.titel}</span>
                                       {action.beschrijving && action.beschrijving !== '' && (
                                         <p class="text-xs text-gray-500 mt-0.5">{action.beschrijving}</p>
                                       )}
                                       <TaskCommentsCollapsible taskType="meeting_action" taskId={action.id} initialCount={commentCounts[action.id] || 0} />
                                    </td>
                                    <td class="px-4 py-3 text-sm text-gray-500">{action.voornaam || '-'}</td>
                                    <td class="px-4 py-3 text-sm text-gray-500">{action.deadline ? new Date(action.deadline).toLocaleDateString('nl-BE') : '-'}</td>
                                    <td class="px-4 py-3">
                                       <form action="/api/admin/meetings/actions/status" method="POST" onchange="this.submit()">
                                          <input type="hidden" name="action_id" value={action.id} />
                                          <input type="hidden" name="meeting_id" value={meetingId} />
                                          <select name="status" class={`text-xs rounded border-0 py-1 pl-2 pr-6 ring-1 ring-inset ${
                                             action.status === 'done' ? 'ring-green-600 text-green-700 bg-green-50' :
                                             action.status === 'in_progress' ? 'ring-blue-400 text-blue-700 bg-blue-50' :
                                             'ring-gray-300 text-gray-700'
                                          }`}>
                                             <option value="open" selected={action.status === 'open'}>Te doen</option>
                                             <option value="in_progress" selected={action.status === 'in_progress'}>Bezig</option>
                                             <option value="done" selected={action.status === 'done'}>Klaar</option>
                                          </select>
                                       </form>
                                    </td>
                                    <td class="px-4 py-3 text-right whitespace-nowrap">
                                       <button
                                          type="button"
                                          data-action-id={action.id}
                                          data-action-titel={action.titel || ''}
                                          data-action-beschrijving={action.beschrijving || ''}
                                          data-action-verantwoordelijke={action.verantwoordelijke_id || ''}
                                          data-action-deadline={action.deadline ? String(action.deadline).split('T')[0] : ''}
                                          data-action-prioriteit={prio}
                                          onclick="openEditActionModalFromDataset(this)"
                                          class="text-blue-600 hover:text-blue-900 mr-3"
                                          title="Actiepunt bewerken"
                                       >
                                          <i class="fas fa-edit"></i>
                                       </button>
                                       <form id={`delete-action-${action.id}`} action={`/api/admin/meetings/actions/${action.id}/delete`} method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)" class="inline">
                                          <input type="hidden" name="meeting_id" value={meetingId} />
                                          <button type="submit" class="text-gray-400 hover:text-red-500" title="Actiepunt verwijderen"><i class="fas fa-trash"></i></button>
                                       </form>
                                    </td>
                                 </tr>
                                )
                              })}
                           </tbody>
                        </table>
                      </div>
                      {/* Client-side sort script voor de Actiepunten-tabel */}
                      <script dangerouslySetInnerHTML={{__html: `
                        (function() {
                          const table = document.getElementById('actiepunten-table');
                          if (!table) return;
                          const tbody = table.querySelector('tbody');
                          let currentSort = { col: 'prio', dir: 'asc' };
                          table.querySelectorAll('th[data-sort-col]').forEach(th => {
                            th.addEventListener('click', () => {
                              const col = th.dataset.sortCol;
                              const type = th.dataset.sortType;
                              const dir = currentSort.col === col && currentSort.dir === 'asc' ? 'desc' : 'asc';
                              currentSort = { col, dir };
                              // Update icons
                              table.querySelectorAll('.sort-icon').forEach(i => { i.className = 'fas fa-sort text-gray-300 ml-1 sort-icon'; });
                              const icon = th.querySelector('.sort-icon');
                              if (icon) icon.className = 'fas fa-sort-' + (dir === 'asc' ? 'up' : 'down') + ' text-animato-primary ml-1 sort-icon';
                              // Sort rows
                              const rows = Array.from(tbody.querySelectorAll('tr'));
                              rows.sort((a, b) => {
                                let av = a.dataset['sort' + col.charAt(0).toUpperCase() + col.slice(1)];
                                let bv = b.dataset['sort' + col.charAt(0).toUpperCase() + col.slice(1)];
                                if (type === 'number') { av = Number(av) || 0; bv = Number(bv) || 0; return dir === 'asc' ? av - bv : bv - av; }
                                av = String(av || ''); bv = String(bv || '');
                                return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                              });
                              rows.forEach(r => tbody.appendChild(r));
                            });
                          });
                          // Initialiseer pijl op prio (default-sortering server-side)
                          const initTh = table.querySelector('th[data-sort-col="prio"] .sort-icon');
                          if (initTh) initTh.className = 'fas fa-sort-up text-animato-primary ml-1 sort-icon';
                        })();
                      `}} />


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
                                    <textarea name="beschrijving" rows={4} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary resize-y overflow-y-auto" placeholder="Details..." style="min-height: 100px; max-height: 300px;"></textarea>
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Verantwoordelijke</label>
                                    <MemberPicker name="verantwoordelijke_id" users={users} inputId="add-action-verantwoordelijke" placeholder="Typ om te zoeken..." />
                                    <p class="text-xs text-gray-500 mt-1">Tip: typ een paar letters om snel een lid te vinden.</p>
                                  </div>
                                  <div class="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                      <label class="block text-sm font-medium text-gray-700 mb-1">Prioriteit</label>
                                      <select name="prioriteit" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                        <option value="1">Hoog</option>
                                        <option value="2" selected>Normaal</option>
                                        <option value="3">Laag</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label class="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                                      <input type="date" name="deadline" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                    </div>
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

                      {/* Edit Action Modal */}
                      <div id="edit-action-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                          <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="document.getElementById('edit-action-modal').classList.add('hidden')"></div>
                          <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                          <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-blue-500">
                            <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                              <div class="mt-3 text-center sm:mt-0 sm:text-left w-full">
                                <h3 class="text-xl leading-6 font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
                                  Actiepunt bewerken
                                </h3>
                                <form id="edit-action-form" method="POST">
                                  <input type="hidden" name="meeting_id" value={meetingId} />
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                                    <input type="text" name="titel" id="edit-action-titel" required class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                                    <textarea name="beschrijving" id="edit-action-beschrijving" rows={4} class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary resize-y overflow-y-auto" style="min-height: 100px; max-height: 300px;"></textarea>
                                  </div>
                                  <div class="mb-3">
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Verantwoordelijke</label>
                                    <MemberPicker name="verantwoordelijke_id" users={users} inputId="edit-action-verantwoordelijke" placeholder="Typ om te zoeken..." />
                                  </div>
                                  <div class="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                      <label class="block text-sm font-medium text-gray-700 mb-1">Prioriteit</label>
                                      <select name="prioriteit" id="edit-action-prioriteit" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary">
                                        <option value="1">Hoog</option>
                                        <option value="2">Normaal</option>
                                        <option value="3">Laag</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label class="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                                      <input type="date" name="deadline" id="edit-action-deadline" class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary" />
                                    </div>
                                  </div>
                                  <div class="flex justify-end gap-3 mt-6">
                                    <button type="button" onclick="document.getElementById('edit-action-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition">Annuleren</button>
                                    <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary font-medium shadow-md transition">Wijzigingen opslaan</button>
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
                {/* #47: Compactere bestuursleden-lijst — initialenavatar + statuspill, één rij per persoon, sticky toolbar */}
                <div class="bg-white rounded-lg shadow-md p-4">
                   <div class="flex items-center justify-between mb-3 pb-2 border-b">
                      <h3 class="font-bold text-gray-800 text-sm">Aanwezigen</h3>
                      <div class="flex items-center gap-1.5 text-[11px]">
                         <span class="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-semibold">
                            {participants.filter((p: any) => p.status === 'aanwezig').length}
                         </span>
                         <span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">
                            {participants.filter((p: any) => p.status === 'geexcuseerd').length}
                         </span>
                         <span class="px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-semibold">
                            {participants.filter((p: any) => p.status === 'afwezig').length}
                         </span>
                         <span class="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold">
                            {participants.filter((p: any) => p.status === 'uitgenodigd').length}
                         </span>
                      </div>
                   </div>
                   {/* #ux: lijst toont min. 10 deelnemers zonder scroll; daarboven scrollt het. */}
                   <div class="max-h-[36rem] overflow-y-auto -mx-1 px-1 divide-y divide-gray-50">
                      {participants.map((p: any) => {
                         const initials = ((p.voornaam || '?')[0] + (p.achternaam || '?')[0]).toUpperCase()
                         const statusBg =
                            p.status === 'aanwezig' ? 'bg-green-100 text-green-800 border-green-200' :
                            p.status === 'afwezig' ? 'bg-red-100 text-red-800 border-red-200' :
                            p.status === 'geexcuseerd' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                            'bg-gray-100 text-gray-600 border-gray-200'
                         return (
                            <div class="flex items-center gap-2 py-1.5 group">
                               <div class="w-7 h-7 rounded-full bg-gradient-to-br from-animato-primary/15 to-animato-secondary/15 text-animato-secondary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                  {initials}
                               </div>
                               <span class="text-sm text-gray-800 truncate flex-1 min-w-0" title={`${p.voornaam} ${p.achternaam}`}>
                                  {p.voornaam} {p.achternaam}
                               </span>
                               <form action="/api/admin/meetings/attendance" method="POST" onchange="this.submit()" class="flex-shrink-0">
                                  <input type="hidden" name="meeting_id" value={meetingId} />
                                  <input type="hidden" name="user_id" value={p.user_id} />
                                  <select name="status" class={`text-[11px] font-semibold border rounded-full pl-2 pr-5 py-0.5 cursor-pointer ${statusBg}`}>
                                     <option value="uitgenodigd" selected={p.status === 'uitgenodigd'}>Genodigd</option>
                                     <option value="aanwezig" selected={p.status === 'aanwezig'}>Aanwezig</option>
                                     <option value="afwezig" selected={p.status === 'afwezig'}>Afwezig</option>
                                     <option value="geexcuseerd" selected={p.status === 'geexcuseerd'}>Verontsch.</option>
                                  </select>
                               </form>
                               <form id={`delete-participant-${p.user_id}`} action="/api/admin/meetings/participants/remove" method="POST" onsubmit="event.preventDefault(); openDeleteModal(this.id)" class="flex-shrink-0">
                                   <input type="hidden" name="meeting_id" value={meetingId} />
                                   <input type="hidden" name="user_id" value={p.user_id} />
                                   <button type="submit" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition px-1" title="Verwijderen">
                                      <i class="fas fa-times text-xs"></i>
                                   </button>
                               </form>
                            </div>
                         )
                      })}
                   </div>
                   <div class="mt-3 pt-2 border-t">
                      <button onclick="document.getElementById('add-participant-modal').classList.remove('hidden')" class="text-xs text-animato-primary hover:underline w-full text-center font-medium">
                         <i class="fas fa-user-plus mr-1"></i> Deelnemers uitnodigen
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

        // Edit Action Item modal — vult de form in met data uit de table-row
        function openEditActionModalFromDataset(btn) {
          const ds = btn.dataset;
          const form = document.getElementById('edit-action-form');
          form.action = '/api/admin/meetings/actions/' + ds.actionId + '/update';
          document.getElementById('edit-action-titel').value = ds.actionTitel || '';
          document.getElementById('edit-action-beschrijving').value = ds.actionBeschrijving || '';
          if (window.__setMemberPicker) {
            window.__setMemberPicker('edit-action-verantwoordelijke', ds.actionVerantwoordelijke || '');
          }
          document.getElementById('edit-action-deadline').value = ds.actionDeadline || '';
          // Prioriteit instellen (default 2 = Normaal als niet gezet)
          const prioEl = document.getElementById('edit-action-prioriteit');
          if (prioEl) prioEl.value = ds.actionPrioriteit || '2';
          document.getElementById('edit-action-modal').classList.remove('hidden');
        }
        window.openEditActionModalFromDataset = openEditActionModalFromDataset;

        // Edit Agenda Item modal
        function openEditAgendaModalFromDataset(btn) {
          const ds = btn.dataset;
          const form = document.getElementById('edit-agenda-form');
          form.action = '/api/admin/meetings/agenda/' + ds.agendaId + '/update';
          document.getElementById('edit-agenda-titel').value = ds.agendaTitel || '';
          document.getElementById('edit-agenda-beschrijving').value = ds.agendaBeschrijving || '';
          document.getElementById('edit-agenda-duration').value = ds.agendaDuration || '';
          document.getElementById('edit-agenda-presenter').value = ds.agendaPresenter || '';
          document.getElementById('edit-agenda-modal').classList.remove('hidden');
        }
        window.openEditAgendaModalFromDataset = openEditAgendaModalFromDataset;

        // ===========================================================
        // Agendapunten — verschuiven (up/down knoppen + drag-and-drop)
        // ===========================================================
        function getAgendaList() { return document.getElementById('agenda-items-list'); }

        function renumberAgenda() {
          var list = getAgendaList(); if (!list) return;
          var rows = Array.from(list.querySelectorAll('.agenda-row'));
          rows.forEach(function(row, idx) {
            var nr = row.querySelector('.agenda-nr');
            if (nr) nr.textContent = String(idx + 1);
            // Disable up-button op eerste, down-button op laatste
            var btns = row.querySelectorAll('button[onclick^="moveAgenda"]');
            if (btns.length === 2) {
              btns[0].disabled = (idx === 0);
              btns[1].disabled = (idx === rows.length - 1);
            }
          });
        }

        function persistAgendaOrder() {
          var list = getAgendaList(); if (!list) return;
          var meetingId = list.getAttribute('data-meeting-id');
          var ids = Array.from(list.querySelectorAll('.agenda-row')).map(function(r) {
            return parseInt(r.getAttribute('data-agenda-id'), 10);
          });
          fetch('/api/admin/meetings/' + meetingId + '/agenda/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
          }).catch(function(e) { console.error('Reorder failed', e); });
        }

        window.moveAgenda = function(agendaId, direction) {
          var list = getAgendaList(); if (!list) return;
          var row = list.querySelector('[data-agenda-id="' + agendaId + '"]'); if (!row) return;
          if (direction < 0 && row.previousElementSibling) {
            list.insertBefore(row, row.previousElementSibling);
          } else if (direction > 0 && row.nextElementSibling) {
            list.insertBefore(row.nextElementSibling, row);
          } else {
            return;
          }
          renumberAgenda();
          persistAgendaOrder();
        };

        // Drag-and-drop
        (function() {
          var list = getAgendaList(); if (!list) return;
          var dragSrc = null;
          list.addEventListener('dragstart', function(e) {
            var row = e.target.closest('.agenda-row');
            if (!row) return;
            dragSrc = row;
            row.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', row.getAttribute('data-agenda-id')); } catch(_){}
          });
          list.addEventListener('dragend', function(e) {
            var row = e.target.closest('.agenda-row');
            if (row) row.style.opacity = '';
            dragSrc = null;
          });
          list.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var row = e.target.closest('.agenda-row');
            if (!row || !dragSrc || row === dragSrc) return;
            var rect = row.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
              list.insertBefore(dragSrc, row);
            } else {
              list.insertBefore(dragSrc, row.nextElementSibling);
            }
          });
          list.addEventListener('drop', function(e) {
            e.preventDefault();
            renumberAgenda();
            persistAgendaOrder();
          });
        })();
      ` }} />
      <MemberPickerScript />
      <TaskCommentsScript />
      {/* expose huidige user voor delete-rechten */}
      <script dangerouslySetInnerHTML={{ __html: `window.__currentUserId = ${Number(user.id) || 0}; window.__isAdmin = ${user.role === 'admin' || user.role === 'moderator' ? 'true' : 'false'};` }} />
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
  const { meeting_id, titel, beschrijving, verantwoordelijke_id, deadline, prioriteit } = body
  // Prio default 2 (normaal), 1=hoog, 3=laag
  const prio = prioriteit ? Math.min(3, Math.max(1, Number(prioriteit))) : 2

  await c.env.DB.prepare(
    `INSERT INTO meeting_action_items (meeting_id, titel, beschrijving, verantwoordelijke_id, deadline, prioriteit)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(meeting_id, titel, beschrijving || '', verantwoordelijke_id || null, deadline || null, prio).run()

  // 📬 Notificatie versturen aan de verantwoordelijke (Dominique, 2026-07-07)
  // Zodat de persoon direct in de "Wat staat er open?"-stack op /leden ziet
  // dat er een taak op zijn/haar naam staat, met link naar /leden/taken.
  if (verantwoordelijke_id && Number(verantwoordelijke_id) > 0) {
    try {
      const meeting = await queryOne<any>(c.env.DB,
        `SELECT titel FROM meetings WHERE id = ? LIMIT 1`, [meeting_id])
      const dlText = deadline ? ` — deadline ${deadline}` : ''
      await createNotification(
        c.env.DB,
        Number(verantwoordelijke_id),
        'taak',
        `Nieuwe taak toegewezen${dlText}`,
        `"${titel}" uit vergadering "${meeting?.titel || 'onbekend'}"`,
        '/leden/taken'
      )
    } catch (e) {
      console.error('[meetings/actions/create] notificatie mislukt:', e)
    }
  }

  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

app.post('/api/admin/meetings/actions/status', async (c) => {
  const body = await c.req.parseBody()
  const { action_id, meeting_id, status } = body
  
  await c.env.DB.prepare(`UPDATE meeting_action_items SET status = ? WHERE id = ?`).bind(status, action_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

// Prioriteit van een actiepunt aanpassen via dropdown in de tabel
app.post('/api/admin/meetings/actions/prioriteit', async (c) => {
  const body = await c.req.parseBody()
  const { action_id, meeting_id, prioriteit } = body
  const prio = Math.min(3, Math.max(1, Number(prioriteit) || 2))
  await c.env.DB.prepare(`UPDATE meeting_action_items SET prioriteit = ? WHERE id = ?`).bind(prio, action_id).run()
  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

// Update full action item (titel/beschrijving/verantwoordelijke/deadline/prioriteit)
app.post('/api/admin/meetings/actions/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const { meeting_id, titel, beschrijving, verantwoordelijke_id, deadline, prioriteit } = body
  const prio = prioriteit ? Math.min(3, Math.max(1, Number(prioriteit))) : 2

  // Bewaar de vorige verantwoordelijke om alleen te notificeren bij wijziging
  const prevRow = await queryOne<any>(c.env.DB,
    `SELECT verantwoordelijke_id FROM meeting_action_items WHERE id = ? LIMIT 1`, [id])
  const prevRespId = prevRow?.verantwoordelijke_id ? Number(prevRow.verantwoordelijke_id) : null
  const newRespId = verantwoordelijke_id ? Number(verantwoordelijke_id) : null

  await c.env.DB.prepare(
    `UPDATE meeting_action_items
     SET titel = ?, beschrijving = ?, verantwoordelijke_id = ?, deadline = ?, prioriteit = ?
     WHERE id = ?`
  ).bind(
    titel,
    beschrijving || '',
    newRespId,
    deadline || null,
    prio,
    id
  ).run()

  // 📬 Notificatie enkel bij ECHTE wijziging naar een andere gebruiker.
  // Vermijdt spam bij simpele edit (deadline of titel aanpassen).
  if (newRespId && newRespId !== prevRespId) {
    try {
      const meeting = await queryOne<any>(c.env.DB,
        `SELECT titel FROM meetings WHERE id = ? LIMIT 1`, [meeting_id])
      const dlText = deadline ? ` — deadline ${deadline}` : ''
      await createNotification(
        c.env.DB,
        newRespId,
        'taak',
        `Taak toegewezen aan jou${dlText}`,
        `"${titel}" uit vergadering "${meeting?.titel || 'onbekend'}"`,
        '/leden/taken'
      )
    } catch (e) {
      console.error('[meetings/actions/update] notificatie mislukt:', e)
    }
  }

  return c.redirect(`/admin/meetings/${meeting_id}?tab=actions`)
})

// Update full agenda item (titel/beschrijving/duur/spreker)
app.post('/api/admin/meetings/agenda/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const { meeting_id, titel, beschrijving, duration, presenter } = body

  await c.env.DB.prepare(
    `UPDATE meeting_agenda_items
     SET titel = ?, beschrijving = ?, duur_minuten = ?, presentator_id = ?
     WHERE id = ?`
  ).bind(
    titel,
    beschrijving || '',
    duration ? Number(duration) : null,
    presenter ? Number(presenter) : null,
    id
  ).run()

  return c.redirect(`/admin/meetings/${meeting_id}?tab=agenda`)
})

// Reorder agendapunten: ontvang gesorteerde array van IDs en update volgorde-kolom
app.post('/api/admin/meetings/:meetingId/agenda/reorder', async (c) => {
  const meetingId = parseInt(c.req.param('meetingId'))
  if (!meetingId) return c.json({ error: 'meeting_id ontbreekt' }, 400)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const ids = Array.isArray(body?.ids) ? body.ids : null
  if (!ids) return c.json({ error: 'ids[] is verplicht' }, 400)

  for (let i = 0; i < ids.length; i++) {
    const id = parseInt(String(ids[i]))
    if (!id) continue
    await c.env.DB.prepare(
      `UPDATE meeting_agenda_items SET volgorde = ? WHERE id = ? AND meeting_id = ?`
    ).bind((i + 1) * 10, id, meetingId).run()
  }
  return c.json({ success: true })
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
