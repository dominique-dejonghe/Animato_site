import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'

import { createMolliePayment, getMollieMode } from '../utils/mollie'
import { getMollieApiKey } from '../utils/mollie-config'
import { getSiteUrl } from '../utils/site-url'
import { sendEmail } from '../utils/email'
import { createNotification, createNotificationForUsers, notifyUser, notifyUsers } from '../utils/notifications'
import { formatBrusselsDate, formatBrusselsTime, brusselsToday } from '../utils/time'

const app = new Hono()

// Auth Middleware – scoped to /admin/* and /api/admin/* only
// 2026-06-13: bestuursleden krijgen volledige toegang tot Financi\u00ebn/Lidgeld/Giften.
// admin/moderator OR is_bestuurslid=1 → toegang. Anders redirect naar /leden.
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.redirect('/login')
  const hasAccess = user.role === 'admin' || user.role === 'moderator' || user.is_bestuurslid
  if (!hasAccess) return c.redirect('/leden')
  c.set('user', user)
  await next()
}
// SCOPE-FIX 2026-06-17: was /admin/* — te breed.
app.use('/admin/lidgelden', adminAuthMiddleware)
app.use('/admin/lidgelden/*', adminAuthMiddleware)
app.use('/admin/mollie-webhook-log', adminAuthMiddleware)
app.use('/admin/mollie-webhook-log/*', adminAuthMiddleware)
app.use('/api/admin/lidgelden', adminAuthMiddleware)
app.use('/api/admin/lidgelden/*', adminAuthMiddleware)
app.use('/api/admin/donations', adminAuthMiddleware)
app.use('/api/admin/donations/*', adminAuthMiddleware)

