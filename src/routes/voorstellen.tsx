import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryAll, queryOne } from '../utils/db'
import { requireAuth } from '../middleware/auth'

const app = new Hono<{ Bindings: Bindings }>()

// Auth middleware - all members can access proposals
app.use('/leden/*', requireAuth)

// =====================================================
// LEDEN VOORSTELLEN OVERZICHT
// =====================================================

app.get('/leden/voorstellen', async (c) => {
  const user = c.get('user') as SessionUser
  const filter = c.req.query('filter') || 'alle'
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get proposals with vote counts and user's vote
  let proposalsQuery = `
    SELECT 
      mp.*,
      u.email as voorgesteld_door_email,
      pr.voornaam,
      pr.achternaam,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'up') as upvotes,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'down') as downvotes,
      (SELECT vote_type FROM proposal_votes WHERE proposal_id = mp.id AND user_id = ?) as user_vote
    FROM member_proposals mp
    LEFT JOIN users u ON u.id = mp.voorgesteld_door
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE mp.status ${
      filter === 'in_voting' ? "= 'in_voting'" :
      filter === 'pending' ? "= 'pending'" :
      filter === 'approved' ? "= 'approved'" :
      "IN ('pending', 'approved', 'in_voting')"
    }
    ORDER BY 
      CASE 
        WHEN mp.status = 'in_voting' THEN 0
        WHEN mp.status = 'pending' THEN 1
        WHEN mp.status = 'approved' THEN 2
        ELSE 3
      END,
      mp.created_at DESC
  `

  const proposals = await queryAll(c.env.DB, proposalsQuery, [user.id])

  // Calculate net votes for each proposal
  const proposalsWithScore = proposals.map((p: any) => ({
    ...p,
    net_votes: (p.upvotes || 0) - (p.downvotes || 0)
  }))

  return c.html(
    <Layout 
      title="Voorstellen" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Voorstellen', href: '/leden/voorstellen' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <div class="flex items-center justify-between">
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-lightbulb text-yellow-500 mr-3"></i>
                Voorstellen van Leden
              </h1>
              <a 
                href="/leden/voorstellen/nieuw" 
                class="bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
              >
                <i class="fas fa-plus mr-2"></i>
                Nieuw Voorstel
              </a>
            </div>
            <p class="text-gray-600 mt-2">
              Deel je ideeën en stem op voorstellen van andere koorleden
            </p>
          </div>

          {/* Success/Error Messages */}
          {success === 'submitted' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Je voorstel is ingediend en wacht op goedkeuring door het bestuur.
            </div>
          )}
          {success === 'voted' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Je stem is geregistreerd!
            </div>
          )}
          {error === 'not_found' && (
            <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-exclamation-circle mr-3"></i>
              Voorstel niet gevonden.
            </div>
          )}

          {/* Filter Tabs */}
          <div class="mb-6 bg-white rounded-lg shadow p-1 inline-flex">
            <a 
              href="/leden/voorstellen?filter=alle" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'alle' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Alle
            </a>
            <a 
              href="/leden/voorstellen?filter=in_voting" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'in_voting' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              In Stemming
            </a>
            <a 
              href="/leden/voorstellen?filter=pending" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'pending' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              In Behandeling
            </a>
            <a 
              href="/leden/voorstellen?filter=approved" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'approved' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Goedgekeurd
            </a>
          </div>

          {/* Proposals Grid */}
          {proposalsWithScore.length === 0 ? (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-inbox text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">Geen voorstellen gevonden</h3>
              <p class="text-gray-600 mb-6">
                {filter === 'alle' 
                  ? 'Er zijn nog geen voorstellen ingediend.' 
                  : `Er zijn geen voorstellen met status "${filter}".`}
              </p>
              <a 
                href="/leden/voorstellen/nieuw" 
                class="inline-flex items-center bg-animato-primary hover:bg-animato-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                <i class="fas fa-plus mr-2"></i>
                Dien je eerste voorstel in
              </a>
            </div>
          ) : (
            <div class="space-y-4">
              {proposalsWithScore.map((proposal: any) => (
                <div class="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6">
                  <div class="flex items-start justify-between">
                    
                    {/* Left: Vote Buttons */}
                    <div class="flex flex-col items-center mr-6">
                      <form method="POST" action={`/api/voorstellen/${proposal.id}/vote`}>
                        <input type="hidden" name="vote_type" value="up" />
                        <button 
                          type="submit"
                          class={`p-2 rounded-full transition-colors ${
                            proposal.user_vote === 'up'
                              ? 'text-green-600 bg-green-50'
                              : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                          }`}
                          disabled={proposal.status === 'rejected'}
                        >
                          <i class="fas fa-chevron-up text-xl"></i>
                        </button>
                      </form>
                      
                      <div class={`text-xl font-bold my-2 ${
                        proposal.net_votes > 0 ? 'text-green-600' : 
                        proposal.net_votes < 0 ? 'text-red-600' : 
                        'text-gray-600'
                      }`}>
                        {proposal.net_votes > 0 ? '+' : ''}{proposal.net_votes}
                      </div>
                      
                      <form method="POST" action={`/api/voorstellen/${proposal.id}/vote`}>
                        <input type="hidden" name="vote_type" value="down" />
                        <button 
                          type="submit"
                          class={`p-2 rounded-full transition-colors ${
                            proposal.user_vote === 'down'
                              ? 'text-red-600 bg-red-50'
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          disabled={proposal.status === 'rejected'}
                        >
                          <i class="fas fa-chevron-down text-xl"></i>
                        </button>
                      </form>
                    </div>

                    {/* Right: Content */}
                    <div class="flex-1">
                      <div class="flex items-start justify-between mb-3">
                        <div>
                          <a 
                            href={`/leden/voorstellen/${proposal.id}`}
                            class="text-xl font-bold text-gray-900 hover:text-animato-primary transition-colors"
                          >
                            {proposal.titel}
                          </a>
                          
                          {/* Status Badge */}
                          <div class="mt-2 flex items-center gap-2">
                            {proposal.status === 'in_voting' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <i class="fas fa-vote-yea mr-1"></i>
                                In Stemming
                              </span>
                            )}
                            {proposal.status === 'pending' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                <i class="fas fa-clock mr-1"></i>
                                In Behandeling
                              </span>
                            )}
                            {proposal.status === 'approved' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                <i class="fas fa-check mr-1"></i>
                                Goedgekeurd
                              </span>
                            )}
                            {proposal.status === 'rejected' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                <i class="fas fa-times mr-1"></i>
                                Afgewezen
                              </span>
                            )}
                            
                            {/* Category Badge */}
                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                              {proposal.categorie === 'repertoire' && <i class="fas fa-music mr-1"></i>}
                              {proposal.categorie === 'activiteit' && <i class="fas fa-calendar mr-1"></i>}
                              {proposal.categorie === 'verbetering' && <i class="fas fa-tools mr-1"></i>}
                              {proposal.categorie === 'algemeen' && <i class="fas fa-comment mr-1"></i>}
                              {proposal.categorie.charAt(0).toUpperCase() + proposal.categorie.slice(1)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <p class="text-gray-700 mb-4 line-clamp-3">
                        {proposal.beschrijving}
                      </p>

                      <div class="flex items-center justify-between text-sm text-gray-500">
                        <div class="flex items-center gap-4">
                          <span>
                            <i class="fas fa-user mr-1"></i>
                            {proposal.voornaam} {proposal.achternaam}
                          </span>
                          <span>
                            <i class="fas fa-clock mr-1"></i>
                            {new Date(proposal.created_at).toLocaleDateString('nl-NL', { 
                              day: 'numeric', 
                              month: 'long', 
                              year: 'numeric' 
                            })}
                          </span>
                        </div>
                        
                        <a 
                          href={`/leden/voorstellen/${proposal.id}`}
                          class="text-animato-primary hover:text-animato-primary-dark font-medium"
                        >
                          Bekijk details <i class="fas fa-arrow-right ml-1"></i>
                        </a>
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
// NIEUW VOORSTEL FORMULIER
// =====================================================

app.get('/leden/voorstellen/nieuw', async (c) => {
  const user = c.get('user') as SessionUser

  return c.html(
    <Layout 
      title="Nieuw Voorstel" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Voorstellen', href: '/leden/voorstellen' },
        { label: 'Nieuw Voorstel', href: '/leden/voorstellen/nieuw' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-lightbulb text-yellow-500 mr-3"></i>
              Nieuw Voorstel Indienen
            </h1>
            <p class="text-gray-600 mt-2">
              Deel je idee met het koor. Het bestuur zal je voorstel beoordelen voordat het zichtbaar wordt voor andere leden.
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-md p-8">
            <form method="POST" action="/api/voorstellen/nieuw">
              
              {/* Titel */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Titel van je voorstel <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  name="titel"
                  required
                  maxlength="200"
                  placeholder="Bijv. Laten we een extra concert organiseren in de zomer"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              {/* Categorie */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Categorie <span class="text-red-500">*</span>
                </label>
                <select 
                  name="categorie"
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="">Kies een categorie...</option>
                  <option value="repertoire">Repertoire - Muziekstukken, componisten, genres</option>
                  <option value="activiteit">Activiteit - Evenementen, uitjes, sociale activiteiten</option>
                  <option value="verbetering">Verbetering - Processen, organisatie, faciliteiten</option>
                  <option value="algemeen">Algemeen - Overige voorstellen</option>
                </select>
              </div>

              {/* Beschrijving */}
              <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Beschrijving <span class="text-red-500">*</span>
                </label>
                <textarea 
                  name="beschrijving"
                  required
                  rows="8"
                  maxlength="2000"
                  placeholder="Leg je voorstel uit. Waarom vind je dit een goed idee? Wat zijn de voordelen?"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-none"
                ></textarea>
                <p class="text-sm text-gray-500 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Maximaal 2000 tekens
                </p>
              </div>

              {/* Info Box */}
              <div class="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div class="flex items-start">
                  <i class="fas fa-info-circle text-blue-600 mt-1 mr-3"></i>
                  <div class="text-sm text-blue-800">
                    <p class="font-medium mb-1">Wat gebeurt er na het indienen?</p>
                    <ul class="list-disc list-inside space-y-1">
                      <li>Het bestuur ontvangt je voorstel ter beoordeling</li>
                      <li>Na goedkeuring wordt het zichtbaar voor alle leden</li>
                      <li>Andere leden kunnen dan op je voorstel stemmen</li>
                      <li>Populaire voorstellen kunnen worden omgezet in officiële polls</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div class="flex items-center justify-end gap-4">
                <a 
                  href="/leden/voorstellen"
                  class="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                >
                  Annuleren
                </a>
                <button 
                  type="submit"
                  class="bg-animato-primary hover:bg-animato-primary-dark text-white px-8 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
                >
                  <i class="fas fa-paper-plane mr-2"></i>
                  Voorstel Indienen
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
// VOORSTEL DETAIL PAGINA
// =====================================================

app.get('/leden/voorstellen/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const proposalId = c.req.param('id')

  // Get proposal with full details
  const proposal = await queryOne<any>(c.env.DB, `
    SELECT 
      mp.*,
      u.email as voorgesteld_door_email,
      pr.voornaam,
      pr.achternaam,
      reviewer.email as reviewed_by_email,
      reviewer_pr.voornaam as reviewer_voornaam,
      reviewer_pr.achternaam as reviewer_achternaam,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'up') as upvotes,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'down') as downvotes,
      (SELECT vote_type FROM proposal_votes WHERE proposal_id = mp.id AND user_id = ?) as user_vote,
      (SELECT comment FROM proposal_votes WHERE proposal_id = mp.id AND user_id = ?) as user_vote_comment
    FROM member_proposals mp
    LEFT JOIN users u ON u.id = mp.voorgesteld_door
    LEFT JOIN profiles pr ON pr.user_id = u.id
    LEFT JOIN users reviewer ON reviewer.id = mp.reviewed_by
    LEFT JOIN profiles reviewer_pr ON reviewer_pr.user_id = reviewer.id
    WHERE mp.id = ?
  `, [user.id, user.id, proposalId])

  if (!proposal) {
    return c.redirect('/leden/voorstellen?error=not_found')
  }

  const net_votes = (proposal.upvotes || 0) - (proposal.downvotes || 0)

  // Fetch vote comments (#65)
  const voteComments = await queryAll<any>(c.env.DB,
    `SELECT pv.vote_type, pv.comment, pv.created_at, pr.voornaam, pr.achternaam
     FROM proposal_votes pv
     JOIN profiles pr ON pr.user_id = pv.user_id
     WHERE pv.proposal_id = ? AND pv.comment IS NOT NULL AND pv.comment != ''
     ORDER BY pv.created_at DESC`,
    [proposalId]
  )

  return c.html(
    <Layout 
      title={proposal.titel} 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Voorstellen', href: '/leden/voorstellen' },
        { label: proposal.titel, href: `/leden/voorstellen/${proposalId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="bg-white rounded-lg shadow-md p-8">
            
            {/* Header */}
            <div class="flex items-start justify-between mb-6">
              <div class="flex-1">
                <h1 class="text-3xl font-bold text-gray-900 mb-3" style="font-family: 'Playfair Display', serif;">
                  {proposal.titel}
                </h1>
                
                {/* Status & Category Badges */}
                <div class="flex items-center gap-2 mb-4">
                  {proposal.status === 'in_voting' && (
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      <i class="fas fa-vote-yea mr-2"></i>
                      In Stemming
                    </span>
                  )}
                  {proposal.status === 'pending' && (
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                      <i class="fas fa-clock mr-2"></i>
                      In Behandeling
                    </span>
                  )}
                  {proposal.status === 'approved' && (
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                      <i class="fas fa-check mr-2"></i>
                      Goedgekeurd
                    </span>
                  )}
                  {proposal.status === 'rejected' && (
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                      <i class="fas fa-times mr-2"></i>
                      Afgewezen
                    </span>
                  )}
                  
                  <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                    {proposal.categorie === 'repertoire' && <i class="fas fa-music mr-2"></i>}
                    {proposal.categorie === 'activiteit' && <i class="fas fa-calendar mr-2"></i>}
                    {proposal.categorie === 'verbetering' && <i class="fas fa-tools mr-2"></i>}
                    {proposal.categorie === 'algemeen' && <i class="fas fa-comment mr-2"></i>}
                    {proposal.categorie.charAt(0).toUpperCase() + proposal.categorie.slice(1)}
                  </span>
                </div>

                {/* Author & Date */}
                <div class="flex items-center gap-4 text-sm text-gray-600">
                  <span>
                    <i class="fas fa-user mr-1"></i>
                    Voorgesteld door <strong>{proposal.voornaam} {proposal.achternaam}</strong>
                  </span>
                  <span>
                    <i class="fas fa-clock mr-1"></i>
                    {new Date(proposal.created_at).toLocaleDateString('nl-NL', { 
                      day: 'numeric', 
                      month: 'long', 
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>

              {/* Vote Box */}
              <div class="ml-8 bg-gray-50 rounded-lg p-6 text-center border-2 border-gray-200">
                <form method="POST" action={`/api/voorstellen/${proposal.id}/vote`}>
                  <input type="hidden" name="vote_type" value="up" />
                  <button 
                    type="submit"
                    class={`w-12 h-12 rounded-full transition-colors flex items-center justify-center mx-auto ${
                      proposal.user_vote === 'up'
                        ? 'text-green-600 bg-green-100 border-2 border-green-600'
                        : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                    }`}
                    disabled={proposal.status === 'rejected'}
                  >
                    <i class="fas fa-chevron-up text-2xl"></i>
                  </button>
                </form>
                
                <div class={`text-3xl font-bold my-3 ${
                  net_votes > 0 ? 'text-green-600' : 
                  net_votes < 0 ? 'text-red-600' : 
                  'text-gray-600'
                }`}>
                  {net_votes > 0 ? '+' : ''}{net_votes}
                </div>
                
                <form method="POST" action={`/api/voorstellen/${proposal.id}/vote`}>
                  <input type="hidden" name="vote_type" value="down" />
                  <button 
                    type="submit"
                    class={`w-12 h-12 rounded-full transition-colors flex items-center justify-center mx-auto ${
                      proposal.user_vote === 'down'
                        ? 'text-red-600 bg-red-100 border-2 border-red-600'
                        : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                    disabled={proposal.status === 'rejected'}
                  >
                    <i class="fas fa-chevron-down text-2xl"></i>
                  </button>
                </form>

                <div class="mt-3 text-xs text-gray-500">
                  {proposal.upvotes} <i class="fas fa-thumbs-up"></i> · {proposal.downvotes} <i class="fas fa-thumbs-down"></i>
                </div>

                {/* Vote comment (#65) */}
                <div class="mt-4 border-t border-gray-200 pt-3">
                  <form method="POST" action={`/api/voorstellen/${proposal.id}/vote-comment`}>
                    <textarea
                      name="comment"
                      rows={2}
                      placeholder="Laat een opmerking achter..."
                      class="w-full text-xs px-2 py-1 border border-gray-300 rounded-md focus:ring-1 focus:ring-animato-primary resize-none"
                    >{proposal.user_vote_comment || ''}</textarea>
                    <button type="submit" class="mt-1 text-xs text-animato-primary hover:underline">
                      <i class="fas fa-comment mr-1"></i> Opslaan
                    </button>
                  </form>
                </div>
              </div>
            </div>

            <hr class="my-6" />

            {/* Description */}
            <div class="prose max-w-none mb-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-3">Beschrijving</h3>
              <p class="text-gray-700 whitespace-pre-wrap">{proposal.beschrijving}</p>
            </div>

            {/* Vote Comments (#65) */}
            {voteComments.length > 0 && (
              <div class="mb-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-3">
                  <i class="fas fa-comments text-animato-primary mr-2"></i>
                  Reacties bij stemmen ({voteComments.length})
                </h3>
                <div class="space-y-3">
                  {voteComments.map((vc: any) => (
                    <div class="flex items-start bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <span class={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mr-3 ${vc.vote_type === 'up' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        <i class={`fas fa-thumbs-${vc.vote_type}`}></i>
                      </span>
                      <div class="flex-1">
                        <p class="text-sm text-gray-800">{vc.comment}</p>
                        <p class="text-xs text-gray-500 mt-1">— {vc.voornaam} {vc.achternaam}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review Section (if reviewed) */}
            {proposal.status === 'rejected' && proposal.review_opmerking && (
              <div class="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
                <div class="flex items-start">
                  <i class="fas fa-exclamation-circle text-red-600 mt-1 mr-3"></i>
                  <div class="flex-1">
                    <h4 class="font-semibold text-red-900 mb-2">
                      Afgewezen door {proposal.reviewer_voornaam} {proposal.reviewer_achternaam}
                    </h4>
                    <p class="text-sm text-red-800">{proposal.review_opmerking}</p>
                    <p class="text-xs text-red-600 mt-2">
                      {new Date(proposal.reviewed_at).toLocaleDateString('nl-NL', { 
                        day: 'numeric', 
                        month: 'long', 
                        year: 'numeric' 
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {proposal.status === 'approved' && proposal.review_opmerking && (
              <div class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div class="flex items-start">
                  <i class="fas fa-check-circle text-blue-600 mt-1 mr-3"></i>
                  <div class="flex-1">
                    <h4 class="font-semibold text-blue-900 mb-2">
                      Goedgekeurd door {proposal.reviewer_voornaam} {proposal.reviewer_achternaam}
                    </h4>
                    <p class="text-sm text-blue-800">{proposal.review_opmerking}</p>
                    <p class="text-xs text-blue-600 mt-2">
                      {new Date(proposal.reviewed_at).toLocaleDateString('nl-NL', { 
                        day: 'numeric', 
                        month: 'long', 
                        year: 'numeric' 
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Back Button */}
            <div class="mt-8">
              <a 
                href="/leden/voorstellen"
                class="inline-flex items-center text-animato-primary hover:text-animato-primary-dark font-medium"
              >
                <i class="fas fa-arrow-left mr-2"></i>
                Terug naar overzicht
              </a>
            </div>

          </div>

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// API: NIEUW VOORSTEL INDIENEN
// =====================================================

app.post('/api/voorstellen/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  
  const titel = body.titel as string
  const beschrijving = body.beschrijving as string
  const categorie = body.categorie as string

  // Validation
  if (!titel || !beschrijving || !categorie) {
    return c.redirect('/leden/voorstellen/nieuw?error=missing_fields')
  }

  if (!['repertoire', 'activiteit', 'verbetering', 'algemeen'].includes(categorie)) {
    return c.redirect('/leden/voorstellen/nieuw?error=invalid_category')
  }

  // Insert proposal
  await c.env.DB.prepare(`
    INSERT INTO member_proposals (titel, beschrijving, categorie, voorgesteld_door, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).bind(titel, beschrijving, categorie, user.id).run()

  return c.redirect('/leden/voorstellen?success=submitted')
})

// =====================================================
// API: VOTE ON PROPOSAL (UP/DOWN)
// =====================================================

app.post('/api/voorstellen/:id/vote', async (c) => {
  const user = c.get('user') as SessionUser
  const proposalId = c.req.param('id')
  const body = await c.req.parseBody()
  const voteType = body.vote_type as string

  // Validate vote type
  if (!['up', 'down'].includes(voteType)) {
    return c.redirect(`/leden/voorstellen/${proposalId}?error=invalid_vote`)
  }

  // Check if proposal exists
  const proposal = await queryOne<any>(c.env.DB,
    `SELECT id, status FROM member_proposals WHERE id = ?`,
    [proposalId]
  )

  if (!proposal) {
    return c.redirect('/leden/voorstellen?error=not_found')
  }

  // Check if user already voted
  const existingVote = await queryOne<any>(c.env.DB,
    `SELECT id, vote_type FROM proposal_votes WHERE proposal_id = ? AND user_id = ?`,
    [proposalId, user.id]
  )

  if (existingVote) {
    // If same vote, remove it (toggle off)
    if (existingVote.vote_type === voteType) {
      await c.env.DB.prepare(
        `DELETE FROM proposal_votes WHERE proposal_id = ? AND user_id = ?`
      ).bind(proposalId, user.id).run()
    } else {
      // If different vote, update it
      await c.env.DB.prepare(
        `UPDATE proposal_votes SET vote_type = ? WHERE proposal_id = ? AND user_id = ?`
      ).bind(voteType, proposalId, user.id).run()
    }
  } else {
    // Insert new vote
    await c.env.DB.prepare(
      `INSERT INTO proposal_votes (proposal_id, user_id, vote_type) VALUES (?, ?, ?)`
    ).bind(proposalId, user.id, voteType).run()
  }

  // Redirect back to the page they came from
  const referer = c.req.header('Referer') || `/leden/voorstellen/${proposalId}`
  if (referer.includes('/leden/voorstellen/') && !referer.includes('?')) {
    return c.redirect(referer)
  }
  return c.redirect(`/leden/voorstellen?success=voted`)
})

// Vote comment (#65)
app.post('/api/voorstellen/:id/vote-comment', async (c) => {
  const user = c.get('user') as SessionUser
  const proposalId = c.req.param('id')
  const body = await c.req.parseBody()
  const comment = (body.comment as string || '').trim()

  // Update or insert the comment on existing vote
  const existingVote = await queryOne<any>(c.env.DB,
    `SELECT id FROM proposal_votes WHERE proposal_id = ? AND user_id = ?`,
    [proposalId, user.id]
  )

  if (existingVote) {
    await c.env.DB.prepare(
      `UPDATE proposal_votes SET comment = ? WHERE proposal_id = ? AND user_id = ?`
    ).bind(comment || null, proposalId, user.id).run()
  }
  // If no vote exists yet, they need to vote first before commenting

  return c.redirect(`/leden/voorstellen/${proposalId}`)
})

export default app
