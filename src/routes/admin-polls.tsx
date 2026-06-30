// Admin Polls Management
// Create, Edit, Delete Polls and manage options

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole, requireBestuurslid } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware - only admin and moderator
app.use('/admin/*', requireAuth)
app.use('/admin/*', requireBestuurslid)

// =====================================================
// ADMIN POLLS OVERZICHT
// =====================================================

app.get('/admin/polls', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const filter = c.req.query('filter') || 'all'
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get all polls with statistics
  let pollsQuery = `
    SELECT 
      p.*,
      u.email as created_by_email,
      pr.voornaam,
      pr.achternaam,
      (SELECT COUNT(DISTINCT user_id) FROM poll_votes WHERE poll_id = p.id) as total_voters,
      (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes,
      (SELECT COUNT(*) FROM poll_options WHERE poll_id = p.id) as option_count
    FROM polls p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.status ${
      filter === 'open' ? "= 'open'" :
      filter === 'gesloten' ? "= 'gesloten'" :
      filter === 'concept' ? "= 'concept'" :
      "IN ('open', 'gesloten', 'concept')"
    }
    ORDER BY 
      CASE 
        WHEN p.status = 'concept' THEN 0
        WHEN p.status = 'open' THEN 1
        WHEN p.status = 'gesloten' THEN 2
        ELSE 3
      END,
      p.created_at DESC
  `

  const polls = await queryAll(c.env.DB, pollsQuery, [])

  return c.html(
    <Layout 
      title="Polls Beheer" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Polls', href: '/admin/polls' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-4">
            <a href="/admin" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar Admin Dashboard
            </a>
          </div>

          {/* Header */}
          <div class="mb-8">
            <div class="flex items-center justify-between">
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-poll text-animato-primary mr-3"></i>
                Polls Beheer
              </h1>
              <a 
                href="/admin/polls/nieuw" 
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
              >
                <i class="fas fa-plus mr-2"></i>
                Nieuwe Poll
              </a>
            </div>
            <p class="text-gray-600 mt-2">
              Beheer polls en stemmingen voor je koorleden
            </p>
          </div>

          {/* Success/Error Messages */}
          {success === 'created' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Poll succesvol aangemaakt!
            </div>
          )}
          {success === 'updated' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Poll succesvol bijgewerkt!
            </div>
          )}
          {success === 'deleted' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Poll succesvol verwijderd!
            </div>
          )}
          {success === 'status_changed' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Poll status succesvol gewijzigd!
            </div>
          )}
          {error === 'not_found' && (
            <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-exclamation-circle mr-3"></i>
              Poll niet gevonden.
            </div>
          )}

          {/* Filter Tabs */}
          <div class="mb-6 bg-white rounded-lg shadow p-1 inline-flex">
            <a 
              href="/admin/polls?filter=all" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'all' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Alle
            </a>
            <a 
              href="/admin/polls?filter=concept" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'concept' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Concepten
            </a>
            <a 
              href="/admin/polls?filter=open" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'open' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Open
            </a>
            <a 
              href="/admin/polls?filter=gesloten" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'gesloten' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Gesloten
            </a>
          </div>

          {/* Polls List */}
          {polls.length === 0 ? (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-inbox text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">Geen polls gevonden</h3>
              <p class="text-gray-600 mb-6">
                {filter === 'all' 
                  ? 'Er zijn nog geen polls aangemaakt.' 
                  : `Er zijn geen polls met status "${filter}".`}
              </p>
              <a 
                href="/admin/polls/nieuw" 
                class="inline-flex items-center bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                <i class="fas fa-plus mr-2"></i>
                Maak je eerste poll
              </a>
            </div>
          ) : (
            <div class="space-y-4">
              {polls.map((poll: any) => (
                <div class="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6">
                  <div class="flex items-start justify-between">
                    
                    <div class="flex-1">
                      <div class="flex items-start justify-between mb-3">
                        <div class="flex-1">
                          <h3 class="text-xl font-bold text-gray-900 mb-2">
                            {poll.titel}
                          </h3>
                          
                          {/* Status & Type Badges */}
                          <div class="flex items-center gap-2 mb-3">
                            {poll.status === 'open' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <i class="fas fa-check-circle mr-1"></i>
                                Open
                              </span>
                            )}
                            {poll.status === 'gesloten' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                <i class="fas fa-lock mr-1"></i>
                                Gesloten
                              </span>
                            )}
                            {poll.status === 'concept' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                <i class="fas fa-edit mr-1"></i>
                                Concept
                              </span>
                            )}
                            
                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {poll.type === 'repertoire' && <i class="fas fa-music mr-1"></i>}
                              {poll.type === 'datum' && <i class="fas fa-calendar mr-1"></i>}
                              {poll.type === 'locatie' && <i class="fas fa-map-marker-alt mr-1"></i>}
                              {poll.type === 'activiteit' && <i class="fas fa-star mr-1"></i>}
                              {poll.type === 'bestuur' && <i class="fas fa-users mr-1"></i>}
                              {poll.type === 'algemeen' && <i class="fas fa-comment mr-1"></i>}
                              {poll.type.charAt(0).toUpperCase() + poll.type.slice(1)}
                            </span>

                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              <i class="fas fa-users mr-1"></i>
                              {poll.doelgroep === 'all' ? 'Alle leden' : poll.doelgroep}
                            </span>
                          </div>

                          {poll.beschrijving && (
                            <p class="text-gray-700 mb-3 line-clamp-2">
                              {poll.beschrijving}
                            </p>
                          )}

                          {/* Stats */}
                          <div class="flex items-center gap-4 text-sm text-gray-600">
                            <span>
                              <i class="fas fa-list mr-1"></i>
                              {poll.option_count} opties
                            </span>
                            <span>
                              <i class="fas fa-users mr-1"></i>
                              {poll.total_voters} stemmer{poll.total_voters !== 1 ? 's' : ''}
                            </span>
                            <span>
                              <i class="fas fa-vote-yea mr-1"></i>
                              {poll.total_votes} stem{poll.total_votes !== 1 ? 'men' : ''}
                            </span>
                            {poll.max_stemmen > 1 && (
                              <span>
                                <i class="fas fa-check-double mr-1"></i>
                                Max {poll.max_stemmen} keuzes
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Meta Info */}
                      <div class="flex items-center justify-between text-sm text-gray-500 mt-4">
                        <div class="flex items-center gap-4">
                          <span>
                            <i class="fas fa-user mr-1"></i>
                            {poll.voornaam} {poll.achternaam}
                          </span>
                          <span>
                            <i class="fas fa-clock mr-1"></i>
                            {new Date(poll.created_at).toLocaleDateString('nl-NL', { 
                              day: 'numeric', 
                              month: 'short', 
                              year: 'numeric' 
                            })}
                          </span>
                          {poll.eind_datum && (
                            <span class={new Date(poll.eind_datum) < new Date() ? 'text-red-600' : ''}>
                              <i class="fas fa-hourglass-end mr-1"></i>
                              Sluit {new Date(poll.eind_datum).toLocaleDateString('nl-NL', { 
                                day: 'numeric', 
                                month: 'short' 
                              })}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div class="flex items-center gap-2 flex-wrap">
                          <a
                            href={`/admin/polls/${poll.id}/resultaten`}
                            class="px-3 py-1 text-animato-primary hover:bg-cyan-50 rounded transition text-sm font-semibold border border-animato-primary/30"
                            title="Bekijk wie wat gestemd heeft"
                          >
                            <i class="fas fa-chart-bar mr-1"></i>
                            Resultaten
                          </a>
                          <a 
                            href={`/leden/polls/${poll.id}`}
                            class="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded transition text-sm"
                          >
                            <i class="fas fa-external-link-alt mr-1"></i>
                            Bekijk
                          </a>
                          <a 
                            href={`/admin/polls/${poll.id}/edit`}
                            class="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded transition text-sm"
                          >
                            <i class="fas fa-edit mr-1"></i>
                            Bewerk
                          </a>
                          
                          {/* Status toggle */}
                          {poll.status === 'concept' && (
                            <form method="POST" action={`/api/admin/polls/${poll.id}/status`} class="inline">
                              <input type="hidden" name="status" value="open" />
                              <button 
                                type="submit"
                                class="px-3 py-1 text-green-600 hover:bg-green-50 rounded transition text-sm"
                              >
                                <i class="fas fa-play mr-1"></i>
                                Open
                              </button>
                            </form>
                          )}
                          {poll.status === 'open' && (
                            <form method="POST" action={`/api/admin/polls/${poll.id}/status`} class="inline">
                              <input type="hidden" name="status" value="gesloten" />
                              <button 
                                type="submit"
                                class="px-3 py-1 text-orange-600 hover:bg-orange-50 rounded transition text-sm"
                              >
                                <i class="fas fa-lock mr-1"></i>
                                Sluit
                              </button>
                            </form>
                          )}
                          
                          <form 
                            id={`delete-poll-${poll.id}`}
                            method="POST" 
                            action={`/api/admin/polls/${poll.id}/delete`}
                            onsubmit="event.preventDefault(); openDeleteModal(this.id, 'Weet je zeker dat je deze poll wilt verwijderen? Alle stemmen worden ook verwijderd.')"
                            class="inline"
                          >
                            <button 
                              type="submit"
                              class="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition text-sm"
                            >
                              <i class="fas fa-trash mr-1"></i>
                              Verwijder
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}

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
                    <p class="text-sm text-gray-500" id="deleteModalBody">
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

        function openDeleteModal(formId, message = null) {
          deleteFormId = formId;
          if (message) {
             const body = document.getElementById('deleteModalBody');
             if (body) body.innerText = message;
          }
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
// NIEUWE POLL AANMAKEN
// =====================================================

app.get('/admin/polls/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  return c.html(
    <Layout 
      title="Nieuwe Poll" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Polls', href: '/admin/polls' },
        { label: 'Nieuw', href: '/admin/polls/nieuw' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-poll text-animato-primary mr-3"></i>
              Nieuwe Poll Aanmaken
            </h1>
            <p class="text-gray-600 mt-2">
              Maak een nieuwe poll aan voor je koorleden
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-md p-8">
            <form method="POST" action="/api/admin/polls/create" id="pollForm">
              
              {/* Titel */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  name="titel"
                  required
                  maxlength="200"
                  placeholder="Bijv. Welk werk willen we dit seizoen zingen?"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Beschrijving */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving (optioneel)
                  <span class="text-xs font-normal text-gray-500 ml-2">— max 1000 tekens, het tekstvak scrollt en is verticaal vergrootbaar</span>
                </label>
                <textarea
                  name="beschrijving"
                  rows="6"
                  maxlength="1000"
                  placeholder="Extra context of uitleg over deze poll. Je kan hier rustig een langere uitleg kwijt — het vak scrollt automatisch als de tekst te lang wordt, en je kan het manueel verticaal groter slepen via de hoek rechtsonder."
                  oninput="const c=document.getElementById('beschr-counter-new');if(c){c.textContent=this.value.length;c.parentElement.classList.toggle('text-amber-600',this.value.length>900);c.parentElement.classList.toggle('text-red-600',this.value.length>=1000)}"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-y min-h-[10rem] max-h-[24rem] overflow-y-auto leading-relaxed"
                ></textarea>
                <div class="text-xs text-gray-500 text-right mt-1">
                  <span id="beschr-counter-new">0</span> / 1000 tekens
                </div>
              </div>

              <div class="grid grid-cols-2 gap-6 mb-6">
                {/* Type */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Type <span class="text-red-500">*</span>
                  </label>
                  <select 
                    name="type"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="repertoire">Repertoire</option>
                    <option value="datum">Datum</option>
                    <option value="locatie">Locatie</option>
                    <option value="activiteit">Activiteit</option>
                    <option value="bestuur">Bestuur</option>
                    <option value="algemeen">Algemeen</option>
                  </select>
                </div>

                {/* Doelgroep */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Doelgroep <span class="text-red-500">*</span>
                  </label>
                  <select 
                    name="doelgroep"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="all">Alle leden</option>
                    <option value="S">Sopraan</option>
                    <option value="A">Alt</option>
                    <option value="T">Tenor</option>
                    <option value="B">Bas</option>
                    <option value="SATB">Alle zangers</option>
                    <option value="bestuur">Bestuur</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-6 mb-6">
                {/* Status */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Status <span class="text-red-500">*</span>
                  </label>
                  <select 
                    name="status"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="concept">Concept (niet zichtbaar)</option>
                    <option value="open">Open (leden kunnen stemmen)</option>
                    <option value="gesloten">Gesloten (alleen resultaten)</option>
                  </select>
                </div>

                {/* Max stemmen */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Maximum aantal keuzes <span class="text-red-500">*</span>
                  </label>
                  <input 
                    type="number" 
                    name="max_stemmen"
                    required
                    min="1"
                    max="10"
                    value="1"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <p class="text-sm text-gray-500 mt-1">
                    1 = Single choice, &gt;1 = Multiple choice
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-6 mb-6">
                {/* Einddatum */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Einddatum (optioneel)
                  </label>
                  <input 
                    type="date" 
                    name="eind_datum"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                {/* Toon resultaten */}
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Resultaten tonen <span class="text-red-500">*</span>
                  </label>
                  <select 
                    name="toon_resultaten"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  >
                    <option value="after_vote">Na stemmen</option>
                    <option value="always">Altijd</option>
                    <option value="after_close">Alleen na sluiting</option>
                  </select>
                </div>
              </div>

              {/* Anonimiteit — expliciete keuze */}
              <div class="mb-8">
                <label class="block text-sm font-medium text-gray-700 mb-3">
                  <i class="fas fa-user-shield mr-1 text-animato-primary"></i>
                  Zichtbaarheid van stemmen <span class="text-red-500">*</span>
                </label>
                <div class="space-y-2">
                  <label class="flex items-start gap-3 p-3 border-2 border-animato-primary bg-cyan-50 rounded-lg cursor-pointer hover:bg-cyan-100 transition has-[:checked]:border-animato-primary has-[:checked]:bg-cyan-50">
                    <input
                      type="radio"
                      name="anoniem"
                      value="0"
                      checked
                      class="w-5 h-5 mt-0.5 text-animato-primary focus:ring-2 focus:ring-animato-primary"
                    />
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-gray-900">
                        <i class="fas fa-eye mr-1 text-green-600"></i>
                        Niet anoniem — admin ziet wie wat stemde
                      </div>
                      <div class="text-xs text-gray-600 mt-1">
                        Aanbevolen voor de meeste polls. Admins kunnen in het resultaten-overzicht zien welk lid welke optie koos. Stemmers blijven onderling onbekend.
                      </div>
                    </div>
                  </label>
                  <label class="flex items-start gap-3 p-3 border-2 border-gray-200 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50">
                    <input
                      type="radio"
                      name="anoniem"
                      value="1"
                      class="w-5 h-5 mt-0.5 text-amber-600 focus:ring-2 focus:ring-amber-500"
                    />
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-gray-900">
                        <i class="fas fa-user-secret mr-1 text-amber-600"></i>
                        Anoniem — niemand ziet wie wat stemde
                      </div>
                      <div class="text-xs text-gray-600 mt-1">
                        Voor gevoelige onderwerpen (bv. bestuursverkiezingen). Ook admins zien enkel totalen per stemgroep, geen namen. <strong>Niet terug te draaien</strong> na de eerste stem.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <hr class="my-8" />

              {/* Poll Opties */}
              <div class="mb-8">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  Poll Opties <span class="text-red-500">*</span>
                </h3>

                <div class="space-y-3">
                  {/* Option 1 */}
                  <div class="flex items-start gap-3">
                    <div class="flex-1">
                      <input 
                        type="text" 
                        name="option_1_text"
                        required
                        placeholder="Optie 1 (bijv. Requiem van Fauré)"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <input 
                        type="text" 
                        name="option_1_desc"
                        placeholder="Beschrijving (optioneel)"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent mt-2 text-sm"
                      />
                    </div>
                  </div>

                  {/* Option 2 */}
                  <div class="flex items-start gap-3">
                    <div class="flex-1">
                      <input 
                        type="text" 
                        name="option_2_text"
                        required
                        placeholder="Optie 2 (bijv. Carmina Burana)"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <input 
                        type="text" 
                        name="option_2_desc"
                        placeholder="Beschrijving (optioneel)"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent mt-2 text-sm"
                      />
                    </div>
                  </div>

                  {/* Option 3 */}
                  <div class="flex items-start gap-3">
                    <div class="flex-1">
                      <input 
                        type="text" 
                        name="option_3_text"
                        placeholder="Optie 3 (optioneel)"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <input 
                        type="text" 
                        name="option_3_desc"
                        placeholder="Beschrijving (optioneel)"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent mt-2 text-sm"
                      />
                    </div>
                  </div>

                  {/* Option 4 */}
                  <div class="flex items-start gap-3">
                    <div class="flex-1">
                      <input 
                        type="text" 
                        name="option_4_text"
                        placeholder="Optie 4 (optioneel)"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <input 
                        type="text" 
                        name="option_4_desc"
                        placeholder="Beschrijving (optioneel)"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent mt-2 text-sm"
                      />
                    </div>
                  </div>

                  {/* Option 5 */}
                  <div class="flex items-start gap-3">
                    <div class="flex-1">
                      <input 
                        type="text" 
                        name="option_5_text"
                        placeholder="Optie 5 (optioneel)"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <input 
                        type="text" 
                        name="option_5_desc"
                        placeholder="Beschrijving (optioneel)"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent mt-2 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <p class="text-sm text-gray-500 mt-3">
                  <i class="fas fa-info-circle mr-1"></i>
                  Minimaal 2 opties vereist, maximaal 5 opties
                </p>
              </div>

              {/* Buttons */}
              <div class="flex items-center justify-end gap-4">
                <a 
                  href="/admin/polls"
                  class="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                >
                  Annuleren
                </a>
                <button 
                  type="submit"
                  class="bg-animato-primary hover:bg-animato-primary-dark text-white px-8 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
                >
                  <i class="fas fa-save mr-2"></i>
                  Poll Aanmaken
                </button>
              </div>

            </form>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// EDIT POLL PAGE
// =====================================================

app.get('/admin/polls/:id/edit', async (c) => {
  const user = c.get('user') as SessionUser
  const pollId = c.req.param('id')
  noCacheHeaders(c)

  // Get poll details
  const poll = await queryOne(c.env.DB, `
    SELECT p.*, u.email as created_by_email
    FROM polls p
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.id = ?
  `, [pollId])

  if (!poll) {
    return c.redirect('/admin/polls?error=not_found')
  }

  // Get poll options
  const options = await queryAll(c.env.DB, `
    SELECT id, optie_tekst, optie_beschrijving, volgorde
    FROM poll_options
    WHERE poll_id = ?
    ORDER BY volgorde ASC, id ASC
  `, [pollId])

  return c.html(
    <Layout 
      title={`Bewerk Poll: ${poll.titel}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Polls', href: '/admin/polls' },
        { label: 'Bewerken', href: `/admin/polls/${pollId}/edit` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-edit text-animato-primary mr-3"></i>
              Poll Bewerken
            </h1>
            <p class="text-gray-600 mt-2">
              Wijzig de gegevens en opties van deze poll
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-md p-8">
            <form method="POST" action={`/api/admin/polls/${pollId}/update`} id="pollForm">
              
              {/* Titel */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  name="titel"
                  value={poll.titel}
                  required
                  maxlength="200"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Beschrijving */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving (optioneel)
                  <span class="text-xs font-normal text-gray-500 ml-2">— max 1000 tekens, het tekstvak scrollt en is verticaal vergrootbaar</span>
                </label>
                <textarea
                  name="beschrijving"
                  rows="6"
                  maxlength="1000"
                  oninput="const c=document.getElementById('beschr-counter-edit');if(c){c.textContent=this.value.length;c.parentElement.classList.toggle('text-amber-600',this.value.length>900);c.parentElement.classList.toggle('text-red-600',this.value.length>=1000)}"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-y min-h-[10rem] max-h-[24rem] overflow-y-auto leading-relaxed"
                >{poll.beschrijving || ''}</textarea>
                <div class="text-xs text-gray-500 text-right mt-1">
                  <span id="beschr-counter-edit">{(poll.beschrijving || '').length}</span> / 1000 tekens
                </div>
              </div>

              {/* Type */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Type <span class="text-red-500">*</span>
                </label>
                <select 
                  name="type" 
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="repertoire" selected={poll.type === 'repertoire'}>🎵 Repertoire</option>
                  <option value="datum" selected={poll.type === 'datum'}>📅 Datum</option>
                  <option value="locatie" selected={poll.type === 'locatie'}>📍 Locatie</option>
                  <option value="activiteit" selected={poll.type === 'activiteit'}>🎉 Activiteit</option>
                  <option value="bestuur" selected={poll.type === 'bestuur'}>👔 Bestuur</option>
                  <option value="algemeen" selected={poll.type === 'algemeen'}>📋 Algemeen</option>
                </select>
              </div>

              {/* Doelgroep */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Doelgroep <span class="text-red-500">*</span>
                </label>
                <select 
                  name="doelgroep" 
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="all" selected={poll.doelgroep === 'all'}>👥 Alle leden</option>
                  <option value="sopraan" selected={poll.doelgroep === 'sopraan'}>🎤 Sopraan</option>
                  <option value="alt" selected={poll.doelgroep === 'alt'}>🎤 Alt</option>
                  <option value="tenor" selected={poll.doelgroep === 'tenor'}>🎤 Tenor</option>
                  <option value="bas" selected={poll.doelgroep === 'bas'}>🎤 Bas</option>
                  <option value="zangers" selected={poll.doelgroep === 'zangers'}>🎶 Alle zangers</option>
                  <option value="bestuur" selected={poll.doelgroep === 'bestuur'}>👔 Bestuur</option>
                </select>
              </div>

              {/* Max stemmen */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Max aantal keuzes per lid <span class="text-red-500">*</span>
                </label>
                <input 
                  type="number" 
                  name="max_stemmen"
                  value={poll.max_stemmen}
                  min="1"
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Einddatum */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Einddatum (optioneel)
                </label>
                <input 
                  type="datetime-local" 
                  name="eind_datum"
                  value={poll.eind_datum ? poll.eind_datum.slice(0, 16) : ''}
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Status */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Status <span class="text-red-500">*</span>
                </label>
                <select 
                  name="status" 
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="concept" selected={poll.status === 'concept'}>📝 Concept</option>
                  <option value="open" selected={poll.status === 'open'}>✅ Open</option>
                  <option value="gesloten" selected={poll.status === 'gesloten'}>🔒 Gesloten</option>
                </select>
              </div>

              {/* Toon resultaten */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Wanneer resultaten tonen? <span class="text-red-500">*</span>
                </label>
                <select 
                  name="toon_resultaten" 
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="altijd" selected={poll.toon_resultaten === 'altijd'}>👁️ Altijd zichtbaar</option>
                  <option value="na_stemmen" selected={poll.toon_resultaten === 'na_stemmen'}>✅ Na stemmen</option>
                  <option value="na_sluiting" selected={poll.toon_resultaten === 'na_sluiting'}>🔒 Na sluiting</option>
                </select>
              </div>

              {/* Anonimiteit — expliciete keuze */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-3">
                  <i class="fas fa-user-shield mr-1 text-animato-primary"></i>
                  Zichtbaarheid van stemmen <span class="text-red-500">*</span>
                </label>
                <div class="space-y-2">
                  <label class={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition ${poll.anoniem !== 1 ? 'border-animato-primary bg-cyan-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <input
                      type="radio"
                      name="anoniem"
                      value="0"
                      checked={poll.anoniem !== 1}
                      class="w-5 h-5 mt-0.5 text-animato-primary focus:ring-2 focus:ring-animato-primary"
                    />
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-gray-900">
                        <i class="fas fa-eye mr-1 text-green-600"></i>
                        Niet anoniem — admin ziet wie wat stemde
                      </div>
                      <div class="text-xs text-gray-600 mt-1">
                        Aanbevolen voor de meeste polls. Admins kunnen in het resultaten-overzicht zien welk lid welke optie koos.
                      </div>
                    </div>
                  </label>
                  <label class={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition ${poll.anoniem === 1 ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <input
                      type="radio"
                      name="anoniem"
                      value="1"
                      checked={poll.anoniem === 1}
                      class="w-5 h-5 mt-0.5 text-amber-600 focus:ring-2 focus:ring-amber-500"
                    />
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-gray-900">
                        <i class="fas fa-user-secret mr-1 text-amber-600"></i>
                        Anoniem — niemand ziet wie wat stemde
                      </div>
                      <div class="text-xs text-gray-600 mt-1">
                        Voor gevoelige onderwerpen (bv. bestuursverkiezingen). Ook admins zien enkel totalen per stemgroep, geen namen.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Poll Opties */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-4">
                  Opties <span class="text-red-500">*</span> (minimaal 2)
                </label>
                
                <div id="pollOptions" class="space-y-3">
                  {options.map((option, index) => (
                    <div class="flex items-center gap-3 poll-option-row">
                      <span class="text-gray-500 font-medium min-w-[2rem]">{index + 1}.</span>
                      <input 
                        type="text" 
                        name={`option_${index}_text`}
                        value={option.optie_tekst}
                        required
                        maxlength="200"
                        placeholder={`Optie ${index + 1}`}
                        class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      {index > 1 && (
                        <button 
                          type="button" 
                          onclick="this.closest('.poll-option-row').remove()" 
                          class="text-red-600 hover:text-red-700"
                        >
                          <i class="fas fa-times-circle text-xl"></i>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button 
                  type="button" 
                  id="addOption"
                  class="mt-4 text-animato-primary hover:text-animato-primary-dark font-medium inline-flex items-center"
                >
                  <i class="fas fa-plus-circle mr-2"></i>
                  Optie toevoegen
                </button>
              </div>

              {/* Actions */}
              <div class="flex items-center justify-between pt-6 border-t border-gray-200">
                <div class="flex gap-2">
                  <a 
                    href="/admin/polls"
                    class="text-gray-700 hover:text-gray-900 font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Annuleren
                  </a>
                  <button 
                    type="button"
                    onclick={`openDeleteModal('delete-poll-form', 'Weet je zeker dat je deze poll wilt verwijderen?')`}
                    class="text-red-600 hover:text-red-800 font-medium px-4 py-2 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <i class="fas fa-trash mr-2"></i>
                    Verwijder Poll
                  </button>
                </div>
                <button 
                  type="submit"
                  class="bg-animato-primary hover:bg-animato-primary-dark text-white px-8 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
                >
                  <i class="fas fa-save mr-2"></i>
                  Wijzigingen Opslaan
                </button>
              </div>

            </form>
            
            {/* Hidden Delete Form */}
            <form id="delete-poll-form" method="POST" action={`/api/admin/polls/${pollId}/delete`} class="hidden"></form>
          </div>

        </div>
      </div>

      {/* JavaScript for dynamic options */}
      <script dangerouslySetInnerHTML={{
        __html: `
          let optionCount = ${options.length};
          
          document.getElementById('addOption').addEventListener('click', function() {
            const container = document.getElementById('pollOptions');
            const div = document.createElement('div');
            div.className = 'flex items-center gap-3 poll-option-row';
            div.innerHTML = \`
              <span class="text-gray-500 font-medium min-w-[2rem]">\${optionCount + 1}.</span>
              <input 
                type="text" 
                name="option_\${optionCount}_text"
                required
                maxlength="200"
                placeholder="Optie \${optionCount + 1}"
                class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
              />
              <button 
                type="button" 
                onclick="this.closest('.poll-option-row').remove()" 
                class="text-red-600 hover:text-red-700"
              >
                <i class="fas fa-times-circle text-xl"></i>
              </button>
            \`;
            container.appendChild(div);
            optionCount++;
          });
        `
      }} />
    </Layout>
  )
})

// =====================================================
// API: UPDATE POLL
// =====================================================

app.post('/api/admin/polls/:id/update', async (c) => {
  const user = c.get('user') as SessionUser
  const pollId = c.req.param('id')
  const body = await c.req.parseBody()

  // Extract poll data
  const titel = body.titel as string
  const beschrijving = (body.beschrijving as string) || null
  const type = body.type as string
  const doelgroep = body.doelgroep as string
  const status = body.status as string
  const max_stemmen = parseInt(body.max_stemmen as string)
  const eind_datum = (body.eind_datum as string) || null
  const toon_resultaten = body.toon_resultaten as string
  // Radio-pair stuurt "0" of "1" als string — beide truthy, dus expliciet vergelijken
  const anoniem = body.anoniem === '1' ? 1 : 0

  // Validation
  if (!titel || !type || !doelgroep || !status || !max_stemmen || !toon_resultaten) {
    return c.redirect(`/admin/polls/${pollId}/edit?error=missing_fields`)
  }

  // Extract options
  const optionKeys = Object.keys(body).filter(key => key.startsWith('option_') && key.endsWith('_text'))
  const options = optionKeys.map(key => body[key] as string).filter(text => text.trim() !== '')

  if (options.length < 2) {
    return c.redirect(`/admin/polls/${pollId}/edit?error=min_options`)
  }

  try {
    // Update poll
    await execute(c.env.DB, `
      UPDATE polls 
      SET titel = ?, beschrijving = ?, type = ?, doelgroep = ?, status = ?,
          max_stemmen = ?, eind_datum = ?, toon_resultaten = ?, anoniem = ?
      WHERE id = ?
    `, [titel, beschrijving, type, doelgroep, status, max_stemmen, eind_datum, toon_resultaten, anoniem, pollId])

    // Delete old options
    await execute(c.env.DB, `DELETE FROM poll_options WHERE poll_id = ?`, [pollId])

    // Insert new options
    for (let i = 0; i < options.length; i++) {
      await execute(c.env.DB, `
        INSERT INTO poll_options (poll_id, optie_tekst, optie_beschrijving, volgorde) VALUES (?, ?, NULL, ?)
      `, [pollId, options[i], i])
    }

    return c.redirect('/admin/polls?success=updated', 303)
  } catch (error) {
    console.error('Update poll error:', error)
    return c.redirect(`/admin/polls/${pollId}/edit?error=update_failed`)
  }
})

// =====================================================
// API: CREATE POLL
// =====================================================

app.post('/api/admin/polls/create', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()

  // Extract poll data
  const titel = body.titel as string
  const beschrijving = (body.beschrijving as string) || null
  const type = body.type as string
  const doelgroep = body.doelgroep as string
  const status = body.status as string
  const max_stemmen = parseInt(body.max_stemmen as string)
  const eind_datum = (body.eind_datum as string) || null
  const toon_resultaten = body.toon_resultaten as string
  // Radio-pair stuurt "0" of "1" als string — beide truthy, dus expliciet vergelijken
  const anoniem = body.anoniem === '1' ? 1 : 0

  // Validation
  if (!titel || !type || !doelgroep || !status || !max_stemmen || !toon_resultaten) {
    return c.redirect('/admin/polls/nieuw?error=missing_fields')
  }

  // Extract options
  const options: Array<{text: string, desc: string | null}> = []
  const keys = Object.keys(body)
  const optionNumbers = new Set<number>()
  
  keys.forEach(key => {
    const match = key.match(/^option_(\d+)_text$/)
    if (match) {
      optionNumbers.add(parseInt(match[1]))
    }
  })

  Array.from(optionNumbers).sort((a, b) => a - b).forEach((num, index) => {
    const text = body[`option_${num}_text`] as string
    const desc = (body[`option_${num}_desc`] as string) || null
    if (text && text.trim()) {
      options.push({ text: text.trim(), desc })
    }
  })

  if (options.length < 2) {
    return c.redirect('/admin/polls/nieuw?error=insufficient_options')
  }

  // Insert poll
  const result = await c.env.DB.prepare(`
    INSERT INTO polls (
      titel, beschrijving, type, created_by, doelgroep, status, 
      eind_datum, max_stemmen, toon_resultaten, anoniem
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    titel, beschrijving, type, user.id, doelgroep, status,
    eind_datum, max_stemmen, toon_resultaten, anoniem
  ).run()

  const pollId = result.meta.last_row_id

  // Insert options
  for (let i = 0; i < options.length; i++) {
    await c.env.DB.prepare(`
      INSERT INTO poll_options (poll_id, optie_tekst, optie_beschrijving, volgorde)
      VALUES (?, ?, ?, ?)
    `).bind(pollId, options[i].text, options[i].desc, i).run()
  }

  return c.redirect('/admin/polls?success=created')
})

// =====================================================
// API: CHANGE POLL STATUS
// =====================================================

app.post('/api/admin/polls/:id/status', async (c) => {
  const pollId = c.req.param('id')
  const body = await c.req.parseBody()
  const newStatus = body.status as string

  if (!['open', 'gesloten', 'concept'].includes(newStatus)) {
    return c.redirect('/admin/polls?error=invalid_status')
  }

  await c.env.DB.prepare(
    `UPDATE polls SET status = ? WHERE id = ?`
  ).bind(newStatus, pollId).run()

  return c.redirect('/admin/polls?success=status_changed')
})

// =====================================================
// API: DELETE POLL
// =====================================================

app.post('/api/admin/polls/:id/delete', async (c) => {
  const pollId = c.req.param('id')

  // Cascade delete handled by foreign keys
  await c.env.DB.prepare(
    `DELETE FROM polls WHERE id = ?`
  ).bind(pollId).run()

  return c.redirect('/admin/polls?success=deleted')
})

// =====================================================
// ADMIN: RESULTATEN-OVERZICHT (wie stemde wat)
// =====================================================
// Toont voor één poll een overzicht van wie wat gestemd heeft.
// Respecteert poll.anoniem=1 (toon dan ENKEL geaggregeerde tellingen).
// Datamodel: poll_votes (poll_id, option_id, user_id, created_at), niet 1 rij
// per kiezer maar 1 rij per (kiezer, optie). Bij max_stemmen>1 kan dezelfde
// user_id dus meerdere keren voorkomen.

// Avatar-mapping per stemgroep (consistent met leden.tsx)
function avatarForStemgroep(s: string | null | undefined): string {
  switch (s) {
    case 'S': return '/static/avatars/sopraan-callas.webp'
    case 'A': return '/static/avatars/alt-bartoli.webp'
    case 'T': return '/static/avatars/tenor-pavarotti.webp'
    case 'B': return '/static/avatars/bas-terfel.webp'
    default:  return '/static/avatars/tenor-pavarotti.webp'
  }
}

function stemgroepLabel(s: string | null | undefined): string {
  switch (s) {
    case 'S': return 'Sopraan'
    case 'A': return 'Alt'
    case 'T': return 'Tenor'
    case 'B': return 'Bas'
    default:  return 'Onbekend'
  }
}

function stemgroepBadgeClasses(s: string | null | undefined): string {
  // Consistent met admin.tsx kleurconventie
  switch (s) {
    case 'S': return 'bg-pink-100 text-pink-800'
    case 'A': return 'bg-purple-100 text-purple-800'
    case 'T': return 'bg-green-100 text-green-800'
    case 'B': return 'bg-blue-100 text-blue-800'
    default:  return 'bg-gray-100 text-gray-700'
  }
}

app.get('/admin/polls/:id/resultaten', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const pollId = parseInt(c.req.param('id'))
  if (!pollId) return c.redirect('/admin/polls?error=invalid_id')

  // Poll-metadata
  const poll = await queryOne<any>(c.env.DB, `
    SELECT p.*,
           u.email AS created_by_email,
           pr.voornaam AS creator_voornaam,
           pr.achternaam AS creator_achternaam
    FROM polls p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.id = ?
  `, [pollId])

  if (!poll) {
    return c.redirect('/admin/polls?error=not_found')
  }

  // Opties met aantal stemmen
  const options = await queryAll<any>(c.env.DB, `
    SELECT o.id, o.optie_tekst, o.optie_beschrijving, o.volgorde,
           (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) AS vote_count
    FROM poll_options o
    WHERE o.poll_id = ?
    ORDER BY o.volgorde ASC, o.id ASC
  `, [pollId])

  // Stemmen met user-info — alleen ophalen als poll NIET anoniem is
  const isAnoniem = poll.anoniem === 1
  const votesWithUsers = isAnoniem ? [] : await queryAll<any>(c.env.DB, `
    SELECT v.id AS vote_id, v.option_id, v.user_id, v.created_at,
           u.email, u.stemgroep, u.status AS user_status,
           pr.voornaam, pr.achternaam, pr.foto_url
    FROM poll_votes v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE v.poll_id = ?
    ORDER BY v.created_at ASC
  `, [pollId])

  // Bij anonieme poll: aggregeer per (option_id, stemgroep) zonder user_id te onthullen
  const anoniemBreakdown = !isAnoniem ? [] : await queryAll<any>(c.env.DB, `
    SELECT v.option_id, u.stemgroep, COUNT(*) AS cnt
    FROM poll_votes v
    JOIN users u ON u.id = v.user_id
    WHERE v.poll_id = ?
    GROUP BY v.option_id, u.stemgroep
    ORDER BY v.option_id, u.stemgroep
  `, [pollId])

  // Totaal aantal unieke kiezers + stemmen
  const totals = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) AS total_votes, COUNT(DISTINCT user_id) AS total_voters
    FROM poll_votes WHERE poll_id = ?
  `, [pollId])
  const totalVotes = totals?.total_votes || 0
  const totalVoters = totals?.total_voters || 0

  // Doelgroep: hoeveel leden konden stemmen? (voor opkomst-percentage)
  let doelgroepFilter = ''
  if (poll.doelgroep === 'S' || poll.doelgroep === 'A' || poll.doelgroep === 'T' || poll.doelgroep === 'B') {
    doelgroepFilter = `AND stemgroep = '${poll.doelgroep}'`
  } else if (poll.doelgroep === 'bestuur') {
    doelgroepFilter = `AND is_bestuurslid = 1`
  }
  // 'all' en 'SATB' = geen extra filter (= alle actieve leden)
  const eligible = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) AS n FROM users
    WHERE status = 'active' AND is_test_account = 0 ${doelgroepFilter}
  `, [])
  const totalEligible = eligible?.n || 0
  const opkomst = totalEligible > 0 ? Math.round((totalVoters / totalEligible) * 100) : 0

  // Wie heeft nog NIET gestemd? (handig voor herinneringen)
  // Alleen ophalen voor NIET-anonieme polls
  const nietGestemd = isAnoniem ? [] : await queryAll<any>(c.env.DB, `
    SELECT u.id, u.email, u.stemgroep,
           pr.voornaam, pr.achternaam, pr.foto_url
    FROM users u
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE u.status = 'active' AND u.is_test_account = 0 ${doelgroepFilter}
      AND u.id NOT IN (SELECT user_id FROM poll_votes WHERE poll_id = ?)
    ORDER BY u.stemgroep ASC, pr.voornaam ASC, pr.achternaam ASC
  `, [pollId])

  // Bouw lookup: option_id → lijst stemmers (voor de UI)
  const votersByOption = new Map<number, any[]>()
  for (const o of options) votersByOption.set(o.id, [])
  for (const v of votesWithUsers) {
    const arr = votersByOption.get(v.option_id)
    if (arr) arr.push(v)
  }

  // Bouw lookup: option_id → { S: n, A: n, T: n, B: n, X: n } voor anoniem-modus
  const anonByOption = new Map<number, Record<string, number>>()
  for (const o of options) anonByOption.set(o.id, { S: 0, A: 0, T: 0, B: 0, X: 0 })
  for (const r of anoniemBreakdown) {
    const bucket = anonByOption.get(r.option_id)
    if (!bucket) continue
    const key = (r.stemgroep === 'S' || r.stemgroep === 'A' || r.stemgroep === 'T' || r.stemgroep === 'B') ? r.stemgroep : 'X'
    bucket[key] = (bucket[key] || 0) + r.cnt
  }

  // Max vote_count voor balk-schaling
  const maxVotes = Math.max(1, ...options.map((o: any) => o.vote_count || 0))

  // Helper voor formatteren created_at (DB-string, geen TZ info → toon ruw "dd-mm HH:MM")
  function fmtDate(s: string | null | undefined): string {
    if (!s) return ''
    // DB-format: YYYY-MM-DD HH:MM:SS (UTC). Toon als "dd MMM HH:MM" in Brussels.
    try {
      const d = new Date(s.replace(' ', 'T') + 'Z')
      return d.toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
    } catch { return s }
  }

  return c.html(
    <Layout
      title={`Resultaten: ${poll.titel}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Polls', href: '/admin/polls' },
        { label: 'Resultaten', href: `/admin/polls/${pollId}/resultaten` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Terug-link */}
          <div class="mb-4">
            <a href="/admin/polls" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar polls
            </a>
          </div>

          {/* Header */}
          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2 flex-wrap">
                  <span class={`px-3 py-1 text-xs font-bold rounded-full ${
                    poll.status === 'open' ? 'bg-green-100 text-green-800' :
                    poll.status === 'gesloten' ? 'bg-gray-200 text-gray-700' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {poll.status === 'open' ? 'OPEN' : poll.status === 'gesloten' ? 'GESLOTEN' : 'CONCEPT'}
                  </span>
                  <span class="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                    {poll.type}
                  </span>
                  <span class="px-3 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                    {poll.doelgroep === 'all' ? 'Alle leden' :
                     poll.doelgroep === 'bestuur' ? 'Bestuur' :
                     poll.doelgroep === 'SATB' ? 'Alle stemgroepen' :
                     `Stemgroep ${poll.doelgroep}`}
                  </span>
                  {isAnoniem && (
                    <span class="px-3 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-800" title="Geheime stemming — namen worden niet getoond">
                      <i class="fas fa-user-secret mr-1"></i>
                      ANONIEM
                    </span>
                  )}
                  {poll.max_stemmen > 1 && (
                    <span class="px-3 py-1 text-xs font-medium rounded-full bg-cyan-100 text-cyan-800">
                      Meerkeuze ({poll.max_stemmen}×)
                    </span>
                  )}
                </div>
                <h1 class="text-2xl md:text-3xl font-bold text-gray-900 mb-2" style="font-family: 'Playfair Display', serif;">
                  {poll.titel}
                </h1>
                {poll.beschrijving && (
                  <p class="text-gray-600 mb-3">{poll.beschrijving}</p>
                )}
                <div class="text-xs text-gray-500 flex items-center gap-4 flex-wrap">
                  <span>
                    <i class="fas fa-user mr-1"></i>
                    Door {poll.creator_voornaam ? `${poll.creator_voornaam} ${poll.creator_achternaam || ''}`.trim() : poll.created_by_email}
                  </span>
                  <span>
                    <i class="fas fa-calendar-plus mr-1"></i>
                    Gemaakt {fmtDate(poll.created_at)}
                  </span>
                  {poll.eind_datum && (
                    <span class={new Date(poll.eind_datum.replace(' ', 'T') + 'Z') < new Date() ? 'text-red-600 font-semibold' : ''}>
                      <i class="fas fa-hourglass-end mr-1"></i>
                      Sluit {fmtDate(poll.eind_datum)}
                    </span>
                  )}
                </div>
              </div>

              {/* Actie-knoppen */}
              <div class="flex flex-col sm:flex-row gap-2">
                <a
                  href={`/admin/polls/${pollId}/resultaten/export.csv`}
                  class="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium inline-flex items-center justify-center"
                  title="Download als CSV"
                >
                  <i class="fas fa-file-csv mr-2"></i> Export CSV
                </a>
                <a
                  href={`/admin/polls/${pollId}/edit`}
                  class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium inline-flex items-center justify-center"
                >
                  <i class="fas fa-edit mr-2"></i> Bewerk
                </a>
              </div>
            </div>
          </div>

          {/* Stats-strip */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Stemmers</div>
              <div class="text-3xl font-bold text-animato-primary mt-1">{totalVoters}</div>
              <div class="text-xs text-gray-500 mt-1">unieke kiezers</div>
            </div>
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Stemmen</div>
              <div class="text-3xl font-bold text-gray-900 mt-1">{totalVotes}</div>
              <div class="text-xs text-gray-500 mt-1">
                {poll.max_stemmen > 1 ? `tot ${poll.max_stemmen} per persoon` : '1 per persoon'}
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Opkomst</div>
              <div class="text-3xl font-bold text-gray-900 mt-1">{opkomst}<span class="text-lg text-gray-500">%</span></div>
              <div class="text-xs text-gray-500 mt-1">van {totalEligible} stemgerechtigden</div>
            </div>
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div class="text-xs text-gray-500 uppercase tracking-wide font-semibold">Niet gestemd</div>
              <div class={`text-3xl font-bold mt-1 ${totalEligible - totalVoters > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {totalEligible - totalVoters}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                {isAnoniem ? 'lijst verborgen (anoniem)' : 'zie tab "Niet gestemd"'}
              </div>
            </div>
          </div>

          {/* Anoniem-waarschuwing als van toepassing */}
          {isAnoniem && (
            <div class="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6 rounded-r-lg">
              <div class="flex">
                <i class="fas fa-user-secret text-amber-600 text-xl mr-3 mt-0.5"></i>
                <div>
                  <p class="text-sm text-amber-800 font-semibold">Dit is een anonieme poll</p>
                  <p class="text-sm text-amber-700 mt-1">
                    Per ontwerp tonen we hier <strong>geen individuele namen</strong>. Je ziet wel hoeveel
                    leden uit elke stemgroep voor welke optie gestemd hebben. Wie er niet gestemd heeft
                    is ook verborgen om deductie te voorkomen.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div class="border-b border-gray-200 px-4 flex gap-1 overflow-x-auto" id="tab-bar">
              <button data-tab="per-optie" class="tab-btn px-4 py-3 text-sm font-semibold text-animato-primary border-b-2 border-animato-primary whitespace-nowrap">
                <i class="fas fa-chart-bar mr-1"></i> Per optie
              </button>
              {!isAnoniem && (
                <button data-tab="per-stemmer" class="tab-btn px-4 py-3 text-sm font-semibold text-gray-500 hover:text-gray-700 border-b-2 border-transparent whitespace-nowrap">
                  <i class="fas fa-users mr-1"></i> Per stemmer
                </button>
              )}
              {!isAnoniem && (
                <button data-tab="niet-gestemd" class="tab-btn px-4 py-3 text-sm font-semibold text-gray-500 hover:text-gray-700 border-b-2 border-transparent whitespace-nowrap">
                  <i class="fas fa-user-slash mr-1"></i> Niet gestemd ({nietGestemd.length})
                </button>
              )}
            </div>

            {/* PANE 1: per optie */}
            <div data-pane="per-optie" class="p-6">
              {options.length === 0 ? (
                <p class="text-center text-gray-500 py-12">
                  <i class="fas fa-inbox text-4xl mb-3 block"></i>
                  Deze poll heeft geen opties.
                </p>
              ) : (
                <div class="space-y-5">
                  {options.map((opt: any) => {
                    const count = opt.vote_count || 0
                    const pctOfVoters = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0
                    const pctOfMax = (count / maxVotes) * 100
                    const voters = votersByOption.get(opt.id) || []
                    const anonCounts = anonByOption.get(opt.id) || {}

                    // Groepeer voters per stemgroep
                    const byStemgroep: Record<string, any[]> = { S: [], A: [], T: [], B: [], X: [] }
                    for (const v of voters) {
                      const k = (v.stemgroep === 'S' || v.stemgroep === 'A' || v.stemgroep === 'T' || v.stemgroep === 'B') ? v.stemgroep : 'X'
                      byStemgroep[k].push(v)
                    }

                    return (
                      <div class="border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                        {/* Optie-header met balk */}
                        <div class="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                          <h3 class="text-lg font-semibold text-gray-900 flex-1">
                            {opt.optie_tekst}
                          </h3>
                          <div class="flex items-center gap-3">
                            <span class="text-2xl font-bold text-animato-primary">{count}</span>
                            <span class="text-sm text-gray-500">
                              ({pctOfVoters}% van kiezers)
                            </span>
                          </div>
                        </div>
                        {opt.optie_beschrijving && (
                          <p class="text-sm text-gray-600 mb-3">{opt.optie_beschrijving}</p>
                        )}
                        {/* Balk */}
                        <div class="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-4">
                          <div
                            class="h-full bg-gradient-to-r from-animato-primary to-cyan-500 transition-all duration-500"
                            style={`width: ${pctOfMax.toFixed(1)}%`}
                          ></div>
                        </div>

                        {/* Anoniem: stemgroep-tellers */}
                        {isAnoniem ? (
                          <div class="flex gap-2 flex-wrap">
                            {['S', 'A', 'T', 'B', 'X'].map((sg) => {
                              const n = anonCounts[sg] || 0
                              if (n === 0) return null
                              return (
                                <span class={`px-2.5 py-1 text-xs font-medium rounded-full ${stemgroepBadgeClasses(sg === 'X' ? null : sg)}`}>
                                  {stemgroepLabel(sg === 'X' ? null : sg)}: {n}
                                </span>
                              )
                            })}
                            {count === 0 && (
                              <span class="text-sm text-gray-400 italic">Nog geen stemmen</span>
                            )}
                          </div>
                        ) : (
                          <div>
                            {count === 0 ? (
                              <p class="text-sm text-gray-400 italic">Nog niemand heeft op deze optie gestemd</p>
                            ) : (
                              <div class="space-y-3">
                                {['S', 'A', 'T', 'B', 'X'].map((sg) => {
                                  const list = byStemgroep[sg]
                                  if (list.length === 0) return null
                                  return (
                                    <div>
                                      <div class="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                                        <span class={`px-2 py-0.5 rounded-full ${stemgroepBadgeClasses(sg === 'X' ? null : sg)}`}>
                                          {stemgroepLabel(sg === 'X' ? null : sg)}
                                        </span>
                                        <span class="ml-2 text-gray-600">{list.length} {list.length === 1 ? 'stem' : 'stemmen'}</span>
                                      </div>
                                      <div class="flex flex-wrap gap-2">
                                        {list.map((v: any) => {
                                          const naam = v.voornaam || v.achternaam
                                            ? `${v.voornaam || ''} ${v.achternaam || ''}`.trim()
                                            : v.email
                                          const avatar = v.foto_url || avatarForStemgroep(v.stemgroep)
                                          return (
                                            <span
                                              class="inline-flex items-center bg-gray-50 border border-gray-200 rounded-full pl-1 pr-3 py-0.5 text-sm hover:bg-white hover:shadow-sm transition"
                                              title={`${v.email} — gestemd ${fmtDate(v.created_at)}`}
                                            >
                                              <img
                                                src={avatar}
                                                alt=""
                                                class="w-6 h-6 rounded-full mr-2 object-cover"
                                                loading="lazy"
                                                onerror={`this.src='${avatarForStemgroep(v.stemgroep)}'`}
                                              />
                                              <span class="text-gray-800">{naam}</span>
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* PANE 2: per stemmer (alleen bij niet-anoniem) */}
            {!isAnoniem && (
              <div data-pane="per-stemmer" class="p-6 hidden">
                {(() => {
                  // Groepeer alle votes per user
                  const byUser = new Map<number, { voter: any, opties: any[] }>()
                  for (const v of votesWithUsers) {
                    if (!byUser.has(v.user_id)) {
                      byUser.set(v.user_id, { voter: v, opties: [] })
                    }
                    const opt = options.find((o: any) => o.id === v.option_id)
                    if (opt) byUser.get(v.user_id)!.opties.push({ ...opt, voted_at: v.created_at })
                  }
                  const stemmers = [...byUser.values()].sort((a, b) => {
                    // Sort: stemgroep dan naam
                    const sgA = a.voter.stemgroep || 'Z'
                    const sgB = b.voter.stemgroep || 'Z'
                    if (sgA !== sgB) return sgA.localeCompare(sgB)
                    const nA = `${a.voter.voornaam || ''} ${a.voter.achternaam || ''}`.trim().toLowerCase()
                    const nB = `${b.voter.voornaam || ''} ${b.voter.achternaam || ''}`.trim().toLowerCase()
                    return nA.localeCompare(nB)
                  })

                  if (stemmers.length === 0) {
                    return (
                      <p class="text-center text-gray-500 py-12">
                        <i class="fas fa-inbox text-4xl mb-3 block"></i>
                        Nog niemand heeft gestemd.
                      </p>
                    )
                  }

                  return (
                    <div class="overflow-hidden border border-gray-200 rounded-xl">
                      <table class="w-full text-sm">
                        <thead class="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th class="text-left px-4 py-3 font-semibold text-gray-700">Stemmer</th>
                            <th class="text-left px-4 py-3 font-semibold text-gray-700">Stemgroep</th>
                            <th class="text-left px-4 py-3 font-semibold text-gray-700">Gestemd op</th>
                            <th class="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Wanneer</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                          {stemmers.map(({ voter, opties }) => {
                            const naam = voter.voornaam || voter.achternaam
                              ? `${voter.voornaam || ''} ${voter.achternaam || ''}`.trim()
                              : voter.email
                            const avatar = voter.foto_url || avatarForStemgroep(voter.stemgroep)
                            const lastVote = opties.map((o: any) => o.voted_at).sort().slice(-1)[0]
                            return (
                              <tr class="hover:bg-gray-50 transition">
                                <td class="px-4 py-3">
                                  <div class="flex items-center">
                                    <img
                                      src={avatar}
                                      alt=""
                                      class="w-8 h-8 rounded-full mr-3 object-cover"
                                      loading="lazy"
                                      onerror={`this.src='${avatarForStemgroep(voter.stemgroep)}'`}
                                    />
                                    <div>
                                      <div class="font-semibold text-gray-900">{naam}</div>
                                      <div class="text-xs text-gray-500">{voter.email}</div>
                                    </div>
                                  </div>
                                </td>
                                <td class="px-4 py-3">
                                  <span class={`px-2.5 py-1 text-xs font-medium rounded-full ${stemgroepBadgeClasses(voter.stemgroep)}`}>
                                    {stemgroepLabel(voter.stemgroep)}
                                  </span>
                                </td>
                                <td class="px-4 py-3">
                                  <div class="flex flex-wrap gap-1.5">
                                    {opties.map((o: any) => (
                                      <span class="px-2 py-0.5 bg-cyan-50 text-cyan-800 border border-cyan-200 rounded text-xs font-medium">
                                        {o.optie_tekst}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                                  {fmtDate(lastVote)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* PANE 3: niet gestemd (alleen bij niet-anoniem) */}
            {!isAnoniem && (
              <div data-pane="niet-gestemd" class="p-6 hidden">
                {nietGestemd.length === 0 ? (
                  <div class="text-center py-12">
                    <i class="fas fa-trophy text-5xl text-yellow-500 mb-3 block"></i>
                    <p class="text-lg font-semibold text-gray-900">100% opkomst!</p>
                    <p class="text-sm text-gray-500 mt-1">Alle stemgerechtigden hebben gestemd.</p>
                  </div>
                ) : (
                  <div>
                    <p class="text-sm text-gray-600 mb-4">
                      <i class="fas fa-info-circle mr-1 text-blue-500"></i>
                      Deze {nietGestemd.length} leden uit de doelgroep hebben nog niet gestemd.
                      {poll.status === 'open' && ' Je kunt ze nog herinneren.'}
                    </p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {nietGestemd.map((m: any) => {
                        const naam = m.voornaam || m.achternaam
                          ? `${m.voornaam || ''} ${m.achternaam || ''}`.trim()
                          : m.email
                        const avatar = m.foto_url || avatarForStemgroep(m.stemgroep)
                        return (
                          <div class="flex items-center bg-orange-50 border border-orange-200 rounded-lg p-2.5">
                            <img
                              src={avatar}
                              alt=""
                              class="w-9 h-9 rounded-full mr-3 object-cover"
                              loading="lazy"
                              onerror={`this.src='${avatarForStemgroep(m.stemgroep)}'`}
                            />
                            <div class="flex-1 min-w-0">
                              <div class="font-semibold text-gray-900 text-sm truncate">{naam}</div>
                              <div class="flex items-center gap-1.5 mt-0.5">
                                <span class={`px-1.5 py-0.5 text-[10px] font-medium rounded ${stemgroepBadgeClasses(m.stemgroep)}`}>
                                  {stemgroepLabel(m.stemgroep)}
                                </span>
                                <span class="text-[11px] text-gray-500 truncate">{m.email}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab-switcher JS — klein inline blokje, geen externe deps */}
      <script src="/static/js/admin-poll-results-tabs.js" defer></script>
    </Layout>
  )
})

// =====================================================
// ADMIN: CSV-EXPORT van resultaten
// =====================================================
// Levert een CSV met 1 rij per stem. Bij anoniem: geen namen, alleen stemgroep.

app.get('/admin/polls/:id/resultaten/export.csv', async (c) => {
  const pollId = parseInt(c.req.param('id'))
  if (!pollId) return c.text('invalid_id', 400)

  const poll = await queryOne<any>(c.env.DB, `SELECT id, titel, anoniem FROM polls WHERE id = ?`, [pollId])
  if (!poll) return c.text('not_found', 404)

  const isAnoniem = poll.anoniem === 1
  const rows = await queryAll<any>(c.env.DB, `
    SELECT o.optie_tekst, u.stemgroep, u.email, pr.voornaam, pr.achternaam, v.created_at
    FROM poll_votes v
    JOIN poll_options o ON o.id = v.option_id
    JOIN users u ON u.id = v.user_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE v.poll_id = ?
    ORDER BY o.volgorde ASC, v.created_at ASC
  `, [pollId])

  function csvEscape(s: any): string {
    const str = (s === null || s === undefined) ? '' : String(s)
    if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
    return str
  }

  const header = isAnoniem
    ? ['Optie', 'Stemgroep', 'Wanneer (UTC)']
    : ['Optie', 'Voornaam', 'Achternaam', 'Email', 'Stemgroep', 'Wanneer (UTC)']

  const lines = [header.join(';')]
  for (const r of rows) {
    if (isAnoniem) {
      lines.push([r.optie_tekst, r.stemgroep || '', r.created_at].map(csvEscape).join(';'))
    } else {
      lines.push([
        r.optie_tekst, r.voornaam || '', r.achternaam || '', r.email,
        r.stemgroep || '', r.created_at
      ].map(csvEscape).join(';'))
    }
  }

  const filename = `poll-${pollId}-resultaten-${new Date().toISOString().slice(0, 10)}.csv`
  // BOM zodat Excel UTF-8 correct herkent
  const body = '\ufeff' + lines.join('\n')
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    }
  })
})

export default app
