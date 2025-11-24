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
      title="Polls & Stemmingen" 
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
              Polls & Stemmingen
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
                <a
                  href="/leden/voorstellen"
                  class="px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                >
                  <i class="fas fa-lightbulb mr-2"></i>
                  Mijn Voorstellen
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

export default app
