// Admin Module Management
// Toggle features on/off dynamically

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
// MODULE SETTINGS OVERVIEW
// =====================================================

app.get('/admin/modules', async (c) => {
  const user = c.get('user') as SessionUser
  noCacheHeaders(c)

  const success = c.req.query('success')
  const error = c.req.query('error')

  // Get all modules grouped by category
  const modules = await queryAll(c.env.DB, `
    SELECT *
    FROM module_settings
    ORDER BY category ASC, sort_order ASC
  `, [])

  // Group by category
  const groupedModules: Record<string, any[]> = {}
  modules.forEach((mod: any) => {
    if (!groupedModules[mod.category]) {
      groupedModules[mod.category] = []
    }
    groupedModules[mod.category].push(mod)
  })

  const categoryLabels: Record<string, string> = {
    content: 'Content Modules',
    members: 'Leden Modules',
    admin: 'Admin Modules',
    general: 'Algemene Modules'
  }

  return c.html(
    <Layout title="Module Beheer" user={user} breadcrumbs={[
      { label: 'Admin', href: '/admin' },
      { label: 'Modules', href: '/admin/modules' }
    ]}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="modules" />
        
        <div class="flex-1 min-w-0">
          <div class="bg-white border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-toggle-on text-animato-primary mr-3"></i>
                  Module Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Schakel features aan of uit voor je koorwebsite
                </p>
              </div>
            </div>
          </div>

          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            
            {success && (
              <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
                <i class="fas fa-check-circle mr-3"></i>
                {success === 'updated' && 'Module instellingen succesvol bijgewerkt!'}
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
                  <h3 class="font-semibold text-blue-900 mb-2">Hoe werkt dit?</h3>
                  <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Schakel modules aan/uit met de toggle switches</li>
                    <li>Uitgeschakelde modules verdwijnen uit menu's en zijn niet toegankelijk</li>
                    <li>Bestaande data blijft bewaard (veilig om uit te zetten)</li>
                    <li>Wijzigingen zijn direct actief na opslaan</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Module Categories */}
            {Object.entries(groupedModules).map(([category, mods]) => (
              <div class="mb-8">
                <h2 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                  {categoryLabels[category] || category}
                  <span class="ml-3 text-sm text-gray-500 font-normal">
                    ({mods.filter((m: any) => m.is_enabled).length}/{mods.length} actief)
                  </span>
                </h2>

                <div class="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
                  {mods.map((module: any) => (
                    <div class="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div class="flex items-start flex-1">
                        <div class={`w-12 h-12 rounded-lg flex items-center justify-center mr-4 ${
                          module.is_enabled ? 'bg-animato-primary text-white' : 'bg-gray-200 text-gray-400'
                        }`}>
                          <i class={`${module.icon} text-xl`}></i>
                        </div>
                        <div class="flex-1">
                          <h3 class="font-semibold text-gray-900 text-lg mb-1">
                            {module.module_name}
                          </h3>
                          <p class="text-sm text-gray-600">
                            {module.module_description}
                          </p>
                          {module.updated_at && (
                            <p class="text-xs text-gray-500 mt-2">
                              <i class="far fa-clock mr-1"></i>
                              Laatst gewijzigd: {new Date(module.updated_at).toLocaleString('nl-NL')}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Toggle Switch */}
                      <form method="POST" action="/admin/modules/toggle" class="ml-6">
                        <input type="hidden" name="module_id" value={module.id} />
                        <input type="hidden" name="current_state" value={module.is_enabled} />
                        <label class="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={module.is_enabled === 1}
                            class="sr-only peer"
                            onchange="this.form.submit()"
                          />
                          <div class="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-animato-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-animato-primary"></div>
                          <span class="ml-3 text-sm font-medium text-gray-700">
                            {module.is_enabled ? 'Actief' : 'Inactief'}
                          </span>
                        </label>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Warning Box */}
            <div class="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <div class="flex items-start">
                <i class="fas fa-exclamation-triangle text-yellow-600 text-xl mr-3 mt-1"></i>
                <div>
                  <h3 class="font-semibold text-yellow-900 mb-2">Let op</h3>
                  <p class="text-sm text-yellow-800">
                    Het uitschakelen van modules zoals <strong>Agenda</strong> of <strong>Nieuws</strong> kan de gebruikerservaring beïnvloeden. 
                    Zorg ervoor dat je begrijpt welke impact dit heeft voordat je core modules uitschakelt.
                  </p>
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
// TOGGLE MODULE
// =====================================================

app.post('/admin/modules/toggle', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  
  const moduleId = body.module_id as string
  const currentState = parseInt(body.current_state as string)
  const newState = currentState === 1 ? 0 : 1

  try {
    await execute(c.env.DB, `
      UPDATE module_settings
      SET is_enabled = ?,
          updated_by = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [newState, user.id, moduleId])

    return c.redirect('/admin/modules?success=updated')
  } catch (error) {
    console.error('Error toggling module:', error)
    return c.redirect('/admin/modules?error=failed')
  }
})

export default app
