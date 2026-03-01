// Admin Walkthrough Tours Management
// CRUD interface for managing interactive guided tours

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll, execute, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Auth required
app.use('*', requireAuth)
app.use('*', requireRole('admin'))

// =====================================================
// TOURS OVERVIEW
// =====================================================

app.get('/admin/walkthrough', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get all tours with stats
  const tours = await queryAll(c.env.DB, `
    SELECT 
      t.*,
      COUNT(DISTINCT s.id) as step_count,
      COUNT(DISTINCT p.id) as total_attempts,
      SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) as completed_count
    FROM walkthrough_tours t
    LEFT JOIN walkthrough_steps s ON s.tour_id = t.id
    LEFT JOIN walkthrough_progress p ON p.tour_id = t.id
    GROUP BY t.id
    ORDER BY t.sort_order ASC, t.id ASC
  `, [])

  return c.html(
    <Layout title="Walkthrough Tours" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Walkthrough', href: '/admin/walkthrough' }
    ]}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="walkthrough" />
        
        <div class="flex-1 min-w-0">
          <div class="bg-white border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div class="flex items-center justify-between">
                <div>
                  <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-route text-animato-primary mr-3"></i>
                    Walkthrough Tours
                  </h1>
                  <p class="mt-2 text-gray-600">
                    Beheer interactieve rondleidingen voor nieuwe gebruikers
                  </p>
                </div>
                <a 
                  href="/admin/walkthrough/nieuw" 
                  class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition inline-flex items-center"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuwe Tour
                </a>
              </div>
            </div>
          </div>

          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            
            {success && (
              <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-check-circle mr-3"></i>
                {success === 'created' && 'Tour succesvol aangemaakt!'}
                {success === 'updated' && 'Tour succesvol bijgewerkt!'}
                {success === 'deleted' && 'Tour succesvol verwijderd!'}
              </div>
            )}

            {error && (
              <div class="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-exclamation-circle mr-3"></i>
                {error === 'failed' && 'Er ging iets mis. Probeer het opnieuw.'}
              </div>
            )}

            {/* Info Box */}
            <div class="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div class="flex items-start">
                <i class="fas fa-info-circle text-blue-600 text-xl mr-3 mt-1"></i>
                <div>
                  <h3 class="font-semibold text-blue-900 mb-2">Over Walkthrough Tours</h3>
                  <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Maak interactieve rondleidingen voor nieuwe admins en leden</li>
                    <li>Tours kunnen automatisch starten bij eerste login</li>
                    <li>Bekijk completion rates om te zien welke tours populair zijn</li>
                    <li>Gebruik CSS selectors om specifieke UI elementen te highlighten</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Tours List */}
            {tours.length === 0 ? (
              <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <i class="fas fa-route text-gray-400 text-6xl mb-4"></i>
                <h3 class="text-xl font-semibold text-gray-900 mb-2">Nog geen tours</h3>
                <p class="text-gray-600 mb-6">Maak je eerste walkthrough tour aan om gebruikers te helpen.</p>
                <a 
                  href="/admin/walkthrough/nieuw" 
                  class="inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuwe Tour Aanmaken
                </a>
              </div>
            ) : (
              <div class="space-y-4">
                {tours.map((tour: any) => {
                  const completionRate = tour.total_attempts > 0 
                    ? Math.round((tour.completed_count / tour.total_attempts) * 100) 
                    : 0

                  return (
                    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:border-animato-primary transition">
                      <div class="flex items-start justify-between">
                        <div class="flex items-start flex-1">
                          <div class={`w-12 h-12 rounded-lg flex items-center justify-center mr-4 ${
                            tour.is_active ? 'bg-animato-primary text-white' : 'bg-gray-200 text-gray-400'
                          }`}>
                            <i class={`${tour.icon} text-xl`}></i>
                          </div>
                          <div class="flex-1">
                            <div class="flex items-center gap-3 mb-2">
                              <h3 class="font-semibold text-gray-900 text-lg">
                                {tour.title}
                              </h3>
                              {tour.auto_start === 1 && (
                                <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                                  <i class="fas fa-magic mr-1"></i>
                                  Auto-start
                                </span>
                              )}
                              {tour.is_active ? (
                                <span class="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                  ✓ Actief
                                </span>
                              ) : (
                                <span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                                  Inactief
                                </span>
                              )}
                            </div>
                            
                            <p class="text-sm text-gray-600 mb-3">
                              {tour.description}
                            </p>

                            <div class="flex items-center gap-4 text-sm text-gray-500">
                              <span>
                                <i class="fas fa-list-ol mr-1"></i>
                                {tour.step_count} steps
                              </span>
                              <span>
                                <i class="fas fa-user-tag mr-1"></i>
                                Voor: <span class="font-medium capitalize">{tour.target_role}</span>
                              </span>
                              {tour.total_attempts > 0 && (
                                <>
                                  <span>
                                    <i class="fas fa-chart-line mr-1"></i>
                                    {tour.total_attempts} pogingen
                                  </span>
                                  <span>
                                    <i class="fas fa-check-circle mr-1"></i>
                                    {completionRate}% voltooid
                                  </span>
                                </>
                              )}
                            </div>

                            {tour.total_attempts > 0 && (
                              <div class="mt-3">
                                <div class="flex items-center justify-between text-xs text-gray-600 mb-1">
                                  <span>Completion rate</span>
                                  <span class="font-medium">{tour.completed_count}/{tour.total_attempts}</span>
                                </div>
                                <div class="w-full bg-gray-200 rounded-full h-2">
                                  <div 
                                    class="bg-animato-primary h-2 rounded-full transition-all"
                                    style={`width: ${completionRate}%`}
                                  ></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div class="flex items-center gap-2 ml-4">
                          <a 
                            href={`/admin/walkthrough/${tour.id}/preview`}
                            class="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition inline-flex items-center text-sm"
                            title="Preview tour"
                          >
                            <i class="fas fa-play mr-1"></i>
                            Preview
                          </a>
                          <a 
                            href={`/admin/walkthrough/${tour.id}/edit`}
                            class="px-3 py-2 border border-animato-primary text-animato-primary rounded-lg hover:bg-animato-primary hover:text-white transition inline-flex items-center text-sm"
                          >
                            <i class="fas fa-edit mr-1"></i>
                            Bewerken
                          </a>
                          <form method="POST" action={`/admin/walkthrough/${tour.id}/delete`} class="inline">
                            <button 
                              type="submit"
                              onclick="return confirm('Weet je zeker dat je deze tour wilt verwijderen?')"
                              class="px-3 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition inline-flex items-center text-sm"
                            >
                              <i class="fas fa-trash mr-1"></i>
                              Verwijderen
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// PREVIEW TOUR
// =====================================================

app.get('/admin/walkthrough/:id/preview', async (c) => {
  const tourId = c.req.param('id')

  // Get first step to find target URL
  const firstStep = await queryOne(c.env.DB, `
    SELECT target_url 
    FROM walkthrough_steps 
    WHERE tour_id = ? 
    ORDER BY step_number ASC 
    LIMIT 1
  `, [tourId])

  if (!firstStep) {
    // If no steps, redirect with error
    return c.redirect('/admin/walkthrough?error=no_steps')
  }

  // Redirect to target URL with start_tour param
  // Use 'start_tour' as implemented in public/static/walkthrough.js
  const targetUrl = firstStep.target_url || '/admin'
  const separator = targetUrl.includes('?') ? '&' : '?'
  return c.redirect(`${targetUrl}${separator}start_tour=${tourId}`)
})

// =====================================================
// DELETE TOUR
// =====================================================

app.post('/admin/walkthrough/:id/delete', async (c) => {
  const tourId = c.req.param('id')

  try {
    await execute(c.env.DB, `DELETE FROM walkthrough_tours WHERE id = ?`, [tourId])
    return c.redirect('/admin/walkthrough?success=deleted')
  } catch (error) {
    console.error('Error deleting tour:', error)
    return c.redirect('/admin/walkthrough?error=failed')
  }
})

// =====================================================
// NEW TOUR (Placeholder)
// =====================================================

app.get('/admin/walkthrough/nieuw', async (c) => {
  const user = c.get('user') as SessionUser
  return c.html(
    <Layout title="Nieuwe Tour" user={user}>
      <div class="p-8 text-center">
        <h1 class="text-2xl font-bold mb-4">Nieuwe Tour</h1>
        <p class="mb-4">Deze functionaliteit is nog in ontwikkeling.</p>
        <a href="/admin/walkthrough" class="text-blue-600 hover:underline">Terug naar overzicht</a>
      </div>
    </Layout>
  )
})

// =====================================================
// EDIT TOUR (Placeholder)
// =====================================================

app.get('/admin/walkthrough/:id/edit', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('id')
  return c.html(
    <Layout title="Bewerk Tour" user={user}>
      <div class="p-8 text-center">
        <h1 class="text-2xl font-bold mb-4">Bewerk Tour {tourId}</h1>
        <p class="mb-4">Deze functionaliteit is nog in ontwikkeling.</p>
        <a href="/admin/walkthrough" class="text-blue-600 hover:underline">Terug naar overzicht</a>
      </div>
    </Layout>
  )
})

export default app
