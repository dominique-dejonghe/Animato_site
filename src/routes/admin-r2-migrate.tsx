// =============================================================================
// Admin R2 Migration — verplaats bestaande base64-data uit D1 naar R2
// =============================================================================
// Eenmalige migratie van:
//   1. photos.url        (39 albumfoto's, ~9.5 MB)
//   2. member_photos.data (14 profielfoto's, ~1 MB)
//   3. albums.cover_url  (eventuele base64-covers)
//   4. materials.url     (eventuele base64-materialen, momenteel 0)
//
// Endpoints (admin only):
//   GET  /admin/r2-migrate          — overzicht + run-knoppen
//   POST /admin/r2-migrate/photos   — verplaats album-foto's naar R2
//   POST /admin/r2-migrate/members  — verplaats profielfoto's
//   POST /admin/r2-migrate/covers   — verplaats album-covers
//   POST /admin/r2-migrate/materials — verplaats materiaal-bestanden
//
// Idempotent: rijen die al een /r2/<key> URL hebben worden overgeslagen.
// =============================================================================

import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import type { Bindings, SessionUser } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { uploadDataUrlToR2, isDataUrl } from '../utils/r2-storage'

const app = new Hono<{ Bindings: Bindings }>()

// SCOPE-FIX 2026-06-17: was /admin/* en /api/admin/* — te breed.
app.use('/admin/r2-migrate', requireAuth)
app.use('/admin/r2-migrate', requireRole('admin'))
app.use('/admin/r2-migrate/*', requireAuth)
app.use('/admin/r2-migrate/*', requireRole('admin'))
app.use('/api/admin/r2-migrate', requireAuth)
app.use('/api/admin/r2-migrate', requireRole('admin'))
app.use('/api/admin/r2-migrate/*', requireAuth)
app.use('/api/admin/r2-migrate/*', requireRole('admin'))

