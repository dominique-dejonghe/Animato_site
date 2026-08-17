// Gemengd Koor Animato - Hoofdapplicatie
// Modern koorwebsite met ledenportaal, agenda en ticketing

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings } from './types'
import { fetchNavPages, runWithNavPages } from './utils/nav-context'

// Import routes
import publicRoutes from './routes/public'
import authRoutes from './routes/auth'
import nieuwsRoutes from './routes/nieuws'
import agendaRoutes from './routes/agenda'
import ledenRoutes from './routes/leden'
import adminRoutes from './routes/admin'
import adminEventsRoutes from './routes/admin-events'
import adminCalendarRoutes from './routes/admin-calendar'
import adminBestandenRoutes from './routes/admin-bestanden'
import adminLocationsRoutes from './routes/admin-locations'
import adminLocatiesRoutes from './routes/admin-locaties'
import adminFotoboekRoutes from './routes/admin-fotoboek'
import adminTicketsRoutes from './routes/admin-tickets'
import adminScannerRoutes from './routes/admin-scanner'
import ticketsRoutes from './routes/tickets'
import accountRoutes from './routes/account'
import webhooksRoutes from './routes/webhooks'
import apiRoutes from './routes/api'
import photosRoutes from './routes/photos'
import pollsRoutes from './routes/polls'
import voorstellenRoutes from './routes/voorstellen'
import adminPollsRoutes from './routes/admin-polls'
import adminVoorstellenRoutes from './routes/admin-voorstellen'
import adminActivityRoutes from './routes/admin-activity'
import voiceAnalyzerRoutes from './routes/voice-analyzer'
import adminProjectsRoutes from './routes/admin-projects'
import adminMeetingsRoutes from './routes/admin-meetings'
import taskCommentsRoutes from './routes/task-comments'
import adminSettingsRoutes from './routes/admin-settings'
import adminFinanceRoutes from './routes/admin-finance'
import adminCommentsRoutes from './routes/admin-comments'
import editablePagesRoutes from './routes/editable-pages'
import adminSeatingRoutes from './routes/admin-seating'
import ledenActivityRoutes from './routes/leden-activity'
import ledenTicketsRoutes from './routes/leden-tickets'
import welkomRoutes from './routes/welkom'
import newMembersRoutes from './routes/new-members'
import adminCommunicationsRoutes from './routes/admin-communications' // Imported
import feedbackRoutes from './routes/feedback'
import adminFeedbackRoutes from './routes/admin-feedback'
import adminLedenImportRoutes from './routes/admin-leden-import'
import adminPagesRoutes from './routes/admin-pages'
import adminReglementenRoutes from './routes/admin-reglementen'
import quizRoutes from './routes/quiz'
import adminAnalyticsRoutes from './routes/admin-analytics'
import adminModulesRoutes from './routes/admin-modules'
import adminWalkthroughRoutes from './routes/admin-walkthrough'
import walkthroughApiRoutes from './routes/walkthrough-api'
import commentReactionsRoutes from './routes/comment-reactions'
import publicDonationRoutes from './routes/public-donation'
import adminAttendanceRoutes from './routes/admin-attendance'
import adminAiNewsRoutes from './routes/admin-ai-news'
import checkinRoutes from './routes/checkin'
import r2Routes from './routes/r2'
import adminR2MigrateRoutes from './routes/admin-r2-migrate'
import badgesRoutes from './routes/badges'
import cronRoutes from './routes/cron'

// =====================================================
// APP INITIALIZATION
// =====================================================

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// MIDDLEWARE
// =====================================================

// Logger middleware
app.use('*', logger())

// ─────────────────────────────────────────────────────────────────────
// EDGE-CACHE voor publieke pagina's (anonieme bezoekers)
// ─────────────────────────────────────────────────────────────────────
// Strategie:
//   - Alleen GET-requests
//   - Alleen wanneer er GEEN auth_token cookie is (anders zien leden cached
//     content van andere leden — privacy-bug)
//   - Alleen op een witte lijst van échte publieke routes
//   - Cache-Control: public, s-maxage=60 → Cloudflare edge cache't 60s,
//     browser revalidate't onmiddellijk
//
// Effect: tweede bezoeker binnen 60s krijgt response uit edge-cache (≈5ms)
// in plaats van Worker-render (160-180ms). Stale-while-revalidate zorgt dat
// een verlopen cache nog steeds onmiddellijk geserved wordt terwijl op de
// achtergrond ververst wordt.
const PUBLIC_CACHEABLE_ROUTES = [
  /^\/$/,                    // homepage
  /^\/agenda\/?$/,           // agenda overzicht
  /^\/concerten\/?$/,        // concerten overzicht
  /^\/nieuws\/?$/,           // nieuws overzicht
  /^\/over-ons\/?$/,         // statische pagina
  /^\/contact\/?$/,          // statische pagina
]
app.use('*', async (c, next) => {
  // Beslis BEFORE next() of we mogen cachen (request-level info)
  const isCacheable =
    c.req.method === 'GET' &&
    PUBLIC_CACHEABLE_ROUTES.some(re => re.test(c.req.path)) &&
    !/(?:^|;\s*)auth_token=/.test(c.req.header('Cookie') || '')

  await next()

  if (!isCacheable) return
  if (c.res.status !== 200) return
  // Niet overschrijven als route zelf al een Cache-Control header zette
  if (c.res.headers.get('Cache-Control')) return

  // In Hono 4 + Cloudflare Pages is `c.res.headers.set()` na await next() onbetrouwbaar
  // (response is mogelijk al immutable). De zekere methode: rewrap.
  const newHeaders = new Headers(c.res.headers)
  newHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  newHeaders.set('Vary', 'Cookie')
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: newHeaders,
  })
})

