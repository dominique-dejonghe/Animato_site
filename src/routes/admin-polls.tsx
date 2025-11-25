// Admin Polls Management
// Create, Edit, Delete Polls and manage options

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware - only admin and moderator
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

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
                        <div class="flex items-center gap-2">
                          <a 
                            href={`/leden/polls/${poll.id}`}
                            target="_blank"
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
                            method="POST" 
                            action={`/api/admin/polls/${poll.id}/delete`}
                            onsubmit="return confirm('Weet je zeker dat je deze poll wilt verwijderen? Alle stemmen worden ook verwijderd.')"
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
                </label>
                <textarea 
                  name="beschrijving"
                  rows="3"
                  maxlength="1000"
                  placeholder="Extra context of uitleg over deze poll"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-none"
                ></textarea>
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

              {/* Anoniem */}
              <div class="mb-8">
                <label class="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    name="anoniem"
                    value="1"
                    class="w-5 h-5 text-animato-primary border-gray-300 rounded focus:ring-2 focus:ring-animato-primary"
                  />
                  <span class="ml-3 text-sm font-medium text-gray-700">
                    Anonieme stemming (verberg wie gestemd heeft)
                  </span>
                </label>
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
  const anoniem = body.anoniem ? 1 : 0

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

export default app
