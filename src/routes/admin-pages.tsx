// Admin: editeerbare statische pagina's (#121)
// Doel: pagina-content (bv. /over) bewerken zonder code-wijziging.
// CRUD op de editable_pages tabel (zie migratie 0068).

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryAll, queryOne, execute } from '../utils/db'
import { requireAdmin } from '../middleware/auth'
import { uploadDataUrlToR2, isDataUrl, deleteFromR2, r2KeyFromUrl, uploadInlineDataUrlsInHtml } from '../utils/r2-storage'

const app = new Hono<{ Bindings: Bindings }>()

// Alle /admin/paginas routes vereisen admin/bestuur
app.use('/admin/paginas', requireAdmin)
app.use('/admin/paginas/*', requireAdmin)
app.use('/api/admin/paginas/*', requireAdmin)

// =====================================================
// LIJST: /admin/paginas
// =====================================================
app.get('/admin/paginas', async (c) => {
  const user = c.get('user') as SessionUser
  const success = c.req.query('success')

  const pages = await queryAll<any>(c.env.DB,
    `SELECT p.slug, p.titel, p.intro, p.updated_at, p.show_in_nav, p.nav_order,
            pr.voornaam as updater_voornaam, pr.achternaam as updater_achternaam
     FROM editable_pages p
     LEFT JOIN profiles pr ON pr.user_id = p.updated_by
     ORDER BY p.nav_order ASC, p.slug ASC`)

  return c.html(
    <Layout title="Pagina-beheer" user={user} currentPath="/admin/paginas">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {success === 'saved' && (
          <div class="mb-6 bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 flex items-center">
            <i class="fas fa-check-circle mr-2"></i> Pagina succesvol bijgewerkt.
          </div>
        )}

        <div class="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-file-alt text-animato-primary mr-3"></i>
              Pagina-beheer
            </h1>
            <p class="text-gray-600 mt-2">
              Hier beheer je de inhoud van statische pagina's zoals <code>/over</code>. Geen code-wijziging nodig.
            </p>
          </div>
          <button
            onclick="document.getElementById('newPageModal').classList.remove('hidden')"
            class="bg-animato-primary text-white px-4 py-2 rounded-lg hover:opacity-90 font-medium"
          >
            <i class="fas fa-plus mr-2"></i> Nieuwe pagina
          </button>
        </div>

        <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
          <table class="min-w-full">
            <thead class="bg-gray-50 border-b border-gray-200">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Slug</th>
                <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Titel</th>
                <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Laatst bewerkt</th>
                <th class="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acties</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {pages.length === 0 ? (
                <tr>
                  <td colspan={4} class="px-6 py-12 text-center text-gray-500">
                    <i class="fas fa-folder-open text-4xl mb-3 text-gray-300"></i>
                    <p>Nog geen pagina's. Maak er één aan om te starten.</p>
                  </td>
                </tr>
              ) : pages.map((p: any) => (
                <tr class="hover:bg-gray-50">
                  <td class="px-6 py-4">
                    <a href={`/${p.slug}`} target="_blank" rel="noopener" class="text-animato-primary font-mono text-sm hover:underline">
                      /{p.slug} <i class="fas fa-external-link-alt text-[10px] ml-0.5"></i>
                    </a>
                  </td>
                  <td class="px-6 py-4">
                    <div class="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                      <span>{p.titel}</span>
                      {p.show_in_nav === 1 ? (
                        <span title={`In header-navigatie (positie ${p.nav_order})`} class="inline-flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 text-xs px-2 py-0.5 rounded-full">
                          <i class="fas fa-bars"></i>
                          <span>nav #{p.nav_order}</span>
                        </span>
                      ) : (
                        <span title="Niet in header-navigatie" class="inline-flex items-center gap-1 text-gray-500 bg-gray-50 border border-gray-200 text-xs px-2 py-0.5 rounded-full">
                          <i class="fas fa-eye-slash"></i>
                          <span>verborgen</span>
                        </span>
                      )}
                    </div>
                    {p.intro && <div class="text-xs text-gray-500 line-clamp-1 mt-0.5">{p.intro}</div>}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500 hidden sm:table-cell">
                    {p.updated_at ? new Date(p.updated_at + 'Z').toLocaleString('nl-BE', {
                      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    }) : '-'}
                    {p.updater_voornaam && (
                      <div class="text-xs text-gray-400 mt-0.5">door {p.updater_voornaam} {p.updater_achternaam}</div>
                    )}
                  </td>
                  <td class="px-6 py-4 text-right">
                    <a href={`/admin/paginas/${p.slug}`} class="text-animato-primary hover:underline text-sm font-medium">
                      <i class="fas fa-edit mr-1"></i> Bewerken
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* New page modal */}
        <div id="newPageModal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-gray-900">Nieuwe pagina</h3>
              <button onclick="document.getElementById('newPageModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>
            <form action="/api/admin/paginas/create" method="POST" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Slug (URL-pad) <span class="text-red-500">*</span></label>
                <div class="flex items-center">
                  <span class="text-gray-400 mr-1 font-mono text-sm">/</span>
                  <input type="text" name="slug" required pattern="[a-z0-9-]+" placeholder="bijv. visie" class="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm" />
                </div>
                <p class="text-xs text-gray-500 mt-1">Enkel kleine letters, cijfers en streepjes. Bijv. <code>visie</code>, <code>historiek</code>.</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Titel <span class="text-red-500">*</span></label>
                <input type="text" name="titel" required class="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" name="show_in_nav" value="1" checked class="rounded border-gray-300 text-animato-primary focus:ring-animato-primary" />
                  <span>Toon in header-navigatie</span>
                </label>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Positie in nav (lager = eerder)</label>
                <input type="number" name="nav_order" value="100" min="0" max="9999" class="w-full border border-gray-300 rounded-lg px-3 py-2" />
                <p class="text-xs text-gray-500 mt-1">Statische items: Home=0, Over=10, Nieuws=20, Agenda=30, Concerten=40, Foto's=50, Contact=9999. Tip: gebruik tussen-waardes om je pagina ergens in te voegen.</p>
              </div>
              <div class="flex justify-end gap-2 pt-2">
                <button type="button" onclick="document.getElementById('newPageModal').classList.add('hidden')" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                  Annuleer
                </button>
                <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg hover:opacity-90 font-medium">
                  Aanmaken
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
// EDIT: /admin/paginas/:slug
// =====================================================
app.get('/admin/paginas/:slug', async (c) => {
  const user = c.get('user') as SessionUser
  const slug = c.req.param('slug')

  const page = await queryOne<any>(c.env.DB,
    `SELECT slug, titel, intro, body, hero_image, show_in_nav, nav_order FROM editable_pages WHERE slug = ?`,
    [slug])

  if (!page) {
    return c.html(
      <Layout title="Pagina niet gevonden" user={user}>
        <div class="max-w-2xl mx-auto py-16 text-center">
          <h1 class="text-3xl font-bold text-gray-800 mb-4">Pagina niet gevonden</h1>
          <a href="/admin/paginas" class="text-animato-primary hover:underline">← Terug naar pagina-overzicht</a>
        </div>
      </Layout>
    )
  }

  return c.html(
    <Layout title={`Bewerk: ${page.titel}`} user={user} currentPath="/admin/paginas">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="mb-6">
          <a href="/admin/paginas" class="text-animato-primary hover:underline text-sm">
            <i class="fas fa-arrow-left mr-1"></i> Terug naar pagina's
          </a>
        </div>

        <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              Bewerk pagina
            </h1>
            <p class="text-gray-600 mt-1">
              Live-link: <a href={`/${page.slug}`} target="_blank" class="text-animato-primary hover:underline font-mono">/{page.slug} <i class="fas fa-external-link-alt text-[10px]"></i></a>
            </p>
          </div>
        </div>

        <form action="/api/admin/paginas/save" method="POST" class="space-y-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <input type="hidden" name="slug" value={page.slug} />

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Titel <span class="text-red-500">*</span></label>
            <input type="text" name="titel" required value={page.titel} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Hero-afbeelding (optioneel)</label>
            <input type="text" name="hero_image" value={page.hero_image || ''} placeholder="/r2/photos/... of https://..." class="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm" />
            <p class="text-xs text-gray-500 mt-1">URL naar een afbeelding bovenaan de pagina. Laat leeg om geen hero te tonen.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Intro-tekst</label>
            <textarea name="intro" rows={2} class="w-full border border-gray-300 rounded-lg px-3 py-2">{page.intro || ''}</textarea>
            <p class="text-xs text-gray-500 mt-1">Korte tagline die direct onder de titel komt.</p>
          </div>

          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="show_in_nav"
                value="1"
                checked={page.show_in_nav === 1}
                class="mt-1 rounded border-gray-300 text-animato-primary focus:ring-animato-primary"
              />
              <div>
                <span class="text-sm font-medium text-gray-700">Toon in header-navigatie</span>
                <p class="text-xs text-gray-500 mt-0.5">
                  Wanneer aangevinkt verschijnt deze pagina als link in de header-balk
                  (op desktop bij te veel items in de "Meer ▾" dropdown).
                </p>
              </div>
            </label>

            <div class="pl-7">
              <label class="block text-sm font-medium text-gray-700 mb-1">Positie in nav</label>
              <input
                type="number"
                name="nav_order"
                value={page.nav_order ?? 100}
                min="0"
                max="9999"
                class="w-40 border border-gray-300 rounded-lg px-3 py-2"
              />
              <p class="text-xs text-gray-500 mt-1">
                Lager getal = eerder in de balk. Statische posities ter referentie:
                Home=0, Over Ons=10, Nieuws=20, Agenda=30, Concerten=40, Foto's=50, Contact=9999.
                Gebruik 15 om tussen "Over Ons" en "Nieuws" te staan, bv.
              </p>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Inhoud (HTML)</label>
            <div id="quill-editor" style="height: 480px; background: white; border-radius: 0.5rem;">
              <div dangerouslySetInnerHTML={{ __html: page.body || '' }} />
            </div>
            <textarea name="body" id="bodyTextarea" style="display:none">{page.body || ''}</textarea>
            <p class="text-xs text-gray-500 mt-1">
              Gebruik de toolbar voor titels, vetgedrukt, lijsten, links en afbeeldingen. Standaard rich text editor.
            </p>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100">
            <a href={`/${page.slug}`} target="_blank" class="text-sm text-gray-600 hover:text-animato-primary">
              <i class="fas fa-eye mr-1"></i> Bekijk live-pagina (na opslaan)
            </a>
            <button type="submit" class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:opacity-90 font-semibold shadow">
              <i class="fas fa-save mr-2"></i> Wijzigingen opslaan
            </button>
          </div>
        </form>

        {/* Quill editor (CDN) */}
        <link href="https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var quill = new Quill('#quill-editor', {
              theme: 'snow',
              modules: {
                toolbar: [
                  [{ 'header': [2, 3, false] }],
                  ['bold', 'italic', 'underline'],
                  [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                  ['link', 'image'],
                  ['clean']
                ]
              }
            });
            var ta = document.getElementById('bodyTextarea');
            // Sync on form submit
            document.querySelector('form').addEventListener('submit', function() {
              ta.value = quill.root.innerHTML;
            });
          })();
        ` }} />
      </div>
    </Layout>
  )
})

// =====================================================
// API: create / save
// =====================================================
app.post('/api/admin/paginas/create', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const slug = String(body.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '')
  const titel = String(body.titel || '').trim()
  const showInNav = body.show_in_nav ? 1 : 0
  const navOrderRaw = parseInt(String(body.nav_order || '100'), 10)
  const navOrder = Number.isFinite(navOrderRaw) ? Math.max(0, Math.min(9999, navOrderRaw)) : 100

  if (!slug || !titel) {
    return c.redirect('/admin/paginas?error=missing_fields')
  }

  // Check unique
  const existing = await queryOne(c.env.DB, `SELECT slug FROM editable_pages WHERE slug = ?`, [slug])
  if (existing) {
    return c.redirect('/admin/paginas?error=slug_exists')
  }

  await execute(c.env.DB,
    `INSERT INTO editable_pages (slug, titel, body, show_in_nav, nav_order, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [slug, titel, '<p>Nieuwe pagina — vul hier je inhoud in.</p>', showInNav, navOrder, user.id])

  return c.redirect(`/admin/paginas/${slug}`)
})

app.post('/api/admin/paginas/save', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const slug = String(body.slug || '')
  const titel = String(body.titel || '').trim()
  let intro: string | null = String(body.intro || '').trim() || null
  let heroImage: string | null = String(body.hero_image || '').trim() || null
  let content = String(body.body || '').trim()
  // Checkbox: aanwezig in body = aangevinkt; afwezig = niet aangevinkt
  const showInNav = body.show_in_nav ? 1 : 0
  const navOrderRaw = parseInt(String(body.nav_order || '100'), 10)
  const navOrder = Number.isFinite(navOrderRaw) ? Math.max(0, Math.min(9999, navOrderRaw)) : 100

  if (!slug || !titel) {
    return c.redirect('/admin/paginas?error=missing_fields')
  }

  // ─── Data-URL sanering: GEEN base64-foto's in editable_pages ───
  // hero_image kan een data:URL zijn (van de upload-widget)
  // intro/body zijn Quill HTML die <img src="data:...">-tags kan bevatten
  // (Quill embedt geplakte/gedropte afbeeldingen by default als base64)
  let oldHeroR2KeyToDelete: string | null = null
  try {
    // 1. hero_image
    if (heroImage && isDataUrl(heroImage)) {
      if (heroImage.length > 35_000_000) {
        return c.redirect(`/admin/paginas/${slug}?error=` + encodeURIComponent(
          'Hero-foto te groot (' + Math.round(heroImage.length / 1024 / 1024) + ' MB). Comprimeer en probeer opnieuw.'))
      }
      if (!c.env.R2) {
        return c.redirect(`/admin/paginas/${slug}?error=` + encodeURIComponent('R2 storage niet beschikbaar'))
      }
      const up = await uploadDataUrlToR2(c.env.R2, `pages/${slug}`, heroImage)
      if (!up) {
        return c.redirect(`/admin/paginas/${slug}?error=` + encodeURIComponent('Hero-foto upload mislukt'))
      }
      // Track oude R2-key voor opruimen na succesvolle UPDATE
      const prev = await queryOne<{ hero_image: string | null }>(c.env.DB,
        `SELECT hero_image FROM editable_pages WHERE slug = ?`, [slug]) as any
      oldHeroR2KeyToDelete = r2KeyFromUrl(prev?.hero_image || null)
      heroImage = up.url
    }

    // 2. intro & body: scan voor inline <img src="data:...">
    if (intro && c.env.R2) {
      intro = await uploadInlineDataUrlsInHtml(c.env.R2, `pages/${slug}`, intro)
    }
    if (content && c.env.R2) {
      content = await uploadInlineDataUrlsInHtml(c.env.R2, `pages/${slug}`, content)
    }
  } catch (e: any) {
    console.error('admin-pages save: R2 sanitize failed:', e?.message)
    return c.redirect(`/admin/paginas/${slug}?error=` + encodeURIComponent(
      'Foto kon niet opgeslagen worden: ' + (e?.message || 'onbekende fout')))
  }

  await execute(c.env.DB, `
    UPDATE editable_pages
    SET titel = ?, intro = ?, body = ?, hero_image = ?,
        show_in_nav = ?, nav_order = ?,
        updated_at = CURRENT_TIMESTAMP, updated_by = ?
    WHERE slug = ?
  `, [titel, intro, content, heroImage, showInNav, navOrder, user.id, slug])

  // Best-effort: oude R2 hero opruimen
  if (oldHeroR2KeyToDelete && c.env.R2) {
    try { await deleteFromR2(c.env.R2, oldHeroR2KeyToDelete) } catch {}
  }

  return c.redirect('/admin/paginas?success=saved')
})

export default app