// CORS voor API routes
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

// Static files from /static/* path
app.use('/static/*', serveStatic({ root: './' }))

// =====================================================
// NAV CONTEXT MIDDLEWARE
// =====================================================
// Fetcht editable_pages met show_in_nav=1 één keer per request,
// stopt ze in een AsyncLocalStorage zodat Layout.tsx ze sync kan
// lezen zonder dat we 120+ call-sites moeten aanpassen.
// Skip voor /api/*, /static/*, /r2/* — die hebben geen UI.
app.use('*', async (c, next) => {
  const path = c.req.path
  if (path.startsWith('/api/') || path.startsWith('/static/') || path.startsWith('/r2/')) {
    return next()
  }
  const navPages = await fetchNavPages(c.env.DB)
  return runWithNavPages(navPages, () => next())
})

// R2 object storage public-serve route (foto's, partituren, covers)
app.route('/', r2Routes)

// =====================================================
// ROUTES
// =====================================================

// Public routes (homepage, nieuws, contact, etc.)
app.route('/', publicRoutes)
app.route('/', publicDonationRoutes)

// Auth routes (login, register, logout)
app.route('/', authRoutes)

// Nieuws routes
app.route('/', nieuwsRoutes)

// Agenda & Concerten routes
app.route('/', agendaRoutes)

// Voice Analyzer (MUST be before leden - no auth required)
app.route('/', voiceAnalyzerRoutes)

// Feedback routes (MUST be before auth-protected routes - beta-status is public)
app.route('/', feedbackRoutes)

// Photos API (upload, serve, migrate — MUST be before leden auth middleware)
app.route('/', photosRoutes)

// Check-in routes (QR scan page is public, streaks require auth)
app.route('/', checkinRoutes)

// Editable pages (dynamische /:slug pagina's uit editable_pages tabel)
// MOET voor ledenRoutes staan — die heeft wildcard auth-middleware die
// anders alle unmatched paden 401-t. Bevat een RESERVED_SLUGS lijst om
// conflicten met /leden, /admin, etc. te voorkomen.
app.route('/', editablePagesRoutes)

// Welkom-splash voor nieuwe koorleden — MOET voor ledenRoutes, want
// /leden/welkom zou anders door de wildcard van ledenRoutes worden gevangen
app.route('/', welkomRoutes)

// Nieuwe-lid aankondigingen API (popup "Welkom Rudy!" voor alle bestaande leden)
// MOET voor ledenRoutes om dezelfde reden
app.route('/', newMembersRoutes)

// ⚠️ KRITIEK: webhook routes MOETEN voor ledenRoutes staan.
// /api/webhooks/mollie is een publieke POST endpoint (Mollie heeft géén
// auth-cookie), maar leden.tsx heeft `app.use('*', requireAuth)` dat
// elke unmatched route 401-t. Mollie's bevestiging zou verloren gaan en
// lidgeld-status zou eeuwig op 'pending' blijven. Zie webhooks.tsx.
app.route('/', webhooksRoutes)

// ⚠️ KRITIEK: ticketsRoutes MOET ook voor ledenRoutes staan.
// Tickets zijn een publieke verkoopflow: anonieme bezoekers moeten
// /concerten/:id/tickets kunnen openen, POST /api/tickets/order
// kunnen versturen, en /tickets/bevestiging/:orderRef kunnen zien na
// Mollie-redirect. Anders 401't de leden-wildcard de hele flow en
// blijft je betaling pending. (Bug ontdekt 2026-06-13)
app.route('/', ticketsRoutes)

// Kaartkoper-portaal: /account/setup, /mijn-tickets alias, /profiel
// MOET voor ledenRoutes — anders vangt de leden-wildcard /profiel op.
app.route('/', accountRoutes)

// Leden ticket-portal MOET vóór de catch-all ledenRoutes komen, anders vangt
// die de /leden/mijn-tickets wildcard af voor we daar aan toe komen.
app.route('/', ledenTicketsRoutes)

// Badges-routes: ook vóór de catch-all ledenRoutes om botsing met /leden/* te vermijden
app.route('/', badgesRoutes)
app.route('/', cronRoutes)

// Leden portal routes
app.route('/', ledenRoutes)

