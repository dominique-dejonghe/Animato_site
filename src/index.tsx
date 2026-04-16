// Gemengd Koor Animato - Hoofdapplicatie
// Modern koorwebsite met ledenportaal, agenda en ticketing

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings } from './types'

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
import ticketsRoutes from './routes/tickets'
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
import adminSettingsRoutes from './routes/admin-settings'
import adminFinanceRoutes from './routes/admin-finance'
import adminPrintsRoutes from './routes/admin-prints'
import adminSeatingRoutes from './routes/admin-seating'
import ledenActivityRoutes from './routes/leden-activity'
import adminCommunicationsRoutes from './routes/admin-communications' // Imported
import feedbackRoutes from './routes/feedback'
import adminFeedbackRoutes from './routes/admin-feedback'
import adminLedenImportRoutes from './routes/admin-leden-import'
import adminAnalyticsRoutes from './routes/admin-analytics'
import adminModulesRoutes from './routes/admin-modules'
import adminWalkthroughRoutes from './routes/admin-walkthrough'
import walkthroughApiRoutes from './routes/walkthrough-api'
import publicDonationRoutes from './routes/public-donation'
import adminAttendanceRoutes from './routes/admin-attendance'
import adminAiNewsRoutes from './routes/admin-ai-news'
import checkinRoutes from './routes/checkin'

// =====================================================
// APP INITIALIZATION
// =====================================================

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// MIDDLEWARE
// =====================================================

// Logger middleware
app.use('*', logger())

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
app.route('/', adminPollsRoutes)
app.route('/', adminVoorstellenRoutes)
app.route('/', adminActivityRoutes)
app.route('/', adminProjectsRoutes)
app.route('/', adminMeetingsRoutes)
app.route('/', adminSettingsRoutes)
app.route('/', adminFinanceRoutes)
app.route('/', adminPrintsRoutes)
app.route('/', adminSeatingRoutes)
app.route('/', adminModulesRoutes)
app.route('/', adminWalkthroughRoutes)
app.route('/', walkthroughApiRoutes)
app.route('/', ledenActivityRoutes)
app.route('/', adminCommunicationsRoutes) // Added route
app.route('/', adminFeedbackRoutes)
// adminLedenImportRoutes en adminAttendanceRoutes zijn verplaatst naar boven (voor adminRoutes)
app.route('/', adminAnalyticsRoutes)

// Tickets & Webhooks
app.route('/', ticketsRoutes)
app.route('/', webhooksRoutes)

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
      <script src="https://cdn.tailwindcss.com"></script>
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

// Error handler
app.onError((err, c) => {
  console.error('Application error:', err)
  
  return c.json({
    error: 'Er is een fout opgetreden',
    message: err.message,
    timestamp: new Date().toISOString()
  }, 500)
})

export default app
