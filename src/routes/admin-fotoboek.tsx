import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import type { Bindings, SessionUser } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryOne, queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply authentication middleware
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// FOTOBOEK MANAGEMENT - Albums Overview
// =====================================================

app.get('/admin/fotoboek', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''

  // Get albums with photo counts
  let query = `
    SELECT a.id, a.titel, a.slug, a.beschrijving, a.datum, a.cover_url, a.is_publiek, a.created_at,
           COUNT(p.id) as foto_count,
           u.email as auteur_email,
           pr.voornaam as auteur_voornaam,
           pr.achternaam as auteur_achternaam
    FROM albums a
    LEFT JOIN photos p ON p.album_id = a.id
    LEFT JOIN users u ON u.id = a.created_by
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE 1=1
  `
  const params: any[] = []

  if (search) {
    query += ` AND (a.titel LIKE ? OR a.beschrijving LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }

  query += ` GROUP BY a.id ORDER BY a.datum DESC, a.created_at DESC LIMIT 50`

  const albums = await queryAll(c.env.DB, query, params)

  // Get counts
  const counts = {
    albums_all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM albums`),
    albums_publiek: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM albums WHERE is_publiek = 1`),
    photos_all: await queryOne<any>(c.env.DB, `SELECT COUNT(*) as count FROM photos`),
  }

  return c.html(
    <Layout 
      title="Fotoboek Beheer"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Fotoboek', href: '/admin/fotoboek' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-images text-purple-600 mr-3"></i>
                  Fotoboek Beheer
                </h1>
                <p class="mt-2 text-gray-600">
                  Beheer fotoalbums en foto's
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
                <a 
                  href="/admin/fotoboek/album/nieuw"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Nieuw Album
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Stats */}
          <div class="bg-white rounded-lg shadow-md mb-6 p-6">
            <div class="grid grid-cols-3 gap-4">
              <div class="text-center">
                <p class="text-2xl font-bold text-gray-900">{counts.albums_all?.count || 0}</p>
                <p class="text-sm text-gray-600">Totaal Albums</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-green-600">{counts.albums_publiek?.count || 0}</p>
                <p class="text-sm text-gray-600">Publiek</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-blue-600">{counts.photos_all?.count || 0}</p>
                <p class="text-sm text-gray-600">Totaal Foto's</p>
              </div>
            </div>
          </div>

          {/* Search */}
          <div class="bg-white rounded-lg shadow-md mb-6 p-6">
            <form method="GET" action="/admin/fotoboek" class="flex gap-4">
              <div class="flex-1">
                <input
                  type="text"
                  name="search"
                  value={search}
                  placeholder="Zoek albums..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                class="px-6 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
              >
                <i class="fas fa-search mr-2"></i>
                Zoeken
              </button>
            </form>
          </div>

          {/* Albums Grid */}
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {albums.length === 0 ? (
              <div class="col-span-full bg-white rounded-lg shadow-md p-12 text-center">
                <i class="fas fa-images text-gray-400 text-6xl mb-4"></i>
                <p class="text-gray-600 text-lg">Geen albums gevonden</p>
                <a 
                  href="/admin/fotoboek/album/nieuw"
                  class="inline-block mt-4 px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Eerste Album Maken
                </a>
              </div>
            ) : (
              albums.map((album: any) => (
                <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition group">
                  {/* Cover Image */}
                  <div class="relative h-48 bg-gray-200 overflow-hidden">
                    {album.cover_url ? (
                      <img 
                        src={album.cover_url} 
                        alt={album.titel}
                        class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div class="w-full h-full flex items-center justify-center">
                        <i class="fas fa-image text-gray-400 text-6xl"></i>
                      </div>
                    )}
                    
                    {/* Status Badge */}
                    <div class="absolute top-2 right-2">
                      <span class={`px-2 py-1 rounded text-xs font-medium ${
                        album.is_publiek ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'
                      }`}>
                        {album.is_publiek ? 'Publiek' : 'Privé'}
                      </span>
                    </div>
                  </div>

                  {/* Album Info */}
                  <div class="p-4">
                    <h3 class="text-lg font-semibold text-gray-900 mb-1 line-clamp-1">
                      {album.titel}
                    </h3>
                    <p class="text-sm text-gray-600 mb-3 line-clamp-2">
                      {album.beschrijving || 'Geen beschrijving'}
                    </p>

                    {/* Meta Info */}
                    <div class="flex items-center justify-between text-xs text-gray-500 mb-4">
                      <span>
                        <i class="fas fa-calendar mr-1"></i>
                        {new Date(album.datum).toLocaleDateString('nl-NL')}
                      </span>
                      <span>
                        <i class="fas fa-image mr-1"></i>
                        {album.foto_count} foto's
                      </span>
                    </div>

                    {/* Actions */}
                    <div class="flex gap-2">
                      <a
                        href={`/admin/fotoboek/album/${album.id}`}
                        class="flex-1 px-3 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition text-center text-sm"
                      >
                        <i class="fas fa-edit mr-1"></i>
                        Beheer
                      </a>
                      <a
                        href={`/fotoboek/${album.slug}`}
                        target="_blank"
                        class="px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition text-sm"
                      >
                        <i class="fas fa-external-link-alt"></i>
                      </a>
                      <button
                        onclick={`if(confirm('Weet je zeker dat je dit album wilt verwijderen?')) { fetch('/admin/fotoboek/album/${album.id}/delete', {method: 'POST'}).then(() => location.reload()) }`}
                        class="px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition text-sm"
                      >
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// ALBUM MANAGEMENT - View/Edit Album + Photos
// =====================================================

app.get('/admin/fotoboek/album/nieuw', async (c) => {
  const user = c.get('user') as SessionUser

  return c.html(
    <Layout 
      title="Nieuw Album"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Fotoboek', href: '/admin/fotoboek' },
        { label: 'Nieuw Album', href: '/admin/fotoboek/album/nieuw' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div class="bg-white rounded-lg shadow-md p-6">
            <h1 class="text-2xl font-bold mb-6">
              <i class="fas fa-plus-circle text-purple-600 mr-2"></i>
              Nieuw Album Maken
            </h1>

            <form method="POST" action="/admin/fotoboek/album/create">
              <div class="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Titel *</label>
                  <input
                    type="text"
                    name="titel"
                    required
                    placeholder="Kerstconcert 2024"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Datum</label>
                  <input
                    type="date"
                    name="datum"
                    value={new Date().toISOString().split('T')[0]}
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Beschrijving</label>
                <textarea
                  name="beschrijving"
                  rows="3"
                  placeholder="Korte beschrijving van dit album..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                ></textarea>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Cover Foto</label>
                
                {/* File Upload Option */}
                <div class="mb-3">
                  <label class="block text-sm text-gray-600 mb-2">
                    <i class="fas fa-upload mr-1"></i>
                    Upload Foto
                  </label>
                  <input
                    type="file"
                    id="cover_file"
                    accept="image/*"
                    class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-animato-primary file:text-white hover:file:bg-animato-secondary cursor-pointer"
                    onchange="handleCoverFileSelect(event)"
                  />
                  <p class="text-xs text-gray-500 mt-1">Of gebruik een URL hieronder</p>
                </div>

                {/* Image Preview */}
                <div id="cover_preview" class="hidden mb-3">
                  <label class="block text-sm text-gray-600 mb-2">Preview:</label>
                  <div class="relative inline-block">
                    <img id="cover_preview_img" src="" alt="Preview" class="h-32 rounded-lg border border-gray-300" />
                    <button
                      type="button"
                      onclick="clearCoverImage()"
                      class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                    >
                      <i class="fas fa-times text-xs"></i>
                    </button>
                  </div>
                </div>

                {/* URL Input (alternative) */}
                <div class="mb-2">
                  <label class="block text-sm text-gray-600 mb-2">
                    <i class="fas fa-link mr-1"></i>
                    Of gebruik een URL
                  </label>
                  <input
                    type="url"
                    name="cover_url"
                    id="cover_url_input"
                    placeholder="https://example.com/cover.jpg"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    onchange="handleCoverUrlChange()"
                  />
                  <p class="text-xs text-gray-500 mt-1">Gebruik Unsplash voor gratis afbeeldingen</p>
                </div>

                {/* Hidden field for base64 data */}
                <input type="hidden" name="cover_data" id="cover_data" />
              </div>

              <div class="mb-6">
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="is_publiek"
                    value="1"
                    checked
                    class="mr-2 h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded"
                  />
                  <span class="text-sm text-gray-700">Publiek zichtbaar maken</span>
                </label>
              </div>

              <div class="flex gap-3">
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-save mr-2"></i>
                  Album Aanmaken
                </button>
                <a
                  href="/admin/fotoboek"
                  class="px-6 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  Annuleren
                </a>
              </div>
            </form>
          </div>
        </div>

        {/* JavaScript for file upload handling */}
        <script dangerouslySetInnerHTML={{
          __html: `
            function handleCoverFileSelect(event) {
              const file = event.target.files[0];
              if (!file) return;

              // Validate file type
              if (!file.type.startsWith('image/')) {
                alert('Alleen afbeeldingen zijn toegestaan');
                return;
              }

              // Validate file size (max 5MB)
              if (file.size > 5 * 1024 * 1024) {
                alert('Bestand is te groot. Maximaal 5MB toegestaan.');
                return;
              }

              // Read file and create preview
              const reader = new FileReader();
              reader.onload = function(e) {
                const base64Data = e.target.result;
                
                // Show preview
                document.getElementById('cover_preview_img').src = base64Data;
                document.getElementById('cover_preview').classList.remove('hidden');
                
                // Store base64 in hidden field
                document.getElementById('cover_data').value = base64Data;
                
                // Clear URL input
                document.getElementById('cover_url_input').value = '';
              };
              reader.readAsDataURL(file);
            }

            function handleCoverUrlChange() {
              const url = document.getElementById('cover_url_input').value;
              if (url) {
                // Clear file input and preview
                document.getElementById('cover_file').value = '';
                document.getElementById('cover_data').value = '';
                document.getElementById('cover_preview').classList.add('hidden');
              }
            }

            function clearCoverImage() {
              document.getElementById('cover_file').value = '';
              document.getElementById('cover_data').value = '';
              document.getElementById('cover_preview').classList.add('hidden');
              document.getElementById('cover_preview_img').src = '';
            }
          `
        }}></script>
      </div>
    </Layout>
  )
})
app.get('/admin/fotoboek/album/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const albumId = c.req.param('id')

  // Get album details
  const album = await queryOne(
    c.env.DB,
    `SELECT a.*, u.email as auteur_email, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam
     FROM albums a
     LEFT JOIN users u ON u.id = a.created_by
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE a.id = ?`,
    [albumId]
  )

  if (!album) {
    return c.html(<div>Album niet gevonden</div>, 404)
  }

  // Get photos
  const photos = await queryAll(
    c.env.DB,
    `SELECT * FROM photos WHERE album_id = ? ORDER BY sorteer_volgorde ASC, created_at ASC`,
    [albumId]
  )

  return c.html(
    <Layout 
      title={`Album: ${album.titel}`}
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Fotoboek', href: '/admin/fotoboek' },
        { label: album.titel, href: `/admin/fotoboek/album/${albumId}` }
      ]}
    >
      <div class="bg-gray-50 min-h-screen">
        {/* Header */}
        <div class="bg-white border-b border-gray-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-images text-purple-600 mr-3"></i>
                  {album.titel}
                </h1>
                <p class="mt-2 text-gray-600">
                  {album.beschrijving || 'Geen beschrijving'}
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/admin/fotoboek" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <i class="fas fa-arrow-left mr-2"></i>
                  Terug
                </a>
                <button
                  onclick="document.getElementById('edit-album-form').style.display = 'block'"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  <i class="fas fa-edit mr-2"></i>
                  Album Bewerken
                </button>
                <button
                  onclick="document.getElementById('add-photo-form').style.display = 'block'"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Foto Toevoegen
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Edit Album Form (Hidden by default) */}
          <div id="edit-album-form" class="bg-white rounded-lg shadow-md p-6 mb-6" style="display: none;">
            <h2 class="text-xl font-bold mb-4">Album Bewerken</h2>
            <form method="POST" action={`/admin/fotoboek/album/${albumId}/update`}>
              <div class="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Titel *</label>
                  <input
                    type="text"
                    name="titel"
                    value={album.titel}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Datum</label>
                  <input
                    type="date"
                    name="datum"
                    value={album.datum}
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Beschrijving</label>
                <textarea
                  name="beschrijving"
                  rows="3"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{album.beschrijving || ''}</textarea>
              </div>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Cover Foto</label>
                
                {/* Current cover preview */}
                {album.cover_url && (
                  <div class="mb-3">
                    <label class="block text-sm text-gray-600 mb-2">Huidige cover:</label>
                    <img src={album.cover_url} alt="Current cover" class="h-32 rounded-lg border border-gray-300 mb-2" />
                  </div>
                )}
                
                {/* File Upload Option */}
                <div class="mb-3">
                  <label class="block text-sm text-gray-600 mb-2">
                    <i class="fas fa-upload mr-1"></i>
                    Upload Nieuwe Foto
                  </label>
                  <input
                    type="file"
                    id="edit_cover_file"
                    accept="image/*"
                    class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-animato-primary file:text-white hover:file:bg-animato-secondary cursor-pointer"
                    onchange="handleEditCoverFileSelect(event)"
                  />
                </div>

                {/* Image Preview */}
                <div id="edit_cover_preview" class="hidden mb-3">
                  <label class="block text-sm text-gray-600 mb-2">Nieuwe preview:</label>
                  <div class="relative inline-block">
                    <img id="edit_cover_preview_img" src="" alt="Preview" class="h-32 rounded-lg border border-gray-300" />
                    <button
                      type="button"
                      onclick="clearEditCoverImage()"
                      class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                    >
                      <i class="fas fa-times text-xs"></i>
                    </button>
                  </div>
                </div>

                {/* URL Input (alternative) */}
                <div class="mb-2">
                  <label class="block text-sm text-gray-600 mb-2">
                    <i class="fas fa-link mr-1"></i>
                    Of gebruik een URL
                  </label>
                  <input
                    type="url"
                    name="cover_url"
                    id="edit_cover_url_input"
                    value={album.cover_url || ''}
                    placeholder="https://example.com/foto.jpg"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    onchange="handleEditCoverUrlChange()"
                  />
                </div>

                {/* Hidden field for base64 data */}
                <input type="hidden" name="cover_data" id="edit_cover_data" />
              </div>
              <div class="mb-4">
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    name="is_publiek"
                    value="1"
                    checked={album.is_publiek === 1}
                    class="mr-2 h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded"
                  />
                  <span class="text-sm text-gray-700">Publiek zichtbaar</span>
                </label>
              </div>
              <div class="flex gap-3">
                <button
                  type="submit"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-save mr-2"></i>
                  Opslaan
                </button>
                <button
                  type="button"
                  onclick="document.getElementById('edit-album-form').style.display = 'none'"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  Annuleren
                </button>
              </div>
            </form>
          </div>

          {/* Add Photo Form (Hidden by default) */}
          <div id="add-photo-form" class="bg-white rounded-lg shadow-md p-6 mb-6" style="display: none;">
            <h2 class="text-xl font-bold mb-4">Foto Toevoegen</h2>
            <form method="POST" action={`/admin/fotoboek/album/${albumId}/foto/add`}>
              
              {/* Foto Upload/URL Section */}
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Foto *</label>
                
                {/* Tab Toggle */}
                <div class="flex gap-2 mb-3">
                  <button 
                    type="button" 
                    id="photo-upload-tab-btn"
                    onclick="switchPhotoMode('upload')"
                    class="flex-1 px-4 py-2 border-2 border-animato-primary bg-animato-primary text-white rounded-lg transition font-medium"
                  >
                    <i class="fas fa-upload mr-2"></i>Upload Bestand
                  </button>
                  <button 
                    type="button" 
                    id="photo-url-tab-btn"
                    onclick="switchPhotoMode('url')"
                    class="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg transition font-medium hover:bg-gray-50"
                  >
                    <i class="fas fa-link mr-2"></i>URL Invoeren
                  </button>
                </div>

                {/* Upload Section */}
                <div id="photo-upload-section">
                  <input
                    type="file"
                    id="photo_file_input"
                    accept="image/*"
                    class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-animato-primary file:text-white hover:file:bg-animato-secondary cursor-pointer"
                    onchange="handlePhotoFileSelect(event)"
                  />
                  <p class="text-xs text-gray-500 mt-1">Maximaal 5MB per foto</p>
                  
                  {/* Preview */}
                  <div id="photo_file_preview" class="hidden mt-3">
                    <label class="block text-sm text-gray-600 mb-2">Preview:</label>
                    <div class="relative inline-block">
                      <img id="photo_file_preview_img" src="" alt="Preview" class="max-h-48 rounded-lg border border-gray-300" />
                      <button
                        type="button"
                        onclick="clearPhotoFile()"
                        class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        <i class="fas fa-times text-xs"></i>
                      </button>
                    </div>
                  </div>
                </div>

                {/* URL Section */}
                <div id="photo-url-section" style="display: none;">
                  <input
                    type="url"
                    id="photo_url_input"
                    name="url"
                    placeholder="https://example.com/foto.jpg"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <p class="text-xs text-gray-500 mt-1">Gebruik Unsplash, Imgur of een andere afbeeldingsdienst</p>
                </div>

                {/* Hidden field for base64 data */}
                <input type="hidden" name="photo_data" id="photo_data_input" />
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Bijschrift</label>
                <input
                  type="text"
                  name="caption"
                  placeholder="Beschrijving van de foto..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Fotograaf</label>
                <input
                  type="text"
                  name="fotograaf"
                  placeholder="Naam van de fotograaf..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Volgorde</label>
                <input
                  type="number"
                  name="sorteer_volgorde"
                  value={photos.length + 1}
                  min="1"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              <div class="flex gap-3">
                <button
                  type="submit"
                  class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Toevoegen
                </button>
                <button
                  type="button"
                  onclick="document.getElementById('add-photo-form').style.display = 'none'; resetPhotoForm();"
                  class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                >
                  Annuleren
                </button>
              </div>
            </form>
          </div>

          {/* Photos Grid */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold mb-4">
              Foto's ({photos.length})
            </h2>
            
            {photos.length === 0 ? (
              <div class="text-center py-12">
                <i class="fas fa-images text-gray-400 text-6xl mb-4"></i>
                <p class="text-gray-600">Nog geen foto's in dit album</p>
                <button
                  onclick="document.getElementById('add-photo-form').style.display = 'block'"
                  class="inline-block mt-4 px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition"
                >
                  <i class="fas fa-plus mr-2"></i>
                  Eerste Foto Toevoegen
                </button>
              </div>
            ) : (
              <div class="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
                {photos.map((photo: any) => (
                  <div class="relative group bg-gray-100 rounded-lg overflow-hidden">
                    <img 
                      src={photo.url} 
                      alt={photo.caption || 'Foto'}
                      class="w-full h-48 object-cover"
                    />
                    
                    {/* Overlay with info */}
                    <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-70 transition flex items-end">
                      <div class="p-3 text-white opacity-0 group-hover:opacity-100 transition">
                        {photo.caption && (
                          <p class="text-sm font-medium mb-1">{photo.caption}</p>
                        )}
                        {photo.fotograaf && (
                          <p class="text-xs">📷 {photo.fotograaf}</p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onclick={`if(confirm('Weet je zeker dat je deze foto wilt verwijderen?')) { fetch('/admin/fotoboek/foto/${photo.id}/delete', {method: 'POST'}).then(() => location.reload()) }`}
                        class="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                      >
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>

                    {/* Order badge */}
                    <div class="absolute top-2 left-2">
                      <span class="px-2 py-1 bg-gray-900 bg-opacity-75 text-white rounded text-xs">
                        #{photo.sorteer_volgorde}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* JavaScript for edit form file upload handling */}
      <script dangerouslySetInnerHTML={{
        __html: `
          function handleEditCoverFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
              alert('Alleen afbeeldingen zijn toegestaan');
              return;
            }

            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
              alert('Bestand is te groot. Maximaal 5MB toegestaan.');
              return;
            }

            // Read file and create preview
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64Data = e.target.result;
              
              // Show preview
              document.getElementById('edit_cover_preview_img').src = base64Data;
              document.getElementById('edit_cover_preview').classList.remove('hidden');
              
              // Store base64 in hidden field
              document.getElementById('edit_cover_data').value = base64Data;
              
              // Clear URL input
              document.getElementById('edit_cover_url_input').value = '';
            };
            reader.readAsDataURL(file);
          }

          function handleEditCoverUrlChange() {
            const url = document.getElementById('edit_cover_url_input').value;
            if (url) {
              // Clear file input and preview
              document.getElementById('edit_cover_file').value = '';
              document.getElementById('edit_cover_data').value = '';
              document.getElementById('edit_cover_preview').classList.add('hidden');
            }
          }

          function clearEditCoverImage() {
            document.getElementById('edit_cover_file').value = '';
            document.getElementById('edit_cover_data').value = '';
            document.getElementById('edit_cover_preview').classList.add('hidden');
            document.getElementById('edit_cover_preview_img').src = '';
          }

          // ===== Photo Upload/URL Toggle =====
          function switchPhotoMode(mode) {
            const uploadTab = document.getElementById('photo-upload-tab-btn');
            const urlTab = document.getElementById('photo-url-tab-btn');
            const uploadSection = document.getElementById('photo-upload-section');
            const urlSection = document.getElementById('photo-url-section');
            
            if (mode === 'upload') {
              // Switch to upload mode
              uploadTab.classList.add('bg-animato-primary', 'text-white', 'border-animato-primary');
              uploadTab.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
              urlTab.classList.remove('bg-animato-primary', 'text-white', 'border-animato-primary');
              urlTab.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
              
              uploadSection.style.display = 'block';
              urlSection.style.display = 'none';
              
              // Clear URL input
              document.getElementById('photo_url_input').value = '';
            } else {
              // Switch to URL mode
              urlTab.classList.add('bg-animato-primary', 'text-white', 'border-animato-primary');
              urlTab.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
              uploadTab.classList.remove('bg-animato-primary', 'text-white', 'border-animato-primary');
              uploadTab.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
              
              urlSection.style.display = 'block';
              uploadSection.style.display = 'none';
              
              // Clear file upload
              clearPhotoFile();
            }
          }

          function handlePhotoFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
              alert('Alleen afbeeldingen zijn toegestaan');
              event.target.value = '';
              return;
            }

            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
              alert('Bestand is te groot. Maximaal 5MB toegestaan.');
              event.target.value = '';
              return;
            }

            // Read file and create preview
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64Data = e.target.result;
              
              // Show preview
              document.getElementById('photo_file_preview_img').src = base64Data;
              document.getElementById('photo_file_preview').classList.remove('hidden');
              
              // Store base64 in hidden field
              document.getElementById('photo_data_input').value = base64Data;
            };
            reader.readAsDataURL(file);
          }

          function clearPhotoFile() {
            const fileInput = document.getElementById('photo_file_input');
            const preview = document.getElementById('photo_file_preview');
            const previewImg = document.getElementById('photo_file_preview_img');
            const dataInput = document.getElementById('photo_data_input');
            
            if (fileInput) fileInput.value = '';
            if (preview) preview.classList.add('hidden');
            if (previewImg) previewImg.src = '';
            if (dataInput) dataInput.value = '';
          }

          function resetPhotoForm() {
            // Reset to upload mode
            switchPhotoMode('upload');
            clearPhotoFile();
            
            // Clear URL input
            document.getElementById('photo_url_input').value = '';
          }
        `
      }}></script>
    </Layout>
  )
})

// =====================================================
// NEW ALBUM - Create Form
// =====================================================


// =====================================================
// API ROUTES - CRUD Operations
// =====================================================

// Create new album
app.post('/admin/fotoboek/album/create', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  
  const { titel, beschrijving, datum, cover_url, cover_data, is_publiek } = body

  // Generate slug from title
  const slug = String(titel).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Determine final cover URL
  // Priority: uploaded file (base64) > URL input
  let finalCoverUrl = null
  if (cover_data && String(cover_data).startsWith('data:image/')) {
    // Use base64 data directly
    finalCoverUrl = cover_data as string
  } else if (cover_url) {
    // Use provided URL
    finalCoverUrl = cover_url as string
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO albums (titel, slug, beschrijving, datum, cover_url, is_publiek, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      titel,
      slug,
      beschrijving || null,
      datum || new Date().toISOString().split('T')[0],
      finalCoverUrl,
      is_publiek === '1' ? 1 : 0,
      user.id
    ).run()

    return c.redirect(`/admin/fotoboek/album/${result.meta.last_row_id}`)
  } catch (error: any) {
    return c.json({ error: 'Album aanmaken mislukt', message: error.message }, 500)
  }
})

// Update album
app.post('/admin/fotoboek/album/:id/update', async (c) => {
  const albumId = c.req.param('id')
  const body = await c.req.parseBody()
  
  const { titel, beschrijving, datum, cover_url, cover_data, is_publiek } = body

  // Generate new slug from title
  const slug = String(titel).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Determine final cover URL
  // Priority: uploaded file (base64) > URL input > keep existing
  let finalCoverUrl = cover_url || null
  if (cover_data && String(cover_data).startsWith('data:image/')) {
    // Use base64 data directly
    finalCoverUrl = cover_data as string
  } else if (!cover_url) {
    // If no new data provided, keep existing (don't update)
    // We need to fetch current value
    const current = await c.env.DB.prepare(
      `SELECT cover_url FROM albums WHERE id = ?`
    ).bind(albumId).first() as any
    finalCoverUrl = current?.cover_url || null
  }

  try {
    await c.env.DB.prepare(
      `UPDATE albums 
       SET titel = ?, slug = ?, beschrijving = ?, datum = ?, cover_url = ?, is_publiek = ?
       WHERE id = ?`
    ).bind(
      titel,
      slug,
      beschrijving || null,
      datum || new Date().toISOString().split('T')[0],
      finalCoverUrl,
      is_publiek === '1' ? 1 : 0,
      albumId
    ).run()

    return c.redirect(`/admin/fotoboek/album/${albumId}`)
  } catch (error: any) {
    return c.json({ error: 'Album bijwerken mislukt', message: error.message }, 500)
  }
})

// Delete album
app.post('/admin/fotoboek/album/:id/delete', async (c) => {
  const albumId = c.req.param('id')

  try {
    // Delete all photos in album first
    await c.env.DB.prepare(`DELETE FROM photos WHERE album_id = ?`).bind(albumId).run()
    
    // Delete album
    await c.env.DB.prepare(`DELETE FROM albums WHERE id = ?`).bind(albumId).run()

    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Album verwijderen mislukt', message: error.message }, 500)
  }
})

// Add photo to album
app.post('/admin/fotoboek/album/:id/foto/add', async (c) => {
  const user = c.get('user') as SessionUser
  const albumId = c.req.param('id')
  const body = await c.req.parseBody()
  
  const { url, photo_data, caption, fotograaf, sorteer_volgorde } = body

  // Determine final photo URL
  // Priority: uploaded file (base64) > URL input
  let finalPhotoUrl = null
  if (photo_data && String(photo_data).startsWith('data:image/')) {
    // Use base64 data directly
    finalPhotoUrl = photo_data as string
  } else if (url) {
    // Use provided URL
    finalPhotoUrl = url as string
  }

  // Validation: must have either uploaded file or URL
  if (!finalPhotoUrl) {
    return c.json({ error: 'Geen foto opgegeven. Upload een bestand of geef een URL op.' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO photos (album_id, url, caption, fotograaf, upload_door, sorteer_volgorde)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      albumId,
      finalPhotoUrl,
      caption || null,
      fotograaf || null,
      user.id,
      sorteer_volgorde || 999
    ).run()

    return c.redirect(`/admin/fotoboek/album/${albumId}`)
  } catch (error: any) {
    return c.json({ error: 'Foto toevoegen mislukt', message: error.message }, 500)
  }
})

// Delete photo
app.post('/admin/fotoboek/foto/:id/delete', async (c) => {
  const photoId = c.req.param('id')

  try {
    await c.env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(photoId).run()
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Foto verwijderen mislukt', message: error.message }, 500)
  }
})

export default app
