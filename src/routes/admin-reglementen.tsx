// =====================================================
// ADMIN: Reglementen documenten beheer
//
// CRUD op de reglementen_documenten tabel.
// Admins kunnen documenten (PDF, link, etc.) toevoegen die voor alle leden
// zichtbaar worden in /leden/reglementen.
// =====================================================

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware: alleen admin of bestuurslid
const requireAdmin = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.redirect('/login')
  const isStaff = user.role === 'admin' || user.role === 'bestuur' || user.is_bestuurslid === 1
  if (!isStaff) return c.redirect('/leden')
  c.set('user', user)
  await next()
}
app.use('/admin/reglementen', requireAdmin)
app.use('/admin/reglementen/*', requireAdmin)
app.use('/api/admin/reglementen/*', requireAdmin)

// =====================================================
// LIJST
// =====================================================
app.get('/admin/reglementen', async (c) => {
  const user = c.get('user')
  const docs = await queryAll<any>(c.env.DB,
    `SELECT r.*, p.voornaam, p.achternaam
     FROM reglementen_documenten r
     LEFT JOIN profiles p ON p.user_id = r.uploaded_by
     ORDER BY r.volgorde ASC, r.created_at DESC`
  ).catch(() => [])

  const success = c.req.query('success')
  const error = c.req.query('error')

  return c.html(
    <Layout title="Reglementen beheren" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="settings" userRole={(user as any).role} isBestuurslid={(user as any).is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="max-w-4xl">
            <div class="mb-6 flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900">
                  <i class="fas fa-scroll text-animato-primary mr-3"></i>
                  Reglementen & Documenten
                </h1>
                <p class="text-gray-600 mt-2">Beheer documenten die in het ledenportaal verschijnen onder "Reglementen".</p>
              </div>
            </div>

            {success && (
              <div class="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded mb-4">
                <i class="fas fa-check-circle mr-2"></i>
                {success === 'created' ? 'Document toegevoegd!' : success === 'updated' ? 'Document bijgewerkt!' : success === 'deleted' ? 'Document verwijderd!' : 'Opgeslagen.'}
              </div>
            )}
            {error && (
              <div class="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
                <i class="fas fa-exclamation-circle mr-2"></i>
                {error === 'missing_fields' ? 'Vul titel en URL in.' : 'Fout: ' + error}
              </div>
            )}

            {/* Nieuw formulier */}
            <div class="bg-white rounded-lg shadow-md p-6 mb-8">
              <h2 class="text-lg font-semibold mb-4">
                <i class="fas fa-plus-circle text-green-600 mr-2"></i>
                Nieuw document toevoegen
              </h2>
              <form action="/api/admin/reglementen/create" method="POST" class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
                  <input type="text" name="titel" required placeholder="bv. Animato koor-kompas" class="w-full border rounded px-3 py-2" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">URL naar document *</label>
                  <input type="url" name="url" required placeholder="https://r2.example.com/koor-kompas.pdf" class="w-full border rounded px-3 py-2 font-mono text-sm" />
                  <p class="text-xs text-gray-500 mt-1">Plaats het PDF eerst in <a href="/admin/bestanden" class="text-animato-primary hover:underline">Bestanden</a> of upload naar Cloudflare R2, plak hier de publieke URL.</p>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Icoon</label>
                    <select name="icoon" class="w-full border rounded px-3 py-2">
                      <option value="fa-file-pdf">PDF</option>
                      <option value="fa-file-word">Word</option>
                      <option value="fa-file-alt">Document</option>
                      <option value="fa-book-open">Boek / Kompas</option>
                      <option value="fa-balance-scale">Reglement</option>
                      <option value="fa-link">Externe link</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Volgorde</label>
                    <input type="number" name="volgorde" value="0" class="w-full border rounded px-3 py-2" />
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                  <textarea name="beschrijving" rows={2} class="w-full border rounded px-3 py-2" placeholder="Korte uitleg over dit document"></textarea>
                </div>
                <button type="submit" class="bg-animato-primary text-white px-6 py-2 rounded hover:bg-opacity-90">
                  <i class="fas fa-plus mr-1"></i> Toevoegen
                </button>
              </form>
            </div>

            {/* Lijst bestaande */}
            <div class="bg-white rounded-lg shadow-md overflow-hidden">
              <div class="px-6 py-4 border-b">
                <h2 class="text-lg font-semibold">
                  <i class="fas fa-list text-animato-primary mr-2"></i>
                  Bestaande documenten ({docs.length})
                </h2>
              </div>
              {docs.length === 0 ? (
                <div class="p-12 text-center text-gray-500">
                  <i class="fas fa-folder-open text-5xl text-gray-300 mb-3"></i>
                  <p>Nog geen documenten. Voeg er bovenaan eentje toe.</p>
                </div>
              ) : (
                <table class="w-full">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Volgorde</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titel</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acties</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    {docs.map((d: any) => (
                      <tr class="hover:bg-gray-50">
                        <td class="px-6 py-3 text-sm text-gray-600">{d.volgorde}</td>
                        <td class="px-6 py-3">
                          <div class="font-medium text-gray-900">
                            <i class={`fas ${d.icoon || 'fa-file-pdf'} mr-2 text-animato-primary`}></i>
                            {d.titel}
                          </div>
                          {d.beschrijving && <div class="text-xs text-gray-500 mt-1">{d.beschrijving}</div>}
                        </td>
                        <td class="px-6 py-3 text-sm">
                          <a href={d.url} target="_blank" class="text-animato-primary hover:underline truncate inline-block max-w-xs">
                            {d.url}
                          </a>
                        </td>
                        <td class="px-6 py-3">
                          {d.is_actief === 1 ? (
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">Actief</span>
                          ) : (
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">Inactief</span>
                          )}
                        </td>
                        <td class="px-6 py-3 text-right">
                          <a href={`/admin/reglementen/${d.id}/edit`} class="text-animato-primary hover:underline text-sm mr-3">
                            <i class="fas fa-edit"></i> Bewerken
                          </a>
                          <form action="/api/admin/reglementen/delete" method="POST" class="inline" onsubmit="return confirm('Document echt verwijderen?')">
                            <input type="hidden" name="id" value={d.id} />
                            <button type="submit" class="text-red-600 hover:underline text-sm">
                              <i class="fas fa-trash"></i> Verwijderen
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// EDIT FORM
// =====================================================
app.get('/admin/reglementen/:id/edit', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await queryOne<any>(c.env.DB, `SELECT * FROM reglementen_documenten WHERE id = ?`, [id])
  if (!doc) return c.redirect('/admin/reglementen?error=not_found')

  return c.html(
    <Layout title={`Bewerk: ${doc.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="settings" userRole={(user as any).role} isBestuurslid={(user as any).is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="max-w-2xl">
            <a href="/admin/reglementen" class="text-animato-primary hover:underline text-sm">
              <i class="fas fa-arrow-left mr-1"></i> Terug naar lijst
            </a>
            <h1 class="text-2xl font-bold text-gray-900 mt-3 mb-6">Bewerk: {doc.titel}</h1>

            <form action="/api/admin/reglementen/update" method="POST" class="bg-white rounded-lg shadow-md p-6 space-y-4">
              <input type="hidden" name="id" value={doc.id} />
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
                <input type="text" name="titel" required value={doc.titel} class="w-full border rounded px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">URL *</label>
                <input type="url" name="url" required value={doc.url} class="w-full border rounded px-3 py-2 font-mono text-sm" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Icoon</label>
                  <select name="icoon" class="w-full border rounded px-3 py-2">
                    {['fa-file-pdf','fa-file-word','fa-file-alt','fa-book-open','fa-balance-scale','fa-link'].map(opt => (
                      <option value={opt} selected={doc.icoon === opt}>{opt.replace('fa-','')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Volgorde</label>
                  <input type="number" name="volgorde" value={doc.volgorde} class="w-full border rounded px-3 py-2" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                <textarea name="beschrijving" rows={3} class="w-full border rounded px-3 py-2">{doc.beschrijving || ''}</textarea>
              </div>
              <div class="flex items-center">
                <input type="checkbox" id="is_actief" name="is_actief" value="1" checked={doc.is_actief === 1} class="h-4 w-4 text-animato-primary border-gray-300 rounded" />
                <label for="is_actief" class="ml-2 text-sm text-gray-700">Zichtbaar voor leden</label>
              </div>
              <div class="flex gap-3 pt-2">
                <button type="submit" class="bg-animato-primary text-white px-6 py-2 rounded hover:bg-opacity-90">
                  <i class="fas fa-save mr-1"></i> Opslaan
                </button>
                <a href="/admin/reglementen" class="text-gray-600 hover:underline px-6 py-2">Annuleren</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// API: CRUD
// =====================================================
app.post('/api/admin/reglementen/create', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.parseBody()
  const titel = String(body.titel || '').trim()
  const url = String(body.url || '').trim()
  if (!titel || !url) return c.redirect('/admin/reglementen?error=missing_fields')

  await execute(c.env.DB,
    `INSERT INTO reglementen_documenten (titel, beschrijving, url, icoon, volgorde, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [titel, String(body.beschrijving || ''), url, String(body.icoon || 'fa-file-pdf'), parseInt(String(body.volgorde || '0'), 10) || 0, user.id]
  )
  return c.redirect('/admin/reglementen?success=created')
})

app.post('/api/admin/reglementen/update', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || '0'), 10)
  const titel = String(body.titel || '').trim()
  const url = String(body.url || '').trim()
  if (!id || !titel || !url) return c.redirect('/admin/reglementen?error=missing_fields')

  await execute(c.env.DB,
    `UPDATE reglementen_documenten
     SET titel = ?, beschrijving = ?, url = ?, icoon = ?, volgorde = ?, is_actief = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      titel,
      String(body.beschrijving || ''),
      url,
      String(body.icoon || 'fa-file-pdf'),
      parseInt(String(body.volgorde || '0'), 10) || 0,
      body.is_actief === '1' ? 1 : 0,
      id
    ]
  )
  return c.redirect('/admin/reglementen?success=updated')
})

app.post('/api/admin/reglementen/delete', async (c) => {
  const body = await c.req.parseBody()
  const id = parseInt(String(body.id || '0'), 10)
  if (!id) return c.redirect('/admin/reglementen?error=missing_id')
  await execute(c.env.DB, `DELETE FROM reglementen_documenten WHERE id = ?`, [id])
  return c.redirect('/admin/reglementen?success=deleted')
})

export default app
