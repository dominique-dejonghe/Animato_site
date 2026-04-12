import { Hono } from 'hono'
import type { SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryAll, queryOne } from '../utils/db'

const app = new Hono()

// =====================================================
// LEDEN POLLS OVERZICHT
// =====================================================

app.get('/leden/polls', async (c) => {
  const user = c.get('user') as SessionUser
  const filter = c.req.query('filter') || 'open'

  // Get polls visible to this user
  let pollsQuery = `
    SELECT p.*, u.email as created_by_email, pr.voornaam, pr.achternaam,
           (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes,
           (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND user_id = ?) as user_voted
    FROM polls p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE (p.doelgroep = 'all' OR p.doelgroep = ? OR p.doelgroep LIKE '%' || ? || '%')
      AND p.status ${filter === 'open' ? "= 'open'" : filter === 'gesloten' ? "= 'gesloten'" : "IN ('open', 'gesloten')"}
    ORDER BY 
      CASE WHEN p.status = 'open' THEN 0 ELSE 1 END,
      p.created_at DESC
  `

  const polls = await queryAll(c.env.DB, pollsQuery, [user.id, user.stemgroep, user.stemgroep])

  return c.html(
    <Layout 
      title="Polls" 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Polls', href: '/leden/polls' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-poll text-animato-primary mr-3"></i>
              Polls
            </h1>
            <p class="mt-2 text-gray-600">
              Stem mee over repertoire, data, en andere koor beslissingen
            </p>
          </div>

          {/* Filter Tabs */}
          <div class="bg-white rounded-lg shadow-md mb-6">
            <div class="border-b border-gray-200">
              <nav class="flex -mb-px">
                <a
                  href="/leden/polls?filter=open"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    filter === 'open'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-vote-yea mr-2"></i>
                  Open Polls
                </a>
                <a
                  href="/leden/polls?filter=gesloten"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    filter === 'gesloten'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-lock mr-2"></i>
                  Gesloten
                </a>
                <a
                  href="/leden/polls?filter=all"
                  class={`px-6 py-4 text-sm font-medium border-b-2 ${
                    filter === 'all'
                      ? 'border-animato-primary text-animato-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <i class="fas fa-list mr-2"></i>
                  Alle
                </a>

              </nav>
            </div>
          </div>

          {/* Polls List */}
          {polls.length > 0 ? (
            <div class="space-y-6">
              {polls.map((poll: any) => (
                <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition">
                  <div class="p-6">
                    <div class="flex items-start justify-between mb-4">
                      <div class="flex-1">
                        <div class="flex items-center gap-3 mb-2">
                          <h2 class="text-2xl font-bold text-gray-900">
                            {poll.titel}
                          </h2>
                          {poll.status === 'open' && (
                            <span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                              <i class="fas fa-check-circle mr-1"></i>
                              Open
                            </span>
                          )}
                          {poll.status === 'gesloten' && (
                            <span class="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-semibold">
                              <i class="fas fa-lock mr-1"></i>
                              Gesloten
                            </span>
                          )}
                          {poll.user_voted > 0 && (
                            <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                              <i class="fas fa-check mr-1"></i>
                              Gestemd
                            </span>
                          )}
                        </div>
                        {poll.beschrijving && (
                          <p class="text-gray-600 mb-3">{poll.beschrijving}</p>
                        )}
                        <div class="flex items-center gap-4 text-sm text-gray-500">
                          <span>
                            <i class="fas fa-user mr-1"></i>
                            {poll.voornaam} {poll.achternaam}
                          </span>
                          <span>
                            <i class="fas fa-users mr-1"></i>
                            {poll.total_votes} {poll.total_votes === 1 ? 'stem' : 'stemmen'}
                          </span>
                          {poll.eind_datum && (
                            <span>
                              <i class="fas fa-calendar mr-1"></i>
                              Tot {new Date(poll.eind_datum).toLocaleDateString('nl-BE')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <a
                      href={`/leden/polls/${poll.id}`}
                      class="inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                    >
                      {poll.user_voted > 0 ? (
                        <>
                          <i class="fas fa-eye mr-2"></i>
                          Bekijk Resultaten
                        </>
                      ) : poll.status === 'open' ? (
                        <>
                          <i class="fas fa-vote-yea mr-2"></i>
                          Stem Nu
                        </>
                      ) : (
                        <>
                          <i class="fas fa-chart-bar mr-2"></i>
                          Bekijk Resultaten
                        </>
                      )}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-poll text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">
                Geen polls beschikbaar
              </h3>
              <p class="text-gray-600">
                Er zijn momenteel geen {filter === 'open' ? 'open' : filter === 'gesloten' ? 'gesloten' : ''} polls.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// POLL DETAIL & VOTING
// =====================================================

app.get('/leden/polls/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const pollId = c.req.param('id')
  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get poll details
  const poll = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, u.email as created_by_email, pr.voornaam, pr.achternaam,
            (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes,
            (SELECT COUNT(DISTINCT user_id) FROM poll_votes WHERE poll_id = p.id) as total_voters
     FROM polls p
     LEFT JOIN users u ON u.id = p.created_by
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.id = ?`,
    [pollId]
  )

  if (!poll) {
    return c.redirect('/leden/polls?error=not_found')
  }

  // Check if user has access to this poll
  if (poll.doelgroep !== 'all' && poll.doelgroep !== user.stemgroep && !poll.doelgroep.includes(user.stemgroep || '')) {
    return c.redirect('/leden/polls?error=no_access')
  }

  // Get poll options with vote counts
  const options = await queryAll(
    c.env.DB,
    `SELECT o.*,
            (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count,
            (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id AND user_id = ?) as user_voted
     FROM poll_options o
     WHERE o.poll_id = ?
     ORDER BY o.volgorde, o.id`,
    [user.id, pollId]
  )

  // Check if user has voted
  const userVotes = await queryAll(
    c.env.DB,
    `SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?`,
    [pollId, user.id]
  )
  const hasVoted = userVotes.length > 0

  // Determine if results should be shown
  const showResults = 
    poll.toon_resultaten === 'always' ||
    (poll.toon_resultaten === 'after_vote' && hasVoted) ||
    (poll.toon_resultaten === 'after_close' && poll.status === 'gesloten') ||
    poll.status === 'gesloten'

  return c.html(
    <Layout 
      title={poll.titel} 
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Polls', href: '/leden/polls' },
        { label: poll.titel, href: `/leden/polls/${pollId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Back button */}
          <div class="mb-6">
            <a 
              href="/leden/polls"
              class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
            >
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar polls
            </a>
          </div>

          {/* Success/Error Messages */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 mr-3"></i>
                <div class="text-sm text-green-800">
                  {success === 'voted' && 'Je stem is succesvol opgeslagen!'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
                <div class="text-sm text-red-800">
                  {error === 'already_voted' && 'Je hebt al gestemd op deze poll'}
                  {error === 'poll_closed' && 'Deze poll is gesloten'}
                  {error === 'invalid_selection' && 'Ongeldige keuze'}
                  {error === 'too_many_votes' && 'Je hebt te veel opties geselecteerd'}
                </div>
              </div>
            </div>
          )}

          {/* Poll Card */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Poll Header */}
            <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white p-8">
              <div class="flex items-start justify-between mb-4">
                <h1 class="text-3xl font-bold flex-1" style="font-family: 'Playfair Display', serif;">
                  {poll.titel}
                </h1>
                <div class="flex gap-2 ml-4">
                  {poll.status === 'open' && (
                    <span class="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-sm font-semibold">
                      <i class="fas fa-check-circle mr-1"></i>
                      Open
                    </span>
                  )}
                  {poll.status === 'gesloten' && (
                    <span class="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-sm font-semibold">
                      <i class="fas fa-lock mr-1"></i>
                      Gesloten
                    </span>
                  )}
                  {hasVoted && (
                    <span class="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-sm font-semibold">
                      <i class="fas fa-check mr-1"></i>
                      Gestemd
                    </span>
                  )}
                </div>
              </div>
              {poll.beschrijving && (
                <p class="text-lg text-white/90 mb-4">{poll.beschrijving}</p>
              )}
              <div class="flex flex-wrap gap-4 text-sm text-white/80">
                <span>
                  <i class="fas fa-user mr-1"></i>
                  Door: {poll.voornaam} {poll.achternaam}
                </span>
                <span>
                  <i class="fas fa-users mr-1"></i>
                  {poll.total_voters} {poll.total_voters === 1 ? 'deelnemer' : 'deelnemers'}
                </span>
                {poll.eind_datum && (
                  <span>
                    <i class="fas fa-calendar mr-1"></i>
                    Tot {new Date(poll.eind_datum).toLocaleDateString('nl-BE', { 
                      day: 'numeric', 
                      month: 'long', 
                      year: 'numeric' 
                    })}
                  </span>
                )}
                {poll.max_stemmen > 1 && (
                  <span>
                    <i class="fas fa-check-double mr-1"></i>
                    Max {poll.max_stemmen} keuzes
                  </span>
                )}
              </div>
            </div>

            {/* Poll Body */}
            <div class="p-8">
              {poll.status === 'open' && !hasVoted ? (
                // Voting Form
                <form action={`/api/polls/${pollId}/vote`} method="POST">
                  <div class="space-y-4 mb-6">
                    <p class="text-gray-700 font-medium mb-4">
                      {poll.max_stemmen === 1 
                        ? 'Kies één optie:' 
                        : `Kies maximaal ${poll.max_stemmen} opties:`
                      }
                    </p>
                    {options.map((option: any) => (
                      <label class="flex items-start p-4 border-2 border-gray-200 rounded-lg hover:border-animato-primary hover:bg-gray-50 cursor-pointer transition group">
                        <input
                          type={poll.max_stemmen === 1 ? 'radio' : 'checkbox'}
                          name="option_ids"
                          value={option.id}
                          class="mt-1 mr-4 w-5 h-5 text-animato-primary focus:ring-animato-primary"
                          required={poll.max_stemmen === 1}
                        />
                        <div class="flex-1">
                          <div class="font-semibold text-gray-900 group-hover:text-animato-primary">
                            {option.optie_tekst}
                          </div>
                          {option.optie_beschrijving && (
                            <div class="text-sm text-gray-600 mt-1">
                              {option.optie_beschrijving}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  <button
                    type="submit"
                    class="w-full px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition font-semibold text-lg"
                  >
                    <i class="fas fa-vote-yea mr-2"></i>
                    Bevestig Mijn Stem
                  </button>
                </form>
              ) : (
                // Results View
                <div class="space-y-4">
                  <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900">
                      <i class="fas fa-chart-bar mr-2 text-animato-primary"></i>
                      Resultaten
                    </h2>
                    {hasVoted && (
                      <span class="text-sm text-green-600 font-semibold">
                        <i class="fas fa-check-circle mr-1"></i>
                        Je hebt gestemd
                      </span>
                    )}
                  </div>

                  {options.map((option: any) => {
                    const percentage = poll.total_votes > 0 
                      ? Math.round((option.vote_count / poll.total_votes) * 100) 
                      : 0
                    const isUserChoice = option.user_voted > 0

                    return (
                      <div class={`p-4 rounded-lg border-2 ${
                        isUserChoice 
                          ? 'border-animato-primary bg-blue-50' 
                          : 'border-gray-200 bg-white'
                      }`}>
                        <div class="flex items-center justify-between mb-2">
                          <div class="flex items-center flex-1">
                            <span class="font-semibold text-gray-900">
                              {option.optie_tekst}
                            </span>
                            {isUserChoice && (
                              <span class="ml-2 px-2 py-0.5 bg-animato-primary text-white rounded-full text-xs font-semibold">
                                Jouw keuze
                              </span>
                            )}
                          </div>
                          <div class="text-right">
                            <span class="text-2xl font-bold text-animato-primary">
                              {percentage}%
                            </span>
                            <div class="text-xs text-gray-500">
                              {option.vote_count} {option.vote_count === 1 ? 'stem' : 'stemmen'}
                            </div>
                          </div>
                        </div>
                        {option.optie_beschrijving && (
                          <div class="text-sm text-gray-600 mb-2">
                            {option.optie_beschrijving}
                          </div>
                        )}
                        <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                          <div 
                            class="bg-gradient-to-r from-animato-primary to-animato-secondary h-full rounded-full transition-all duration-500"
                            style={`width: ${percentage}%`}
                          ></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// API: SUBMIT VOTE
// =====================================================

app.post('/api/polls/:id/vote', async (c) => {
  const user = c.get('user') as SessionUser
  const pollId = c.req.param('id')

  try {
    const body = await c.req.parseBody()
    const optionIds = Array.isArray(body.option_ids) 
      ? body.option_ids 
      : [body.option_ids].filter(Boolean)

    // Validate poll exists and is open
    const poll = await queryOne<any>(
      c.env.DB,
      `SELECT * FROM polls WHERE id = ?`,
      [pollId]
    )

    if (!poll) {
      return c.redirect(`/leden/polls?error=not_found`)
    }

    if (poll.status !== 'open') {
      return c.redirect(`/leden/polls/${pollId}?error=poll_closed`)
    }

    // Check if user already voted
    const existingVote = await queryOne<any>(
      c.env.DB,
      `SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?`,
      [pollId, user.id]
    )

    if (existingVote) {
      return c.redirect(`/leden/polls/${pollId}?error=already_voted`)
    }

    // Validate number of selections
    if (optionIds.length === 0) {
      return c.redirect(`/leden/polls/${pollId}?error=invalid_selection`)
    }

    if (optionIds.length > poll.max_stemmen) {
      return c.redirect(`/leden/polls/${pollId}?error=too_many_votes`)
    }

    // Insert votes
    for (const optionId of optionIds) {
      await c.env.DB.prepare(
        `INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)`
      ).bind(pollId, optionId, user.id).run()
    }

    return c.redirect(`/leden/polls/${pollId}?success=voted`)
  } catch (error: any) {
    console.error('Vote submission error:', error)
    return c.redirect(`/leden/polls/${pollId}?error=vote_failed`)
  }
})

export default app