// Admin routes
// BELANGRIJK: adminLedenImportRoutes MOET voor adminRoutes staan,
// omdat adminRoutes /admin/leden/:id bevat die anders "import" als ID matcht
app.route('/', adminLedenImportRoutes)
app.route('/', adminAttendanceRoutes)
app.route('/', adminAiNewsRoutes)
app.route('/', adminRoutes)
app.route('/', adminEventsRoutes)
app.route('/', adminCalendarRoutes)
app.route('/', adminBestandenRoutes)
app.route('/', adminLocationsRoutes)
app.route('/', adminLocatiesRoutes)
app.route('/', adminFotoboekRoutes)
app.route('/', adminTicketsRoutes)
app.route('/', adminScannerRoutes)
app.route('/', adminPollsRoutes)
app.route('/', adminVoorstellenRoutes)
app.route('/', adminActivityRoutes)
app.route('/', adminProjectsRoutes)
app.route('/', adminMeetingsRoutes)
app.route('/', taskCommentsRoutes)
app.route('/', adminSettingsRoutes)
app.route('/', adminFinanceRoutes)
app.route('/', adminCommentsRoutes)
app.route('/', adminSeatingRoutes)
app.route('/', adminModulesRoutes)
app.route('/', adminWalkthroughRoutes)
app.route('/', walkthroughApiRoutes)
app.route('/', commentReactionsRoutes)
app.route('/', ledenActivityRoutes)
app.route('/', adminCommunicationsRoutes) // Added route
app.route('/', adminFeedbackRoutes)
app.route('/', adminPagesRoutes)
app.route('/', adminReglementenRoutes)
app.route('/', quizRoutes)
// adminLedenImportRoutes en adminAttendanceRoutes zijn verplaatst naar boven (voor adminRoutes)
app.route('/', adminAnalyticsRoutes)
app.route('/', adminR2MigrateRoutes)

// (ticketsRoutes en webhooksRoutes zijn hierboven al gemount vóór ledenRoutes —
// zie de KRITIEK-comment daar voor uitleg over de Mollie auth-bypass.)

// Polls & Voting
app.route('/', pollsRoutes)

// Voorstellen (Member Proposals)
app.route('/', voorstellenRoutes)

// API routes
app.route('/', apiRoutes)

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Animato Koor Website'
  })
})

// API info endpoint
app.get('/api', (c) => {
  return c.json({
    name: 'Animato Koor API',
    version: '1.0.0',
    endpoints: {
      public: ['/api/nieuws', '/api/agenda', '/api/concerten'],
      auth: ['/api/auth/login', '/api/auth/register', '/api/auth/logout'],
      leden: ['/api/leden/profiel', '/api/leden/materiaal', '/api/leden/board'],
      admin: ['/api/admin/users', '/api/admin/content', '/api/admin/settings']
    }
  })
})

// 404 handler
app.notFound((c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Pagina niet gevonden | Animato</title>
      <link href="/static/css/tailwind.css" rel="stylesheet" />
    </head>
    <body class="bg-gray-50 flex items-center justify-center min-h-screen">
      <div class="text-center px-4">
        <h1 class="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <h2 class="text-2xl font-semibold text-gray-700 mb-4">Pagina niet gevonden</h2>
        <p class="text-gray-600 mb-8">De pagina die je zoekt bestaat niet of is verplaatst.</p>
        <a href="/" class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition">
          Terug naar home
        </a>
      </div>
    </body>
    </html>
  `, 404)
})

// Error handler — geeft veel meer context terug bij 500's zodat we
// in productie kunnen achterhalen WELKE route en query crashten.
app.onError((err, c) => {
  const url = c.req.url
  const path = new URL(url).pathname + new URL(url).search
  const method = c.req.method
  const ua = c.req.header('User-Agent') || ''
  const referer = c.req.header('Referer') || ''

  console.error('===== APPLICATION ERROR =====')
  console.error('Path:    ', path)
  console.error('Method:  ', method)
  console.error('Referer: ', referer)
  console.error('Message: ', err.message)
  console.error('Stack:   ', err.stack)
  console.error('UA:      ', ua.slice(0, 100))
  console.error('=============================')

  // For form submissions (HTML), redirect back with error
  const accept = c.req.header('Accept') || ''
  const contentType = c.req.header('Content-Type') || ''
  const isFormSubmit = c.req.method === 'POST' && (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  )

  if (isFormSubmit && !accept.includes('application/json')) {
    const errMsg = encodeURIComponent((err.message || 'unknown').substring(0, 100))
    const separator = referer.includes('?') ? '&' : '?'
    return c.redirect(`${(referer || '/')}${separator}error=server_error&msg=${errMsg}`)
  }

  return c.json({
    error: 'Er is een fout opgetreden',
    message: err.message,
    // Extra diagnostische velden — onmisbaar om de bron te identificeren
    // zonder dat we toegang tot CF-logs nodig hebben.
    path,
    method,
    timestamp: new Date().toISOString()
  }, 500)
})

export default app
