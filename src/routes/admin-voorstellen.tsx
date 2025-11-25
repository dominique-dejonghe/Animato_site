// Admin Voorstellen Management
// Review, Approve, Reject member proposals

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
// ADMIN VOORSTELLEN OVERZICHT
// =====================================================

app.get('/admin/voorstellen', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const filter = c.req.query('filter') || 'pending'
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get proposals with vote statistics
  let proposalsQuery = `
    SELECT 
      mp.*,
      u.email as voorgesteld_door_email,
      pr.voornaam,
      pr.achternaam,
      reviewer.email as reviewed_by_email,
      reviewer_pr.voornaam as reviewer_voornaam,
      reviewer_pr.achternaam as reviewer_achternaam,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'up') as upvotes,
      (SELECT COUNT(*) FROM proposal_votes WHERE proposal_id = mp.id AND vote_type = 'down') as downvotes
    FROM member_proposals mp
    LEFT JOIN users u ON u.id = mp.voorgesteld_door
    LEFT JOIN profiles pr ON pr.user_id = u.id
    LEFT JOIN users reviewer ON reviewer.id = mp.reviewed_by
    LEFT JOIN profiles reviewer_pr ON reviewer_pr.user_id = reviewer.id
    WHERE mp.status ${
      filter === 'pending' ? "= 'pending'" :
      filter === 'approved' ? "= 'approved'" :
      filter === 'rejected' ? "= 'rejected'" :
      filter === 'in_voting' ? "= 'in_voting'" :
      "IN ('pending', 'approved', 'rejected', 'in_voting')"
    }
    ORDER BY 
      CASE 
        WHEN mp.status = 'pending' THEN 0
        WHEN mp.status = 'in_voting' THEN 1
        WHEN mp.status = 'approved' THEN 2
        WHEN mp.status = 'rejected' THEN 3
        ELSE 4
      END,
      mp.created_at DESC
  `

  const proposals = await queryAll(c.env.DB, proposalsQuery, [])

  // Calculate net votes
  const proposalsWithScore = proposals.map((p: any) => ({
    ...p,
    net_votes: (p.upvotes || 0) - (p.downvotes || 0)
  }))

  return c.html(
    <Layout 
      title="Voorstellen Beheer" 
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Voorstellen', href: '/admin/voorstellen' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-lightbulb text-yellow-500 mr-3"></i>
              Voorstellen Beheer
            </h1>
            <p class="text-gray-600 mt-2">
              Beoordeel voorstellen van koorleden en converteer naar polls
            </p>
          </div>

          {/* Success/Error Messages */}
          {success === 'approved' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Voorstel goedgekeurd!
            </div>
          )}
          {success === 'rejected' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Voorstel afgewezen.
            </div>
          )}
          {success === 'status_changed' && (
            <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
              <i class="fas fa-check-circle mr-3"></i>
              Status succesvol gewijzigd!
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
              href="/admin/voorstellen?filter=pending" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'pending' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              In Behandeling
              {proposalsWithScore.filter((p: any) => p.status === 'pending').length > 0 && (
                <span class="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded-full text-xs">
                  {proposalsWithScore.filter((p: any) => p.status === 'pending').length}
                </span>
              )}
            </a>
            <a 
              href="/admin/voorstellen?filter=in_voting" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'in_voting' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              In Stemming
            </a>
            <a 
              href="/admin/voorstellen?filter=approved" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'approved' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Goedgekeurd
            </a>
            <a 
              href="/admin/voorstellen?filter=rejected" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'rejected' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Afgewezen
            </a>
            <a 
              href="/admin/voorstellen?filter=all" 
              class={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === 'all' 
                  ? 'bg-animato-primary text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Alle
            </a>
          </div>

          {/* Proposals List */}
          {proposalsWithScore.length === 0 ? (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-inbox text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">Geen voorstellen gevonden</h3>
              <p class="text-gray-600">
                {filter === 'pending' 
                  ? 'Er zijn geen voorstellen in behandeling.' 
                  : `Er zijn geen voorstellen met status "${filter}".`}
              </p>
            </div>
          ) : (
            <div class="space-y-4">
              {proposalsWithScore.map((proposal: any) => (
                <div class="bg-white rounded-lg shadow-md p-6">
                  <div class="flex items-start justify-between">
                    
                    {/* Vote Score (Left) */}
                    <div class="flex flex-col items-center mr-6 bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                      <div class={`text-3xl font-bold ${
                        proposal.net_votes > 0 ? 'text-green-600' : 
                        proposal.net_votes < 0 ? 'text-red-600' : 
                        'text-gray-600'
                      }`}>
                        {proposal.net_votes > 0 ? '+' : ''}{proposal.net_votes}
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        {proposal.upvotes} <i class="fas fa-thumbs-up"></i> · {proposal.downvotes} <i class="fas fa-thumbs-down"></i>
                      </div>
                    </div>

                    {/* Content (Center) */}
                    <div class="flex-1">
                      <div class="flex items-start justify-between mb-3">
                        <div class="flex-1">
                          <h3 class="text-xl font-bold text-gray-900 mb-2">
                            {proposal.titel}
                          </h3>
                          
                          {/* Status & Category Badges */}
                          <div class="flex items-center gap-2 mb-3">
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
                            {proposal.status === 'in_voting' && (
                              <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <i class="fas fa-vote-yea mr-1"></i>
                                In Stemming
                              </span>
                            )}
                            
                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                              {proposal.categorie === 'repertoire' && <i class="fas fa-music mr-1"></i>}
                              {proposal.categorie === 'activiteit' && <i class="fas fa-calendar mr-1"></i>}
                              {proposal.categorie === 'verbetering' && <i class="fas fa-tools mr-1"></i>}
                              {proposal.categorie === 'algemeen' && <i class="fas fa-comment mr-1"></i>}
                              {proposal.categorie.charAt(0).toUpperCase() + proposal.categorie.slice(1)}
                            </span>
                          </div>

                          <p class="text-gray-700 mb-3 line-clamp-2">
                            {proposal.beschrijving}
                          </p>

                          {/* Meta Info */}
                          <div class="flex items-center gap-4 text-sm text-gray-600 mb-3">
                            <span>
                              <i class="fas fa-user mr-1"></i>
                              {proposal.voornaam} {proposal.achternaam}
                            </span>
                            <span>
                              <i class="fas fa-clock mr-1"></i>
                              {new Date(proposal.created_at).toLocaleDateString('nl-NL', { 
                                day: 'numeric', 
                                month: 'short', 
                                year: 'numeric' 
                              })}
                            </span>
                          </div>

                          {/* Review Info (if reviewed) */}
                          {proposal.reviewed_by && (
                            <div class={`text-sm p-3 rounded ${
                              proposal.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'
                            }`}>
                              <strong>
                                {proposal.status === 'rejected' ? 'Afgewezen' : 'Goedgekeurd'} door {proposal.reviewer_voornaam} {proposal.reviewer_achternaam}
                              </strong>
                              {proposal.review_opmerking && (
                                <p class="mt-1">"{proposal.review_opmerking}"</p>
                              )}
                              <p class="text-xs mt-1">
                                {new Date(proposal.reviewed_at).toLocaleDateString('nl-NL', { 
                                  day: 'numeric', 
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions (Right) */}
                    <div class="ml-6 flex flex-col gap-2 min-w-[180px]">
                      <a 
                        href={`/leden/voorstellen/${proposal.id}`}
                        target="_blank"
                        class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition text-sm text-center"
                      >
                        <i class="fas fa-external-link-alt mr-2"></i>
                        Bekijk Detail
                      </a>

                      {proposal.status === 'pending' && (
                        <>
                          <button 
                            onclick={`openReviewModal(${proposal.id}, '${proposal.titel}', 'approve')`}
                            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm"
                          >
                            <i class="fas fa-check mr-2"></i>
                            Goedkeuren
                          </button>
                          <button 
                            onclick={`openReviewModal(${proposal.id}, '${proposal.titel}', 'reject')`}
                            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition text-sm"
                          >
                            <i class="fas fa-times mr-2"></i>
                            Afwijzen
                          </button>
                        </>
                      )}

                      {proposal.status === 'approved' && (
                        <form method="POST" action={`/api/admin/voorstellen/${proposal.id}/status`}>
                          <input type="hidden" name="status" value="in_voting" />
                          <button 
                            type="submit"
                            class="w-full px-4 py-2 bg-animato-primary hover:bg-animato-primary-dark text-white rounded-lg transition text-sm"
                          >
                            <i class="fas fa-vote-yea mr-2"></i>
                            Zet in Stemming
                          </button>
                        </form>
                      )}

                      {(proposal.status === 'approved' || proposal.status === 'in_voting') && (
                        <a 
                          href={`/admin/polls/nieuw?from_proposal=${proposal.id}`}
                          class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition text-sm text-center"
                        >
                          <i class="fas fa-poll mr-2"></i>
                          Converteer naar Poll
                        </a>
                      )}
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Review Modal */}
      <div id="reviewModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50">
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-8">
          <h3 class="text-2xl font-bold text-gray-900 mb-4" id="modalTitle">Voorstel Beoordelen</h3>
          <p class="text-gray-600 mb-6" id="modalProposalTitle"></p>

          <form method="POST" action="" id="reviewForm">
            <input type="hidden" name="action" id="reviewAction" />
            
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Opmerking <span class="text-sm text-gray-500">(optioneel)</span>
              </label>
              <textarea 
                name="review_opmerking"
                rows="4"
                placeholder="Voeg een opmerking toe voor de indiener..."
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-none"
              ></textarea>
            </div>

            <div class="flex items-center justify-end gap-4">
              <button 
                type="button"
                onclick="closeReviewModal()"
                class="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
              >
                Annuleren
              </button>
              <button 
                type="submit"
                id="reviewSubmitBtn"
                class="px-8 py-3 rounded-lg text-white font-medium transition-colors"
              >
                <i class="fas fa-check mr-2"></i>
                Bevestigen
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* JavaScript for modal */}
      <script dangerouslySetInnerHTML={{ __html: `
        function openReviewModal(proposalId, title, action) {
          const modal = document.getElementById('reviewModal');
          const form = document.getElementById('reviewForm');
          const modalTitle = document.getElementById('modalTitle');
          const modalProposalTitle = document.getElementById('modalProposalTitle');
          const reviewAction = document.getElementById('reviewAction');
          const submitBtn = document.getElementById('reviewSubmitBtn');

          form.action = '/api/admin/voorstellen/' + proposalId + '/review';
          reviewAction.value = action;
          modalProposalTitle.textContent = title;

          if (action === 'approve') {
            modalTitle.textContent = 'Voorstel Goedkeuren';
            submitBtn.className = 'px-8 py-3 rounded-lg text-white font-medium transition-colors bg-green-600 hover:bg-green-700';
            submitBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Goedkeuren';
          } else {
            modalTitle.textContent = 'Voorstel Afwijzen';
            submitBtn.className = 'px-8 py-3 rounded-lg text-white font-medium transition-colors bg-red-600 hover:bg-red-700';
            submitBtn.innerHTML = '<i class="fas fa-times mr-2"></i>Afwijzen';
          }

          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }

        function closeReviewModal() {
          const modal = document.getElementById('reviewModal');
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }

        // Close modal on outside click
        document.getElementById('reviewModal').addEventListener('click', function(e) {
          if (e.target === this) {
            closeReviewModal();
          }
        });
      ` }}></script>
    </Layout>
  )
})

// =====================================================
// API: REVIEW PROPOSAL (APPROVE/REJECT)
// =====================================================

app.post('/api/admin/voorstellen/:id/review', async (c) => {
  const user = c.get('user') as SessionUser
  const proposalId = c.req.param('id')
  const body = await c.req.parseBody()

  const action = body.action as string
  const review_opmerking = (body.review_opmerking as string) || null

  if (!['approve', 'reject'].includes(action)) {
    return c.redirect('/admin/voorstellen?error=invalid_action')
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  await c.env.DB.prepare(`
    UPDATE member_proposals 
    SET status = ?, reviewed_by = ?, review_opmerking = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(newStatus, user.id, review_opmerking, proposalId).run()

  return c.redirect(`/admin/voorstellen?success=${action}d`)
})

// =====================================================
// API: CHANGE PROPOSAL STATUS
// =====================================================

app.post('/api/admin/voorstellen/:id/status', async (c) => {
  const proposalId = c.req.param('id')
  const body = await c.req.parseBody()
  const newStatus = body.status as string

  if (!['pending', 'approved', 'rejected', 'in_voting'].includes(newStatus)) {
    return c.redirect('/admin/voorstellen?error=invalid_status')
  }

  await c.env.DB.prepare(
    `UPDATE member_proposals SET status = ? WHERE id = ?`
  ).bind(newStatus, proposalId).run()

  return c.redirect('/admin/voorstellen?success=status_changed')
})

export default app