// =====================================================
// Migration overview page
// =====================================================
app.get('/admin/r2-migrate', async (c) => {
  const user = c.get('user') as SessionUser

  // Tellingen
  const stats = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM photos WHERE url LIKE 'data:%') AS photos_pending,
      (SELECT COUNT(*) FROM photos WHERE url LIKE '/r2/%') AS photos_migrated,
      (SELECT COUNT(*) FROM photos) AS photos_total,
      (SELECT COUNT(*) FROM member_photos WHERE r2_key IS NULL AND data IS NOT NULL AND data != '') AS members_pending,
      (SELECT COUNT(*) FROM member_photos WHERE r2_key IS NOT NULL) AS members_migrated,
      (SELECT COUNT(*) FROM member_photos) AS members_total,
      (SELECT COUNT(*) FROM albums WHERE cover_url LIKE 'data:%') AS covers_pending,
      (SELECT COUNT(*) FROM albums WHERE cover_url LIKE '/r2/%') AS covers_migrated,
      (SELECT COUNT(*) FROM materials WHERE url LIKE 'data:%') AS materials_pending,
      (SELECT COUNT(*) FROM materials WHERE url LIKE '/r2/%') AS materials_migrated
  `).first() as any

  return c.html(
    <Layout title="R2 Migratie" user={user}>
      <div class="flex">
        <AdminSidebar userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-8">
          <div class="max-w-4xl">
            <h1 class="text-2xl font-bold mb-2">
              <i class="fas fa-cloud-upload-alt mr-2 text-blue-600"></i>
              R2 Storage Migratie
            </h1>
            <p class="text-gray-600 mb-6">
              Verplaats bestaande base64-bestanden uit de database naar Cloudflare R2 object storage.
              Dit verlaagt de database-grootte drastisch en lost de SQLITE_TOOBIG limiet op.
            </p>

            <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
              <p class="text-sm text-yellow-800">
                <i class="fas fa-exclamation-triangle mr-2"></i>
                <strong>Belangrijk:</strong> Run elke migratie één keer. Idempotent — al-gemigreerde rijen worden overgeslagen.
                Voor grote batches (39 foto's): deze pagina kan 1-2 minuten draaien — niet sluiten.
              </p>
            </div>

            {/* Photos */}
            <div class="bg-white rounded-lg border border-gray-200 p-6 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold">📷 Album-foto's</h2>
                <span class="text-sm text-gray-500">{stats.photos_total} totaal</span>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-orange-50 rounded p-3">
                  <div class="text-2xl font-bold text-orange-600">{stats.photos_pending}</div>
                  <div class="text-xs text-orange-700">Te migreren (base64)</div>
                </div>
                <div class="bg-green-50 rounded p-3">
                  <div class="text-2xl font-bold text-green-600">{stats.photos_migrated}</div>
                  <div class="text-xs text-green-700">Op R2</div>
                </div>
              </div>
              <button
                id="btn-photos"
                onclick="runMigration('photos')"
                disabled={stats.photos_pending === 0}
                class={`px-4 py-2 rounded ${stats.photos_pending === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                <i class="fas fa-play mr-2"></i>
                Migreer album-foto's
              </button>
              <div id="result-photos" class="mt-3 hidden text-sm"></div>
            </div>

            {/* Member photos */}
            <div class="bg-white rounded-lg border border-gray-200 p-6 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold">👤 Profielfoto's</h2>
                <span class="text-sm text-gray-500">{stats.members_total} totaal</span>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-orange-50 rounded p-3">
                  <div class="text-2xl font-bold text-orange-600">{stats.members_pending}</div>
                  <div class="text-xs text-orange-700">Te migreren (base64)</div>
                </div>
                <div class="bg-green-50 rounded p-3">
                  <div class="text-2xl font-bold text-green-600">{stats.members_migrated}</div>
                  <div class="text-xs text-green-700">Op R2</div>
                </div>
              </div>
              <button
                id="btn-members"
                onclick="runMigration('members')"
                disabled={stats.members_pending === 0}
                class={`px-4 py-2 rounded ${stats.members_pending === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                <i class="fas fa-play mr-2"></i>
                Migreer profielfoto's
              </button>
              <div id="result-members" class="mt-3 hidden text-sm"></div>
            </div>

            {/* Covers */}
            <div class="bg-white rounded-lg border border-gray-200 p-6 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold">🖼️ Album-covers</h2>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-orange-50 rounded p-3">
                  <div class="text-2xl font-bold text-orange-600">{stats.covers_pending}</div>
                  <div class="text-xs text-orange-700">Te migreren</div>
                </div>
                <div class="bg-green-50 rounded p-3">
                  <div class="text-2xl font-bold text-green-600">{stats.covers_migrated}</div>
                  <div class="text-xs text-green-700">Op R2</div>
                </div>
              </div>
              <button
                id="btn-covers"
                onclick="runMigration('covers')"
                disabled={stats.covers_pending === 0}
                class={`px-4 py-2 rounded ${stats.covers_pending === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                <i class="fas fa-play mr-2"></i>
                Migreer album-covers
              </button>
              <div id="result-covers" class="mt-3 hidden text-sm"></div>
            </div>

            {/* Materials */}
            <div class="bg-white rounded-lg border border-gray-200 p-6 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold">📄 Oefenmateriaal-bestanden</h2>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-orange-50 rounded p-3">
                  <div class="text-2xl font-bold text-orange-600">{stats.materials_pending}</div>
                  <div class="text-xs text-orange-700">Te migreren</div>
                </div>
                <div class="bg-green-50 rounded p-3">
                  <div class="text-2xl font-bold text-green-600">{stats.materials_migrated}</div>
                  <div class="text-xs text-green-700">Op R2</div>
                </div>
              </div>
              <button
                id="btn-materials"
                onclick="runMigration('materials')"
                disabled={stats.materials_pending === 0}
                class={`px-4 py-2 rounded ${stats.materials_pending === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                <i class="fas fa-play mr-2"></i>
                Migreer materiaal-bestanden
              </button>
              <div id="result-materials" class="mt-3 hidden text-sm"></div>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            async function runMigration(type) {
              const btn = document.getElementById('btn-' + type);
              const result = document.getElementById('result-' + type);
              btn.disabled = true;
              btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Bezig...';
              result.className = 'mt-3 text-sm text-blue-700 bg-blue-50 rounded p-3';
              result.classList.remove('hidden');
              result.innerHTML = 'Migratie loopt — niet sluiten...';

              try {
                const res = await fetch('/api/admin/r2-migrate/' + type, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                  result.className = 'mt-3 text-sm text-green-800 bg-green-50 rounded p-3';
                  result.innerHTML = '<i class="fas fa-check-circle mr-2"></i>' +
                    'Klaar: ' + data.migrated + ' verplaatst, ' + data.skipped + ' overgeslagen, ' +
                    data.failed + ' mislukt. <a href="/admin/r2-migrate" class="underline">Ververs</a>';
                } else {
                  result.className = 'mt-3 text-sm text-red-800 bg-red-50 rounded p-3';
                  result.innerHTML = '<i class="fas fa-times-circle mr-2"></i>Fout: ' + (data.error || 'onbekend');
                  btn.disabled = false;
                  btn.innerHTML = '<i class="fas fa-play mr-2"></i>Probeer opnieuw';
                }
              } catch (e) {
                result.className = 'mt-3 text-sm text-red-800 bg-red-50 rounded p-3';
                result.innerHTML = '<i class="fas fa-times-circle mr-2"></i>Netwerk-fout: ' + e.message;
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play mr-2"></i>Probeer opnieuw';
              }
            }
          ` }}></script>
        </main>
      </div>
    </Layout>
  )
})