// === OVERVIEW ===
app.get('/admin/lidgelden', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const selectedSeasonId = c.req.query('season_id')
  const filter = c.req.query('filter') || 'all'  // all | paid | pending | fast | slow | overdue | basis | full
  const successMsg = c.req.query('success') || ''
  const errorMsg = c.req.query('error') || ''
  const successCount = c.req.query('count') || ''

  // Mollie status — voor banner bovenaan zodat je nooit twijfelt
  const mollieKey = await getMollieApiKey(c.env)
  const mollieMode = getMollieMode(mollieKey)

  // Get all seasons
  const seasons = await queryAll(db, "SELECT * FROM membership_years ORDER BY start_date DESC")
  
  // Determine active season (selected or most recent)
  let activeSeason: any = null
  if (selectedSeasonId) {
    activeSeason = seasons.find((s: any) => s.id == selectedSeasonId)
  } else {
    activeSeason = seasons.find((s: any) => s.is_active) || seasons[0]
  }

  // If no seasons exist yet, activeSeason might be null
  const memberships: any[] = activeSeason ? await queryAll(db, `
    SELECT um.*, u.email, u.stemgroep, p.voornaam, p.achternaam
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.year_id = ?
    ORDER BY p.achternaam
  `, [activeSeason.id]) : []

  // Bug #200.2 — Tel "betalende leden" (= actief, geen bezoeker/dirigent/pianist, geen testaccount)
  // versus "totaal actieve leden" — beide voor de uitleg-header bovenaan.
  const memberCounts = await queryOne<any>(db, `
    SELECT
      SUM(CASE WHEN status = 'actief' THEN 1 ELSE 0 END) AS totaal_actief,
      SUM(CASE WHEN status = 'actief'
                AND role NOT IN ('bezoeker','dirigent','pianist')
                AND (is_test_account IS NULL OR is_test_account = 0)
              THEN 1 ELSE 0 END) AS betalende_leden,
      SUM(CASE WHEN status = 'actief' AND role = 'dirigent' THEN 1 ELSE 0 END) AS dirigenten,
      SUM(CASE WHEN status = 'actief' AND role = 'pianist' THEN 1 ELSE 0 END) AS pianisten
    FROM users
  `) || { totaal_actief: 0, betalende_leden: 0, dirigenten: 0, pianisten: 0 }

  // Get active users WITHOUT membership for this season (to add them manually or bulk)
  // Bug #200.1 — dirigent + pianist hoeven geen lidgeld te betalen, sluit uit.
  // Ook test-accounts uitsluiten zodat overzichten en totalen kloppen.
  const usersWithoutMembership: any[] = activeSeason ? await queryAll(db, `
    SELECT u.id, u.email, u.stemgroep, p.voornaam, p.achternaam
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE u.status = 'actief'
    AND u.role NOT IN ('bezoeker', 'dirigent', 'pianist')
    AND (u.is_test_account IS NULL OR u.is_test_account = 0)
    AND u.id NOT IN (
      SELECT um.user_id
      FROM user_memberships um
      WHERE um.year_id = ?
    )
    ORDER BY p.achternaam, p.voornaam
  `, [activeSeason.id]) : []

  // === Donaties (giften) — alle donations, ongeacht seizoen ===
  // Public donations hebben user_id=null + "[Publiek: Naam <email>]" prefix in message
  // Member donations hebben user_id ingevuld
  const allDonations: any[] = await queryAll(db, `
    SELECT d.id, d.user_id, d.amount, d.message, d.is_anonymous, d.status,
           d.payment_provider, d.payment_id, d.created_at,
           u.email AS donor_email,
           p.voornaam AS donor_voornaam, p.achternaam AS donor_achternaam
    FROM donations d
    LEFT JOIN users u ON d.user_id = u.id
    LEFT JOIN profiles p ON d.user_id = p.user_id
    ORDER BY d.created_at DESC
  `) || []

  // === Payment Analytics ===
  const now = Date.now()
  const DAY = 1000 * 60 * 60 * 24

  // Helper: hoeveel dagen open / hoe snel betaald
  const computeDays = (m: any) => {
    const created = m.created_at ? new Date(m.created_at).getTime() : now
    if (m.status === 'paid' && m.paid_at) {
      const paid = new Date(m.paid_at).getTime()
      return { daysToPay: Math.max(0, Math.round((paid - created) / DAY)), daysOpen: 0 }
    }
    return { daysToPay: null, daysOpen: Math.max(0, Math.round((now - created) / DAY)) }
  }

  // Verrijk memberships met days info
  const enriched = memberships.map((m: any) => ({ ...m, ...computeDays(m) }))

  // KPI berekeningen
  const paid = enriched.filter((m: any) => m.status === 'paid')
  const pending = enriched.filter((m: any) => m.status === 'pending')
  const totalAmount = enriched.reduce((acc: number, m: any) => acc + m.amount, 0)
  const paidAmount = paid.reduce((acc: number, m: any) => acc + m.amount, 0)
  const openAmount = pending.reduce((acc: number, m: any) => acc + m.amount, 0)
  const paidPct = enriched.length > 0 ? Math.round((paid.length / enriched.length) * 100) : 0

  // Snelle vs late betalers
  const fastPayers = paid.filter((m: any) => m.daysToPay !== null && m.daysToPay <= 7)
  const slowPayers = paid.filter((m: any) => m.daysToPay !== null && m.daysToPay > 30)
  const overdue = pending.filter((m: any) => m.daysOpen > 30)
  const avgDaysToPay = paid.length > 0
    ? Math.round(paid.reduce((a: number, m: any) => a + (m.daysToPay || 0), 0) / paid.length)
    : 0
  const avgDaysOpen = pending.length > 0
    ? Math.round(pending.reduce((a: number, m: any) => a + (m.daysOpen || 0), 0) / pending.length)
    : 0

  // Top 5 snelste & langzaamste betalers
  const fastestPayers = [...paid]
    .filter((m: any) => m.daysToPay !== null)
    .sort((a: any, b: any) => (a.daysToPay || 0) - (b.daysToPay || 0))
    .slice(0, 5)
  const slowestOpen = [...pending]
    .sort((a: any, b: any) => (b.daysOpen || 0) - (a.daysOpen || 0))
    .slice(0, 5)

  // Alle betalingen, gesorteerd op datum (nieuwste eerst).
  // We tonen standaard 10 maar laden alles client-side voor "Toon alle X"-toggle.
  const allPaidPayments = [...paid]
    .filter((m: any) => m.paid_at)
    .sort((a: any, b: any) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
  const recentPayments = allPaidPayments.slice(0, 10)

  // Weekly trend (laatste 8 weken: nieuwe betalingen per week)
  const weeklyTrend: { week: string; count: number; amount: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const weekStart = now - (i + 1) * 7 * DAY
    const weekEnd = now - i * 7 * DAY
    const weekPaid = paid.filter((m: any) => {
      if (!m.paid_at) return false
      const t = new Date(m.paid_at).getTime()
      return t >= weekStart && t < weekEnd
    })
    const d = new Date(weekStart)
    weeklyTrend.push({
      week: `${d.getDate()}/${d.getMonth() + 1}`,
      count: weekPaid.length,
      amount: weekPaid.reduce((a: number, m: any) => a + m.amount, 0)
    })
  }
  const maxWeekCount = Math.max(1, ...weeklyTrend.map((w) => w.count))

  // === Donations KPIs ===
  const donationsPaid = allDonations.filter((d: any) => d.status === 'paid')
  const donationsPending = allDonations.filter((d: any) => d.status === 'pending')
  const donationsTotalPaid = donationsPaid.reduce((acc: number, d: any) => acc + Number(d.amount || 0), 0)
  const donationsTotalPending = donationsPending.reduce((acc: number, d: any) => acc + Number(d.amount || 0), 0)
  const donationsAvg = donationsPaid.length > 0 ? donationsTotalPaid / donationsPaid.length : 0
  // Helper: parse "[Publiek: Naam <email>]" prefix uit message-veld
  const parsePublicDonor = (msg: string | null): { name: string; email: string; cleanMsg: string } | null => {
    if (!msg) return null
    const m = msg.match(/^\[Publiek:\s*([^<]+?)\s*<([^>]+)>\]\s*(.*)$/s)
    if (!m) return null
    return { name: m[1].trim(), email: m[2].trim(), cleanMsg: m[3].trim() }
  }
  // Recente donations (laatste 10) — al gesorteerd DESC op created_at
  // Bug #211 — enkel 'paid' tonen. Pending/cancelled/expired/failed-giften zijn
  // ruis voor de eindgebruiker (admin) die wil zien wat er écht binnenkwam.
  // Status-checks blijven beschikbaar via de aparte donationsPending counter
  // en de "Sync Mollie"-knop.
  const recentDonations = allDonations
    .filter((d: any) => d.status === 'paid')
    .slice(0, 10)

  // Formule-buckets (basis = €25 digitaal, full = €50 met papieren partituren)
  const basisMemberships = enriched.filter((m: any) => m.type === 'basis')
  const fullMemberships = enriched.filter((m: any) => m.type === 'full')

  // Print-stats berekening verwijderd (2026-06-13) - Printservice afgeschaft

  // Filter de visible memberships op basis van ?filter=
  let visibleMemberships = enriched
  let filterLabel = ''
  if (filter === 'paid') { visibleMemberships = paid; filterLabel = 'Betaald' }
  else if (filter === 'pending') { visibleMemberships = pending; filterLabel = 'Openstaand' }
  else if (filter === 'fast') { visibleMemberships = fastPayers; filterLabel = 'Snelle betalers (≤7 dagen)' }
  else if (filter === 'slow') { visibleMemberships = slowPayers; filterLabel = 'Langzame betalers (>30 dagen)' }
  else if (filter === 'overdue') { visibleMemberships = overdue; filterLabel = 'Overdue (>30 dagen open)' }
  else if (filter === 'basis') { visibleMemberships = basisMemberships; filterLabel = 'Formule Basis (€25 digitaal)' }
  else if (filter === 'full') { visibleMemberships = fullMemberships; filterLabel = 'Formule Full (€50 met partituren)' }
  // Printservice-filters verwijderd (2026-06-13)

  return c.html(
    <Layout title="Lidgelden Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="finance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-euro-sign text-animato-primary"></i>
                Lidgelden Beheer
              </h1>
              <p class="text-gray-600 mt-1">Beheer seizoenen en betalingen</p>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button
                onclick="document.getElementById('createSeasonModal').classList.remove('hidden')"
                class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50"
                title="Maak een nieuw koorseizoen aan (bv. 2026-2027). Oude seizoenen blijven bewaard in het archief."
              >
                <i class="fas fa-calendar-plus mr-2"></i> Nieuw Seizoen
              </button>
              {activeSeason && (
                <>
                  <button onclick="document.getElementById('addModal').classList.remove('hidden')" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90">
                    <i class="fas fa-plus mr-2"></i> Lidmaatschap Toekennen
                  </button>
                  {/* Bug #201 — Reset enkel toelaten op ACTIEF seizoen, niet op archief.
                      Zo kunnen we per ongeluk nooit historische jaren wissen. */}
                  {activeSeason.is_active ? (
                    <button onclick="document.getElementById('resetSeasonModal').classList.remove('hidden')" class="bg-white border border-red-300 text-red-700 px-4 py-2 rounded hover:bg-red-50" title="Verwijder alle lidmaatschappen voor dit seizoen (enkel actief seizoen)">
                      <i class="fas fa-eraser mr-2"></i> Reset Seizoen
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      class="bg-gray-100 border border-gray-200 text-gray-400 px-4 py-2 rounded cursor-not-allowed"
                      title="Reset is uitgeschakeld voor archief-seizoenen om historische data te beschermen. Schakel eerst over naar het actieve seizoen."
                    >
                      <i class="fas fa-lock mr-2"></i> Reset Seizoen
                    </button>
                  )}
                </>
              )}
              <a href="/admin/mollie-webhook-log" class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50" title="Bekijk welke webhook-calls Mollie naar ons stuurde (diagnose)">
                <i class="fas fa-clipboard-list mr-2"></i> Webhook-log
              </a>
            </div>
          </div>

          {/* Mollie mode badge — altijd zichtbaar zodat MOCK ↔ TEST ↔ LIVE niet verward worden */}
          {mollieMode === 'mock' && (
            <div class="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4 flex items-center justify-between">
              <div class="text-sm text-amber-900">
                <i class="fas fa-flask mr-2"></i>
                <strong>MOCK-modus actief</strong> — er is geen Mollie API-key geconfigureerd. Online betalingen worden gesimuleerd (auto-paid). Geen echt geld.
              </div>
              <a href="/admin/settings" class="text-sm font-semibold text-amber-900 hover:text-amber-700 whitespace-nowrap">
                <i class="fas fa-cog mr-1"></i> Configureer Mollie →
              </a>
            </div>
          )}
          {mollieMode === 'test' && (
            <div class="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-4 text-sm text-blue-900 flex items-center justify-between">
              <div>
                <i class="fas fa-vial mr-2"></i>
                <strong>TEST-modus actief</strong> — gebruik Mollie testkaarten. Geen echt geld wordt verwerkt.
              </div>
              <a href="/admin/settings" class="text-xs font-semibold text-blue-900 hover:underline whitespace-nowrap">
                Naar instellingen →
              </a>
            </div>
          )}
          {mollieMode === 'live' && (
            <div class="bg-green-50 border border-green-300 rounded-lg p-2 mb-4 text-xs text-green-800 flex items-center gap-2">
              <i class="fas fa-check-circle"></i>
              <span><strong>LIVE</strong> — echte betalingen via Mollie zijn actief.</span>
            </div>
          )}

          {/* Feedback banners */}
          {successMsg === 'reset' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-check-circle mr-2"></i>
              Seizoen gereset — <strong>{successCount}</strong> lidmaatschap{Number(successCount) === 1 ? '' : 'pen'} verwijderd. Klaar voor een nieuwe start. 🚀
            </div>
          )}
          {successMsg === 'bulk_generated' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-check-circle mr-2"></i>
              <strong>{successCount}</strong> lidmaatschap{Number(successCount) === 1 ? '' : 'pen'} aangemaakt en notificaties verstuurd.
            </div>
          )}
          {successMsg === 'bulk_reminded' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-paper-plane mr-2"></i>
              Bulk reminder verstuurd naar <strong>{successCount}</strong> lid{Number(successCount) === 1 ? '' : 'leden'}.
              {c.req.query('failed') && <span class="text-red-700 ml-2">({c.req.query('failed')} mislukt — check logs)</span>}
            </div>
          )}
          {errorMsg === 'confirm_mismatch' && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">
              <i class="fas fa-exclamation-circle mr-2"></i>
              Reset geannuleerd: de getypte seizoennaam kwam niet overeen.
            </div>
          )}
          {errorMsg === 'archive_locked' && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">
              <i class="fas fa-lock mr-2"></i>
              <strong>Reset geweigerd:</strong> dit is een archief-seizoen. Historische lidmaatschappen en betalingen worden beschermd — alleen het actieve seizoen kan gereset worden.
            </div>
          )}
          {/* #111 banners */}
          {successMsg === 'amount_updated' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-euro-sign mr-2"></i>
              Bedrag aangepast. Mollie betaallink werd gereset — bij volgende mailing wordt een nieuwe link gegenereerd.
            </div>
          )}
          {successMsg === 'type_updated' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-exchange-alt mr-2"></i>
              Formule (basis/full) aangepast.
            </div>
          )}
          {successMsg === 'deleted' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
              <i class="fas fa-trash mr-2"></i>
              Lidmaatschap verwijderd.
            </div>
          )}
          {errorMsg === 'invalid_amount' && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">
              <i class="fas fa-exclamation-circle mr-2"></i>
              Ongeldig bedrag — gebruik een getal tussen 0 en 9999.
            </div>
          )}
          {errorMsg === 'already_paid' && (
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <i class="fas fa-lock mr-2"></i>
              Dit lidmaatschap is al betaald — bedrag kan niet meer gewijzigd worden.
            </div>
          )}
          {successMsg === 'synced' && (
            <div class="bg-cyan-50 border border-cyan-200 rounded-lg p-3 mb-4 text-sm text-cyan-800">
              <i class="fas fa-sync mr-2"></i>
              Status gesynchroniseerd met Mollie. Actuele Mollie-status: <strong>{c.req.query('mollie_status') || 'onbekend'}</strong>
            </div>
          )}
          {successMsg === 'bulk_synced' && (
            <div class="bg-cyan-50 border border-cyan-200 rounded-lg p-3 mb-4 text-sm text-cyan-800">
              <i class="fas fa-sync mr-2"></i>
              <strong>Bulk-sync klaar.</strong> {' '}
              {c.req.query('checked') || '0'} lidgelden bevraagd bij Mollie:{' '}
              <span class="font-bold text-green-700">{c.req.query('paid') || '0'} alsnog op &lsquo;paid&rsquo;</span>,{' '}
              {c.req.query('unchanged') || '0'} nog steeds open,{' '}
              {c.req.query('errors') || '0'} fouten.
            </div>
          )}
          {errorMsg === 'sync_failed' && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">
              <i class="fas fa-exclamation-triangle mr-2"></i>
              Mollie-sync mislukt — check API-key en payment ID. Details in server-log.
            </div>
          )}
          {errorMsg === 'mollie_not_found' && (
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <i class="fas fa-question-circle mr-2"></i>
              Deze payment is niet (meer) bekend bij Mollie — mogelijk verlopen of een test-betaling die nooit gestart is.
            </div>
          )}
          {errorMsg === 'no_mollie_id' && (
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-sm text-gray-800">
              <i class="fas fa-info-circle mr-2"></i>
              Geen Mollie payment ID gekoppeld — sync niet mogelijk. Het lid moet eerst op "Nu Betalen" klikken.
            </div>
          )}

          {/* Bug #201 — Korte uitleg over de twee seizoen-acties, expliciet
              vermelden dat archief bewaard blijft (was zorg in feedback). */}
          <details class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-900">
            <summary class="cursor-pointer font-medium flex items-center gap-2">
              <i class="fas fa-info-circle"></i>
              Wat doen <em>Nieuw Seizoen</em> en <em>Reset Seizoen</em>? (klik om uit te klappen)
            </summary>
            <div class="mt-3 space-y-2 pl-6">
              <p>
                <i class="fas fa-calendar-plus text-gray-600 mr-1"></i>
                <strong>Nieuw Seizoen</strong> — maakt een volgend koorseizoen aan (bv. 2026-2027) met eigen tarieven.
                Het lopende seizoen wordt automatisch <em>archief</em> en blijft zichtbaar via de seizoendropdown hieronder.
                <span class="text-blue-700">Alle leden, lidmaatschappen en betalingen van vorige seizoenen blijven bewaard.</span>
              </p>
              <p>
                <i class="fas fa-eraser text-red-600 mr-1"></i>
                <strong>Reset Seizoen</strong> — wist <em>alleen</em> de lidmaatschappen + betalingen van het <strong>actieve</strong> seizoen
                (bv. om opnieuw te bulk-genereren bij een foutje). De knop is uitgeschakeld voor archief-seizoenen
                zodat historische data niet per ongeluk verloren kan gaan. Het seizoen zelf en zijn tarieven blijven bestaan.
              </p>
              <p>
                <i class="fas fa-archive text-gray-600 mr-1"></i>
                <strong>Archief raadplegen</strong> — kies in de selector hieronder een oud seizoen om alle betalingen en lidmaatschappen
                van dat jaar te bekijken. Niet-actieve seizoenen zijn alleen-lezen voor reset-acties.
              </p>
            </div>
          </details>

          {/* Season Selector */}
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <label class="font-medium text-gray-700">Selecteer Seizoen:</label>
              <select 
                class="border-gray-300 rounded-md shadow-sm focus:border-animato-primary focus:ring focus:ring-animato-primary focus:ring-opacity-50"
                onchange="window.location.href = '/admin/lidgelden?season_id=' + this.value"
              >
                {seasons.map((s: any) => (
                  <option value={s.id} selected={activeSeason && s.id === activeSeason.id}>
                    {s.season} ({s.is_active ? 'Actief' : 'Archief'})
                  </option>
                ))}
                {seasons.length === 0 && <option>Geen seizoenen gevonden</option>}
              </select>
              {activeSeason && !activeSeason.is_active && (
                <span class="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded inline-flex items-center gap-1" title="Dit is een archief-seizoen — alleen-lezen voor reset-acties">
                  <i class="fas fa-lock"></i> Archief
                </span>
              )}
            </div>
            {activeSeason && (
              <div class="text-sm text-gray-500">
                Periode: {formatBrusselsDate(activeSeason.start_date, { day: '2-digit', month: '2-digit', year: 'numeric' })} - {formatBrusselsDate(activeSeason.end_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </div>
            )}
          </div>

          {activeSeason ? (
            <>
              {/* Bug #200.3 — Prominente "Betalende leden"-header bovenaan.
                  Dirk: "in de zin moet helemaal boven eerder de notitie 'betalende leden'
                  staan en in het klein 'Totaal aantal leden'". */}
              <div class="bg-gradient-to-r from-animato-primary/10 to-blue-50 border border-animato-primary/30 rounded-lg p-4 mb-6">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div class="text-3xl font-bold text-animato-primary">
                      {memberCounts.betalende_leden || 0} <span class="text-base font-normal text-gray-700">betalende leden</span>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                      Totaal aantal actieve leden: <strong>{memberCounts.totaal_actief || 0}</strong>
                      {(Number(memberCounts.dirigenten) + Number(memberCounts.pianisten)) > 0 && (
                        <span class="ml-1">
                          (waarvan {memberCounts.dirigenten} dirigent{Number(memberCounts.dirigenten) === 1 ? '' : 'en'} en {memberCounts.pianisten} pianist{Number(memberCounts.pianisten) === 1 ? '' : 'en'} — geen lidgeld verschuldigd)
                        </span>
                      )}
                    </div>
                  </div>
                  <div class="text-xs text-gray-600 bg-white/70 rounded-md p-2 max-w-md leading-snug">
                    <i class="fas fa-circle-info text-animato-primary mr-1"></i>
                    <strong>Twee formules</strong>: <em>Basis (€{activeSeason.fee_base.toFixed(0)})</em> = digitale partituren, koorlid betaalt het standaard tarief. <em>Full (€{activeSeason.fee_full.toFixed(0)})</em> = bovenop digitaal krijgt het lid ook <strong>papieren partituren</strong> afgedrukt en in een kaft.
                  </div>
                </div>
              </div>

              {/* Season Settings */}
              <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6">
                 <div class="flex justify-between items-center mb-2">
                    <h3 class="font-bold text-gray-800">Seizoen Instellingen</h3>
                    <button onclick="document.getElementById('editSeasonModal').classList.remove('hidden')" class="text-blue-600 hover:underline text-sm">
                        <i class="fas fa-edit"></i> Bewerk Prijzen & Details
                    </button>
                 </div>
                 <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><span class="text-gray-500">Naam:</span> <span class="font-medium">{activeSeason.season}</span></div>
                    <div><span class="text-gray-500">Status:</span> <span class={`font-medium ${activeSeason.is_active ? 'text-green-600' : 'text-gray-500'}`}>{activeSeason.is_active ? 'Actief' : 'Gearchiveerd'}</span></div>
                    <div title="Basis = enkel digitale partituren">
                      <span class="text-gray-500">Basis lidgeld <i class="fas fa-info-circle text-gray-400 text-xs"></i>:</span>
                      <span class="font-medium ml-1">€ {activeSeason.fee_base.toFixed(2)}</span>
                      <div class="text-xs text-gray-400 italic">enkel digitale partituren</div>
                    </div>
                    <div title="Full = digitaal + papieren partituren">
                      <span class="text-gray-500">Full lidgeld <i class="fas fa-info-circle text-gray-400 text-xs"></i>:</span>
                      <span class="font-medium ml-1">€ {activeSeason.fee_full.toFixed(2)}</span>
                      <div class="text-xs text-gray-400 italic">incl. papieren partituren in kaft</div>
                    </div>
                 </div>
                 {/* #110: Tarief-uitleg */}
                 <div class="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 flex items-start gap-2">
                   <i class="fas fa-circle-info text-blue-500 mt-0.5"></i>
                   <span>
                     <strong>Standaard formule</strong> = <em>Basis</em> (digitale partituren). Leden die papieren partituren wensen kunnen later upgraden naar <em>Full</em>; de partituren worden dan afgedrukt en in een kaft bezorgd.
                   </span>
                 </div>
              </div>

              {/* Stats Cards — klikbaar voor filter */}
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=all`} class={`bg-white p-4 rounded shadow border-l-4 border-blue-500 hover:bg-blue-50 transition cursor-pointer ${filter === 'all' ? 'ring-2 ring-blue-400' : ''}`}>
                  <p class="text-gray-500 text-sm" title="Aantal lidmaatschappen in dit seizoen (basis + full)">Lidmaatschappen in seizoen</p>
                  <p class="text-2xl font-bold">{memberships.length} <span class="text-xs font-normal text-gray-400">/ {memberCounts.betalende_leden || 0}</span></p>
                  <p class="text-xs text-gray-400 mt-1">€ {totalAmount.toFixed(2)} (totaal)</p>
                </a>
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=paid`} class={`bg-white p-4 rounded shadow border-l-4 border-green-500 hover:bg-green-50 transition cursor-pointer ${filter === 'paid' ? 'ring-2 ring-green-400' : ''}`}>
                  <p class="text-gray-500 text-sm">Betaald ({paid.length}) — {paidPct}%</p>
                  <p class="text-2xl font-bold">€ {paidAmount.toFixed(2)}</p>
                  <div class="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div class="bg-green-500 h-1.5 rounded-full" style={`width: ${paidPct}%`}></div>
                  </div>
                </a>
                {/* Bug #195 — Toon de Openstaand-tegel enkel als er écht iets openstaand is.
                    Bij €0,00 / 0 items was de KPI verwarrend ("klopt niet" volgens feedback).
                    Als alles betaald is tonen we een rustige "Alles betaald" tegel zonder
                    bedragteller of details. */}
                {pending.length > 0 ? (
                  <div class={`bg-white p-4 rounded shadow border-l-4 border-amber-500 transition relative ${filter === 'pending' ? 'ring-2 ring-amber-400' : ''}`} id="openstaandCard">
                    {/* Header — klikbaar als filter-shortcut, met een aparte "Toon namen"
                        knop ernaast zodat we niet ongewild filteren bij het bekijken. */}
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=pending`}
                         class="flex-1 block cursor-pointer hover:opacity-80 transition">
                        <p class="text-gray-500 text-sm">Openstaand ({pending.length})</p>
                        <p class="text-2xl font-bold">€ {openAmount.toFixed(2)}</p>
                        <p class="text-xs text-gray-400 mt-1">Gemiddeld {avgDaysOpen} dagen open</p>
                      </a>
                      {/* Aparte knop om popover te tonen — niet de hele tegel, anders
                          interfereert dat met de filter-link */}
                      <button
                        type="button"
                        onclick="document.getElementById('openstaandPreview').classList.toggle('hidden')"
                        class="shrink-0 text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded inline-flex items-center gap-1 transition"
                        title="Toon snel wie nog niet betaalde, gesorteerd op dagen open"
                      >
                        <i class="fas fa-users"></i> Toon namen
                      </button>
                    </div>

                    {/* Popover — wie heeft nog niet betaald?
                        Sortering: meest dringend bovenaan = grootste daysOpen (langste wachttijd).
                        Visuele indicatie: rood badge voor >30d (overdue), oranje voor 15-30d, grijs voor <15d. */}
                    <div
                      id="openstaandPreview"
                      class="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-2xl hidden"
                      style="z-index: 9999; max-height: 480px; overflow-y: auto;"
                    >
                      <div class="px-4 py-2.5 bg-amber-50 border-b border-amber-100 sticky top-0 flex items-center justify-between">
                        <div class="text-xs font-semibold text-gray-700">
                          <i class="fas fa-clock mr-1 text-amber-600"></i>
                          {pending.length} lid{pending.length === 1 ? '' : 'leden'} moet{pending.length === 1 ? '' : 'en'} nog betalen
                          <span class="ml-2 text-[10px] font-normal text-gray-500">— gesorteerd op dagen open</span>
                        </div>
                        <button
                          type="button"
                          onclick="document.getElementById('openstaandPreview').classList.add('hidden')"
                          class="text-gray-400 hover:text-gray-700 text-sm"
                          title="Sluiten"
                        >
                          <i class="fas fa-times"></i>
                        </button>
                      </div>
                      <ul class="divide-y divide-gray-100 text-left">
                        {[...pending]
                          .sort((a: any, b: any) => (b.daysOpen || 0) - (a.daysOpen || 0))
                          .map((m: any) => {
                            const d = m.daysOpen || 0
                            const isOverdue = d > 30
                            const isWarning = d > 14 && d <= 30
                            const badgeClass = isOverdue
                              ? 'bg-red-100 text-red-700 border border-red-200'
                              : isWarning
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-gray-100 text-gray-600 border border-gray-200'
                            const dotClass = isOverdue ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-gray-400'
                            const fullName = `${m.voornaam || ''} ${m.achternaam || ''}`.trim() || m.email || `Lid ${m.user_id}`
                            return (
                              <li class="px-4 py-2 text-xs hover:bg-amber-50 flex items-center gap-2">
                                <span class={`inline-block w-2 h-2 rounded-full ${dotClass} shrink-0`} title={`${d} dagen open`}></span>
                                <div class="flex-1 min-w-0">
                                  <div class="font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
                                    <span class="truncate">{fullName}</span>
                                    {m.stemgroep && <span class="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 shrink-0">{m.stemgroep}</span>}
                                    <span class={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badgeClass}`}>{d}d</span>
                                    <span class="text-[10px] text-gray-500 shrink-0">€{Number(m.amount || 0).toFixed(2)}</span>
                                    {m.type && <span class="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded shrink-0">{m.type}</span>}
                                  </div>
                                  <div class="text-[10px] text-gray-500 truncate">{m.email}</div>
                                </div>
                                {/* Snelle betaallink-mail — gebruikt send-link (werkt écht),
                                    niet /remind (was een no-op stub). */}
                                <form action="/api/admin/lidgelden/send-link" method="POST" class="shrink-0"
                                      onsubmit={`return confirm('Verstuur betaalmail (Mollie-link) naar ${fullName}?')`}>
                                  <input type="hidden" name="membership_id" value={m.id} />
                                  <button type="submit"
                                          class="text-[10px] px-2 py-1 bg-white hover:bg-amber-100 text-amber-700 border border-amber-200 rounded inline-flex items-center gap-1"
                                          title={`Stuur betaalmail naar ${m.email}`}>
                                    <i class="fas fa-paper-plane"></i>
                                  </button>
                                </form>
                              </li>
                            )
                          })}
                      </ul>
                      {/* Footer — bulk-acties net binnen handbereik */}
                      <div class="px-4 py-2 bg-gray-50 border-t border-gray-200 sticky bottom-0 flex items-center justify-between gap-2">
                        <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=pending`}
                           class="text-[10px] text-amber-700 hover:text-amber-900 inline-flex items-center gap-1">
                          <i class="fas fa-filter"></i> Filter op deze lijst in tabel
                        </a>
                        <form action="/api/admin/lidgelden/bulk-remind" method="POST"
                              onsubmit={`return confirm('Verstuur herinneringsmail naar alle ${pending.length} openstaande leden?')`}>
                          <input type="hidden" name="season_id" value={activeSeason.id} />
                          <input type="hidden" name="filter" value="pending" />
                          <button type="submit"
                                  class="text-[10px] px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded inline-flex items-center gap-1">
                            <i class="fas fa-paper-plane"></i> Herinner allen
                          </button>
                        </form>
                      </div>
                    </div>

                    {/* Bulk-sync knop: bevraagt Mollie voor ALLE pending items in dit seizoen.
                        Lost het 'webhook kwam nooit door'-probleem op in één klik. */}
                    <form action="/api/admin/lidgelden/sync-mollie-bulk" method="POST" class="mt-2"
                          onsubmit={`return confirm('Bevraag Mollie voor alle ${pending.length} openstaande lidgelden? Items die intussen bij Mollie betaald zijn worden hier op \\'paid\\' gezet.');`}>
                      <input type="hidden" name="year_id" value={activeSeason.id} />
                      <button type="submit" class="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded inline-flex items-center gap-1 transition"
                              title="Loop door alle openstaande lidgelden en check bij Mollie of er intussen betaald is">
                        <i class="fas fa-sync-alt"></i> Sync alle bij Mollie
                      </button>
                    </form>
                  </div>
                ) : (
                  <div class="bg-white p-4 rounded shadow border-l-4 border-green-500">
                    <p class="text-gray-500 text-sm">Openstaand (0)</p>
                    <p class="text-2xl font-bold text-green-600">
                      <i class="fas fa-check-circle mr-1"></i> Alles betaald
                    </p>
                    <p class="text-xs text-gray-400 mt-1">Geen openstaande lidgelden voor dit seizoen</p>
                  </div>
                )}
                <div class="bg-white p-4 rounded shadow border-l-4 border-gray-500 flex flex-col justify-center items-start relative" id="bulkGenerateCard">
                   <div class="flex items-center justify-between w-full mb-1">
                     <p class="text-gray-500 text-sm">Actie</p>
                     {/* #114 — Aparte preview-knop voor mobile/tablet (hover werkt niet op touch) */}
                     {usersWithoutMembership.length > 0 && (
                       <button
                         type="button"
                         onclick="document.getElementById('bulkPreview').classList.toggle('hidden')"
                         class="text-xs text-gray-500 hover:text-animato-primary"
                         title="Toon/verberg lijst van leden die gegenereerd worden"
                       >
                         <i class="fas fa-eye"></i> Preview
                       </button>
                     )}
                   </div>
                   <form action="/api/admin/lidgelden/generate-bulk" method="POST" onsubmit="return confirm('Weet je zeker dat je lidmaatschappen wilt genereren voor ALLE actieve leden zonder lidmaatschap? Dit kan niet ongedaan worden gemaakt.');" class="w-full relative">
                      <input type="hidden" name="season_id" value={activeSeason.id} />
                      <button
                        type="submit"
                        class="text-sm bg-gray-800 text-white px-3 py-1 rounded hover:bg-gray-700 w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={usersWithoutMembership.length === 0}
                        onmouseenter="document.getElementById('bulkPreview') && document.getElementById('bulkPreview').classList.remove('hidden')"
                        onfocus="document.getElementById('bulkPreview') && document.getElementById('bulkPreview').classList.remove('hidden')"
                      >
                        <i class="fas fa-magic mr-1"></i> Genereer ({usersWithoutMembership.length})
                      </button>
                      {usersWithoutMembership.length > 0 && (
                        <div
                          id="bulkPreview"
                          class="absolute right-0 top-full mt-2 w-80 max-w-[95vw] bg-white border border-gray-200 rounded-lg shadow-2xl hidden"
                          style="z-index: 9999; max-height: 360px; overflow-y: auto;"
                        >
                          <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 sticky top-0 flex items-center justify-between">
                            <div class="text-xs font-semibold text-gray-700">
                              <i class="fas fa-users mr-1 text-animato-primary"></i>
                              {usersWithoutMembership.length} lid{usersWithoutMembership.length === 1 ? '' : 'leden'} krijgen een lidmaatschap
                            </div>
                            <button
                              type="button"
                              onclick="document.getElementById('bulkPreview').classList.add('hidden')"
                              class="text-gray-400 hover:text-gray-700 text-sm"
                              title="Sluiten"
                            >
                              <i class="fas fa-times"></i>
                            </button>
                          </div>
                          <div class="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[10px] text-amber-800">
                            <i class="fas fa-info-circle mr-1"></i>
                            Default type = <strong>Basis (digitaal)</strong>. Per lid achteraf aan te passen.
                          </div>
                          <ul class="divide-y divide-gray-100 text-left">
                            {(usersWithoutMembership as any[]).slice(0, 50).map((u: any) => (
                              <li class="px-4 py-1.5 text-xs hover:bg-gray-50">
                                <div class="font-medium text-gray-800 flex items-center justify-between gap-2">
                                  <span>{u.voornaam || '?'} {u.achternaam || ''}</span>
                                  {u.stemgroep && <span class="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{u.stemgroep}</span>}
                                </div>
                                <div class="text-[10px] text-gray-500 truncate">{u.email}</div>
                              </li>
                            ))}
                            {usersWithoutMembership.length > 50 && (
                              <li class="px-4 py-2 text-[10px] text-gray-600 italic text-center bg-amber-50 sticky bottom-0 border-t border-amber-100">
                                <i class="fas fa-ellipsis-h mr-1"></i>
                                + {usersWithoutMembership.length - 50} meer leden — scroll voor de volledige lijst is uitgeschakeld om de UI vlot te houden
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                   </form>
                </div>
              </div>

              {/* === PAYMENT DASHBOARD === */}
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=fast`} class={`bg-white p-3 rounded shadow border-l-4 border-emerald-400 hover:bg-emerald-50 transition cursor-pointer ${filter === 'fast' ? 'ring-2 ring-emerald-400' : ''}`}>
                  <p class="text-gray-500 text-xs"><i class="fas fa-bolt mr-1"></i> Snelle betalers (≤7d)</p>
                  <p class="text-xl font-bold text-emerald-700">{fastPayers.length}</p>
                </a>
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=slow`} class={`bg-white p-3 rounded shadow border-l-4 border-orange-400 hover:bg-orange-50 transition cursor-pointer ${filter === 'slow' ? 'ring-2 ring-orange-400' : ''}`}>
                  <p class="text-gray-500 text-xs"><i class="fas fa-hourglass-half mr-1"></i> Langzame betalers (&gt;30d)</p>
                  <p class="text-xl font-bold text-orange-700">{slowPayers.length}</p>
                </a>
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=overdue`} class={`bg-white p-3 rounded shadow border-l-4 border-red-400 hover:bg-red-50 transition cursor-pointer ${filter === 'overdue' ? 'ring-2 ring-red-400' : ''}`}>
                  <p class="text-gray-500 text-xs"><i class="fas fa-exclamation-triangle mr-1"></i> Overdue (&gt;30d open)</p>
                  <p class="text-xl font-bold text-red-700">{overdue.length}</p>
                </a>
                <div class="bg-white p-3 rounded shadow border-l-4 border-gray-400">
                  <p class="text-gray-500 text-xs"><i class="fas fa-stopwatch mr-1"></i> Gem. tijd tot betaling</p>
                  <p class="text-xl font-bold text-gray-700">{avgDaysToPay} dagen</p>
                </div>
              </div>

              {/* === FORMULE-FILTERS (Basis = digitaal / Full = met papieren partituren) === */}
              <div class="grid grid-cols-2 md:grid-cols-2 gap-3 mb-6">
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=basis`}
                   class={`bg-white p-3 rounded shadow border-l-4 border-gray-500 hover:bg-gray-50 transition cursor-pointer flex items-center justify-between ${filter === 'basis' ? 'ring-2 ring-gray-400' : ''}`}
                   title="Basis = enkel digitale partituren">
                  <div>
                    <p class="text-gray-500 text-xs"><i class="fas fa-laptop mr-1"></i> Formule Basis (€{activeSeason.fee_base.toFixed(0)} — enkel digitaal)</p>
                    <p class="text-xl font-bold text-gray-700">{basisMemberships.length} <span class="text-xs font-normal text-gray-500">leden — enkel digitale partituren</span></p>
                  </div>
                  <div class="text-right">
                    <p class="text-[10px] text-gray-500 uppercase tracking-wide">betaald</p>
                    <p class="text-sm font-semibold text-green-700">{basisMemberships.filter((m: any) => m.status === 'paid').length}/{basisMemberships.length}</p>
                  </div>
                </a>
                <a href={`/admin/lidgelden?season_id=${activeSeason.id}&filter=full`}
                   class={`bg-white p-3 rounded shadow border-l-4 border-purple-500 hover:bg-purple-50 transition cursor-pointer flex items-center justify-between ${filter === 'full' ? 'ring-2 ring-purple-400' : ''}`}
                   title="Full = digitaal + papieren partituren in een kaft">
                  <div>
                    <p class="text-gray-500 text-xs"><i class="fas fa-music mr-1"></i> Formule Full (€{activeSeason.fee_full.toFixed(0)} — met papieren partituren)</p>
                    <p class="text-xl font-bold text-purple-700">{fullMemberships.length} <span class="text-xs font-normal text-gray-500">leden — wensen papieren partituren</span></p>
                  </div>
                  <div class="text-right">
                    <p class="text-[10px] text-gray-500 uppercase tracking-wide">betaald</p>
                    <p class="text-sm font-semibold text-green-700">{fullMemberships.filter((m: any) => m.status === 'paid').length}/{fullMemberships.length}</p>
                  </div>
                </a>
              </div>

              {/* === PARTITUUR-DISTRIBUTIE FILTERS (alleen voor Full-leden) === */}
              {/* Partituur-distributie-tegels verwijderd - Printservice afgeschaft (2026-06-13) */}

              {/* Trend + lijsten */}
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                {/* Wekelijkse betalingstrend */}
                <div class="bg-white p-4 rounded-lg shadow">
                  <h3 class="font-bold text-gray-800 mb-3 text-sm flex items-center">
                    <i class="fas fa-chart-bar text-blue-500 mr-2"></i> Betalingstrend (8 weken)
                  </h3>
                  <div class="flex items-stretch gap-2 h-36">
                    {weeklyTrend.map((w) => {
                      const pct = (w.count / maxWeekCount) * 100
                      return (
                        <div class="flex-1 flex flex-col" title={`${w.week}: ${w.count} betaling${w.count === 1 ? '' : 'en'} (€${w.amount.toFixed(0)})`}>
                          {/* Plot-area: 1 flexrij die volledig de beschikbare ruimte boven het label opvult */}
                          <div class="flex-1 flex flex-col justify-end items-center min-h-0">
                            <div class="text-[10px] font-semibold text-gray-600 leading-none mb-0.5 h-3">
                              {w.count > 0 ? w.count : ''}
                            </div>
                            <div
                              class="w-full bg-blue-400 hover:bg-blue-500 transition rounded-t"
                              style={`height: ${pct}%; min-height: ${w.count > 0 ? '4px' : '0'};`}
                            ></div>
                          </div>
                          <div class="text-[10px] text-gray-400 text-center mt-1 leading-none">{w.week}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Top 5 snelste betalers */}
                <div class="bg-white p-4 rounded-lg shadow">
                  <h3 class="font-bold text-gray-800 mb-3 text-sm flex items-center">
                    <i class="fas fa-trophy text-emerald-500 mr-2"></i> Top 5 Snelste Betalers
                  </h3>
                  {fastestPayers.length > 0 ? (
                    <ul class="space-y-2 text-sm">
                      {fastestPayers.map((m: any, idx: number) => (
                        <li class="flex justify-between items-center">
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="text-xs text-gray-400 w-4">{idx + 1}.</span>
                            <span class="truncate">{m.voornaam} {m.achternaam}</span>
                          </div>
                          <span class="text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            {m.daysToPay === 0 ? 'zelfde dag' : `${m.daysToPay} dag${m.daysToPay === 1 ? '' : 'en'}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="text-xs text-gray-400 italic">Nog geen betalingen</p>
                  )}
                </div>

                {/* Top 5 langst openstaande — Bug #195: enkel tonen als er écht
                    openstaande items zijn. Anders is de widget visuele ruis. */}
                {slowestOpen.length > 0 && (
                  <div class="bg-white p-4 rounded-lg shadow">
                    <h3 class="font-bold text-gray-800 mb-3 text-sm flex items-center">
                      <i class="fas fa-clock text-red-500 mr-2"></i> Langst Openstaand
                    </h3>
                    <ul class="space-y-2 text-sm">
                      {slowestOpen.map((m: any, idx: number) => (
                        <li class="flex justify-between items-center">
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="text-xs text-gray-400 w-4">{idx + 1}.</span>
                            <span class="truncate">{m.voornaam} {m.achternaam}</span>
                          </div>
                          <span class={`text-xs font-semibold whitespace-nowrap ${m.daysOpen > 30 ? 'text-red-700' : m.daysOpen > 14 ? 'text-orange-600' : 'text-gray-600'}`}>
                            {m.daysOpen} dagen
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Alle betalingen tijdlijn — standaard 10, uitklapbaar naar volledige lijst */}
              {allPaidPayments.length > 0 && (
                <div class="bg-white p-4 rounded-lg shadow mb-6">
                  <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <h3 class="font-bold text-gray-800 text-sm flex items-center">
                      <i class="fas fa-history text-purple-500 mr-2"></i> Betalingen
                      <span class="ml-2 text-xs font-normal text-gray-500" id="paymentsCount">
                        ({allPaidPayments.length} totaal — top 10 zichtbaar)
                      </span>
                    </h3>
                    <div class="flex items-center gap-2 flex-wrap">
                      <div class="relative">
                        <i class="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input
                          type="text"
                          id="paymentsSearch"
                          placeholder="Zoek naam of email..."
                          class="pl-7 pr-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-animato-primary focus:border-animato-primary w-40 sm:w-48"
                          autocomplete="off"
                        />
                      </div>
                      <a
                        href={`/api/admin/lidgelden/export?season_id=${activeSeason.id}&filter=paid`}
                        class="inline-flex items-center px-2 py-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 rounded border border-green-200 transition"
                        title="Download alle betalingen als CSV"
                      >
                        <i class="fas fa-file-csv mr-1"></i> CSV
                      </a>
                    </div>
                  </div>
                  <div class="space-y-1.5" id="paymentsList">
                    {allPaidPayments.map((m: any, idx: number) => {
                      const dateStr = formatBrusselsDate(m.paid_at)
                      const timeStr = formatBrusselsTime(m.paid_at)
                      const fullName = `${m.voornaam || ''} ${m.achternaam || ''}`.trim()
                      return (
                        <div
                          class="payment-row flex items-center gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0"
                          data-payment-search={`${fullName} ${m.email || ''}`.toLowerCase()}
                          data-payment-index={idx}
                          style={idx >= 10 ? 'display:none' : ''}
                        >
                          <i class="fas fa-check-circle text-green-500 text-xs"></i>
                          <span class="font-medium flex-1 truncate" title={m.email}>{fullName}</span>
                          <span class={`text-xs px-1.5 py-0.5 rounded ${m.type === 'full' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                            {m.type === 'full' ? 'Full' : 'Basis'}
                          </span>
                          <span class="font-mono text-xs text-gray-700">€{m.amount.toFixed(2)}</span>
                          <span class="text-xs text-gray-500 whitespace-nowrap hidden sm:inline">
                            {dateStr} {timeStr}
                          </span>
                          <span class="text-xs text-gray-500 whitespace-nowrap sm:hidden">
                            {dateStr}
                          </span>
                          <span class="text-xs text-gray-400 whitespace-nowrap hidden md:inline">
                            {m.daysToPay === 0 ? 'zelfde dag' : `na ${m.daysToPay}d`}
                          </span>
                        </div>
                      )
                    })}
                    <div id="paymentsNoResults" class="hidden text-center text-sm text-gray-400 italic py-4">
                      <i class="fas fa-search mr-2"></i>Geen betalingen gevonden voor deze zoekterm
                    </div>
                  </div>
                  {allPaidPayments.length > 10 && (
                    <div class="mt-3 pt-3 border-t border-gray-100 flex items-center justify-center">
                      <button
                        type="button"
                        id="paymentsToggle"
                        class="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-animato-primary hover:bg-blue-50 rounded transition"
                      >
                        <i class="fas fa-chevron-down" id="paymentsToggleIcon"></i>
                        <span id="paymentsToggleLabel">Toon alle {allPaidPayments.length} betalingen</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* === Giften & Donaties — overzichtsblok === */}
              {/* id voor deeplink vanaf /admin dashboard tile/snelle-actie */}
              <div id="giften-donaties" class="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 p-5 rounded-lg shadow-sm mb-6 scroll-mt-24">
                <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 class="font-bold text-gray-800 text-base flex items-center">
                    <i class="fas fa-gift text-pink-500 mr-2"></i>
                    Giften & Donaties
                    <span class="ml-2 text-xs font-normal text-gray-500">({allDonations.length} totaal)</span>
                  </h3>
                  <div class="flex gap-2 flex-wrap">
                    {donationsPending.filter((d: any) => d.payment_id && !d.payment_id.startsWith('tr_MOCK_')).length > 0 && (
                      <form action="/api/admin/donations/sync-mollie-bulk" method="POST" class="inline"
                        onsubmit="return confirm('Controleer alle openstaande giften bij Mollie en update status?');">
                        <button type="submit" class="inline-flex items-center h-8 px-3 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition font-medium whitespace-nowrap">
                          <i class="fas fa-sync mr-1.5"></i> Sync Mollie ({donationsPending.filter((d: any) => d.payment_id && !d.payment_id.startsWith('tr_MOCK_')).length})
                        </button>
                      </form>
                    )}
                    <a href="/api/admin/donations/export"
                      class="inline-flex items-center h-8 px-3 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition font-medium whitespace-nowrap"
                      title="Download alle giften als CSV">
                      <i class="fas fa-file-csv mr-1.5"></i> Export CSV
                    </a>
                  </div>
                </div>

                {/* Stats tiles */}
                {/* Bug #212 — "Openstaand"-tegel verwijderd. Pending giften
                    zijn meestal Mollie-checkouts die de bezoeker afbrak; het
                    bedrag heeft geen analytische waarde voor de admin. De
                    pending-counter blijft zichtbaar via de "Sync Mollie"-knop
                    bovenaan. Grid teruggebracht naar 3 kolommen. */}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div class="bg-white rounded-lg p-3 border border-pink-100">
                    <div class="text-xs text-gray-500 uppercase tracking-wide">Totaal ontvangen</div>
                    <div class="text-2xl font-bold text-pink-700 mt-1">€{donationsTotalPaid.toFixed(2)}</div>
                    <div class="text-xs text-gray-500 mt-0.5">{donationsPaid.length} betaalde gift{donationsPaid.length === 1 ? '' : 'en'}</div>
                  </div>
                  <div class="bg-white rounded-lg p-3 border border-pink-100">
                    <div class="text-xs text-gray-500 uppercase tracking-wide">Gemiddelde gift</div>
                    <div class="text-2xl font-bold text-purple-700 mt-1">€{donationsAvg.toFixed(2)}</div>
                    <div class="text-xs text-gray-500 mt-0.5">per donateur</div>
                  </div>
                  <div class="bg-white rounded-lg p-3 border border-pink-100">
                    <div class="text-xs text-gray-500 uppercase tracking-wide">Donateurs</div>
                    <div class="text-2xl font-bold text-rose-700 mt-1">{new Set(allDonations.filter((d: any) => d.status === 'paid').map((d: any) => d.user_id || `pub:${parsePublicDonor(d.message)?.email || d.id}`)).size}</div>
                    <div class="text-xs text-gray-500 mt-0.5">unieke gevers</div>
                  </div>
                </div>

                {/* Recent donations lijst */}
                {recentDonations.length > 0 ? (
                  <div class="bg-white rounded-lg border border-pink-100 overflow-hidden">
                    <div class="px-3 py-2 bg-pink-50 border-b border-pink-100 text-xs font-semibold text-gray-700">
                      <i class="fas fa-history mr-1.5"></i> Recente giften (laatste {recentDonations.length})
                    </div>
                    <div class="divide-y divide-gray-100">
                      {recentDonations.map((d: any) => {
                        const dt = d.created_at ? new Date(d.created_at) : null
                        const dateStr = dt ? formatBrusselsDate(dt, { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
                        const pub = parsePublicDonor(d.message)
                        let donorLabel: any
                        let donorBadge: any
                        if (d.user_id && d.donor_voornaam) {
                          // Geregistreerd lid
                          donorLabel = <span class="font-medium text-gray-900">{d.donor_voornaam} {d.donor_achternaam}</span>
                          donorBadge = <span class="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded uppercase tracking-wide">Lid</span>
                        } else if (pub) {
                          // Publieke gift met naam+email
                          donorLabel = (
                            <span>
                              <span class="font-medium text-gray-900">{pub.name}</span>
                              <span class="text-xs text-gray-500 ml-1">&lt;{pub.email}&gt;</span>
                            </span>
                          )
                          donorBadge = <span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded uppercase tracking-wide">Publiek</span>
                        } else if (d.is_anonymous) {
                          donorLabel = <span class="italic text-gray-500">Anoniem</span>
                          donorBadge = <span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded uppercase tracking-wide">Anoniem</span>
                        } else {
                          donorLabel = <span class="italic text-gray-500">Onbekend</span>
                          donorBadge = <span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded uppercase tracking-wide">?</span>
                        }
                        const statusBadge =
                          d.status === 'paid' ? <span class="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-semibold">PAID</span>
                          : d.status === 'pending' ? <span class="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">PENDING</span>
                          : <span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded font-semibold">{(d.status || '').toUpperCase()}</span>
                        const isMock = d.payment_id && d.payment_id.startsWith('tr_MOCK_')
                        const cleanMsg = pub ? pub.cleanMsg : (d.message || '')
                        return (
                          <div class="flex items-center gap-3 px-3 py-2 text-sm hover:bg-pink-50/30">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2 flex-wrap">
                                {donorLabel}
                                {donorBadge}
                                {statusBadge}
                                {isMock && <span class="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">MOCK</span>}
                              </div>
                              {cleanMsg && (
                                <div class="text-xs text-gray-600 mt-0.5 italic truncate" title={cleanMsg}>"{cleanMsg}"</div>
                              )}
                            </div>
                            <div class="text-right whitespace-nowrap">
                              <div class="font-mono font-semibold text-pink-700">€{Number(d.amount).toFixed(2)}</div>
                              <div class="text-[10px] text-gray-500">{dateStr}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div class="bg-white rounded-lg border border-pink-100 p-4 text-center text-sm text-gray-500 italic">
                    Nog geen giften ontvangen. Wanneer iemand via <a href="/steun-ons" class="text-pink-600 hover:underline" target="_blank">/steun-ons</a> of als lid een gift doet, verschijnen ze hier.
                  </div>
                )}

                <div class="text-xs text-gray-500 mt-3 flex items-center gap-2 flex-wrap">
                  <i class="fas fa-info-circle"></i>
                  <span>Giften zijn los van lidgelden. Publieke giften komen via <code class="bg-white px-1 rounded text-pink-700">/steun-ons</code>, lid-giften via het ledenportaal.</span>
                </div>
              </div>

              {/* Active filter banner — met bulk-acties op gefilterde lijst */}
              {filter !== 'all' && (
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
                  <div class="text-sm">
                    <i class="fas fa-filter text-blue-600 mr-2"></i>
                    <span class="font-semibold text-blue-900">Filter actief:</span>
                    <span class="text-blue-800 ml-1">{filterLabel}</span>
                    <span class="text-blue-600 ml-2">({visibleMemberships.length} resultaten)</span>
                  </div>
                  <div class="flex gap-2 flex-wrap">
                    {/* Bulk reminder — alleen bij overdue/pending filters */}
                    {(filter === 'overdue' || filter === 'pending') && visibleMemberships.length > 0 && (
                      <form action="/api/admin/lidgelden/bulk-remind" method="POST" class="inline" onsubmit={`return confirm('Reminder mail sturen naar ${visibleMemberships.length} lid${visibleMemberships.length === 1 ? '' : 'leden'}?');`}>
                        <input type="hidden" name="season_id" value={activeSeason.id} />
                        <input type="hidden" name="filter" value={filter} />
                        <button type="submit" class="inline-flex items-center h-9 px-3 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition font-medium whitespace-nowrap">
                          <i class="fas fa-paper-plane mr-1.5"></i> Bulk reminder ({visibleMemberships.length})
                        </button>
                      </form>
                    )}
                    {/* CSV Export van gefilterde lijst */}
                    <a
                      href={`/api/admin/lidgelden/export?season_id=${activeSeason.id}&filter=${filter}`}
                      class="inline-flex items-center h-9 px-3 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition font-medium whitespace-nowrap"
                      title="Download als CSV (Excel-compatibel)"
                    >
                      <i class="fas fa-file-csv mr-1.5"></i> Export CSV
                    </a>
                    <a href={`/admin/lidgelden?season_id=${activeSeason.id}`} class="inline-flex items-center h-9 px-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
                      <i class="fas fa-times mr-1"></i> Filter wissen
                    </a>
                  </div>
                </div>
              )}

              {/* Permanente CSV Export knop (zonder filter) — voor de penningmeester */}
              {filter === 'all' && memberships.length > 0 && (
                <div class="mb-4 flex justify-end">
                  <a
                    href={`/api/admin/lidgelden/export?season_id=${activeSeason.id}&filter=all`}
                    class="inline-flex items-center h-9 px-3 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition font-medium"
                    title="Download volledige lijst als CSV"
                  >
                    <i class="fas fa-file-csv mr-1.5 text-green-600"></i> Volledige lijst exporteren (CSV)
                  </a>
                </div>
              )}

              {/* Search bar boven de tabel */}
              {visibleMemberships.length > 0 && (
                <div class="mb-3 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <div class="relative flex-1 max-w-md">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                    <input
                      type="text"
                      id="lidgeldenSearch"
                      placeholder="Zoek op naam of email..."
                      class="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-animato-primary focus:border-animato-primary"
                      autocomplete="off"
                    />
                    <button id="lidgeldenSearchClear"
                      class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm hidden"
                      title="Wis zoekterm"
                      type="button">
                      <i class="fas fa-times-circle"></i>
                    </button>
                  </div>
                  <div class="text-xs text-gray-500 flex items-center gap-3">
                    <span id="lidgeldenCount">{visibleMemberships.length} {visibleMemberships.length === 1 ? 'lid' : 'leden'}</span>
                    <span class="text-gray-300">|</span>
                    <span class="text-gray-400">Klik op kolomtitels om te sorteren</span>
                  </div>
                </div>
              )}

              {/* Table — compacte padding zodat actie-kolom zonder horizontaal scrollen leesbaar is */}
              <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="w-full text-sm" id="lidgeldenTable">
                  <thead class="bg-gray-100">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="lid" data-sort-type="string">
                        Lid <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="formule" data-sort-type="string">
                        Formule <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="bedrag" data-sort-type="number">
                        Bedrag <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="status" data-sort-type="string">
                        Status <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="tijd" data-sort-type="number" title="Sorteer op dagen (open dagen of dagen tot betaling)">
                        Tijd <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-200 transition" data-sort-col="betaaldop" data-sort-type="number" title="Sorteer op betaaldatum — recentste eerst (desc) of oudste eerst (asc). Niet-betaalden onderaan.">
                        Betaald op <i class="fas fa-sort text-gray-300 ml-1 text-xs sort-icon"></i>
                      </th>
                      <th class="px-3 py-2 text-right font-medium text-gray-500">Actie</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200" id="lidgeldenTbody">
                    {visibleMemberships.length > 0 ? visibleMemberships.map((m: any) => {
                      const fullName = `${m.voornaam || ''} ${m.achternaam || ''}`.trim()
                      // Sort-key voor "Tijd": negatieve waarden voor 'open' (langer open = hoger), positieve voor 'paid' (sneller betaald = lager)
                      // We gebruiken: open = m.daysOpen (positief, hoger = ouder), paid = -1 * (10000 - daysToPay) zodat snel-betalers bovenaan staan bij asc
                      // Simpeler: open-leden krijgen daysOpen, paid-leden krijgen -1 zodat ze sorteren onderaan
                      const tijdSortValue = m.status === 'paid'
                        ? (m.daysToPay !== null ? m.daysToPay : -1)
                        : (m.daysOpen || 0) + 10000  // open lidgelden hoger, zodat ze bij desc bovenaan komen
                      // Sort-key voor "Betaald op": timestamp ms voor betaalden, 0 voor open (zodat ze onderaan staan bij desc, bovenaan bij asc)
                      const betaaldOpSortValue = m.status === 'paid' && m.paid_at
                        ? new Date(m.paid_at).getTime()
                        : 0
                      return (
                      <tr
                        data-search={`${fullName} ${m.email || ''}`.toLowerCase()}
                        data-sort-lid={fullName.toLowerCase()}
                        data-sort-formule={m.type === 'full' ? 'full' : 'basis'}
                        data-sort-bedrag={Number(m.amount) || 0}
                        data-sort-status={m.status === 'paid' ? '1-paid' : '2-open'}
                        data-sort-tijd={tijdSortValue}
                        data-sort-betaaldop={betaaldOpSortValue}
                      >
                        <td class="px-3 py-2">
                          <div class="font-medium text-gray-900">{m.voornaam} {m.achternaam}</div>
                          <div class="text-xs text-gray-500">{m.email}</div>
                        </td>
                        <td class="px-3 py-2">
                          {m.type === 'full' ? (
                            <span class="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap" title="Full lidgeld — met papieren partituren">
                              <i class="fas fa-print mr-1"></i> Full
                            </span>
                          ) : (
                            <span class="bg-gray-100 text-gray-800 text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap" title="Basis lidgeld — zonder papieren partituren (digitaal)">
                              <i class="fas fa-tablet-alt mr-1"></i> Basis
                            </span>
                          )}
                        </td>
                        <td class="px-3 py-2 font-mono whitespace-nowrap">€ {m.amount.toFixed(2)}</td>
                        <td class="px-3 py-2">
                          {m.status === 'paid' ? (
                            <div class="flex flex-col">
                                <span class="text-green-600 font-semibold whitespace-nowrap"><i class="fas fa-check mr-1"></i> Betaald</span>
                                <span class="text-xs text-gray-400">{formatBrusselsDate(m.paid_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                            </div>
                          ) : (
                            <span class="text-amber-600 font-semibold whitespace-nowrap"><i class="fas fa-clock mr-1"></i> Openstaand</span>
                          )}
                        </td>
                        <td class="px-3 py-2 text-xs">
                          {m.status === 'paid' ? (
                            m.daysToPay !== null ? (
                              <span class={`px-2 py-1 rounded ${m.daysToPay <= 7 ? 'bg-emerald-100 text-emerald-700' : m.daysToPay <= 30 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`} title={`Betaald na ${m.daysToPay} dagen`}>
                                <i class="fas fa-bolt mr-1"></i>{m.daysToPay === 0 ? 'zelfde dag' : `${m.daysToPay}d`}
                              </span>
                            ) : (
                              <span class="text-gray-400">—</span>
                            )
                          ) : (
                            <span class={`px-2 py-1 rounded ${m.daysOpen > 30 ? 'bg-red-100 text-red-700' : m.daysOpen > 14 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`} title={`${m.daysOpen} dagen open`}>
                              <i class="fas fa-clock mr-1"></i>{m.daysOpen}d open
                            </span>
                          )}
                        </td>
                        <td class="px-3 py-2 text-xs whitespace-nowrap">
                          {m.status === 'paid' && m.paid_at ? (
                            <div class="flex flex-col">
                              <span class="text-gray-700 font-medium">{formatBrusselsDate(m.paid_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                              <span class="text-gray-400">{formatBrusselsTime(m.paid_at)}</span>
                            </div>
                          ) : (
                            <span class="text-gray-300">—</span>
                          )}
                        </td>
                        <td class="px-3 py-2 text-right">
                          {/* Acties als icon-only knoppen — tooltip op hover, compact zodat geen horizontaal scrollen nodig is */}
                          <div class="flex flex-wrap gap-1 justify-end">
                            {m.status === 'paid' ? (
                              <form action="/api/admin/lidgelden/status" method="POST" class="inline">
                                <input type="hidden" name="membership_id" value={m.id} />
                                <input type="hidden" name="status" value="pending" />
                                <button class="w-7 h-7 inline-flex items-center justify-center text-amber-600 hover:bg-amber-50 rounded" title="Reset naar onbetaald">
                                  <i class="fas fa-undo text-xs"></i>
                                </button>
                              </form>
                            ) : (
                              <>
                                <form action="/api/admin/lidgelden/status" method="POST" class="inline">
                                  <input type="hidden" name="membership_id" value={m.id} />
                                  <input type="hidden" name="status" value="paid" />
                                  <button class="w-7 h-7 inline-flex items-center justify-center text-green-600 hover:bg-green-50 rounded" title="Markeer als handmatig betaald">
                                    <i class="fas fa-check-circle text-xs"></i>
                                  </button>
                                </form>
                                <form action="/api/admin/lidgelden/send-link" method="POST" class="inline">
                                  <input type="hidden" name="membership_id" value={m.id} />
                                  <button class="w-7 h-7 inline-flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded" title="Stuur betaallink per email">
                                    <i class="fas fa-envelope text-xs"></i>
                                  </button>
                                </form>
                                {/* Sync-knop: alleen als er een echte Mollie payment_id is */}
                                {m.mollie_payment_id && !String(m.mollie_payment_id).startsWith('tr_MOCK_') && (
                                  <form action="/api/admin/lidgelden/sync-mollie" method="POST" class="inline">
                                    <input type="hidden" name="membership_id" value={m.id} />
                                    <button class="w-7 h-7 inline-flex items-center justify-center text-cyan-600 hover:bg-cyan-50 rounded" title="Check status bij Mollie en sync (handig als webhook niet doorkwam)">
                                      <i class="fas fa-sync text-xs"></i>
                                    </button>
                                  </form>
                                )}
                              </>
                            )}
                            {/* #111: switch formule basis ↔ full + bedrag aanpassen + delete */}
                            <form action="/api/admin/lidgelden/update-type" method="POST" class="inline">
                              <input type="hidden" name="membership_id" value={m.id} />
                              <input type="hidden" name="type" value={m.type === 'full' ? 'basis' : 'full'} />
                              <button class="w-7 h-7 inline-flex items-center justify-center text-purple-600 hover:bg-purple-50 rounded" title={m.type === 'full' ? 'Wijzig naar Basis (digitaal)' : 'Upgrade naar Full (+ papieren partituren)'}>
                                <i class={`fas ${m.type === 'full' ? 'fa-arrow-down' : 'fa-arrow-up'} text-xs`}></i>
                              </button>
                            </form>
                            {m.status !== 'paid' && (
                              <form action="/api/admin/lidgelden/update-amount" method="POST" class="inline" onsubmit={`var v = prompt('Nieuw bedrag in € voor ${(m.voornaam || '') + ' ' + (m.achternaam || '')} (huidig: €${Number(m.amount).toFixed(2)}). Mollie betaallink wordt gereset.', '${Number(m.amount).toFixed(2)}'); if (v === null) return false; this.amount.value = v; return true;`}>
                                <input type="hidden" name="membership_id" value={m.id} />
                                <input type="hidden" name="amount" value="" />
                                <button class="w-7 h-7 inline-flex items-center justify-center text-indigo-600 hover:bg-indigo-50 rounded" title="Bedrag aanpassen (korting, bijbetaling, correctie)">
                                  <i class="fas fa-euro-sign text-xs"></i>
                                </button>
                              </form>
                            )}
                            <form action="/api/admin/lidgelden/delete" method="POST" class="inline" onsubmit={`return confirm('Lidmaatschap voor ${m.voornaam || ''} ${m.achternaam || ''} verwijderen?');`}>
                              <input type="hidden" name="membership_id" value={m.id} />
                              <button class="w-7 h-7 inline-flex items-center justify-center text-red-600 hover:bg-red-50 rounded" title="Verwijder dit lidmaatschap">
                                <i class="fas fa-trash text-xs"></i>
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                      )
                    }) : (
                        <tr>
                            <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                                {filter === 'all' ? (
                                  <>
                                    Geen lidmaatschappen gevonden voor dit seizoen.
                                    <br/>
                                    <button onclick="document.querySelector('form[action=\'/api/admin/lidgelden/generate-bulk\'] button').click()" class="text-animato-primary hover:underline mt-2">
                                        Genereer automatisch voor alle actieve leden
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    Geen resultaten voor filter "{filterLabel}".
                                    <br/>
                                    <a href={`/admin/lidgelden?season_id=${activeSeason.id}`} class="text-animato-primary hover:underline mt-2 inline-block">
                                      ← Toon alle lidmaatschappen
                                    </a>
                                  </>
                                )}
                            </td>
                        </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <i class="fas fa-calendar-times text-yellow-500 text-4xl mb-4"></i>
              <h3 class="text-xl font-bold text-gray-900 mb-2">Geen Seizoenen Gevonden</h3>
              <p class="text-gray-600 mb-4">Maak eerst een nieuw seizoen aan om te beginnen.</p>
              <button onclick="document.getElementById('createSeasonModal').classList.remove('hidden')" class="bg-animato-primary text-white px-6 py-2 rounded hover:opacity-90">
                <i class="fas fa-calendar-plus mr-2"></i> Nieuw Seizoen Aanmaken
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Membership Modal
          UX-fix (Dominique, 23 mei 2026): zoekbalk i.p.v. scroll-through select.
          Gebruikers worden gefilterd op voornaam/achternaam/email; klik op een
          rij vult de hidden user_id én toont de selectie zichtbaar. */}
      {activeSeason && (
        <div id="addModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="text-xl font-bold mb-4">Lidmaatschap Toekennen ({activeSeason.season})</h3>
            <form action="/api/admin/lidgelden/create" method="POST" id="addMembershipForm">
              <input type="hidden" name="year_id" value={activeSeason.id} />
              <input type="hidden" name="user_id" id="addModalUserId" required />

              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Lid</label>

                {usersWithoutMembership.length === 0 ? (
                  <div class="text-sm text-gray-500 italic border rounded p-2 bg-gray-50">
                    Alle actieve leden hebben al een lidmaatschap.
                  </div>
                ) : (
                  <>
                    {/* Geselecteerd lid — pill met clear-knop, hidden tot keuze gemaakt */}
                    <div id="addModalSelected" class="hidden mb-2 inline-flex items-center gap-2 bg-animato-primary/10 border border-animato-primary/30 text-animato-primary rounded-full px-3 py-1.5 text-sm font-medium">
                      <i class="fas fa-user-check"></i>
                      <span id="addModalSelectedLabel"></span>
                      <button type="button" id="addModalClear" class="ml-1 text-animato-primary hover:text-red-600 transition" aria-label="Selectie wissen">
                        <i class="fas fa-times text-xs"></i>
                      </button>
                    </div>

                    {/* Zoekbalk + filtered list */}
                    <div class="relative">
                      <div class="relative">
                        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none"></i>
                        <input
                          type="text"
                          id="addModalSearch"
                          autocomplete="off"
                          placeholder={`Zoek op naam of email (${usersWithoutMembership.length} leden)`}
                          class="w-full border rounded pl-9 pr-3 py-2 focus:ring-2 focus:ring-animato-primary focus:border-transparent text-sm"
                        />
                      </div>
                      <ul id="addModalList" class="mt-1 max-h-56 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100 bg-white shadow-sm">
                        {usersWithoutMembership.map((u: any) => {
                          const fullName = `${u.voornaam || ''} ${u.achternaam || ''}`.trim()
                          const haystack = `${fullName} ${u.email || ''}`.toLowerCase()
                          return (
                            <li
                              class="add-modal-row px-3 py-2 cursor-pointer hover:bg-animato-primary/5 transition text-sm"
                              data-user-id={String(u.id)}
                              data-user-label={`${fullName} (${u.email || ''})`}
                              data-haystack={haystack}
                            >
                              <div class="font-medium text-gray-900">{fullName || '(naamloos)'}</div>
                              <div class="text-xs text-gray-500">{u.email}</div>
                            </li>
                          )
                        })}
                      </ul>
                      <div id="addModalEmpty" class="hidden text-center text-xs text-gray-400 py-3 italic">
                        Geen leden gevonden.
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Formule</label>
                <select name="type" class="w-full border rounded p-2" required>
                  <option value="basis">Basis Lidgeld (€{activeSeason.fee_base})</option>
                  <option value="full">Lidgeld + Partituren (€{activeSeason.fee_full})</option>
                </select>
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="document.getElementById('addModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
                <button type="submit" id="addModalSubmit" class="px-4 py-2 bg-animato-primary text-white rounded disabled:opacity-50 disabled:cursor-not-allowed" disabled>Aanmaken</button>
              </div>
            </form>

            {/* Zoek/select JS voor de Lidmaatschap-toekennen modal */}
            <script dangerouslySetInnerHTML={{__html: `
              (function() {
                var modal   = document.getElementById('addModal');
                var search  = document.getElementById('addModalSearch');
                var list    = document.getElementById('addModalList');
                var empty   = document.getElementById('addModalEmpty');
                var hidden  = document.getElementById('addModalUserId');
                var pill    = document.getElementById('addModalSelected');
                var label   = document.getElementById('addModalSelectedLabel');
                var clear   = document.getElementById('addModalClear');
                var submit  = document.getElementById('addModalSubmit');
                if (!modal || !search || !list || !hidden) return;

                function setEnabled(on) {
                  if (submit) submit.disabled = !on;
                }

                function selectUser(id, lbl) {
                  hidden.value = id;
                  if (label) label.textContent = lbl;
                  if (pill)  pill.classList.remove('hidden');
                  setEnabled(true);
                }

                function clearSelection() {
                  hidden.value = '';
                  if (pill)  pill.classList.add('hidden');
                  setEnabled(false);
                }

                if (clear) {
                  clear.addEventListener('click', function() {
                    clearSelection();
                    search.value = '';
                    filter('');
                    search.focus();
                  });
                }

                list.addEventListener('click', function(e) {
                  var row = e.target.closest('.add-modal-row');
                  if (!row) return;
                  var id  = row.getAttribute('data-user-id');
                  var lbl = row.getAttribute('data-user-label');
                  if (id) selectUser(id, lbl || '');
                  // Markeer visueel
                  list.querySelectorAll('.add-modal-row').forEach(function(r) {
                    r.classList.remove('bg-animato-primary/10');
                  });
                  row.classList.add('bg-animato-primary/10');
                });

                function filter(q) {
                  q = (q || '').trim().toLowerCase();
                  var rows = list.querySelectorAll('.add-modal-row');
                  var shown = 0;
                  rows.forEach(function(r) {
                    var h = r.getAttribute('data-haystack') || '';
                    var match = !q || h.indexOf(q) !== -1;
                    r.style.display = match ? '' : 'none';
                    if (match) shown++;
                  });
                  if (empty) empty.classList.toggle('hidden', shown !== 0);
                  list.style.display = shown === 0 ? 'none' : '';
                }

                search.addEventListener('input', function() { filter(search.value); });

                // Enter in zoekbalk: kies de eerste zichtbare rij
                search.addEventListener('keydown', function(e) {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  var rows = list.querySelectorAll('.add-modal-row');
                  for (var i = 0; i < rows.length; i++) {
                    if (rows[i].style.display !== 'none') {
                      rows[i].click();
                      break;
                    }
                  }
                });

                // Reset state bij open van modal: bekijken triggers ontbreken,
                // we observeren classList wijziging via MutationObserver.
                try {
                  var mo = new MutationObserver(function() {
                    if (!modal.classList.contains('hidden')) {
                      // Modal net geopend → reset
                      clearSelection();
                      search.value = '';
                      filter('');
                      setTimeout(function(){ search.focus(); }, 50);
                    }
                  });
                  mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
                } catch(_) {}

                // Submit-guard: voorkom verzending zonder selectie
                var form = document.getElementById('addMembershipForm');
                if (form) {
                  form.addEventListener('submit', function(e) {
                    if (!hidden.value) {
                      e.preventDefault();
                      search.focus();
                      search.classList.add('ring-2','ring-red-400');
                      setTimeout(function(){ search.classList.remove('ring-2','ring-red-400'); }, 1200);
                    }
                  });
                }
              })();
            `}} />
          </div>
        </div>
      )}

      {/* Edit Season Modal */}
      {activeSeason && (
        <div id="editSeasonModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="text-xl font-bold mb-4">Seizoen Bewerken ({activeSeason.season})</h3>
            <form action="/api/admin/seasons/update" method="POST">
              <input type="hidden" name="id" value={activeSeason.id} />
              <div class="mb-4">
                <label class="block text-sm font-medium mb-1">Seizoen Naam</label>
                <input type="text" name="season" value={activeSeason.season} class="w-full border rounded p-2" required />
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Start Datum</label>
                  <input type="date" name="start_date" value={activeSeason.start_date.split('T')[0]} class="w-full border rounded p-2" required />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Eind Datum</label>
                  <input type="date" name="end_date" value={activeSeason.end_date.split('T')[0]} class="w-full border rounded p-2" required />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Basis Lidgeld (€)</label>
                  <input type="number" step="0.01" name="fee_base" value={activeSeason.fee_base} class="w-full border rounded p-2" required />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Full Lidgeld (€)</label>
                  <input type="number" step="0.01" name="fee_full" value={activeSeason.fee_full} class="w-full border rounded p-2" required />
                </div>
              </div>
              <div class="mb-4">
                 <label class="flex items-center gap-2">
                   <input type="checkbox" name="is_active" value="1" checked={activeSeason.is_active === 1} />
                   <span class="text-sm font-medium">Instellen als actief seizoen</span>
                 </label>
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="document.getElementById('editSeasonModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
                <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Opslaan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Season Modal — verwijdert ALLE memberships voor het actieve seizoen */}
      {activeSeason && (
        <div id="resetSeasonModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="text-xl font-bold mb-2 text-red-700 flex items-center gap-2">
              <i class="fas fa-exclamation-triangle"></i> Reset Seizoen
            </h3>
            <p class="text-sm text-gray-700 mb-4">
              Dit verwijdert <strong>alle {memberships.length} lidmaatschappen</strong> van seizoen <strong>{activeSeason.season}</strong>.
              Het seizoen zelf en de tarieven (€{activeSeason.fee_base?.toFixed(2)} / €{activeSeason.fee_full?.toFixed(2)}) blijven bestaan.
              Hierna kan je opnieuw bulk-genereren voor alle actieve leden.
            </p>
            <div class="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-xs text-amber-800">
              <i class="fas fa-info-circle mr-1"></i>
              <strong>Let op:</strong> alle <strong>betalingen</strong> (status, paid_at, mollie-links) gaan ook weg.
              Eventuele giften en webhook-records blijven onaangeroerd.
            </div>
            <form action="/api/admin/lidgelden/reset-season" method="POST">
              <input type="hidden" name="season_id" value={activeSeason.id} />
              <div class="mb-4">
                <label class="block text-sm font-medium mb-1 text-gray-700">
                  Typ ter bevestiging het seizoen: <code class="bg-gray-100 px-1 rounded">{activeSeason.season}</code>
                </label>
                <input
                  type="text"
                  name="confirm_season"
                  class="w-full border-2 border-red-200 rounded p-2 focus:border-red-500 focus:outline-none"
                  placeholder={activeSeason.season}
                  required
                  autocomplete="off"
                />
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="document.getElementById('resetSeasonModal').classList.add('hidden')" class="px-4 py-2 border rounded hover:bg-gray-50">
                  Annuleren
                </button>
                <button
                  type="submit"
                  class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-semibold"
                  onclick="return confirm('Definitief alle lidmaatschappen verwijderen voor dit seizoen?');"
                >
                  <i class="fas fa-eraser mr-1"></i> Definitief Resetten
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Season Modal */}
      <div id="createSeasonModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-xl font-bold mb-2">Nieuw Seizoen Aanmaken</h3>
          {/* Bug #201 — geruststellen dat archief intact blijft */}
          <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-xs text-blue-900">
            <i class="fas fa-info-circle mr-1"></i>
            Het lopende seizoen wordt automatisch <strong>archief</strong>.
            Alle bestaande lidmaatschappen, betalingen en giften van vorige seizoenen blijven bewaard
            en kan je later opvragen via de seizoen-selector.
          </div>
          <form action="/api/admin/seasons/create" method="POST">
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1">Seizoen Naam</label>
              <input type="text" name="season" placeholder="bv. 2026-2027" class="w-full border rounded p-2" required />
            </div>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-medium mb-1">Start Datum</label>
                <input type="date" name="start_date" class="w-full border rounded p-2" required />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Eind Datum</label>
                <input type="date" name="end_date" class="w-full border rounded p-2" required />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-medium mb-1">Basis Lidgeld (€)</label>
                <input type="number" step="0.01" name="fee_base" value="35.00" class="w-full border rounded p-2" required />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Full Lidgeld (€)</label>
                <input type="number" step="0.01" name="fee_full" value="55.00" class="w-full border rounded p-2" required />
              </div>
            </div>
            <div class="mb-4">
               <label class="flex items-center gap-2">
                 <input type="checkbox" name="is_active" value="1" checked />
                 <span class="text-sm font-medium">Instellen als actief seizoen</span>
               </label>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" onclick="document.getElementById('createSeasonModal').classList.add('hidden')" class="px-4 py-2 border rounded">Annuleren</button>
              <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded">Aanmaken</button>
            </div>
          </form>
        </div>
      </div>

      {/* markPackageDelivered helper-script verwijderd - Printservice afgeschaft (2026-06-13) */}

      {/* Client-side filter + sort voor de Lidgelden-tabel */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const searchInput = document.getElementById('lidgeldenSearch');
          const searchClear = document.getElementById('lidgeldenSearchClear');
          const tbody = document.getElementById('lidgeldenTbody');
          const countEl = document.getElementById('lidgeldenCount');
          const table = document.getElementById('lidgeldenTable');
          if (!searchInput || !tbody || !table) return;

          // Bewaar oorspronkelijke volgorde voor reset
          const allRows = Array.from(tbody.querySelectorAll('tr')).filter(r => r.hasAttribute('data-search'));
          if (allRows.length === 0) return;

          let currentSort = { col: null, dir: 'asc' };

          function applyFilter() {
            const q = (searchInput.value || '').trim().toLowerCase();
            searchClear.classList.toggle('hidden', q.length === 0);
            let visibleCount = 0;
            allRows.forEach(row => {
              const haystack = row.getAttribute('data-search') || '';
              const match = !q || haystack.indexOf(q) !== -1;
              row.style.display = match ? '' : 'none';
              if (match) visibleCount++;
            });
            if (countEl) {
              countEl.textContent = visibleCount + ' ' + (visibleCount === 1 ? 'lid' : 'leden') + (q ? ' (gefilterd)' : '');
            }
          }

          function applySort(col, type) {
            // Toggle richting indien dezelfde kolom
            if (currentSort.col === col) {
              currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
              currentSort.col = col;
              currentSort.dir = 'asc';
            }

            // Reset alle icoontjes
            table.querySelectorAll('th[data-sort-col] .sort-icon').forEach(icon => {
              icon.className = 'fas fa-sort text-gray-300 ml-1 text-xs sort-icon';
            });
            // Set actieve kolom-icoon
            const activeHeader = table.querySelector('th[data-sort-col="' + col + '"]');
            if (activeHeader) {
              const icon = activeHeader.querySelector('.sort-icon');
              if (icon) {
                icon.className = 'fas fa-sort-' + (currentSort.dir === 'asc' ? 'up' : 'down') + ' text-animato-primary ml-1 text-xs sort-icon';
              }
            }

            // Sorteer
            const dirMul = currentSort.dir === 'asc' ? 1 : -1;
            const sorted = allRows.slice().sort((a, b) => {
              const av = a.getAttribute('data-sort-' + col) || '';
              const bv = b.getAttribute('data-sort-' + col) || '';
              if (type === 'number') {
                return (parseFloat(av) - parseFloat(bv)) * dirMul;
              }
              return av.localeCompare(bv, 'nl', { numeric: true, sensitivity: 'base' }) * dirMul;
            });

            // Re-append in volgorde
            sorted.forEach(row => tbody.appendChild(row));
          }

          // Wire up search
          searchInput.addEventListener('input', applyFilter);
          if (searchClear) {
            searchClear.addEventListener('click', () => {
              searchInput.value = '';
              applyFilter();
              searchInput.focus();
            });
          }

          // Wire up sort headers
          table.querySelectorAll('th[data-sort-col]').forEach(th => {
            th.addEventListener('click', () => {
              const col = th.getAttribute('data-sort-col');
              const type = th.getAttribute('data-sort-type') || 'string';
              applySort(col, type);
            });
          });

          // Sneltoets: '/' om snel naar zoekveld te springen
          document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== searchInput && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
              e.preventDefault();
              searchInput.focus();
            }
          });
        })();

        // === Betalingen-sectie: toggle "Toon alle X" + zoekveld ===
        (function() {
          const list = document.getElementById('paymentsList');
          const toggle = document.getElementById('paymentsToggle');
          const toggleLabel = document.getElementById('paymentsToggleLabel');
          const toggleIcon = document.getElementById('paymentsToggleIcon');
          const search = document.getElementById('paymentsSearch');
          const countEl = document.getElementById('paymentsCount');
          const noResults = document.getElementById('paymentsNoResults');
          if (!list) return;

          const allRows = Array.from(list.querySelectorAll('.payment-row'));
          if (allRows.length === 0) return;

          const totalCount = allRows.length;
          let expanded = false;
          let activeQuery = '';

          function refresh() {
            const q = activeQuery.trim().toLowerCase();
            let visibleCount = 0;
            allRows.forEach((row, idx) => {
              const haystack = row.getAttribute('data-payment-search') || '';
              const matchesSearch = !q || haystack.indexOf(q) !== -1;
              // Wanneer er gezocht wordt: toon alles dat matcht, ongeacht expanded.
              // Anders: respecteer expanded (alle) vs ingeklapt (top 10).
              const visible = q
                ? matchesSearch
                : (expanded || idx < 10);
              row.style.display = visible ? '' : 'none';
              if (visible) visibleCount++;
            });

            // Update teller
            if (countEl) {
              if (q) {
                countEl.textContent = '(' + visibleCount + ' van ' + totalCount + ' gevonden)';
              } else if (expanded) {
                countEl.textContent = '(' + totalCount + ' totaal — alles zichtbaar)';
              } else {
                countEl.textContent = '(' + totalCount + ' totaal — top 10 zichtbaar)';
              }
            }

            // Geen-resultaten boodschap
            if (noResults) {
              noResults.classList.toggle('hidden', visibleCount > 0);
            }

            // Toggle-knop label + zichtbaarheid
            if (toggle) {
              if (q) {
                // Tijdens zoeken: verberg toggle-knop (zoek toont al alles wat matcht)
                toggle.style.display = 'none';
              } else if (totalCount > 10) {
                toggle.style.display = '';
                if (toggleLabel) toggleLabel.textContent = expanded
                  ? 'Toon enkel laatste 10'
                  : 'Toon alle ' + totalCount + ' betalingen';
                if (toggleIcon) toggleIcon.className = expanded
                  ? 'fas fa-chevron-up'
                  : 'fas fa-chevron-down';
              }
            }
          }

          if (toggle) {
            toggle.addEventListener('click', () => {
              expanded = !expanded;
              refresh();
              if (!expanded) {
                // Scroll terug naar boven van de lijst voor UX
                list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            });
          }

          if (search) {
            search.addEventListener('input', (e) => {
              activeQuery = e.target.value || '';
              refresh();
            });
          }

          // Initial state
          refresh();
        })();
      ` }} />

    </Layout>
  )
})

// === API ACTIONS ===

// Update Season
app.post('/api/admin/seasons/update', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  const isActive = body.is_active ? 1 : 0

  if (isActive) {
    // Deactivate other seasons
    await execute(db, "UPDATE membership_years SET is_active = 0 WHERE id != ?", [body.id])
  }

  await execute(db, `
    UPDATE membership_years 
    SET season = ?, start_date = ?, end_date = ?, fee_base = ?, fee_full = ?, is_active = ?
    WHERE id = ?
  `, [body.season, body.start_date, body.end_date, body.fee_base, body.fee_full, isActive, body.id])

  // Update system setting if active
  if (isActive) {
      await execute(db, "INSERT INTO system_settings (key, value) VALUES ('current_season', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [body.season, body.season])
  }

  return c.redirect('/admin/lidgelden?season_id=' + body.id)
})

// Create Season
app.post('/api/admin/seasons/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  const isActive = body.is_active ? 1 : 0

  if (isActive) {
    // Deactivate other seasons
    await execute(db, "UPDATE membership_years SET is_active = 0")
  }

  await execute(db, `
    INSERT INTO membership_years (season, start_date, end_date, fee_base, fee_full, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [body.season, body.start_date, body.end_date, body.fee_base, body.fee_full, isActive])

  // Update system setting for current_season just in case other parts of the app rely on it
  if (isActive) {
      await execute(db, "INSERT INTO system_settings (key, value) VALUES ('current_season', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [body.season, body.season])
  }

  return c.redirect('/admin/lidgelden')
})

// Create Single Membership
app.post('/api/admin/lidgelden/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // Get year details for fees
  const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [body.year_id])
  if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

  const amount = body.type === 'full' ? year.fee_full : year.fee_base
  const mockMollieId = 'tr_' + Math.random().toString(36).substr(2, 9)
  
  await execute(db, `
    INSERT INTO user_memberships (user_id, year_id, type, amount, status, mollie_payment_id)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `, [body.user_id, body.year_id, body.type, amount, mockMollieId])

  // #116 — Notificeer dit ene lid
  // BUG-FIX (Dominique): sluit eerst bestaande open lidgeld-notifs van deze
  // user (voorkomt dubbele meldingen na re-create of type/bedrag-wijziging).
  try {
    await execute(db,
      `UPDATE notifications
       SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
      [Number(body.user_id)])
    await notifyUser(
      db,
      c.env.RESEND_API_KEY,
      Number(body.user_id),
      'lidgeld',
      `Lidgeld ${year.season} (€${amount}) staat open`,
      `Type: ${body.type === 'full' ? 'Full (met papieren partituren)' : 'Basis (digitaal)'}`,
      '/leden/profiel#lidgeld'
    )
  } catch (e) { console.error('notify on single create failed:', e) }

  return c.redirect('/admin/lidgelden?season_id=' + body.year_id)
})

// Generate Bulk Memberships
app.post('/api/admin/lidgelden/generate-bulk', async (c) => {
    const body = await c.req.parseBody()
    const db = c.env.DB
    const yearId = body.season_id

    // Get year details
    const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [yearId])
    if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

    // Get all active users who don't have a membership for this year
    // Bug #200.1 — dirigent + pianist krijgen GEEN lidgeld. Ook bezoeker
    // en test-accounts uitsluiten zodat het bedrag/aantal klopt.
    const users = await queryAll(db, `
        SELECT id FROM users 
        WHERE status = 'actief' 
        AND role NOT IN ('bezoeker', 'dirigent', 'pianist')
        AND (is_test_account IS NULL OR is_test_account = 0)
        AND id NOT IN (SELECT user_id FROM user_memberships WHERE year_id = ?)
    `, [yearId])

    if (users.length === 0) return c.redirect('/admin/lidgelden?season_id=' + yearId + '&msg=no_users')

    // #112: standaard formule = basis (zonder papieren partituren).
    // Leden kunnen later upgraden naar 'full' als ze toch papieren partituren willen.
    const type = 'basis'
    const amount = year.fee_base

    // We'll do a loop for now as D1 batching in Hono might be tricky with `execute`.
    // Loop is fine for < 100 members.
    for (const u of users) {
        const mockMollieId = 'tr_' + Math.random().toString(36).substr(2, 9)
        await execute(db, `
            INSERT INTO user_memberships (user_id, year_id, type, amount, status, mollie_payment_id)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `, [u.id, yearId, type, amount, mockMollieId])
    }

    // #116 — Notificeer alle nieuwe lidgeld-leden in één batch
    // BUG-FIX (Dominique): sluit eerst alle bestaande open lidgeld-notifs van
    // de doelusers — voorkomt dubbele meldingen na re-generate.
    try {
      const userIds = (users as any[]).map((u: any) => u.id)
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(',')
        await execute(db,
          `UPDATE notifications
           SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
           WHERE user_id IN (${placeholders})
             AND type = 'lidgeld'
             AND is_gelezen = 0`,
          userIds)
      }
      await notifyUsers(
        db,
        c.env.RESEND_API_KEY,
        userIds,
        'lidgeld',
        `Lidgeld ${year.season} (€${amount}) staat open`,
        'Bekijk en betaal je lidgeld via je profiel — papieren partituren? upgrade naar Full.',
        '/leden/profiel#lidgeld'
      )
    } catch (e) { console.error('notify on bulk_generate failed:', e) }

    return c.redirect('/admin/lidgelden?season_id=' + yearId + '&success=bulk_generated&count=' + users.length)
})

// BULK SYNC: loop over alle pending lidgelden met een echte Mollie-ID en
// bevraag elk individueel bij Mollie. Stale 'pending' rijen — waar de webhook
// nooit doorkwam — worden zo alsnog op 'paid' gezet zodra Mollie bevestigt.
// Limiet: 50 per call om timeouts te voorkomen (Cloudflare CPU-budget).
app.post('/api/admin/lidgelden/sync-mollie-bulk', async (c) => {
  const db = c.env.DB
  const body = await c.req.parseBody().catch(() => ({} as any))
  const yearId = String((body as any).year_id || '')

  // Pak alle pending met echte Mollie-id (niet MOCK)
  let q = `SELECT um.id, um.user_id, um.year_id, um.amount, um.mollie_payment_id, my.season
           FROM user_memberships um
           JOIN membership_years my ON my.id = um.year_id
           WHERE um.status = 'pending'
             AND um.mollie_payment_id IS NOT NULL
             AND um.mollie_payment_id NOT LIKE 'tr_MOCK_%'`
  const params: any[] = []
  if (yearId) { q += ` AND um.year_id = ?`; params.push(yearId) }
  q += ` ORDER BY um.created_at DESC LIMIT 50`

  const rows = await queryAll<any>(db, q, params)

  const { getMolliePayment } = await import('../utils/mollie')
  const apiKey = await getMollieApiKey(c.env)

  let paidCount = 0, errorCount = 0, unchanged = 0, expiredReset = 0
  for (const m of rows) {
    try {
      const pmt = await getMolliePayment(apiKey, m.mollie_payment_id)
      if (!pmt) { errorCount++; continue }

      // BUG-FIX 2026-06-17: 'expired' en 'canceled'/'failed' bij Mollie betekenen
      // NIET dat het lidgeld geannuleerd is. Het betekent dat de éne Mollie-
      // betaaltransactie verlopen is — maar het lid moet nog steeds betalen
      // (alleen via een nieuwe link). Eerder gooiden we alles in 'cancelled',
      // waardoor 11 leden uit de Openstaand-tegel verdwenen en onzichtbaar
      // werden in alle KPI's.
      //
      // Nieuwe semantiek:
      //   Mollie 'paid'                    → lokaal 'paid'  (verwerk volledig)
      //   Mollie 'open'/'pending'          → lokaal 'pending' (geen wijziging)
      //   Mollie 'expired'/'canceled'/'failed' → lokaal 'pending' + reset
      //                                          mollie_payment_id zodat lid
      //                                          opnieuw een betaallink krijgt
      //                                          via /send-link
      //   Mollie 'authorized'              → lokaal 'pending' (nog niet captured)
      const ms = pmt.status
      let newStatus: 'paid' | 'pending' | 'cancelled'
      let resetMollieId = false
      if (ms === 'paid') {
        newStatus = 'paid'
      } else if (ms === 'open' || ms === 'pending' || ms === 'authorized') {
        newStatus = 'pending'
      } else if (ms === 'expired' || ms === 'canceled' || ms === 'failed') {
        // Belangrijk: terug op pending zetten EN mollie_payment_id resetten
        newStatus = 'pending'
        resetMollieId = true
      } else {
        // Onbekende Mollie status — speel safe en behandel als pending
        console.warn(`[bulk-sync] onbekende Mollie status '${ms}' voor membership ${m.id}, behandeld als pending`)
        newStatus = 'pending'
      }

      if (newStatus === 'pending' && !resetMollieId) { unchanged++; continue }

      if (resetMollieId) {
        await execute(db,
          `UPDATE user_memberships
           SET status = 'pending', mollie_payment_id = NULL, paid_at = NULL
           WHERE id = ?`,
          [m.id])
        expiredReset++
        continue
      }

      await execute(db,
        `UPDATE user_memberships
         SET status = ?, paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ?`,
        [newStatus, newStatus, m.id])

      if (newStatus === 'paid') {
        paidCount++
        // Sluit lidgeld-notifs + bevestiging (zoals webhook normaal zou doen)
        await execute(db,
          `UPDATE notifications
           SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
          [m.user_id])
        const bedrag = m.amount ? `€ ${Number(m.amount).toFixed(2)}` : ''
        await notifyUser(
          db, c.env.RESEND_API_KEY, m.user_id, 'lidgeld',
          `Lidgeld ${m.season} ontvangen — bedankt! 🎵`,
          bedrag ? `We hebben ${bedrag} ontvangen. Je lidmaatschap is actief.` : 'Je lidmaatschap is actief.',
          '/leden/profiel#lidgeld'
        )
      }
    } catch (e) {
      errorCount++
      console.error(`bulk-sync failed for membership ${m.id}:`, e)
    }
  }

  const params2 = new URLSearchParams({
    success: 'bulk_synced',
    paid: String(paidCount),
    unchanged: String(unchanged),
    errors: String(errorCount),
    expired_reset: String(expiredReset),
    checked: String(rows.length),
  })
  if (yearId) params2.set('season_id', yearId)
  return c.redirect(`/admin/lidgelden?${params2.toString()}`)
})

// Sync met Mollie — query de actuele payment status en update lokaal
// Handig wanneer de webhook niet aangekomen is (ontbrekende DNS, firewall,
// of Mollie heeft hem nog niet getriggerd in test-mode)
app.post('/api/admin/lidgelden/sync-mollie', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const membershipId = String(body.membership_id || '')
  if (!membershipId) return c.redirect('/admin/lidgelden?error=missing_id')

  const m = await queryOne<any>(db,
    `SELECT um.id, um.user_id, um.year_id, um.amount, um.status, um.mollie_payment_id, my.season
     FROM user_memberships um
     JOIN membership_years my ON my.id = um.year_id
     WHERE um.id = ?`,
    [membershipId])

  if (!m) return c.redirect('/admin/lidgelden?error=not_found')
  if (!m.mollie_payment_id || String(m.mollie_payment_id).startsWith('tr_MOCK_')) {
    return c.redirect(`/admin/lidgelden?season_id=${m.year_id}&error=no_mollie_id`)
  }

  try {
    const { getMolliePayment } = await import('../utils/mollie')
    const apiKey = await getMollieApiKey(c.env)
    const molliePmt = await getMolliePayment(apiKey, m.mollie_payment_id)

    if (!molliePmt) {
      return c.redirect(`/admin/lidgelden?season_id=${m.year_id}&error=mollie_not_found`)
    }

    // BUG-FIX 2026-06-17: identieke mapping als in bulk-sync. Mollie 'expired'
    // betekent dat de betaaltransactie verlopen is — niet dat het lidgeld
    // geannuleerd is. We resetten dan mollie_payment_id zodat een nieuwe
    // link kan worden aangemaakt.
    const ms = molliePmt.status
    let newStatus: 'paid' | 'pending' | 'cancelled' = 'pending'
    let resetMollieId = false
    if (ms === 'paid') {
      newStatus = 'paid'
    } else if (ms === 'open' || ms === 'pending' || ms === 'authorized') {
      newStatus = 'pending'
    } else if (ms === 'expired' || ms === 'canceled' || ms === 'failed') {
      newStatus = 'pending'
      resetMollieId = true
    }

    if (resetMollieId) {
      await execute(db,
        `UPDATE user_memberships
         SET status = 'pending', mollie_payment_id = NULL, paid_at = NULL
         WHERE id = ?`,
        [m.id])
    } else {
      await execute(db,
        `UPDATE user_memberships
         SET status = ?, paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ?`,
        [newStatus, newStatus, m.id])
    }

    if (newStatus === 'paid') {
      // Sluit lidgeld-notifs + bevestiging
      await execute(db,
        `UPDATE notifications
         SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
        [m.user_id])
      const bedrag = m.amount ? `€ ${Number(m.amount).toFixed(2)}` : ''
      await notifyUser(
        db, c.env.RESEND_API_KEY, m.user_id, 'lidgeld',
        `Lidgeld ${m.season} ontvangen — bedankt! 🎵`,
        bedrag ? `We hebben ${bedrag} ontvangen. Je lidmaatschap is actief.` : 'Je lidmaatschap is actief.',
        '/leden/profiel#lidgeld'
      )
    }

    return c.redirect(`/admin/lidgelden?season_id=${m.year_id}&success=synced&mollie_status=${molliePmt.status}`)
  } catch (e: any) {
    console.error('sync-mollie failed:', e)
    return c.redirect(`/admin/lidgelden?season_id=${m.year_id}&error=sync_failed`)
  }
})

// Toggle Status (Paid/Pending)
app.post('/api/admin/lidgelden/status', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  await execute(db, `
    UPDATE user_memberships
    SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id = ?
  `, [body.status, body.status, body.membership_id])

  // BUG-FIX: bij handmatig 'paid' zetten — sluit lidgeld-notifs + bevestig
  if (body.status === 'paid') {
    try {
      const m = await queryOne<any>(db,
        `SELECT um.user_id, um.amount, my.season
         FROM user_memberships um
         JOIN membership_years my ON my.id = um.year_id
         WHERE um.id = ?`,
        [body.membership_id])
      if (m) {
        await execute(db,
          `UPDATE notifications
           SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
          [m.user_id])
        const bedrag = m.amount ? `€ ${Number(m.amount).toFixed(2)}` : ''
        await notifyUser(
          db,
          c.env.RESEND_API_KEY,
          m.user_id,
          'lidgeld',
          `Lidgeld ${m.season} geregistreerd — bedankt! 🎵`,
          bedrag ? `${bedrag} geboekt door het bestuur. Je lidmaatschap is actief.` : 'Je lidmaatschap is actief.',
          '/leden/profiel#lidgeld'
        )
      }
    } catch (e) { console.error('lidgeld status->paid notif cleanup failed:', e) }
  }

  // Get referer to redirect back to correct season
  return c.redirect('/admin/lidgelden')
})

// #111: Update formule (basis ↔ full) — bedrag automatisch aanpassen aan seizoen-tarief
app.post('/api/admin/lidgelden/update-type', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const membershipId = body.membership_id
  const newType = body.type === 'full' ? 'full' : 'basis'

  // Haal het seizoen op via membership om correct bedrag te berekenen
  const membership = await queryOne<any>(db,
    `SELECT m.id, m.year_id, m.status, y.fee_base, y.fee_full
     FROM user_memberships m
     JOIN membership_years y ON y.id = m.year_id
     WHERE m.id = ?`,
    [membershipId])

  if (!membership) return c.redirect('/admin/lidgelden?error=membership_not_found')

  const newAmount = newType === 'full' ? membership.fee_full : membership.fee_base

  // Bedrag enkel aanpassen wanneer nog niet betaald — anders enkel type updaten en log toevoegen
  if (membership.status === 'paid') {
    await execute(db, `UPDATE user_memberships SET type = ? WHERE id = ?`, [newType, membershipId])
  } else {
    await execute(db, `UPDATE user_memberships SET type = ?, amount = ? WHERE id = ?`, [newType, newAmount, membershipId])
    // BUG-FIX (Dominique): bij type/bedrag-wijziging hangen er nog 'oude' lidgeld-notifs
    // in de DB met het verouderde bedrag — markeer als gelezen zodat het lid niet
    // meerdere meldingen met verschillende bedragen ziet.
    try {
      const uidRow = await queryOne<any>(db, `SELECT user_id FROM user_memberships WHERE id = ?`, [membershipId])
      if (uidRow?.user_id) {
        await execute(db,
          `UPDATE notifications
           SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
          [uidRow.user_id])
      }
    } catch (e) { console.error('cleanup old lidgeld notifs after update-type failed:', e) }
  }

  return c.redirect('/admin/lidgelden?season_id=' + membership.year_id + '&success=type_updated')
})

// #111: Bedrag aanpassen (admin) — bv. korting, bijbetaling, correctie
app.post('/api/admin/lidgelden/update-amount', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const membershipId = body.membership_id
  const rawAmount = String(body.amount || '').replace(',', '.')
  const newAmount = parseFloat(rawAmount)

  if (isNaN(newAmount) || newAmount < 0 || newAmount > 9999) {
    return c.redirect('/admin/lidgelden?error=invalid_amount')
  }

  const m = await queryOne<any>(db, `SELECT year_id, status FROM user_memberships WHERE id = ?`, [membershipId])
  if (!m) return c.redirect('/admin/lidgelden?error=membership_not_found')

  // Reeds betaald → bedrag staat vast, niet meer wijzigen
  if (m.status === 'paid') {
    return c.redirect('/admin/lidgelden?season_id=' + m.year_id + '&error=already_paid')
  }

  await execute(db,
    `UPDATE user_memberships SET amount = ?, mollie_payment_url = NULL WHERE id = ?`,
    [newAmount, membershipId])

  // BUG-FIX (Dominique): zie update-type — sluit stale lidgeld-notifs
  try {
    const uidRow = await queryOne<any>(db, `SELECT user_id FROM user_memberships WHERE id = ?`, [membershipId])
    if (uidRow?.user_id) {
      await execute(db,
        `UPDATE notifications
         SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
        [uidRow.user_id])
    }
  } catch (e) { console.error('cleanup old lidgeld notifs after update-amount failed:', e) }

  return c.redirect('/admin/lidgelden?season_id=' + m.year_id + '&success=amount_updated')
})

// #111: Verwijder een lidmaatschap (admin)
app.post('/api/admin/lidgelden/delete', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const membershipId = body.membership_id

  // Bewaar season_id zodat we terug naar dezelfde view kunnen redirecten
  const m = await queryOne<any>(db, `SELECT year_id FROM user_memberships WHERE id = ?`, [membershipId])
  await execute(db, `DELETE FROM user_memberships WHERE id = ?`, [membershipId])

  return c.redirect('/admin/lidgelden' + (m?.year_id ? '?season_id=' + m.year_id + '&success=deleted' : '?success=deleted'))
})

// Send Payment Link
app.post('/api/admin/lidgelden/send-link', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  
  // Get membership details
  const membership = await queryOne<any>(db, `
    SELECT um.*, u.email, p.voornaam, my.season
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    JOIN membership_years my ON um.year_id = my.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.id = ?
  `, [body.membership_id])

  if (!membership || membership.status === 'paid') return c.redirect('/admin/lidgelden')

  // Generate Payment Link (if not exists)
  const siteUrl = await getSiteUrl(c)
  let paymentUrl = membership.mollie_payment_url

  if (!paymentUrl) {
    // Referentie + naam zodat de penningmeester in Mollie en op het
    // bankafschrift in één oogopslag ziet wie betaald heeft.
    const paymentRef = `LID-${membership.season}-M${membership.id}`
    const payerName = `${membership.voornaam || ''} ${membership.achternaam || ''}`.trim() || membership.email
    const formuleLabel = membership.type === 'full' ? 'Full + Partituren' : 'Basis'
    const payment = await createMolliePayment(await getMollieApiKey(c.env), {
      amount: membership.amount,
      description: `${payerName} — Lidgeld Animato ${membership.season} (${formuleLabel}) [${paymentRef}]`,
      redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
      webhookUrl: `${siteUrl}/api/webhooks/mollie`,
      metadata: {
        membership_id: membership.id,
        type: 'membership',
        payer_name: payerName,
        payment_ref: paymentRef
      }
    })
    
    paymentUrl = payment.checkoutUrl
    
    // Save URL
    await execute(db, `UPDATE user_memberships SET mollie_payment_url = ? WHERE id = ?`, [paymentUrl, membership.id])
  }

  // Send Email
  const emailHtml = `
    <h1>Betaalverzoek Lidgeld ${membership.season}</h1>
    <p>Beste ${membership.voornaam},</p>
    <p>Hierbij ontvang je de betaallink voor je lidmaatschap (${membership.type === 'full' ? 'Met Partituren' : 'Basis'}).</p>
    <p><strong>Bedrag: €${membership.amount.toFixed(2)}</strong></p>
    <p>
      <a href="${paymentUrl}" style="background-color: #00A9CE; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Betaal nu via Mollie
      </a>
    </p>
    <p>Of kopieer deze link: ${paymentUrl}</p>
    <p>Met muzikale groet,<br>Het Bestuur</p>
  `

  await sendEmail({
    to: membership.email,
    subject: `Lidgeld ${membership.season} - Betaalverzoek`,
    html: emailHtml
  }, c.env.RESEND_API_KEY)

  return c.redirect('/admin/lidgelden?sent=true')
})

app.post('/api/admin/lidgelden/remind', async (c) => {
  // In a real app, this would send an email with the payment link
  return c.redirect('/admin/lidgelden?sent=true')
})

// === Reset Season — verwijdert alle user_memberships voor één seizoen ===
// Confirmatie via typed seizoennaam (extra veiligheid)
app.post('/api/admin/lidgelden/reset-season', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const seasonId = body.season_id
  const confirmSeason = String(body.confirm_season || '').trim()

  // Verifieer seizoen + bevestiging
  const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [seasonId])
  if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

  if (confirmSeason !== year.season) {
    return c.redirect(`/admin/lidgelden?season_id=${seasonId}&error=confirm_mismatch`)
  }

  // Bug #201 — server-side guard: nooit archief-seizoenen wissen.
  // Beschermt historische data ook tegen een directe POST (bv. browser-history,
  // CSRF-replay, of admin die op de verkeerde knop klikt na seizoenwissel).
  if (!year.is_active) {
    return c.redirect(`/admin/lidgelden?season_id=${seasonId}&error=archive_locked`)
  }

  // Tellen voor de feedback message
  const before = await queryOne<any>(db, "SELECT COUNT(*) as c FROM user_memberships WHERE year_id = ?", [seasonId])
  const count = before?.c || 0

  // Verzamel de user_ids die geraakt worden zodat we hun dangling
  // lidgeld-notifs kunnen opruimen voordat we de memberships zelf wissen.
  // Zonder deze stap blijven oude "Lidgeld staat open"-notifs hangen na een
  // reset → leden klikken erop → komen op /leden/profiel#lidgeld → vinden
  // geen betaalknop want hun row is weg → "kon niet betalen". Bug (Dominique, 23 mei).
  const affectedUsers = await queryAll<any>(db,
    "SELECT DISTINCT user_id FROM user_memberships WHERE year_id = ?",
    [seasonId])

  // Verwijder alle memberships voor dit seizoen
  await execute(db, "DELETE FROM user_memberships WHERE year_id = ?", [seasonId])

  // Markeer alle open lidgeld-notifs van deze leden als gelezen — verwijderen
  // zou hun "Alles"-tab geschiedenis aantasten. is_gelezen=1 houdt ze in archief
  // maar weg uit de openstaande-widget en de bel-badge.
  try {
    if (affectedUsers.length > 0) {
      const userIds = affectedUsers.map((u: any) => u.user_id)
      const placeholders = userIds.map(() => '?').join(',')
      await execute(db,
        `UPDATE notifications
         SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
         WHERE user_id IN (${placeholders})
           AND type = 'lidgeld'
           AND is_gelezen = 0`,
        userIds)
    }
  } catch (e) {
    console.error('reset-season: opruimen lidgeld-notifs faalde:', e)
  }

  return c.redirect(`/admin/lidgelden?season_id=${seasonId}&success=reset&count=${count}`)
})

// === CSV EXPORT — gefilterde of volledige lijst ===
app.get('/api/admin/lidgelden/export', async (c) => {
  const db = c.env.DB
  const seasonId = c.req.query('season_id')
  const filter = c.req.query('filter') || 'all'

  if (!seasonId) return c.text('season_id required', 400)

  const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [seasonId])
  if (!year) return c.text('season not found', 404)

  const rows = await queryAll<any>(db, `
    SELECT um.*, u.email, p.voornaam, p.achternaam, p.telefoon
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.year_id = ?
    ORDER BY p.achternaam
  `, [seasonId])

  // Verrijken met days_open / days_to_pay (zelfde logica als view)
  const now = Date.now()
  const DAY = 86400000
  const enriched = (rows as any[]).map(m => {
    const created = m.created_at ? new Date(m.created_at).getTime() : now
    const paid = m.status === 'paid' && m.paid_at ? new Date(m.paid_at).getTime() : null
    return {
      ...m,
      daysToPay: paid ? Math.max(0, Math.round((paid - created) / DAY)) : null,
      daysOpen: !paid ? Math.max(0, Math.round((now - created) / DAY)) : 0,
    }
  })

  // Filter toepassen
  let filtered = enriched
  if (filter === 'paid') filtered = enriched.filter(m => m.status === 'paid')
  else if (filter === 'pending') filtered = enriched.filter(m => m.status === 'pending')
  else if (filter === 'fast') filtered = enriched.filter(m => m.status === 'paid' && m.daysToPay !== null && m.daysToPay <= 7)
  else if (filter === 'slow') filtered = enriched.filter(m => m.status === 'paid' && m.daysToPay !== null && m.daysToPay > 30)
  else if (filter === 'overdue') filtered = enriched.filter(m => m.status === 'pending' && m.daysOpen > 30)
  else if (filter === 'basis') filtered = enriched.filter(m => m.type === 'basis')
  else if (filter === 'full') filtered = enriched.filter(m => m.type === 'full')

  // CSV bouwen — Excel-compatibel met BOM voor accenten
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return /[",;\n]/.test(s) ? `"${s}"` : s
  }
  const headers = [
    'Voornaam', 'Achternaam', 'Email', 'Telefoon',
    'Seizoen', 'Formule', 'Bedrag', 'Status',
    'Aangemaakt op', 'Betaald op',
    'Dagen tot betaling', 'Dagen open',
    'Mollie Payment ID'
  ]
  const lines = [headers.join(';')]
  for (const m of filtered) {
    lines.push([
      escape(m.voornaam),
      escape(m.achternaam),
      escape(m.email),
      escape(m.telefoon),
      escape(year.season),
      escape(m.type === 'full' ? 'Full (+partituren)' : 'Basis (digitaal)'),
      escape(typeof m.amount === 'number' ? m.amount.toFixed(2).replace('.', ',') : m.amount),
      escape(m.status === 'paid' ? 'Betaald' : 'Openstaand'),
      escape(m.created_at ? formatBrusselsDate(m.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''),
      escape(m.paid_at ? formatBrusselsDate(m.paid_at, { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''),
      escape(m.daysToPay !== null ? m.daysToPay : ''),
      escape(m.daysOpen || ''),
      escape(m.mollie_payment_id || ''),
    ].join(';'))
  }
  const csv = '\uFEFF' + lines.join('\r\n')

  const dateStamp = brusselsToday()
  const filename = `lidgelden_${year.season}_${filter}_${dateStamp}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
})

// === BULK REMINDER — verstuur betaallinks naar alle pending of overdue leden ===
app.post('/api/admin/lidgelden/bulk-remind', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB
  const seasonId = body.season_id
  const filter = String(body.filter || 'pending')

  if (!seasonId) return c.redirect('/admin/lidgelden?error=missing_season')

  const year = await queryOne<any>(db, "SELECT * FROM membership_years WHERE id = ?", [seasonId])
  if (!year) return c.redirect('/admin/lidgelden?error=year_not_found')

  // Selecteer enkel openstaande memberships
  const rows = await queryAll<any>(db, `
    SELECT um.*, u.email, p.voornaam, p.achternaam
    FROM user_memberships um
    JOIN users u ON um.user_id = u.id
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE um.year_id = ? AND um.status = 'pending'
  `, [seasonId])

  // Bij filter=overdue: alleen die >30 dagen open zijn
  const now = Date.now()
  const DAY = 86400000
  const targets = (rows as any[]).filter(m => {
    if (filter !== 'overdue') return true
    const created = m.created_at ? new Date(m.created_at).getTime() : now
    return (now - created) / DAY > 30
  })

  const siteUrl = await getSiteUrl(c)
  const apiKey = await getMollieApiKey(c.env)
  let sent = 0
  let failed = 0

  for (const m of targets) {
    try {
      let paymentUrl = m.mollie_payment_url

      // Maak Mollie-link aan indien nog niet bestaat
      if (!paymentUrl) {
        const payment = await createMolliePayment(apiKey, {
          amount: m.amount,
          description: `Lidgeld Animato ${year.season} - ${m.type}`,
          redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
          webhookUrl: `${siteUrl}/api/webhooks/mollie`,
          metadata: { membership_id: m.id, type: 'membership' }
        })
        paymentUrl = payment.checkoutUrl
        await execute(db, `UPDATE user_memberships SET mollie_payment_url = ?, mollie_payment_id = ? WHERE id = ?`, [paymentUrl, payment.id, m.id])
      }

      const subject = filter === 'overdue'
        ? `⏰ Herinnering: lidgeld ${year.season} staat nog open`
        : `Lidgeld ${year.season} - betaalverzoek`

      const html = `
        <h2>Beste ${m.voornaam || 'lid'},</h2>
        <p>Hierbij een ${filter === 'overdue' ? '<strong>vriendelijke herinnering</strong>' : 'verzoek'} voor je lidgeld voor seizoen <strong>${year.season}</strong>.</p>
        <p><strong>Bedrag: €${(m.amount || 0).toFixed(2)}</strong> — ${m.type === 'full' ? 'Full (met papieren partituren)' : 'Basis (digitaal)'}</p>
        <p style="margin: 24px 0;">
          <a href="${paymentUrl}" style="background-color: #00A9CE; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            💳 Betaal nu via Mollie
          </a>
        </p>
        <p style="color:#666; font-size: 13px;">Of kopieer deze link in je browser:<br>${paymentUrl}</p>
        <p>Vragen? Antwoord gewoon op deze mail.</p>
        <p>Met muzikale groet,<br>Het Bestuur — Gemengd Koor Animato</p>
      `

      await sendEmail({ to: m.email, subject, html }, c.env.RESEND_API_KEY)

      // Notificatie ook in-app
      // BUG-FIX (Claudine, 23 mei): sluit eerst alle bestaande open lidgeld-notifs
      // van deze user voordat we een nieuwe maken — anders blijft de oude
      // staan en krijgt het lid 2 (of meer) "openstaande" meldingen voor
      // hetzelfde lidgeld.
      try {
        await execute(db,
          `UPDATE notifications
           SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
          [m.user_id])
        await notifyUser(db, c.env.RESEND_API_KEY, m.user_id, 'lidgeld',
          filter === 'overdue' ? '⏰ Herinnering lidgeld open' : 'Lidgeld betaalverzoek verstuurd',
          `Bekijk je mailbox voor de betaallink — bedrag €${(m.amount||0).toFixed(2)}`,
          '/leden/profiel#lidgeld'
        )
      } catch (_) {}

      sent++
    } catch (err) {
      console.error('bulk-remind failed for membership', m.id, err)
      failed++
    }
  }

  return c.redirect(`/admin/lidgelden?season_id=${seasonId}&success=bulk_reminded&count=${sent}${failed > 0 ? '&failed=' + failed : ''}`)
})

// =============================================================================
// MOLLIE WEBHOOK LOG — diagnose-pagina
// =============================================================================
// Toont de laatste 100 webhook-calls die we van Mollie ontvingen. Cruciaal
// voor het beantwoorden van "waarom blijft mijn lidgeld pending?":
// - Lege tabel = Mollie bereikt ons NIET (DNS/firewall/wrong webhook URL)
// - Wel rows maar errors = onze handler crasht
// - Rows met paid + matching action = alles werkt zoals het hoort
app.get('/admin/mollie-webhook-log', async (c) => {
  const user = c.get('user') as any
  const db = c.env.DB

  const rows = await queryAll<any>(db,
    `SELECT id, payment_id, payment_type, mollie_status, local_action,
            http_status, error_message, raw_body, created_at
     FROM mollie_webhook_log
     ORDER BY created_at DESC, id DESC
     LIMIT 100`
  )

  const totalToday = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM mollie_webhook_log WHERE created_at >= datetime('now', '-1 day')`
  )
  const errorsToday = await queryOne<any>(db,
    `SELECT COUNT(*) as n FROM mollie_webhook_log
     WHERE created_at >= datetime('now', '-1 day') AND (http_status >= 400 OR error_message IS NOT NULL)`
  )

  return c.html(
    <Layout title="Mollie Webhook Log" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="finance" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-clipboard-list text-animato-primary"></i>
                Mollie Webhook Log
              </h1>
              <p class="text-gray-600 mt-1">Diagnose: bereikt Mollie ons met betalingsbevestigingen?</p>
            </div>
            <a href="/admin/lidgelden" class="text-sm text-gray-600 hover:text-gray-800">
              <i class="fas fa-arrow-left mr-1"></i> Terug naar Lidgelden
            </a>
          </div>

          {/* Stats */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="bg-white p-4 rounded shadow border-l-4 border-blue-500">
              <p class="text-gray-500 text-sm">Calls vandaag</p>
              <p class="text-2xl font-bold">{totalToday?.n || 0}</p>
            </div>
            <div class={`bg-white p-4 rounded shadow border-l-4 ${(errorsToday?.n || 0) > 0 ? 'border-red-500' : 'border-green-500'}`}>
              <p class="text-gray-500 text-sm">Errors vandaag</p>
              <p class="text-2xl font-bold">{errorsToday?.n || 0}</p>
            </div>
            <div class="bg-white p-4 rounded shadow border-l-4 border-gray-500">
              <p class="text-gray-500 text-sm">Webhook URL</p>
              <p class="text-xs font-mono break-all text-gray-700">https://animato-live.pages.dev/api/webhooks/mollie</p>
            </div>
          </div>

          {/* Diagnosis hints */}
          {(!rows || rows.length === 0) && (
            <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
              <h3 class="font-semibold text-amber-900 mb-2"><i class="fas fa-exclamation-triangle mr-2"></i>Nog geen webhook-calls ontvangen</h3>
              <p class="text-sm text-amber-800 mb-2">Mogelijke oorzaken:</p>
              <ul class="text-sm text-amber-800 list-disc list-inside space-y-1">
                <li>Er werd nog geen echte betaling via Mollie gestart sinds de live-key actief is</li>
                <li>De Mollie betaling is wel gestart maar nog niet afgerond door de klant</li>
                <li>Mollie's test-betalingen worden pas afgerond na klikken in het test-dashboard</li>
                <li>Webhook-URL onbereikbaar voor Mollie (zou bij Mollie zichtbaar zijn als 'failed webhook')</li>
              </ul>
              <p class="text-sm text-amber-800 mt-3">
                <strong>Tip:</strong> doe een echte test-betaling van 0,01 € met een live-key om dit te valideren.
              </p>
            </div>
          )}

          {/* Log table */}
          <div class="bg-white rounded shadow overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-4 py-2 font-semibold text-gray-700">Tijd</th>
                  <th class="text-left px-4 py-2 font-semibold text-gray-700">Payment ID</th>
                  <th class="text-left px-4 py-2 font-semibold text-gray-700">Type</th>
                  <th class="text-left px-4 py-2 font-semibold text-gray-700">Mollie status</th>
                  <th class="text-left px-4 py-2 font-semibold text-gray-700">Lokale actie</th>
                  <th class="text-center px-4 py-2 font-semibold text-gray-700">HTTP</th>
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((r: any) => (
                  <tr class={`border-b ${(r.http_status >= 400 || r.error_message) ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td class="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{r.created_at}</td>
                    <td class="px-4 py-2 font-mono text-xs">{r.payment_id || '—'}</td>
                    <td class="px-4 py-2 text-xs">{r.payment_type || '—'}</td>
                    <td class="px-4 py-2 text-xs">
                      {r.mollie_status === 'paid' && <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded">paid</span>}
                      {r.mollie_status === 'open' && <span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">open</span>}
                      {r.mollie_status && r.mollie_status !== 'paid' && r.mollie_status !== 'open' && (
                        <span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">{r.mollie_status}</span>
                      )}
                      {!r.mollie_status && <span class="text-gray-400">—</span>}
                    </td>
                    <td class="px-4 py-2 text-xs">
                      {r.local_action || (r.error_message ? <span class="text-red-700">{r.error_message}</span> : '—')}
                    </td>
                    <td class="px-4 py-2 text-center">
                      <span class={`text-xs font-mono ${r.http_status >= 400 ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                        {r.http_status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p class="text-xs text-gray-500 mt-4">
            <i class="fas fa-info-circle mr-1"></i>
            Toont de laatste 100 calls. Calls worden permanent bewaard tot manuele cleanup.
          </p>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================================
// DONATIONS ADMIN ENDPOINTS
// =====================================================================

// CSV export — alle donations met donor-info en publiek/lid/anoniem onderscheid
app.get('/api/admin/donations/export', async (c) => {
  const db = c.env.DB
  const rows = await queryAll<any>(db, `
    SELECT d.id, d.user_id, d.amount, d.message, d.is_anonymous, d.status,
           d.payment_provider, d.payment_id, d.created_at,
           u.email AS donor_email,
           p.voornaam AS donor_voornaam, p.achternaam AS donor_achternaam,
           p.telefoon AS donor_telefoon
    FROM donations d
    LEFT JOIN users u ON d.user_id = u.id
    LEFT JOIN profiles p ON d.user_id = p.user_id
    ORDER BY d.created_at DESC
  `)

  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return /[",;\n]/.test(s) ? `"${s}"` : s
  }
  // Parse "[Publiek: Naam <email>]" prefix
  const parsePub = (msg: string | null) => {
    if (!msg) return null
    const m = msg.match(/^\[Publiek:\s*([^<]+?)\s*<([^>]+)>\]\s*(.*)$/s)
    if (!m) return null
    return { name: m[1].trim(), email: m[2].trim(), cleanMsg: m[3].trim() }
  }

  const headers = [
    'ID', 'Type', 'Voornaam', 'Achternaam', 'Email', 'Telefoon',
    'Bedrag', 'Boodschap', 'Anoniem', 'Status',
    'Provider', 'Payment ID', 'Aangemaakt op'
  ]
  const lines = [headers.join(';')]
  for (const d of (rows as any[])) {
    const pub = parsePub(d.message)
    let type = ''
    let voornaam = ''
    let achternaam = ''
    let email = ''
    let telefoon = ''
    let cleanMsg = d.message || ''

    if (d.user_id && d.donor_voornaam) {
      type = 'Lid'
      voornaam = d.donor_voornaam || ''
      achternaam = d.donor_achternaam || ''
      email = d.donor_email || ''
      telefoon = d.donor_telefoon || ''
    } else if (pub) {
      type = 'Publiek'
      // "Naam" splitsen naar voor/achternaam (eerste spatie)
      const parts = pub.name.split(/\s+/)
      voornaam = parts[0] || ''
      achternaam = parts.slice(1).join(' ') || ''
      email = pub.email
      cleanMsg = pub.cleanMsg
    } else if (d.is_anonymous) {
      type = 'Anoniem'
    } else {
      type = 'Onbekend'
    }

    lines.push([
      escape(d.id),
      escape(type),
      escape(voornaam),
      escape(achternaam),
      escape(email),
      escape(telefoon),
      escape(Number(d.amount).toFixed(2)),
      escape(cleanMsg),
      escape(d.is_anonymous ? 'Ja' : 'Nee'),
      escape(d.status),
      escape(d.payment_provider),
      escape(d.payment_id),
      escape(d.created_at),
    ].join(';'))
  }

  // BOM voor Excel-compatibiliteit (UTF-8 accenten)
  const csv = '\uFEFF' + lines.join('\n')
  const today = brusselsToday()
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="giften-${today}.csv"`,
    }
  })
})

// Bulk-sync openstaande donations met Mollie — analoog aan lidgelden bulk-sync
// Pakt alle pending donations met een echte (niet-MOCK) Mollie payment_id en
// queryt elk individueel. Updated lokale status indien Mollie 'paid' meldt.
app.post('/api/admin/donations/sync-mollie-bulk', async (c) => {
  const db = c.env.DB

  // Pak alle pending met echte Mollie-id (niet MOCK)
  const rows = await queryAll<any>(db, `
    SELECT id, user_id, amount, payment_id, message
    FROM donations
    WHERE status = 'pending'
      AND payment_id IS NOT NULL
      AND payment_id NOT LIKE 'tr_MOCK_%'
      AND payment_provider = 'mollie'
    ORDER BY created_at DESC
    LIMIT 50
  `)

  const { getMolliePayment } = await import('../utils/mollie')
  const apiKey = await getMollieApiKey(c.env)

  let paidCount = 0, errorCount = 0, unchanged = 0
  for (const d of (rows as any[])) {
    try {
      const pmt = await getMolliePayment(apiKey, d.payment_id)
      if (!pmt) { errorCount++; continue }

      const newStatus = pmt.status === 'paid' ? 'paid'
                      : pmt.status === 'open' ? 'pending'
                      : pmt.status === 'pending' ? 'pending'
                      : 'cancelled'

      if (newStatus === 'pending') { unchanged++; continue }

      await execute(db,
        `UPDATE donations SET status = ? WHERE id = ?`,
        [newStatus, d.id])

      if (newStatus === 'paid') {
        paidCount++
        // Bedank-notif voor leden (publieke giften hebben user_id=null → skip)
        if (d.user_id) {
          const bedrag = d.amount ? `€ ${Number(d.amount).toFixed(2)}` : ''
          try {
            await notifyUser(
              db, c.env.RESEND_API_KEY, d.user_id, 'gift',
              `Bedankt voor je gift! 💝`,
              bedrag ? `We hebben ${bedrag} ontvangen — heel hartelijk bedankt voor je steun!` : 'Bedankt voor je steun!',
              '/leden/donaties'
            )
          } catch (e) {
            console.error('donations sync: notifyUser faalde:', e)
          }
        }
      }
    } catch (e) {
      errorCount++
      console.error(`donations bulk-sync failed for donation ${d.id}:`, e)
    }
  }

  const params = new URLSearchParams({
    success: 'donations_synced',
    paid: String(paidCount),
    unchanged: String(unchanged),
    errors: String(errorCount),
    checked: String(rows.length),
  })
  return c.redirect(`/admin/lidgelden?${params.toString()}`)
})

export default app
