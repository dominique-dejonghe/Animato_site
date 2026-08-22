// =====================================================
// EDITABLE PAGES — dynamische publieke pagina's vanuit DB
// =====================================================
//
// Achtergrond: admin kan via /admin/paginas pagina's aanmaken in
// editable_pages. /over heeft een eigen handler in public.tsx, maar nieuwe
// pagina's zoals /bevriend, /vrienden, etc. hadden anders 404 gegeven.
//
// Deze route MOET vóór ledenRoutes/walkthroughApi geregistreerd worden in
// index.tsx, omdat die sub-apps wildcard auth-middleware hebben die alle
// unmatched paths 401-en — dat ving de notFound handler dus weg.
//
// Routing-strategie:
//   * We registreren EXACT op /:slug (single segment)
//   * Maar valideren in de handler dat de slug:
//       - alleen veilige tekens bevat
//       - geen bekende prefix is (login, leden, admin, api, etc.)
//       - daadwerkelijk in editable_pages bestaat
//   * Als één van die checks faalt → c.notFound() → laat Hono doorgaan
//     naar de volgende matching route (of uiteindelijk 404)

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { Breadcrumb } from '../components/Breadcrumb'
import { optionalAuth } from '../middleware/auth'
import { queryOne } from '../utils/db'
import { processBodyLinks } from '../utils/text'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', optionalAuth)

// Slugs die NOOIT als editable-page gerouteerd mogen worden, om conflict te
// voorkomen met andere bekende routes/paden in de site.
// (alleen single-segment routes — multi-segment paden zoals /leden/board komen
// hier sowieso niet, want /:slug matcht maar één segment.)
const RESERVED_SLUGS = new Set([
  // Auth
  'login', 'logout', 'register', 'wachtwoord-vergeten',
  // Public pages met eigen routes
  // NOTE: 'over' is bewust weggehaald — wordt nu door deze handler
  // gerenderd uit editable_pages. /koor blijft gereserveerd want die
  // doet een 301 redirect naar /over in public.tsx.
  'koor', 'word-lid', 'contact', 'fotoboek',
  'privacyverklaring', 'privacy', 'cookies',
  // App-secties
  'leden', 'admin', 'api', 'agenda', 'nieuws', 'tickets',
  'check-in', 'feedback', 'preview', 'r2', 'static',
  'voice-analyzer', 'donatie', 'beta-status',
])

// Belangrijk: we gebruiken app.use ipv app.get om Hono toe te laten door te
// gaan naar de volgende geregistreerde sub-app (ledenRoutes, adminRoutes...)
// wanneer onze slug niet matcht. Bij app.get + c.notFound() zou Hono
// direct de globale 404-handler aanroepen, wat /leden en /admin breekt.
app.use('/:slug', async (c, next) => {
  // Alleen GET-requests proberen we te behandelen
  if (c.req.method !== 'GET') return next()

  const slug = c.req.param('slug')

  // Veiligheidschecks: alleen kleine letters, cijfers, koppelteken en underscore
  if (!slug || !/^[a-z0-9][a-z0-9\-_]{0,80}$/i.test(slug)) {
    return next()
  }

  // Sla bekende prefixen over — laat ze door naar de volgende handler
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return next()
  }

  // Bestaat de pagina in DB?
  const page = await queryOne<any>(
    c.env.DB,
    `SELECT slug, titel, intro, body, hero_image FROM editable_pages WHERE slug = ?`,
    [slug]
  )

  if (!page) {
    return next()
  }

  const user = c.get('user') as any
  const isAdmin = user?.role === 'admin' || user?.role === 'bestuur' || user?.is_bestuurslid === 1
  const titel = page.titel || slug
  const intro = page.intro || ''
  const body = page.body || '<p>Deze pagina wordt nog ingevuld.</p>'
  const url = new URL(c.req.url)
  const siteHosts = [url.hostname, 'animato-live.pages.dev', 'gemengdkooranimato.be', 'www.gemengdkooranimato.be']

  return c.html(
    <Layout title={titel} user={user} currentPath={`/${slug}`}>
      <Breadcrumb items={[{ label: titel }]} />
      <div class="py-16 bg-gradient-to-b from-white to-gray-50">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

          {isAdmin && (
            <div class="mb-6 flex justify-end">
              <a
                href={`/admin/paginas/${slug}`}
                class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm shadow-sm"
                title="Pagina bewerken in beheerders-modus"
              >
                <i class="fas fa-edit"></i> Pagina bewerken
              </a>
            </div>
          )}

          {page.hero_image && (
            <div class="mb-8 rounded-2xl overflow-hidden shadow-lg">
              <img src={page.hero_image} alt={titel} class="w-full h-64 sm:h-80 object-cover" />
            </div>
          )}

          <h1 class="text-4xl sm:text-5xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
            {titel}
          </h1>

          {intro && (
            <p class="text-xl text-gray-600 mb-10 leading-relaxed italic border-l-4 border-animato-primary pl-4">
              {intro}
            </p>
          )}

          <div
            class="prose prose-lg max-w-none prose-headings:text-animato-secondary prose-headings:font-serif prose-a:text-animato-primary prose-a:font-medium hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: processBodyLinks(body, siteHosts) }}
          />

          <div class="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
            <a href="/" class="hover:text-animato-primary">
              <i class="fas fa-arrow-left mr-1"></i> Terug naar home
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