// =====================================================
// Migrate album photos
// =====================================================
app.post('/api/admin/r2-migrate/photos', async (c) => {
  if (!c.env.R2) return c.json({ success: false, error: 'R2 niet geconfigureerd' }, 500)

  const rows = await c.env.DB.prepare(
    `SELECT id, album_id, url FROM photos WHERE url LIKE 'data:%' LIMIT 100`
  ).all()
  const photos = (rows.results || []) as any[]

  let migrated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  for (const p of photos) {
    if (!isDataUrl(p.url)) { skipped++; continue }
    try {
      const up = await uploadDataUrlToR2(c.env.R2, `photos/${p.album_id}`, p.url)
      if (!up) { failed++; errors.push(`#${p.id}: dataUrl niet gedecodeerd`); continue }
      await c.env.DB.prepare(
        `UPDATE photos SET url = ?, r2_key = ?, content_type = ?, size_bytes = ? WHERE id = ?`
      ).bind(up.url, up.key, up.contentType, up.size, p.id).run()
      migrated++
    } catch (e: any) {
      failed++
      errors.push(`#${p.id}: ${e.message}`)
    }
  }

  return c.json({ success: true, migrated, skipped, failed, errors: errors.slice(0, 10) })
})

// =====================================================
// Migrate member profile photos
// =====================================================
app.post('/api/admin/r2-migrate/members', async (c) => {
  if (!c.env.R2) return c.json({ success: false, error: 'R2 niet geconfigureerd' }, 500)

  const rows = await c.env.DB.prepare(
    `SELECT id, user_id, data, content_type FROM member_photos
     WHERE r2_key IS NULL AND data IS NOT NULL AND data != ''
     LIMIT 100`
  ).all()
  const members = (rows.results || []) as any[]

  let migrated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  for (const m of members) {
    try {
      // member_photos.data is meestal een data:URL
      let dataUrl = String(m.data)
      if (!dataUrl.startsWith('data:')) {
        // Anders: ruwe base64 — bouw data:URL met content_type
        const ct = m.content_type || 'image/jpeg'
        dataUrl = `data:${ct};base64,${dataUrl}`
      }
      const up = await uploadDataUrlToR2(c.env.R2, `member-photos`, dataUrl, `${m.user_id}.jpg`)
      if (!up) { failed++; errors.push(`#${m.id}: decode-fout`); continue }
      await c.env.DB.prepare(
        `UPDATE member_photos SET r2_key = ? WHERE id = ?`
      ).bind(up.key, m.id).run()
      // Ook profiles.foto_url updaten naar nieuwe /r2/ URL
      await c.env.DB.prepare(
        `UPDATE profiles SET foto_url = ? WHERE user_id = ?`
      ).bind(up.url, m.user_id).run()
      migrated++
    } catch (e: any) {
      failed++
      errors.push(`#${m.id}: ${e.message}`)
    }
  }

  return c.json({ success: true, migrated, skipped, failed, errors: errors.slice(0, 10) })
})

// =====================================================
// Migrate album covers
// =====================================================
app.post('/api/admin/r2-migrate/covers', async (c) => {
  if (!c.env.R2) return c.json({ success: false, error: 'R2 niet geconfigureerd' }, 500)

  const rows = await c.env.DB.prepare(
    `SELECT id, cover_url FROM albums WHERE cover_url LIKE 'data:%' LIMIT 100`
  ).all()
  const albums = (rows.results || []) as any[]

  let migrated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  for (const a of albums) {
    if (!isDataUrl(a.cover_url)) { skipped++; continue }
    try {
      const up = await uploadDataUrlToR2(c.env.R2, `covers/albums`, a.cover_url, `${a.id}.jpg`)
      if (!up) { failed++; continue }
      await c.env.DB.prepare(
        `UPDATE albums SET cover_url = ?, cover_r2_key = ? WHERE id = ?`
      ).bind(up.url, up.key, a.id).run()
      migrated++
    } catch (e: any) {
      failed++
      errors.push(`#${a.id}: ${e.message}`)
    }
  }

  return c.json({ success: true, migrated, skipped, failed, errors: errors.slice(0, 10) })
})

// =====================================================
// Migrate materials (oefenmateriaal-bestanden)
// =====================================================
app.post('/api/admin/r2-migrate/materials', async (c) => {
  if (!c.env.R2) return c.json({ success: false, error: 'R2 niet geconfigureerd' }, 500)

  const rows = await c.env.DB.prepare(
    `SELECT id, piece_id, url, mime_type, bestandsnaam FROM materials WHERE url LIKE 'data:%' LIMIT 100`
  ).all()
  const materials = (rows.results || []) as any[]

  let migrated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  for (const m of materials) {
    if (!isDataUrl(m.url)) { skipped++; continue }
    try {
      const up = await uploadDataUrlToR2(c.env.R2, `materials/${m.piece_id}`, m.url, m.bestandsnaam)
      if (!up) { failed++; continue }
      await c.env.DB.prepare(
        `UPDATE materials SET url = ?, r2_key = ?, mime_type = ?, grootte_bytes = ? WHERE id = ?`
      ).bind(up.url, up.key, up.contentType, up.size, m.id).run()
      migrated++
    } catch (e: any) {
      failed++
      errors.push(`#${m.id}: ${e.message}`)
    }
  }

  return c.json({ success: true, migrated, skipped, failed, errors: errors.slice(0, 10) })
})

export default app
