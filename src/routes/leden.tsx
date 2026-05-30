// Ledenportaal routes
// Dashboard, Materiaal, Messageboard, Profiel

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll, execute } from '../utils/db'
import { createMolliePayment } from '../utils/mollie'
import { getMollieApiKey } from '../utils/mollie-config'
import { processBodyLinks } from '../utils/text'
import { getNotificationsForUser, getUnreadCount, markAsRead, markAllAsRead, getNotificationStyle, notifyUserIfEnabled, getUserNotificationPrefs, setUserNotificationPrefs } from '../utils/notifications'
import type { NotificationType } from '../utils/notifications'
import { pickSpotlight } from '../utils/spotlight'
import { formatBrusselsDateTime } from '../utils/time'

const app = new Hono<{ Bindings: Bindings }>()

// Default cartoon avatars per stemgroep (famous singers!)
function getDefaultAvatar(stemgroep: string): string {
  switch (stemgroep) {
    case 'S': return '/static/avatars/sopraan-callas.png'     // Maria Callas
    case 'A': return '/static/avatars/alt-bartoli.png'        // Cecilia Bartoli
    case 'T': return '/static/avatars/tenor-pavarotti.png'    // Luciano Pavarotti
    case 'B': return '/static/avatars/bas-terfel.png'         // Bryn Terfel
    default:  return '/static/avatars/tenor-pavarotti.png'    // Pavarotti als default
  }
}

// Apply auth middleware to all leden routes
app.use('*', requireAuth)

// Check impersonation status on every leden request
app.use('*', async (c, next) => {
  const impersonating = !!getCookie(c, 'admin_impersonate_token')
  c.set('impersonating' as any, impersonating)
  await next()
})

// Stop impersonating - restore admin session
// Uses /leden/ path so it's NOT blocked by admin role middleware
app.get('/leden/stop-impersonate', async (c) => {
  // Bug #158: gebruik Hono's getCookie i.p.v. regex op header — robuuster
  // en consistent met de rest van de codebase
  const adminToken = getCookie(c, 'admin_impersonate_token')

  if (adminToken) {
    // Promoveer gestashte admin-sessie terug naar de live sessie
    setCookie(c, 'auth_token', adminToken, {
      maxAge: 7 * 24 * 60 * 60,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/'
    })
    setCookie(c, 'admin_impersonate_token', '', {
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/'
    })
    return c.redirect('/admin')
  }

  // Bug #158: geen impersonate-token meer (cookie verlopen, gewist, of nooit
  // gezet) — admin-sessie is dan onherstelbaar. Vriendelijke re-login i.p.v.
  // een verwarrende redirect naar /admin waar de gebruiker dan vastloopt op
  // een 403 (want hij is nog steeds ingelogd als 'lid' via auth_token).
  // Wis ook auth_token zodat er geen halve sessie blijft hangen.
  setCookie(c, 'auth_token', '', {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/'
  })
  return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Bekijk-als-lid afgesloten</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <i class="fas fa-user-check text-amber-500 text-5xl mb-4"></i>
        <h1 class="text-2xl font-bold text-gray-800 mb-2">Bekijk-als-lid afgesloten</h1>
        <p class="text-gray-600 mb-2">Je beheerderssessie is intussen verlopen. Log opnieuw in om verder te gaan.</p>
        <p class="text-gray-500 text-sm mb-6">Dit gebeurt als de "Bekijk als lid"-tab langer dan 7 dagen open stond.</p>
        <a href="/login?redirect=/admin" class="inline-block px-6 py-3 text-white rounded-lg font-medium hover:opacity-90 transition" style="background-color:#00A9CE">
          <i class="fas fa-sign-in-alt mr-2"></i>Opnieuw inloggen als admin
        </a>
      </div>
    </body></html>`, 401)
})

// =====================================================
// LEDENPORTAAL DASHBOARD
// =====================================================

app.get('/leden', async (c) => {
  const user = c.get('user') as SessionUser
  const welcome = c.req.query('welcome')

  // Birthday helpers
  function getBirthdayWeekRange(): { start: string; end: string } {
    const now = new Date()
    // Use Monday-to-Sunday of the current week (Belgium time = UTC+1/+2)
    // Shift +2h to align with Belgian time zone before calculating weekday
    const be = new Date(now.getTime() + 2 * 60 * 60 * 1000) // approx CEST
    const day = be.getUTCDay() // 0=Sun, 1=Mon, ...
    const diffToMon = (day === 0 ? -6 : 1 - day)
    const mon = new Date(be); mon.setUTCDate(be.getUTCDate() + diffToMon)
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    const fmt = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
    return { start: fmt(mon), end: fmt(sun) }
  }
  const bwRange = getBirthdayWeekRange()

  // Members with birthdays this week (MM-DD comparison on geboortedatum)
  const birthdayMembers = await queryAll<any>(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.geboortedatum
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief'
       AND p.geboortedatum IS NOT NULL
       AND strftime('%m-%d', p.geboortedatum) BETWEEN ? AND ?
     ORDER BY strftime('%m-%d', p.geboortedatum) ASC`,
    [bwRange.start, bwRange.end]
  )

  // Get upcoming events for this user's stemgroep
  const upcomingEvents = await queryAll(
    c.env.DB,
    `SELECT id, type, titel, start_at, locatie, doelgroep
     FROM events
     WHERE datetime(start_at) >= datetime('now')
       AND (doelgroep = 'all' OR doelgroep LIKE ?)
     ORDER BY start_at ASC
     LIMIT 5`,
    [`%${user.stemgroep || ''}%`]
  )

  // Get latest nieuws for members
  // Bug #202 — DB slaat stemgroep als 'S','A','T','B' op,
  // posts.zichtbaarheid gebruikt 'sopraan'/'alt'/'tenor'/'bas'.
  // Map expliciet zodat een Bas-lid ook posts met zichtbaarheid='bas' ziet.
  const stemMapDash: Record<string, string> = {
    s: 'sopraan', sopraan: 'sopraan',
    a: 'alt',     alt:     'alt',
    t: 'tenor',   tenor:   'tenor',
    b: 'bas',     bas:     'bas',
  }
  const userStemKeyDash = (user.stemgroep || '').toLowerCase()
  const userStemLabelDash = stemMapDash[userStemKeyDash]
  const isStaffDash = user.role === 'admin' || user.role === 'bestuur' || (user as any).is_bestuurslid === 1

  // Voor nieuws: publiek + leden + eigen stemgroep + (indien staff) bestuur
  const nieuwsVis: string[] = ['publiek', 'leden']
  if (userStemLabelDash) nieuwsVis.push(userStemLabelDash)
  if (isStaffDash) nieuwsVis.push('bestuur')
  const nieuwsVisPh = nieuwsVis.map(() => '?').join(',')

  const nieuws = await queryAll(
    c.env.DB,
    `SELECT id, titel, slug, published_at
     FROM posts
     WHERE type = 'nieuws' 
       AND is_published = 1
       AND zichtbaarheid IN (${nieuwsVisPh})
     ORDER BY published_at DESC
     LIMIT 3`,
    nieuwsVis
  )

  // Voor board posts: leden + eigen stemgroep + (indien staff) bestuur
  const boardVis: string[] = ['leden']
  if (userStemLabelDash) boardVis.push(userStemLabelDash)
  if (isStaffDash) boardVis.push('bestuur')
  const boardVisPh = boardVis.map(() => '?').join(',')

  // Get latest board posts
  const boardPosts = await queryAll(
    c.env.DB,
    `SELECT p.id, p.titel, p.slug, p.created_at, p.categorie, p.is_pinned,
            u.id as auteur_id, pr.voornaam as auteur_voornaam
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.type = 'board'
       AND p.is_published = 1
       AND p.zichtbaarheid IN (${boardVisPh})
     ORDER BY p.is_pinned DESC, p.created_at DESC
     LIMIT 5`,
    boardVis
  )

  // Get latest materials for user's stemgroep
  const materials = await queryAll(
    c.env.DB,
    `SELECT m.id, m.titel, m.type, m.created_at,
            pi.titel as stuk_titel,
            w.titel as werk_titel, w.componist
     FROM materials m
     JOIN pieces pi ON pi.id = m.piece_id
     JOIN works w ON w.id = pi.work_id
     WHERE m.is_actief = 1
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen'
            OR (m.stem = 'SA' AND ? IN ('S','A'))
            OR (m.stem = 'TB' AND ? IN ('T','B')))
       AND (m.zichtbaar_voor = 'alle_leden' OR 
            (m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem'))
     ORDER BY m.created_at DESC
     LIMIT 5`,
    [user.stemgroep || 'SATB', user.stemgroep || '', user.stemgroep || '']
  )

  // Fetch enabled modules for conditional rendering
  const enabledModulesRaw = await queryAll<any>(c.env.DB,
    `SELECT module_key, is_enabled FROM module_settings`, [])
  const enabledModules = new Set(
    enabledModulesRaw.filter((m: any) => m.is_enabled === 1).map((m: any) => m.module_key)
  )
  const isAdmin = user.role === 'admin' || user.role === 'bestuur'

  // "Nieuw sinds vorige bezoek"-tellingen per sectie voor dashboard-tegels.
  // Lichte queries (1 COUNT(*) per sectie) en alleen ophalen, niet bumpen.
  // Bumpen gebeurt op de sectie-pagina zelf.
  const newCounts: Record<string, number> = { agenda: 0, materiaal: 0, board: 0, nieuws: 0 }
  try {
    const { countNewSince } = await import('../utils/section-visits')
    const [nAgenda, nMaterials, nBoard, nNieuws] = await Promise.all([
      countNewSince(c.env.DB, user.id, 'agenda', 'events',
        { extraWhere: 'COALESCE(is_cancelled,0)=0' }),
      countNewSince(c.env.DB, user.id, 'bestanden', 'materials',
        { extraWhere: 'COALESCE(is_deleted,0)=0' }).catch(() => 0),
      countNewSince(c.env.DB, user.id, 'forum', 'posts',
        { extraWhere: "COALESCE(is_deleted,0)=0 AND post_type='board'" }).catch(() => 0),
      countNewSince(c.env.DB, user.id, 'nieuws', 'posts',
        { extraWhere: "COALESCE(is_deleted,0)=0 AND post_type='nieuws' AND status='gepubliceerd'" }).catch(() => 0),
    ])
    newCounts.agenda = nAgenda
    newCounts.materiaal = nMaterials
    newCounts.board = nBoard  // 'board' module-key is "Berichten" tegel
    newCounts.nieuws = nNieuws
  } catch (_) { /* tabel ontbreekt? laat default 0 */ }

  // Calculate total donations for user
  const totalDonations = await queryOne<any>(c.env.DB, `
    SELECT SUM(amount) as total FROM donations WHERE user_id = ? AND status = 'paid'
  `, [user.id]);

  // Profile completeness (#57)
  const profileData = await queryOne<any>(c.env.DB, `
    SELECT voornaam, achternaam, telefoon, straat, huisnummer, postcode, gemeente, 
           geboortedatum, foto_url, bio, muzikale_ervaring
    FROM profiles WHERE user_id = ?
  `, [user.id])
  const profileFields = profileData ? [
    profileData.voornaam, profileData.achternaam, profileData.telefoon,
    profileData.straat, profileData.postcode, profileData.gemeente,
    profileData.geboortedatum, profileData.foto_url, profileData.bio, profileData.muzikale_ervaring
  ] : []
  const filledFields = profileFields.filter((f: any) => f && String(f).trim() !== '').length
  const profileCompleteness = profileData ? Math.round((filledFields / profileFields.length) * 100) : 0

  // Check if admin is impersonating this user
  const impersonating = !!(c.get('impersonating' as any))

  // 🌟 Koorlid in de kijker — één spotlight per request, dismissible
  const spotlight = await pickSpotlight(c.env.DB, user.id).catch(() => null)

  // 👋 Welkom-terug-detectie: was deze gebruiker > 30 dagen weg sinds vorige login?
  // We gebruiken previous_login_at (gezet bij elke login) en de
  // user_dismissed_spotlights tabel om de banner te kunnen wegklikken
  // zodat we hem niet bij elk dashboard-bezoek herhalen.
  let welcomeBack: { daysAway: number; missed: { events: number; materials: number; posts: number } } | null = null
  try {
    const prev = await queryOne<any>(
      c.env.DB,
      `SELECT previous_login_at FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    )
    if (prev?.previous_login_at) {
      const prevMs = new Date(String(prev.previous_login_at).replace(' ', 'T') + 'Z').getTime()
      const daysAway = Math.floor((Date.now() - prevMs) / (24 * 60 * 60 * 1000))
      if (daysAway >= 30) {
        // Spotlight-key uniek per "afwezigheidsperiode" — gebruik de prev-datum
        const wbKey = 'welcomeback:' + String(prev.previous_login_at).substring(0, 10)
        const dismissed = await queryOne<any>(
          c.env.DB,
          `SELECT id FROM user_dismissed_spotlights
           WHERE user_id = ? AND spotlight_key = ? LIMIT 1`,
          [user.id, wbKey]
        )
        if (!dismissed) {
          // Tel wat ze gemist hebben sinds prev_login (cap 30d via section-visits util)
          const cutoff = String(prev.previous_login_at)
          const [missedEvents, missedMaterials, missedPosts] = await Promise.all([
            queryOne<any>(c.env.DB,
              `SELECT COUNT(*) AS n FROM events WHERE created_at > ? AND COALESCE(is_cancelled,0)=0`,
              [cutoff]).then(r => r?.n || 0).catch(() => 0),
            queryOne<any>(c.env.DB,
              `SELECT COUNT(*) AS n FROM materials WHERE created_at > ? AND COALESCE(is_deleted,0)=0`,
              [cutoff]).then(r => r?.n || 0).catch(() => 0),
            queryOne<any>(c.env.DB,
              `SELECT COUNT(*) AS n FROM posts WHERE created_at > ? AND COALESCE(is_deleted,0)=0`,
              [cutoff]).then(r => r?.n || 0).catch(() => 0),
          ])
          welcomeBack = {
            daysAway: Math.min(daysAway, 365), // cap voor display
            missed: {
              events: missedEvents,
              materials: missedMaterials,
              posts: missedPosts,
            },
          }
          // Attach de wbKey aan welcomeBack zodat de banner-JS hem kan gebruiken
          ;(welcomeBack as any).key = wbKey
        }
      }
    }
  } catch (_) { /* graceful */ }

  // ─── Action items / notification list (#116) ───────────────────────────
  // Build a live "wat staat er voor jou open?" list combining:
  //   1) ongelezen DB-notificaties (laatste 5)
  //   2) openstaand lidgeld voor het actieve seizoen
  //   3) recent nieuws (laatste 7d) dat de user nog niet bekeken heeft
  //   4) profiel < 60% volledig
  //
  // Het idee komt uit feedback #116 — leden moeten bij login meteen zien
  // wat hun aandacht vraagt, zonder eerst naar /leden/profiel te moeten klikken.
  const dashboardActions: Array<{
    icon: string; iconBg: string; iconColor: string;
    titel: string; body?: string; link?: string; cta?: string;
    priority: number;
    // Dismiss support — als beide gezet zijn, krijgt het item een X-knop.
    // dismissType bepaalt welke API-endpoint aangeroepen wordt.
    //   - 'news'         → POST /api/leden/news/:id/dismiss  (post_id)
    //   - 'notification' → POST /api/leden/notifications/:id/read
    dismissType?: 'news' | 'notification';
    dismissId?: number;
  }> = []

  // 1) Openstaand lidgeld
  // Bug #207 — dirigent en pianist hoeven geen lidgeld te betalen → overslaan
  if (!['dirigent', 'pianist'].includes(user.role)) {
    try {
      const openMembership = await queryOne<any>(c.env.DB,
        `SELECT um.id, um.amount, um.status, um.mollie_payment_url, my.season
         FROM user_memberships um
         JOIN membership_years my ON my.id = um.year_id
         WHERE um.user_id = ? AND my.is_active = 1
           AND (um.status IS NULL OR um.status NOT IN ('paid','waived'))
         LIMIT 1`,
        [user.id])
      if (openMembership) {
        dashboardActions.push({
          icon: 'fas fa-euro-sign', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
          titel: `Lidgeld ${openMembership.season} nog te betalen`,
          body: openMembership.amount ? `Bedrag: € ${Number(openMembership.amount).toFixed(2)}` : undefined,
          link: '/leden/profiel#lidgeld',
          cta: 'Bekijk',
          priority: 1
        })
      }
    } catch (e) { /* ignore */ }
  }

  // 2) Recent nieuws (sinds vorige login) — gebruikt previous_login_at; fallback 7d
  try {
    const lastLoginRow = await queryOne<any>(c.env.DB,
      `SELECT previous_login_at FROM users WHERE id = ?`, [user.id])
    const sinceDate = lastLoginRow?.previous_login_at || null
    const sinceClause = sinceDate
      ? `AND datetime(p.published_at) >= datetime(?)`
      : `AND datetime(p.published_at) >= datetime('now', '-7 days')`
    // LEFT JOIN op user_news_dismissed: items die het lid al weggeklikt
    // of via "Lees" gedismissed heeft, vallen weg uit het widget.
    // Bug #202 — gebruik dezelfde zichtbaarheidsmap als boven
    const visForRecent = [...nieuwsVis]
    const visPh = visForRecent.map(() => '?').join(',')
    const params: any[] = sinceDate
      ? [user.id, ...visForRecent, sinceDate]
      : [user.id, ...visForRecent]
    const recentNieuws = await queryAll<any>(c.env.DB,
      `SELECT p.id, p.titel, p.slug, p.published_at
       FROM posts p
       LEFT JOIN user_news_dismissed und
         ON und.post_id = p.id AND und.user_id = ?
       WHERE p.type = 'nieuws'
         AND p.is_published = 1
         AND p.zichtbaarheid IN (${visPh})
         AND und.id IS NULL
         ${sinceClause}
       ORDER BY p.published_at DESC
       LIMIT 3`,
      params)
    for (const n of recentNieuws) {
      dashboardActions.push({
        icon: 'fas fa-newspaper', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
        titel: 'Nieuw bericht: ' + n.titel,
        link: `/nieuws/${n.slug}`,
        cta: 'Lees',
        priority: 3,
        dismissType: 'news',
        dismissId: n.id
      })
    }
  } catch (e) { /* ignore */ }

  // 3) Ongelezen notifications (DB) — laad hier specifiek voor het dashboard
  let dashNotifs: any[] = []
  try {
    dashNotifs = await getNotificationsForUser(c.env.DB, user.id, 10, true) // unreadOnly=true
  } catch (e) { /* ignore */ }
  // BUG-FIX (Dominique, 23 mei → 25 mei):
  // Dubbele lidgeld-melding wegfilteren.
  // Stap 1 hierboven voegt al een directe "Lidgeld YYYY-YYYY nog te betalen"
  // kaart toe uit user_memberships (= bron van waarheid). Daarnaast bestaat
  // er een notifications-tabel die per lid een notif "Lidgeld YYYY (€X) staat
  // open" inplant (via admin-finance.tsx). Vroeger toonden we ze allebei,
  // wat een dubbel-bericht gaf in het "Wat staat er open?"-blok.
  //
  // Regels nu:
  //   - Lidgeld confirmation/thanks (paid, ontvangen): ALTIJD tonen
  //   - Lidgeld invitation/reminder (open, te betalen, herinnering, betaalverzoek):
  //       * NIET tonen als er al een directe lidgeld-kaart in dashboardActions zit
  //         (zou exact dezelfde info zijn, dubbel)
  //       * NIET tonen als er GEEN pending row meer is (stale na reset-season)
  //       * Wel tonen in alle andere edge cases (zou zelden voorkomen)
  const hasOpenLidgeldCard = dashboardActions.some(a => a.titel.startsWith('Lidgeld ') && a.titel.includes('nog te betalen'))
  function isInvitationLidgeld(n: any): boolean {
    if (n.type !== 'lidgeld') return false
    const t = (n.titel || '').toLowerCase()
    return t.includes('open') || t.includes('te betalen') || t.includes('herinnering') || t.includes('betaalverzoek')
  }
  const unreadNotifs = dashNotifs.filter(n => {
    // Niet-lidgeld: altijd tonen
    if (n.type !== 'lidgeld') return true
    // Lidgeld confirmation/thanks: altijd tonen
    if (!isInvitationLidgeld(n)) return true
    // Lidgeld invitation: WEGLATEN als de directe kaart al getoond wordt
    // (anders krijg je twee keer dezelfde melding, eens compact en eens uitgebreid)
    if (hasOpenLidgeldCard) return false
    // Geen kaart maar wel een invitation-notif: laat zien (edge case waar
    // notif gemaakt is zonder bijhorende user_memberships row)
    return true
  }).slice(0, 4)
  for (const n of unreadNotifs) {
    const style = getNotificationStyle(n.type)
    dashboardActions.push({
      icon: style.icon, iconBg: style.bg, iconColor: style.color,
      titel: n.titel,
      body: n.body || undefined,
      link: n.link || undefined,
      cta: n.link ? 'Bekijk' : undefined,
      priority: n.type === 'lidgeld' ? 2 : 4,
      dismissType: 'notification',
      dismissId: n.id
    })
  }

  // 4) Profiel onvolledig
  if (profileCompleteness < 60) {
    dashboardActions.push({
      icon: 'fas fa-user-edit', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
      titel: `Vul je profiel verder aan (${profileCompleteness}% klaar)`,
      body: 'Foto, telefoon, adres en bio helpen ons om je beter te leren kennen.',
      link: '/leden/profiel#bewerken',
      cta: 'Vul aan',
      priority: 5
    })
  }

  // Sort by priority + dedup on titel
  dashboardActions.sort((a, b) => a.priority - b.priority)
  const seenTitles = new Set<string>()
  const dedupedActions = dashboardActions.filter(a => {
    if (seenTitles.has(a.titel)) return false
    seenTitles.add(a.titel)
    return true
  }).slice(0, 6)

  // 🗂️ Mijn taken — uit vergaderingen + concertprojecten
  // Toon enkel taken die nog NIET afgewerkt zijn (open / in_progress / blocked / todo)
  let myTasks: any[] = []
  try {
    const meetingTasks = await queryAll<any>(
      c.env.DB,
      `SELECT
         'meeting' AS bron,
         mai.id AS id,
         mai.titel AS titel,
         mai.beschrijving AS beschrijving,
         mai.deadline AS deadline,
         mai.status AS status,
         mai.created_at AS created_at,
         m.id AS bron_id,
         m.titel AS bron_titel,
         m.datum AS bron_datum
       FROM meeting_action_items mai
       JOIN meetings m ON m.id = mai.meeting_id
       WHERE mai.verantwoordelijke_id = ?
         AND mai.status NOT IN ('done', 'cancelled')
       ORDER BY
         CASE WHEN mai.deadline IS NULL THEN 1 ELSE 0 END,
         mai.deadline ASC`,
      [user.id]
    )
    const projectTasks = await queryAll<any>(
      c.env.DB,
      `SELECT
         'project' AS bron,
         cpt.id AS id,
         cpt.titel AS titel,
         cpt.beschrijving AS beschrijving,
         cpt.deadline AS deadline,
         cpt.status AS status,
         cpt.prioriteit AS prioriteit,
         cpt.created_at AS created_at,
         cp.id AS bron_id,
         cp.titel AS bron_titel,
         cp.concert_datum AS bron_datum
       FROM concert_project_tasks cpt
       JOIN concert_projects cp ON cp.id = cpt.project_id
       WHERE cpt.verantwoordelijke_id = ?
         AND cpt.status NOT IN ('done')
       ORDER BY
         CASE WHEN cpt.deadline IS NULL THEN 1 ELSE 0 END,
         cpt.deadline ASC`,
      [user.id]
    )
    myTasks = [...(meetingTasks || []), ...(projectTasks || [])]
    // Algemene sortering: deadline ASC, NULLs achteraan
    myTasks.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0
      if (!a.deadline) return 1
      if (!b.deadline) return -1
      return String(a.deadline).localeCompare(String(b.deadline))
    })
  } catch (e) {
    console.error('[mijn-taken] query mislukt:', e)
  }

  // Helper: deadline visueel
  const today = new Date().toISOString().slice(0, 10)
  function deadlineLabel(d: string | null) {
    if (!d) return { label: 'Geen deadline', cls: 'text-gray-500 bg-gray-100' }
    const isOverdue = d < today
    const isToday = d === today
    if (isOverdue) return { label: 'Achterstand sinds ' + d, cls: 'text-red-700 bg-red-100' }
    if (isToday) return { label: 'Vandaag', cls: 'text-orange-700 bg-orange-100' }
    // Within 7 days?
    const dt = new Date(d).getTime()
    const now = new Date(today).getTime()
    const days = Math.round((dt - now) / 86400000)
    if (days <= 7) return { label: 'Binnen ' + days + 'd', cls: 'text-amber-700 bg-amber-100' }
    return { label: d, cls: 'text-gray-600 bg-gray-100' }
  }

  return c.html(
    <Layout title="Ledenportaal" user={user} impersonating={impersonating}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* 🌟 Koorlid in de kijker — dismissible banner */}
          {spotlight && (() => {
            const sl = spotlight
            const fotoSrc = sl.user.foto_url || getDefaultAvatar(sl.user.stemgroep || '')
            // Twee labels: partij-naam (voor "bij de X") en zanger-naam (voor "onze X")
            const stemPartij = ({S:'sopranen',A:'alten',T:'tenoren',B:'bassen'} as any)[sl.user.stemgroep || ''] || ''
            const stemLabel = ({S:'Sopraan',A:'Alt',T:'Tenor',B:'Bas'} as any)[sl.user.stemgroep || ''] || ''
            let titleText = ''
            let subText = ''
            let icon = 'fa-star'
            let gradient = 'from-amber-50 to-orange-50 border-amber-200'
            if (sl.type === 'birthday') {
              titleText = `🎂 Vandaag jarig: ${sl.user.voornaam} ${sl.user.achternaam}!`
              subText = `Zing eens een verjaardags-lied${stemPartij ? ` voor onze ${stemPartij}` : ''} 🎵`
              icon = 'fa-birthday-cake'
              gradient = 'from-pink-50 to-rose-50 border-pink-200'
            } else if (sl.type === 'newmember') {
              titleText = `👋 Welkom in Animato, ${sl.user.voornaam}!`
              const dagen = sl.meta?.daysAgo ?? 0
              subText = dagen <= 1
                ? `Vers van de pers: ${sl.user.voornaam} is net begonnen${stemPartij ? ` bij de ${stemPartij}` : ''}. Zeg eens hallo!`
                : `${sl.user.voornaam} is sinds ${dagen} dagen bij ons${stemLabel ? ` (${stemLabel})` : ''}. Maak even kennis!`
              icon = 'fa-hand-wave'
              gradient = 'from-emerald-50 to-teal-50 border-emerald-200'
            } else {
              titleText = `✨ Koorlid in de kijker: ${sl.user.voornaam} ${sl.user.achternaam}`
              subText = stemLabel ? `Zingt ${stemLabel.toLowerCase()} bij Animato — leer ${sl.user.voornaam} eens beter kennen!` : `Leer ${sl.user.voornaam} eens beter kennen!`
            }
            return (
              <div
                id="spotlight-banner"
                data-spotlight-key={sl.key}
                class={`mb-6 bg-gradient-to-r ${gradient} border rounded-2xl shadow-sm p-5 flex items-center gap-5 transition-opacity duration-300`}
              >
                <a href={`/leden/smoelenboek/${sl.user.id}`} class="flex-shrink-0 group">
                  <img
                    src={fotoSrc}
                    alt={sl.user.voornaam}
                    class="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-md group-hover:ring-animato-primary transition"
                  />
                </a>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 text-gray-700 mb-1">
                    <i class={`fas ${icon} text-amber-500`}></i>
                    <a href={`/leden/smoelenboek/${sl.user.id}`} class="text-lg font-bold text-gray-800 hover:underline truncate" style="font-family: 'Playfair Display', serif;">
                      {titleText}
                    </a>
                  </div>
                  <p class="text-sm text-gray-600">{subText}</p>
                  {sl.user.bio && sl.type !== 'birthday' && (
                    <p class="text-xs text-gray-500 mt-2 line-clamp-2 italic">"{sl.user.bio}"</p>
                  )}
                </div>
                <button
                  type="button"
                  id="spotlight-dismiss"
                  class="flex-shrink-0 w-8 h-8 rounded-full hover:bg-white/60 text-gray-400 hover:text-gray-700 transition flex items-center justify-center"
                  title="Niet meer tonen"
                  aria-label="Sluit deze melding"
                >
                  <i class="fas fa-times"></i>
                </button>
              </div>
            )
          })()}
          {spotlight && (
            <script dangerouslySetInnerHTML={{ __html: `
              (function(){
                var banner = document.getElementById('spotlight-banner');
                var btn = document.getElementById('spotlight-dismiss');
                if (!banner || !btn) return;
                btn.addEventListener('click', function(e){
                  e.preventDefault(); e.stopPropagation();
                  var key = banner.getAttribute('data-spotlight-key');
                  banner.style.opacity = '0';
                  setTimeout(function(){ banner.remove(); }, 300);
                  fetch('/api/leden/spotlight/dismiss', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key })
                  }).catch(function(){});
                });
              })();
            `}}/>
          )}

          {/* 👋 Welkom terug — dismissible, telt wat ze gemist hebben */}
          {welcomeBack && (
            <div
              id="welcomeback-banner"
              data-welcomeback-key={(welcomeBack as any).key}
              class="relative mb-6 rounded-2xl p-6 bg-gradient-to-r from-sky-50 via-cyan-50 to-emerald-50 border border-cyan-200 shadow-sm transition-opacity"
            >
              <div class="flex items-start gap-4">
                <div class="flex-shrink-0 w-12 h-12 rounded-full bg-white shadow flex items-center justify-center text-2xl">
                  👋
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-bold text-gray-900 mb-1">
                    Welkom terug, {user.voornaam}!
                  </h3>
                  <p class="text-sm text-gray-700 mb-3">
                    Je was <span class="font-semibold text-cyan-700">{welcomeBack.daysAway} dagen</span> weg.
                    Tof dat je terug bent — hier is een mini-recap:
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {welcomeBack.missed.events > 0 && (
                      <a href="/agenda" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-cyan-700 text-sm rounded-full border border-cyan-200 hover:bg-cyan-50 transition">
                        <i class="far fa-calendar"></i>
                        <span><span class="font-semibold">{welcomeBack.missed.events}</span> nieuwe agenda-item{welcomeBack.missed.events === 1 ? '' : 's'}</span>
                      </a>
                    )}
                    {welcomeBack.missed.materials > 0 && (
                      <a href="/leden/materiaal" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-emerald-700 text-sm rounded-full border border-emerald-200 hover:bg-emerald-50 transition">
                        <i class="fas fa-file-audio"></i>
                        <span><span class="font-semibold">{welcomeBack.missed.materials}</span> nieuw{welcomeBack.missed.materials === 1 ? '' : 'e'} materia{welcomeBack.missed.materials === 1 ? 'al' : 'len'}</span>
                      </a>
                    )}
                    {welcomeBack.missed.posts > 0 && (
                      <a href="/leden/board" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-sky-700 text-sm rounded-full border border-sky-200 hover:bg-sky-50 transition">
                        <i class="fas fa-comments"></i>
                        <span><span class="font-semibold">{welcomeBack.missed.posts}</span> nieuw{welcomeBack.missed.posts === 1 ? '' : 'e'} bericht{welcomeBack.missed.posts === 1 ? '' : 'en'}</span>
                      </a>
                    )}
                    {welcomeBack.missed.events === 0 && welcomeBack.missed.materials === 0 && welcomeBack.missed.posts === 0 && (
                      <span class="text-sm text-gray-500 italic">
                        Het was rustig op de site — niets dramatisch gemist.
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  id="welcomeback-dismiss"
                  class="flex-shrink-0 w-8 h-8 rounded-full hover:bg-white/60 text-gray-400 hover:text-gray-700 transition flex items-center justify-center"
                  title="Sluiten"
                  aria-label="Sluit deze melding"
                >
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
          )}
          {welcomeBack && (
            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var banner = document.getElementById('welcomeback-banner');
                var btn = document.getElementById('welcomeback-dismiss');
                if (!banner || !btn) return;
                btn.addEventListener('click', function(e) {
                  e.preventDefault(); e.stopPropagation();
                  var key = banner.getAttribute('data-welcomeback-key');
                  banner.style.opacity = '0';
                  setTimeout(function(){ banner.remove(); }, 300);
                  fetch('/api/leden/spotlight/dismiss', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key })
                  }).catch(function(){});
                });
              })();
            ` }}/>
          )}

          {/* Welcome message */}
          {welcome && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-6 mb-8 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 text-3xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-semibold text-green-800">
                    Welkom bij Animato, {user.voornaam}!
                  </h3>
                  <p class="text-green-700">
                    Je account is succesvol aangemaakt. Veel plezier in het ledenportaal!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 🔔 Action items / notifications card (#116) — wat staat er voor jou open? */}
          {dedupedActions.length > 0 && (
            <div class="mb-8 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div class="bg-gradient-to-r from-animato-primary/10 to-amber-50 px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 bg-animato-primary text-white rounded-full flex items-center justify-center shadow-sm">
                    <i class="fas fa-bell"></i>
                  </div>
                  <div>
                    <h2 class="text-lg font-bold text-gray-800" style="font-family: 'Playfair Display', serif;">
                      Wat staat er voor jou open?
                    </h2>
                    <p class="text-xs text-gray-500 mt-0.5">{dedupedActions.length} {dedupedActions.length === 1 ? 'actiepunt' : 'actiepunten'} dat je aandacht vraagt</p>
                  </div>
                </div>
                <a href="/leden/profiel#notificaties" class="text-xs text-animato-primary hover:underline whitespace-nowrap">
                  Alle notificaties <i class="fas fa-arrow-right ml-0.5 text-[10px]"></i>
                </a>
              </div>
              <ul id="dashboard-actions-list" class="divide-y divide-gray-100">
                {dedupedActions.map((a, idx) => {
                  const dismissAttrs = a.dismissType && a.dismissId
                    ? {
                        'data-dismiss-type': a.dismissType,
                        'data-dismiss-id': String(a.dismissId)
                      }
                    : {}
                  return (
                    <li class="dashboard-action-item flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition" {...dismissAttrs}>
                      <div class={`flex-shrink-0 w-9 h-9 rounded-full ${a.iconBg} ${a.iconColor} flex items-center justify-center`}>
                        <i class={a.icon}></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-800 truncate">{a.titel}</p>
                        {a.body && <p class="text-xs text-gray-500 truncate">{a.body}</p>}
                      </div>
                      {a.link && (
                        <a href={a.link} data-action-link class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-animato-primary hover:bg-animato-primary/10 rounded-lg border border-animato-primary/30 transition">
                          {a.cta || 'Open'} <i class="fas fa-chevron-right text-[10px]"></i>
                        </a>
                      )}
                      {a.dismissType && a.dismissId && (
                        <button
                          type="button"
                          data-action-dismiss
                          aria-label="Verbergen"
                          title="Verbergen"
                          class="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition"
                        >
                          <i class="fas fa-times text-xs"></i>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {/* Client-side: X-klik én Lees-klik triggert idempotent dismiss
                  zodat het item meteen verdwijnt en bij volgende load niet
                  terugkeert. Widget wordt zelf weggehaald als de lijst leeg is. */}
              <script dangerouslySetInnerHTML={{ __html: `
                (function() {
                  var list = document.getElementById('dashboard-actions-list');
                  if (!list) return;
                  var card = list.closest('.bg-white.border.border-gray-200');

                  function endpointFor(type, id) {
                    if (type === 'news') return '/api/leden/news/' + id + '/dismiss';
                    if (type === 'notification') return '/api/leden/notifications/' + id + '/read';
                    return null;
                  }

                  function dismissItem(li, removeImmediately) {
                    var type = li.getAttribute('data-dismiss-type');
                    var id = li.getAttribute('data-dismiss-id');
                    if (!type || !id) return;
                    var url = endpointFor(type, id);
                    if (!url) return;
                    // Fire-and-forget; idempotent server-side.
                    try {
                      fetch(url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Accept': 'application/json' }
                      }).catch(function(){});
                    } catch (e) {}
                    if (removeImmediately) {
                      li.style.transition = 'opacity .2s ease, transform .2s ease';
                      li.style.opacity = '0';
                      li.style.transform = 'translateX(8px)';
                      setTimeout(function() {
                        li.remove();
                        if (list.children.length === 0 && card) {
                          card.style.transition = 'opacity .25s ease';
                          card.style.opacity = '0';
                          setTimeout(function(){ card.remove(); }, 250);
                        }
                      }, 200);
                    }
                  }

                  // X-knop: meteen visueel verwijderen
                  list.addEventListener('click', function(e) {
                    var btn = e.target.closest('[data-action-dismiss]');
                    if (btn) {
                      e.preventDefault();
                      e.stopPropagation();
                      var li = btn.closest('.dashboard-action-item');
                      if (li) dismissItem(li, true);
                      return;
                    }
                    // "Lees"-link: dismiss in achtergrond, navigatie gebeurt normaal
                    var link = e.target.closest('[data-action-link]');
                    if (link) {
                      var li = link.closest('.dashboard-action-item');
                      if (li) dismissItem(li, false);
                    }
                  });
                })();
              ` }} />
            </div>
          )}

          {/* 🗂️ Mijn taken — uit vergaderingen en projecten */}
          {myTasks.length > 0 && (
            <div class="mb-8 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div class="bg-gradient-to-r from-purple-50 to-indigo-50 px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 bg-purple-600 text-white rounded-full flex items-center justify-center shadow-sm">
                    <i class="fas fa-clipboard-check"></i>
                  </div>
                  <div>
                    <h2 class="text-lg font-bold text-gray-800" style="font-family: 'Playfair Display', serif;">
                      Mijn taken
                    </h2>
                    <p class="text-xs text-gray-500 mt-0.5">
                      {myTasks.length} {myTasks.length === 1 ? 'openstaande taak' : 'openstaande taken'} toegewezen aan jou
                    </p>
                  </div>
                </div>
                <a href="/leden/taken" class="text-xs text-purple-700 hover:underline whitespace-nowrap font-medium">
                  Alle taken <i class="fas fa-arrow-right ml-0.5 text-[10px]"></i>
                </a>
              </div>
              <ul class="divide-y divide-gray-100">
                {myTasks.slice(0, 6).map((t: any) => {
                  const isMeeting = t.bron === 'meeting'
                  const sourceLink = isMeeting
                    ? `/admin/meetings/${t.bron_id}`
                    : `/admin/projects/${t.bron_id}`
                  const sourceIcon = isMeeting ? 'fa-users' : 'fa-music'
                  const sourceLabel = isMeeting ? 'Vergadering' : 'Project'
                  const sourceColor = isMeeting ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-pink-50 text-pink-700 border-pink-200'
                  const dl = deadlineLabel(t.deadline)
                  const statusBadge = t.status === 'in_progress'
                    ? { label: 'Bezig', cls: 'bg-amber-100 text-amber-800' }
                    : t.status === 'blocked'
                      ? { label: 'Geblokkeerd', cls: 'bg-red-100 text-red-800' }
                      : t.status === 'todo' || t.status === 'open'
                        ? { label: 'Open', cls: 'bg-gray-100 text-gray-700' }
                        : { label: t.status, cls: 'bg-gray-100 text-gray-700' }
                  return (
                    <li class="px-5 py-3 hover:bg-gray-50 transition">
                      <div class="flex items-start gap-3">
                        <div class="flex-shrink-0 w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center mt-0.5">
                          <i class="fas fa-tasks text-sm"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-start justify-between gap-2 flex-wrap">
                            <p class="text-sm font-semibold text-gray-800">{t.titel}</p>
                            <div class="flex items-center gap-1.5 flex-wrap">
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sourceColor}`}>
                                <i class={`fas ${sourceIcon}`}></i> {sourceLabel}
                              </span>
                              <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge.cls}`}>
                                {statusBadge.label}
                              </span>
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${dl.cls}`}>
                                <i class="far fa-clock"></i> {dl.label}
                              </span>
                            </div>
                          </div>
                          {t.beschrijving && (
                            <p class="text-xs text-gray-500 mt-1 line-clamp-2">{t.beschrijving}</p>
                          )}
                          <p class="text-[11px] text-gray-400 mt-1">
                            <i class={`fas ${sourceIcon} mr-1`}></i>
                            Uit: <a href={sourceLink} class="text-purple-700 hover:underline">{t.bron_titel}</a>
                            {t.bron_datum && <span class="text-gray-400"> · {t.bron_datum}</span>}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {myTasks.length > 6 && (
                <div class="px-5 py-3 bg-gray-50 border-t border-gray-100 text-center">
                  <a href="/leden/taken" class="text-sm text-purple-700 hover:underline font-medium">
                    Bekijk alle {myTasks.length} taken <i class="fas fa-arrow-right ml-1 text-[10px]"></i>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 🎂 Birthday banner — week overview */}
          {birthdayMembers.length > 0 && (
            <div class="mb-8 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-6 shadow-md relative overflow-hidden">
              <div class="absolute top-2 right-4 text-2xl opacity-30 select-none">🎊</div>
              <div class="absolute bottom-2 left-4 text-2xl opacity-20 select-none">🎶</div>

              <div class="flex items-center gap-3 mb-5">
                <div class="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
                  <i class="fas fa-birthday-cake text-white text-lg"></i>
                </div>
                <div>
                  <h2 class="text-xl font-bold text-amber-900" style="font-family: 'Playfair Display', serif;">
                    🎉 Jarig deze week!
                  </h2>
                  <p class="text-xs text-amber-600 mt-0.5">
                    Proficiat aan de jarige(n)!
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap gap-6 justify-center sm:justify-start">
                {birthdayMembers.map((bm: any) => {
                  const isMe = bm.id === user.id
                  // BELANGRIJK: gebruik het huidige jaar voor de weekdag-weergave.
                  // `new Date(bm.geboortedatum)` zou de weekdag uit het geboortejaar geven.
                  const [, mm, dd] = (bm.geboortedatum || '').split('-')
                  const now = new Date()
                  const thisYearBd = new Date(now.getFullYear(), Number(mm) - 1, Number(dd))
                  // Als de verjaardag al voorbij is vóór vandaag (bv. edge-case),
                  // neem volgend jaar. Banner toont 'deze week' dus normaal in huidige week.
                  const displayDate = thisYearBd < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
                    ? new Date(now.getFullYear() + 1, Number(mm) - 1, Number(dd))
                    : thisYearBd
                  return (
                    <a href={`/leden/smoelenboek/${bm.id}`} class="flex flex-col items-center group transition hover:scale-105">
                      <div class="relative mb-2">
                        <div class={`w-20 h-20 rounded-full overflow-hidden border-4 ${isMe ? 'border-amber-400 ring-2 ring-amber-200' : 'border-amber-200'} bg-white shadow-md`}>
                          <img src={bm.foto_url || getDefaultAvatar(bm.stemgroep)} class="w-full h-full object-cover" alt={`${bm.voornaam} ${bm.achternaam}`} />
                        </div>
                        <span class="absolute -top-4 left-1/2 -translate-x-1/2 text-3xl drop-shadow-sm" title="Jarig deze week!">👑</span>
                      </div>
                      <span class={`text-sm font-bold ${isMe ? 'text-amber-800' : 'text-gray-800'} group-hover:text-amber-600 transition text-center leading-snug`}>
                        {bm.voornaam} {bm.achternaam}
                      </span>
                      {isMe && <span class="text-[10px] font-bold text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full mt-0.5">Dat ben jij! 🥳</span>}
                      <span class="text-xs text-amber-600 font-semibold mt-0.5">
                        {displayDate.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long' })}
                      </span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}

          {/* Header */}
          <div class="mb-8">
            <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              Welkom, {user.voornaam}!
            </h1>
            <p class="text-gray-600 text-lg">
              Je bent ingelogd als {user.role === 'admin' ? 'Administrator' : 
                                    user.role === 'moderator' ? 'Moderator' :
                                    user.role === 'stemleider' ? 'Stemleider' : 'Lid'}
              {user.stemgroep && ` • Stemgroep: ${
                user.stemgroep === 'S' ? 'Sopraan' :
                user.stemgroep === 'A' ? 'Alt' :
                user.stemgroep === 'T' ? 'Tenor' :
                'Bas'
              }`}
            </p>
          </div>

          {/* Quick actions - modules filtered by admin toggle settings */}
          {(() => {
            // "Nieuw sinds vorige bezoek"-counts per sectie
            // newCounts wordt enkele regels boven dit blok geprepareerd
            // Module definitions with their module_key mapping
            const allModules = [
              { key: 'agenda',       href: '/leden/agenda',        icon: 'far fa-calendar',     iconBg: 'bg-animato-primary bg-opacity-10', iconColor: 'text-animato-primary text-xl', title: 'Agenda',         desc: 'Repetities & concerten',        border: '' },
              { key: 'materiaal',    href: '/leden/materiaal',     icon: 'fas fa-file-audio',   iconBg: 'bg-animato-primary bg-opacity-10', iconColor: 'text-animato-primary text-2xl', title: 'Oefenmateriaal', desc: 'Partituren & oefentracks',      border: '' },
              { key: 'nieuws',       href: '/leden/board',         icon: 'fas fa-comments',     iconBg: 'bg-animato-primary bg-opacity-10', iconColor: 'text-animato-primary text-xl', title: 'Berichten',      desc: 'Nieuws & discussies',           border: '' },
              { key: null,           href: '/leden/smoelenboek',   icon: 'fas fa-users',        iconBg: 'bg-pink-100',                      iconColor: 'text-pink-600 text-xl',        title: 'Onze Zangers',   desc: 'Leer je mede-leden kennen',     border: '' },
              { key: 'activiteiten', href: '/leden/activiteiten',  icon: 'fas fa-glass-cheers', iconBg: 'bg-animato-primary text-white shadow-sm', iconColor: 'text-xl',             title: 'Inschrijvingen', desc: 'Feesten & Activiteiten',        border: 'border-2 border-animato-primary border-opacity-20' },
              { key: 'polls',        href: '/leden/polls',         icon: 'fas fa-poll',         iconBg: 'bg-green-100',                     iconColor: 'text-green-600 text-xl',       title: 'Polls',          desc: 'Stem mee!',                     border: '' },
              { key: 'voorstellen',  href: '/leden/voorstellen',   icon: 'fas fa-lightbulb',    iconBg: 'bg-yellow-100',                    iconColor: 'text-yellow-600 text-xl',      title: 'Voorstellen',    desc: 'Deel je ideeën',                border: '' },
              { key: null,           href: '/leden/streaks',       icon: null,                  iconBg: 'bg-orange-100',                    iconColor: '',                             title: 'Streaks',        desc: 'Aanwezigheid & badges',         border: 'border-2 border-orange-200', emoji: '🔥' },
              { key: null,           href: '/leden/reglementen',   icon: 'fas fa-scroll',       iconBg: 'bg-amber-100',                     iconColor: 'text-amber-700 text-xl',       title: 'Reglementen',    desc: 'Koor-kompas & afspraken',       border: '' },
              { key: 'voice_analyzer', href: '/stem-test',         icon: 'fas fa-microphone',   iconBg: 'bg-purple-100',                    iconColor: 'text-purple-600 text-xl',      title: 'Stem Test',      desc: 'Test je stembereik',            border: '' },
              { key: null,           href: '/leden/profiel',       icon: 'fas fa-id-card',      iconBg: 'bg-animato-primary bg-opacity-10', iconColor: 'text-animato-primary text-xl', title: 'Mijn profiel',   desc: 'Persoonsgegevens bewerken',     border: '', isProfile: true },
            ]
            // Filter: admin sees everything, members only see enabled modules (null key = always visible)
            const visibleModules = allModules.filter(m => isAdmin || m.key === null || enabledModules.has(m.key))

            return (
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-12">
                {visibleModules.map(m => {
                  // "Nieuw"-badge voor secties met activiteit sinds vorige bezoek
                  let newCount = 0
                  if (m.key === 'agenda') newCount = newCounts.agenda
                  else if (m.key === 'materiaal') newCount = newCounts.materiaal
                  else if (m.key === 'nieuws') newCount = newCounts.board + newCounts.nieuws
                  return (
                  <a href={m.href} class={`bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center relative ${m.border} ${isAdmin && m.key && !enabledModules.has(m.key) ? 'opacity-50 ring-2 ring-red-300' : ''}`}>
                    {/* Admin-only badge for disabled modules */}
                    {isAdmin && m.key && !enabledModules.has(m.key) && (
                      <span class="absolute top-1 right-1 bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">UIT</span>
                    )}
                    {/* "Nieuw sinds vorige bezoek"-badge (gecapt op 30d) */}
                    {newCount > 0 && (
                      <span class="absolute top-1 right-1 bg-animato-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm" title={`${newCount} nieuw sinds je vorige bezoek`}>
                        {newCount > 99 ? '99+' : newCount} nieuw
                      </span>
                    )}
                    <div class={`w-12 h-12 ${m.iconBg} rounded-full flex items-center justify-center mx-auto mb-3`}>
                      {m.emoji ? <span class="text-2xl">{m.emoji}</span> : <i class={`${m.icon} ${m.iconColor}`}></i>}
                    </div>
                    <h3 class="font-semibold text-gray-900 mb-1">{m.title}</h3>
                    <p class="text-sm text-gray-600">{m.desc}</p>
                    {m.isProfile && (
                      <div class="mt-2">
                        <div class="w-full bg-gray-200 rounded-full h-1.5">
                          <div class={`h-1.5 rounded-full ${profileCompleteness >= 80 ? 'bg-green-500' : profileCompleteness >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={`width: ${profileCompleteness}%`}></div>
                        </div>
                        <p class={`text-xs mt-1 ${profileCompleteness >= 80 ? 'text-green-600' : profileCompleteness >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                          {profileCompleteness}% ingevuld
                        </p>
                      </div>
                    )}
                  </a>
                  )
                })}
              </div>
            )
          })()}

          {/* Main content grid */}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left column - Events & News */}
            <div class="lg:col-span-2 space-y-8">
              {/* Upcoming events */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-2xl font-bold text-gray-900">
                    <i class="far fa-calendar mr-2 text-animato-primary"></i>
                    Aankomende Activiteiten
                  </h2>
                  <a href="/leden/agenda" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {upcomingEvents.length > 0 ? (
                  <div class="space-y-3">
                    {upcomingEvents.map((event: any) => (
                      <div class="border-l-4 border-animato-primary bg-gray-50 p-4 rounded">
                        <div class="flex items-start justify-between">
                          <div>
                            <span class={`inline-block px-2 py-1 rounded text-xs font-semibold mb-2 ${
                              event.type === 'concert' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {event.type === 'concert' ? 'Concert' : 'Repetitie'}
                            </span>
                            <h3 class="font-semibold text-gray-900">{event.titel}</h3>
                            <p class="text-sm text-gray-600 mt-1">
                              <i class="far fa-calendar mr-1"></i>
                              {new Date(event.start_at).toLocaleDateString('nl-BE', { 
                                weekday: 'short', 
                                day: 'numeric', 
                                month: 'short' 
                              })}
                              {' • '}
                              <i class="fas fa-map-marker-alt mr-1"></i>
                              {event.locatie}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-center py-8">
                    Geen aankomende activiteiten
                  </p>
                )}
              </div>

              {/* Latest news */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-2xl font-bold text-gray-900">
                    <i class="far fa-newspaper mr-2 text-animato-primary"></i>
                    Laatste Nieuws
                  </h2>
                  <a href="/nieuws" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {nieuws.length > 0 ? (
                  <div class="space-y-3">
                    {nieuws.map((item: any) => (
                      <a 
                        href={`/nieuws/${item.slug}`}
                        class="block border-b border-gray-200 pb-3 last:border-0 hover:bg-gray-50 p-2 rounded transition"
                      >
                        <div class="text-animato-primary text-xs mb-1">
                          {new Date(item.published_at).toLocaleDateString('nl-BE')}
                        </div>
                        <h3 class="font-semibold text-gray-900 hover:text-animato-primary">
                          {item.titel}
                        </h3>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-center py-8">
                    Geen nieuws beschikbaar
                  </p>
                )}
              </div>
            </div>

            {/* Right column - Berichten & Materials */}
            <div class="space-y-8">
              {/* Latest board posts */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-comments mr-2 text-animato-primary"></i>
                    Berichten
                  </h2>
                  <a href="/leden/board" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {boardPosts.length > 0 ? (
                  <div class="space-y-3">
                    {boardPosts.map((post: any) => (
                      <a 
                        href={`/leden/board/${post.id}`}
                        class="block bg-gray-50 p-3 rounded hover:bg-gray-100 transition"
                      >
                        {post.is_pinned && (
                          <i class="fas fa-thumbtack text-animato-primary text-xs mr-2"></i>
                        )}
                        <h4 class="font-semibold text-sm text-gray-900 line-clamp-1">
                          {post.titel}
                        </h4>
                        <p class="text-xs text-gray-600 mt-1">
                          {post.auteur_voornaam} • {new Date(post.created_at).toLocaleDateString('nl-BE')}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-sm text-center py-4">
                    Geen berichten
                  </p>
                )}
              </div>

              {/* Latest materials */}
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-file-music mr-2 text-animato-primary"></i>
                    Nieuw Materiaal
                  </h2>
                  <a href="/leden/materiaal" class="text-animato-primary hover:underline text-sm font-semibold">
                    Bekijk alles
                  </a>
                </div>
                {materials.length > 0 ? (
                  <div class="space-y-3">
                    {materials.map((mat: any) => (
                      <div class="bg-gray-50 p-3 rounded">
                        <div class="flex items-center justify-between mb-1">
                          <span class={`text-xs font-semibold ${
                            mat.type === 'pdf' ? 'text-red-600' :
                            mat.type === 'audio' ? 'text-green-600' :
                            'text-blue-600'
                          }`}>
                            <i class={`fas ${
                              mat.type === 'pdf' ? 'fa-file-pdf' :
                              mat.type === 'audio' ? 'fa-file-audio' :
                              'fa-file-archive'
                            } mr-1`}></i>
                            {mat.type.toUpperCase()}
                          </span>
                          <span class="text-xs text-gray-500">
                            {new Date(mat.created_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <h4 class="font-semibold text-sm text-gray-900 line-clamp-1">
                          {mat.titel}
                        </h4>
                        <p class="text-xs text-gray-600 mt-1">
                          {mat.werk_titel} - {mat.stuk_titel}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="text-gray-500 text-sm text-center py-4">
                    Geen nieuw materiaal
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Nieuwe-lid aankondiging popup \u2014 fetcht /api/leden/new-members, toont
          confetti-modal als er ongelezen nieuwe leden zijn van laatste 14 dagen */}
      <script src="/static/js/new-members-popup.js" defer></script>
    </Layout>
  )
})

// =====================================================
// MIJN TAKEN PAGE
// =====================================================

app.get('/leden/taken', async (c) => {
  const user = c.get('user') as SessionUser
  const filter = c.req.query('filter') || 'open'  // open | done | all
  const bronFilter = c.req.query('bron') || 'all'  // all | meeting | project

  let allTasks: any[] = []
  try {
    const meetingTasks = await queryAll<any>(
      c.env.DB,
      `SELECT
         'meeting' AS bron,
         mai.id AS id,
         mai.titel AS titel,
         mai.beschrijving AS beschrijving,
         mai.deadline AS deadline,
         mai.status AS status,
         mai.completed_at AS completed_at,
         mai.created_at AS created_at,
         m.id AS bron_id,
         m.titel AS bron_titel,
         m.datum AS bron_datum
       FROM meeting_action_items mai
       JOIN meetings m ON m.id = mai.meeting_id
       WHERE mai.verantwoordelijke_id = ?
       ORDER BY
         CASE WHEN mai.deadline IS NULL THEN 1 ELSE 0 END,
         mai.deadline ASC`,
      [user.id]
    )
    const projectTasks = await queryAll<any>(
      c.env.DB,
      `SELECT
         'project' AS bron,
         cpt.id AS id,
         cpt.titel AS titel,
         cpt.beschrijving AS beschrijving,
         cpt.deadline AS deadline,
         cpt.status AS status,
         cpt.prioriteit AS prioriteit,
         cpt.completed_at AS completed_at,
         cpt.created_at AS created_at,
         cp.id AS bron_id,
         cp.titel AS bron_titel,
         cp.concert_datum AS bron_datum
       FROM concert_project_tasks cpt
       JOIN concert_projects cp ON cp.id = cpt.project_id
       WHERE cpt.verantwoordelijke_id = ?
       ORDER BY
         CASE WHEN cpt.deadline IS NULL THEN 1 ELSE 0 END,
         cpt.deadline ASC`,
      [user.id]
    )
    allTasks = [...(meetingTasks || []), ...(projectTasks || [])]
  } catch (e) {
    console.error('[leden/taken] query mislukt:', e)
  }

  const isDone = (t: any) => t.status === 'done' || t.status === 'cancelled'
  const openTasks = allTasks.filter(t => !isDone(t))
  const doneTasks = allTasks.filter(t => isDone(t))

  let visibleTasks = allTasks
  if (filter === 'open') visibleTasks = openTasks
  else if (filter === 'done') visibleTasks = doneTasks

  if (bronFilter === 'meeting') visibleTasks = visibleTasks.filter(t => t.bron === 'meeting')
  else if (bronFilter === 'project') visibleTasks = visibleTasks.filter(t => t.bron === 'project')

  // Sort: open first by deadline, done last
  visibleTasks.sort((a, b) => {
    if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1
    if (!a.deadline && !b.deadline) return 0
    if (!a.deadline) return 1
    if (!b.deadline) return -1
    return String(a.deadline).localeCompare(String(b.deadline))
  })

  const today = new Date().toISOString().slice(0, 10)
  function deadlineLabel(d: string | null) {
    if (!d) return { label: 'Geen deadline', cls: 'text-gray-500 bg-gray-100' }
    const isOverdue = d < today
    const isToday = d === today
    if (isOverdue) return { label: 'Achterstand sinds ' + d, cls: 'text-red-700 bg-red-100' }
    if (isToday) return { label: 'Vandaag', cls: 'text-orange-700 bg-orange-100' }
    const dt = new Date(d).getTime()
    const now = new Date(today).getTime()
    const days = Math.round((dt - now) / 86400000)
    if (days <= 7) return { label: 'Binnen ' + days + 'd · ' + d, cls: 'text-amber-700 bg-amber-100' }
    return { label: d, cls: 'text-gray-600 bg-gray-100' }
  }

  const meetingCount = openTasks.filter(t => t.bron === 'meeting').length
  const projectCount = openTasks.filter(t => t.bron === 'project').length

  return c.html(
    <Layout title="Mijn taken" user={user}>
      <div class="py-10 bg-gray-50 min-h-screen">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div class="mb-6">
            <h1 class="text-3xl font-bold text-gray-800 mb-1" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-clipboard-check text-purple-600 mr-2"></i>
              Mijn taken
            </h1>
            <p class="text-sm text-gray-600">
              Alle actiepunten en projecttaken die aan jou zijn toegewezen.
            </p>
          </div>

          {/* KPI tiles */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div class="bg-white border border-gray-200 rounded-xl p-4">
              <div class="text-2xl font-bold text-purple-700">{openTasks.length}</div>
              <div class="text-xs text-gray-500 uppercase tracking-wide">Openstaand</div>
            </div>
            <div class="bg-white border border-blue-200 rounded-xl p-4">
              <div class="text-2xl font-bold text-blue-700">{meetingCount}</div>
              <div class="text-xs text-gray-500 uppercase tracking-wide"><i class="fas fa-users mr-1"></i>Uit vergaderingen</div>
            </div>
            <div class="bg-white border border-pink-200 rounded-xl p-4">
              <div class="text-2xl font-bold text-pink-700">{projectCount}</div>
              <div class="text-xs text-gray-500 uppercase tracking-wide"><i class="fas fa-music mr-1"></i>Uit projecten</div>
            </div>
            <div class="bg-white border border-emerald-200 rounded-xl p-4">
              <div class="text-2xl font-bold text-emerald-700">{doneTasks.length}</div>
              <div class="text-xs text-gray-500 uppercase tracking-wide"><i class="fas fa-check mr-1"></i>Afgewerkt</div>
            </div>
          </div>

          {/* Filters */}
          <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
            <div class="flex items-center gap-2 text-sm">
              <span class="text-gray-600 font-medium">Status:</span>
              <a href={`/leden/taken?filter=open&bron=${bronFilter}`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'open' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                Openstaand ({openTasks.length})
              </a>
              <a href={`/leden/taken?filter=done&bron=${bronFilter}`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'done' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                Afgewerkt ({doneTasks.length})
              </a>
              <a href={`/leden/taken?filter=all&bron=${bronFilter}`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                Alles ({allTasks.length})
              </a>
            </div>
            <div class="flex items-center gap-2 text-sm ml-auto">
              <span class="text-gray-600 font-medium">Bron:</span>
              <a href={`/leden/taken?filter=${filter}&bron=all`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${bronFilter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                Alles
              </a>
              <a href={`/leden/taken?filter=${filter}&bron=meeting`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${bronFilter === 'meeting' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
                <i class="fas fa-users mr-1"></i> Vergadering
              </a>
              <a href={`/leden/taken?filter=${filter}&bron=project`} class={`px-3 py-1.5 rounded-lg text-xs font-medium ${bronFilter === 'project' ? 'bg-pink-600 text-white' : 'bg-pink-50 text-pink-700 hover:bg-pink-100'}`}>
                <i class="fas fa-music mr-1"></i> Project
              </a>
            </div>
          </div>

          {/* Task list */}
          {visibleTasks.length === 0 ? (
            <div class="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <i class="fas fa-clipboard-check text-5xl text-gray-300 mb-3"></i>
              <p class="text-gray-600 font-medium">Geen taken in deze filter.</p>
              <p class="text-xs text-gray-500 mt-1">
                {filter === 'open' ? 'Joepie — niets staat open!' : 'Probeer een andere filter.'}
              </p>
            </div>
          ) : (
            <div class="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {visibleTasks.map((t: any) => {
                const done = isDone(t)
                const isMeeting = t.bron === 'meeting'
                const sourceLink = isMeeting
                  ? `/admin/meetings/${t.bron_id}`
                  : `/admin/projects/${t.bron_id}`
                const sourceIcon = isMeeting ? 'fa-users' : 'fa-music'
                const sourceLabel = isMeeting ? 'Vergadering' : 'Project'
                const sourceColor = isMeeting ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-pink-50 text-pink-700 border-pink-200'
                const dl = deadlineLabel(t.deadline)
                const statusBadge = done
                  ? { label: t.status === 'cancelled' ? 'Geannuleerd' : 'Afgewerkt', cls: 'bg-emerald-100 text-emerald-800' }
                  : t.status === 'in_progress'
                    ? { label: 'Bezig', cls: 'bg-amber-100 text-amber-800' }
                    : t.status === 'blocked'
                      ? { label: 'Geblokkeerd', cls: 'bg-red-100 text-red-800' }
                      : t.status === 'todo' || t.status === 'open'
                        ? { label: 'Open', cls: 'bg-gray-100 text-gray-700' }
                        : { label: t.status, cls: 'bg-gray-100 text-gray-700' }
                return (
                  <div class={`px-5 py-4 hover:bg-gray-50 transition ${done ? 'opacity-60' : ''}`}>
                    <div class="flex items-start gap-3">
                      <div class={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5 ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>
                        <i class={`fas ${done ? 'fa-check' : 'fa-tasks'}`}></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2 flex-wrap mb-1">
                          <h3 class={`text-sm font-semibold ${done ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{t.titel}</h3>
                          <div class="flex items-center gap-1.5 flex-wrap">
                            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sourceColor}`}>
                              <i class={`fas ${sourceIcon}`}></i> {sourceLabel}
                            </span>
                            <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge.cls}`}>
                              {statusBadge.label}
                            </span>
                            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${dl.cls}`}>
                              <i class="far fa-clock"></i> {dl.label}
                            </span>
                          </div>
                        </div>
                        {t.beschrijving && (
                          <p class="text-sm text-gray-600 mb-2 whitespace-pre-line">{t.beschrijving}</p>
                        )}
                        <p class="text-[11px] text-gray-400">
                          <i class={`fas ${sourceIcon} mr-1`}></i>
                          Uit: <a href={sourceLink} class="text-purple-700 hover:underline font-medium">{t.bron_titel}</a>
                          {t.bron_datum && <span> · {t.bron_datum}</span>}
                          {done && t.completed_at && <span class="ml-2 text-emerald-600">· afgewerkt op {String(t.completed_at).slice(0, 10)}</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tips */}
          <div class="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <i class="fas fa-info-circle mr-2"></i>
            Taken markeren als afgewerkt? Dat gebeurt vanuit de vergadering of het project zelf.
            Klik op de bron-link bij een taak om naar de juiste pagina te gaan.
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// DONATIES PAGE
// =====================================================

app.get('/leden/donaties', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Fetch donation history
  const donations = await queryAll(c.env.DB, `
    SELECT * FROM donations WHERE user_id = ? ORDER BY created_at DESC
  `, [user.id]);

  const total = donations.filter((d: any) => d.status === 'paid').reduce((sum: number, d: any) => sum + d.amount, 0);

  return c.html(
    <Layout title="Mijn Donaties" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Donaties', href: '/leden/donaties'}]}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-hand-holding-heart text-pink-500 mr-3"></i>
              Vrije Giften & Donaties
            </h1>
            <p class="mt-2 text-gray-600">
              Jouw steun maakt het verschil voor Animato. Bedankt!
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Donation Form */}
            <div class="md:col-span-2">
                <div class="bg-white rounded-lg shadow-md p-6 mb-8 border-t-4 border-pink-500">
                    <h2 class="text-xl font-bold text-gray-900 mb-4">Doe een vrije gift</h2>
                    <form action="/api/leden/donatie" method="POST">
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Ik wil graag doneren:</label>
                            <div class="grid grid-cols-3 gap-3 mb-3">
                                <button type="button" onclick="setAmount(10)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition">€ 10</button>
                                <button type="button" onclick="setAmount(25)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition">€ 25</button>
                                <button type="button" onclick="setAmount(50)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition">€ 50</button>
                            </div>
                            <div class="relative rounded-md shadow-sm">
                                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <span class="text-gray-500 sm:text-sm">€</span>
                                </div>
                                <input type="number" name="amount" id="customAmount" step="0.01" min="1" class="block w-full rounded-md border-gray-300 pl-7 pr-12 focus:border-pink-500 focus:ring-pink-500 py-3 text-lg" placeholder="Eigen bedrag" required />
                            </div>
                        </div>
                        
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Bericht (optioneel)</label>
                            <textarea name="message" rows={2} class="w-full border rounded-lg p-2 text-sm" placeholder="Een korte boodschap voor het koor..."></textarea>
                        </div>

                        <div class="flex items-center mb-6">
                            <input type="checkbox" name="anonymous" id="anon" value="1" class="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded" />
                            <label for="anon" class="ml-2 block text-sm text-gray-900">Anoniem doneren (niet tonen in lijsten)</label>
                        </div>

                        <button type="submit" class="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-3 px-4 rounded-lg transition shadow flex items-center justify-center">
                            <i class="fas fa-heart mr-2"></i>
                            Nu Doneren via Mollie
                        </button>
                        <p class="text-xs text-center text-gray-500 mt-3">Veilig betalen met Bancontact, Payconiq of kaart.</p>
                    </form>
                </div>

                <div class="bg-white rounded-lg shadow-md p-6">
                    <h2 class="text-xl font-bold text-gray-900 mb-4">Mijn Donatie Geschiedenis</h2>
                    {donations.length > 0 ? (
                        <div class="overflow-x-auto">
                            <table class="min-w-full text-sm">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-4 py-2 text-left font-medium text-gray-500">Datum</th>
                                        <th class="px-4 py-2 text-left font-medium text-gray-500">Bedrag</th>
                                        <th class="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100">
                                    {donations.map((d: any) => (
                                        <tr>
                                            <td class="px-4 py-3 text-gray-600">{new Date(d.created_at).toLocaleDateString('nl-BE')}</td>
                                            <td class="px-4 py-3 font-semibold text-gray-900">€ {d.amount.toFixed(2)}</td>
                                            <td class="px-4 py-3">
                                                {d.status === 'paid' ? (
                                                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Betaald</span>
                                                ) : d.status === 'cancelled' ? (
                                                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Geannuleerd</span>
                                                ) : (
                                                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">In behandeling</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p class="text-gray-500 italic text-center py-4">Nog geen donaties gevonden.</p>
                    )}
                </div>
            </div>

            {/* Sidebar info */}
            <div class="md:col-span-1">
                <div class="bg-pink-50 rounded-lg p-6 mb-6">
                    <h3 class="font-bold text-pink-800 mb-2">Totaal gedoneerd</h3>
                    <p class="text-3xl font-bold text-pink-600 mb-1">€ {total.toFixed(2)}</p>
                    <p class="text-sm text-pink-700">Bedankt voor je geweldige steun!</p>
                </div>

                <div class="bg-white rounded-lg shadow-sm p-6">
                    <h3 class="font-bold text-gray-900 mb-3">Waarom doneren?</h3>
                    <ul class="space-y-2 text-sm text-gray-600">
                        <li class="flex items-start"><i class="fas fa-check text-green-500 mt-1 mr-2"></i> Steun nieuwe muziekprojecten</li>
                        <li class="flex items-start"><i class="fas fa-check text-green-500 mt-1 mr-2"></i> Onderhoud van instrumenten</li>
                        <li class="flex items-start"><i class="fas fa-check text-green-500 mt-1 mr-2"></i> Huren van concertlocaties</li>
                        <li class="flex items-start"><i class="fas fa-check text-green-500 mt-1 mr-2"></i> Organiseren van workshops</li>
                    </ul>
                </div>
            </div>
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{__html: `
        function setAmount(val) {
            document.getElementById('customAmount').value = val;
        }
      `}} />
    </Layout>
  )
})

app.post('/api/leden/donatie', async (c) => {
    const user = c.get('user') as SessionUser
    const body = await c.req.parseBody()
    const amount = parseFloat(String(body.amount))
    
    if (!amount || amount < 1) return c.redirect('/leden/donaties?error=invalid_amount')

    const siteUrl = c.env.SITE_URL || 'https://animato.be'

    // Bug #197 — naam + referentie meegeven in Mollie description.
    // We doen INSERT eerst zodat we de donation_id meteen in de description
    // en metadata kunnen meegeven (was vroeger via een dode dubbele call).
    const insertRes = await execute(c.env.DB, `
        INSERT INTO donations (user_id, amount, message, is_anonymous, status)
        VALUES (?, ?, ?, ?, 'pending')
    `, [user.id, amount, body.message, body.anonymous ? 1 : 0])

    const donationId = insertRes.meta.last_row_id
    const donationRef = `GIFT-D${donationId}`
    const payerName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || user.email

    const payment = await createMolliePayment(await getMollieApiKey(c.env), {
        amount: amount,
        description: `${payerName} — Vrije Gift Animato [${donationRef}]`,
        redirectUrl: `${siteUrl}/leden/donaties?success=true`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
            type: 'donation',
            user_id: user.id,
            donation_id: donationId,
            payer_name: payerName,
            payment_ref: donationRef
        }
    })

    await execute(c.env.DB, `UPDATE donations SET payment_id = ?, status = 'pending' WHERE id = ?`, [payment.id, donationId])

    return c.redirect(payment.checkoutUrl)
})

// =====================================================
// MESSAGEBOARD OVERZICHT
// =====================================================

app.get('/leden/board', async (c) => {
  const user = c.get('user') as SessionUser
  const categorie = c.req.query('cat') || 'all'
  const search = c.req.query('search') || ''

  // Markeer dit als sectiebezoek voor "Nieuw sinds vorige bezoek"-badges
  try {
    const { markSectionVisit } = await import('../utils/section-visits')
    await markSectionVisit(c.env.DB, user.id, 'forum')
  } catch (_) {}

  // Bouw zichtbaarheidsfilter rolafhankelijk:
  // - Iedereen: 'leden' + eigen stemgroep
  // - Admins/bestuursleden: ook 'bestuur'
  //
  // Bug #202 — DB slaat stemgroep als 'S','A','T','B' op, posts.zichtbaarheid
  // gebruikt 'sopraan'/'alt'/'tenor'/'bas'. Map expliciet.
  const stemMapForum: Record<string, string> = {
    s: 'sopraan', sopraan: 'sopraan',
    a: 'alt',     alt:     'alt',
    t: 'tenor',   tenor:   'tenor',
    b: 'bas',     bas:     'bas',
  }
  const isStaff = user.role === 'admin' || user.role === 'bestuur' || (user as any).is_bestuurslid === 1
  const userStemKey = (user.stemgroep || '').toLowerCase()
  const userStemLabel = stemMapForum[userStemKey]
  const visibilityValues: string[] = ['leden']
  if (userStemLabel) visibilityValues.push(userStemLabel)
  if (isStaff) visibilityValues.push('bestuur')
  const visibilityPlaceholders = visibilityValues.map(() => '?').join(',')

  // Build query
  let query = `
    SELECT p.id, p.titel, p.slug, p.created_at, p.categorie, p.is_pinned, p.views,
           u.id as auteur_id, pr.voornaam as auteur_voornaam, pr.achternaam as auteur_achternaam,
           (SELECT COUNT(*) FROM post_replies WHERE post_id = p.id AND is_deleted = 0) as reply_count
    FROM posts p
    LEFT JOIN users u ON u.id = p.auteur_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.type = 'board' 
      AND p.is_published = 1
      AND p.zichtbaarheid IN (${visibilityPlaceholders})
  `

  const filters: any[] = [...visibilityValues]

  if (categorie !== 'all') {
    query += ` AND p.categorie = ?`
    filters.push(categorie)
  }

  if (search) {
    query += ` AND (p.titel LIKE ? OR p.body LIKE ?)`
    const searchTerm = `%${search}%`
    filters.push(searchTerm, searchTerm)
  }

  query += ` ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 50`

  const threads = await queryAll(c.env.DB, query, filters)

  return c.html(
    <Layout title="Berichten" user={user} impersonating={!!(c.get('impersonating' as any))}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                Berichten
              </h1>
              <p class="text-gray-600">
                Communiceer met andere koorleden
              </p>
            </div>
            <a href="/leden" class="text-animato-primary hover:underline">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar dashboard
            </a>
          </div>

          {/* Search & Filter */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-8">
            <div class="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <form method="GET" class="flex-1">
                <input type="hidden" name="cat" value={categorie} />
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                  </div>
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek in berichten..."
                    class="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </form>

              {/* Category filter */}
              <div class="flex flex-wrap gap-2">
                <a
                  href="/leden/board?cat=all"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'all'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Alle
                </a>
                <a
                  href="/leden/board?cat=algemeen"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'algemeen'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Algemeen
                </a>
                <a
                  href="/leden/board?cat=sopraan"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'sopraan'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Sopraan
                </a>
                <a
                  href="/leden/board?cat=alt"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'alt'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Alt
                </a>
                <a
                  href="/leden/board?cat=tenor"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'tenor'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Tenor
                </a>
                <a
                  href="/leden/board?cat=bas"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'bas'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Bas
                </a>
                {isStaff && (
                  <a
                    href="/leden/board?cat=bestuur"
                    class={`px-4 py-2 rounded-lg font-semibold transition ${
                      categorie === 'bestuur'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                    }`}
                    title="Alleen zichtbaar voor bestuur en admins"
                  >
                    <i class="fas fa-shield-alt mr-1"></i>
                    Bestuur
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Threads list */}
          {threads.length > 0 ? (
            <div class="space-y-4">
              {threads.map((thread: any) => (
                <a
                  href={`/leden/board/${thread.id}`}
                  class="block bg-white rounded-lg shadow-md hover:shadow-lg transition p-6"
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        {thread.is_pinned && (
                          <i class="fas fa-thumbtack text-animato-primary"></i>
                        )}
                        <span class={`px-3 py-1 rounded-full text-xs font-semibold ${
                          thread.categorie === 'algemeen' ? 'bg-gray-100 text-gray-800' :
                          thread.categorie === 'sopraan' ? 'bg-pink-100 text-pink-800' :
                          thread.categorie === 'alt' ? 'bg-purple-100 text-purple-800' :
                          thread.categorie === 'tenor' ? 'bg-blue-100 text-blue-800' :
                          thread.categorie === 'bas' ? 'bg-green-100 text-green-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {thread.categorie.charAt(0).toUpperCase() + thread.categorie.slice(1)}
                        </span>
                      </div>
                      <h3 class="text-xl font-bold text-gray-900 mb-2 hover:text-animato-primary">
                        {thread.titel}
                      </h3>
                      <div class="flex items-center text-sm text-gray-600 gap-4">
                        <span>
                          <i class="far fa-user mr-1"></i>
                          {thread.auteur_voornaam} {thread.auteur_achternaam}
                        </span>
                        <span>
                          <i class="far fa-calendar mr-1"></i>
                          {new Date(thread.created_at).toLocaleDateString('nl-BE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                        <span>
                          <i class="far fa-comment mr-1"></i>
                          {thread.reply_count} reacties
                        </span>
                        <span>
                          <i class="far fa-eye mr-1"></i>
                          {thread.views} views
                        </span>
                      </div>
                    </div>
                    <i class="fas fa-chevron-right text-gray-400 ml-4"></i>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow-md p-12 text-center">
              <i class="fas fa-comments text-gray-300 text-6xl mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">
                Geen berichten gevonden
              </h3>
              <p class="text-gray-600">
                {search ? 'Probeer een andere zoekopdracht' : 'Nog geen berichten in deze categorie'}
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// MESSAGEBOARD THREAD DETAIL
// =====================================================

app.get('/leden/board/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const threadId = c.req.param('id')

  // Get thread
  const thread = await queryOne<any>(
    c.env.DB,
    `SELECT p.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM posts p
     LEFT JOIN users u ON u.id = p.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE p.id = ? AND p.type = 'board'`,
    [threadId]
  )

  if (!thread) {
    return c.notFound()
  }

  // Check visibility — admins/bestuur zien alles; leden zien 'leden' + eigen stemgroep + 'bestuur' alleen als ze bestuurslid zijn
  const isStaff = user.role === 'admin' || user.role === 'bestuur' || user.is_bestuurslid === 1
  const userStemLower = (user.stemgroep || '').toLowerCase()
  const allowedVisibilities = ['leden']
  if (userStemLower) allowedVisibilities.push(userStemLower)
  if (isStaff) allowedVisibilities.push('bestuur')
  if (!isStaff && !allowedVisibilities.includes(thread.zichtbaarheid)) {
    return c.json({ error: 'Geen toegang tot dit bericht' }, 403)
  }

  // Increment views
  await c.env.DB.prepare(
    'UPDATE posts SET views = views + 1 WHERE id = ?'
  ).bind(threadId).run()

  // Get replies
  const replies = await queryAll<any>(
    c.env.DB,
    `SELECT r.*, 
            u.id as auteur_id, 
            pr.voornaam as auteur_voornaam, 
            pr.achternaam as auteur_achternaam,
            pr.foto_url as auteur_foto
     FROM post_replies r
     LEFT JOIN users u ON u.id = r.auteur_id
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE r.post_id = ? AND r.is_deleted = 0
     ORDER BY r.created_at ASC`,
    [threadId]
  )

  // Comment-reactions (6 emoji's) op individuele post_replies — bulk-fetch
  {
    const { getReactionsForTargets } = await import('../utils/comment-reactions')
    const replyMap = replies.length > 0
      ? await getReactionsForTargets(c.env.DB, 'post_reply', replies.map((r: any) => r.id), user.id)
      : new Map()
    for (const r of replies) {
      const s = replyMap.get(r.id)
      r._reactions_counts = s ? s.counts : { like:0,love:0,laugh:0,music:0,clap:0,pray:0 }
      r._reactions_mine = s ? Array.from(s.mine) : []
    }
  }

  // 📣 @mentions: bulk-resolve over reply-bodies (Quill HTML, dus geen extra escape)
  if (replies.length > 0) {
    try {
      const { extractMentionTokens, resolveMentions, renderMentions } = await import('../utils/mentions')
      const allTokens = new Set<string>()
      for (const r of replies) {
        for (const t of extractMentionTokens(r.body)) allTokens.add(t)
      }
      if (allTokens.size > 0) {
        const mentionMap = await resolveMentions(c.env.DB, Array.from(allTokens))
        for (const r of replies) {
          r._body_with_mentions = renderMentions(r.body, mentionMap)
        }
      }
    } catch (_) { /* graceful */ }
  }

  // === Emoji-reacties op het board-bericht ===
  // Aggregaat per type én de eigen reactie van de gebruiker (om te tonen welke al gekozen is)
  const reactionCountsRaw = await queryAll<any>(
    c.env.DB,
    `SELECT type, COUNT(*) as n FROM post_reactions WHERE post_id = ? GROUP BY type`,
    [threadId]
  )
  const reactionCounts: Record<string, number> = {}
  for (const row of reactionCountsRaw) reactionCounts[row.type] = row.n

  const myReaction = await queryOne<any>(
    c.env.DB,
    `SELECT type FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1`,
    [threadId, user.id]
  )
  const myReactionType: string | null = myReaction?.type || null

  // === Reactions per reply zijn al opgehaald hierboven in _reactions_counts ===

  return c.html(
    <Layout title={thread.titel} user={user} impersonating={!!(c.get('impersonating' as any))}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back button */}
          <a href="/leden/board" class="inline-flex items-center text-animato-primary hover:underline mb-6">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar berichten
          </a>

          {/* Thread */}
          <div class="bg-white rounded-lg shadow-md p-8 mb-6">
            <div class="flex items-center gap-3 mb-4">
              {thread.is_pinned && (
                <i class="fas fa-thumbtack text-animato-primary"></i>
              )}
              <span class={`px-3 py-1 rounded-full text-xs font-semibold ${
                thread.categorie === 'algemeen' ? 'bg-gray-100 text-gray-800' :
                thread.categorie === 'sopraan' ? 'bg-pink-100 text-pink-800' :
                thread.categorie === 'alt' ? 'bg-purple-100 text-purple-800' :
                thread.categorie === 'tenor' ? 'bg-blue-100 text-blue-800' :
                thread.categorie === 'bas' ? 'bg-green-100 text-green-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {thread.categorie.charAt(0).toUpperCase() + thread.categorie.slice(1)}
              </span>
            </div>

            <h1 class="text-3xl font-bold text-gray-900 mb-4">
              {thread.titel}
            </h1>

            <div class="flex items-center text-sm text-gray-600 gap-4 mb-6 pb-6 border-b">
              <div class="flex items-center">
                <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-2">
                  <i class="fas fa-user text-animato-primary"></i>
                </div>
                <div>
                  <div class="font-medium text-gray-900">
                    {thread.auteur_voornaam} {thread.auteur_achternaam}
                  </div>
                  <div class="text-xs">
                    {new Date(thread.created_at).toLocaleDateString('nl-BE', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </div>
                </div>
              </div>
              <span class="text-gray-300">•</span>
              <span>
                <i class="far fa-eye mr-1"></i>
                {thread.views + 1} views
              </span>
            </div>

            <div 
              class="prose prose-lg max-w-none"
              dangerouslySetInnerHTML={{ __html: processBodyLinks(thread.body, [new URL(c.req.url).hostname, 'animato-live.pages.dev', 'animato.be']) }}
            />
          </div>

          {/* ======================================================== */}
          {/* EMOJI-REACTIES — duim/hartje/etc. op het board-bericht    */}
          {/* ======================================================== */}
          {(() => {
            const reactionTypes = [
              { key: 'like',  emoji: '👍', label: 'Duim' },
              { key: 'love',  emoji: '❤️', label: 'Hartje' },
              { key: 'laugh', emoji: '😄', label: 'Lachen' },
              { key: 'wow',   emoji: '😮', label: 'Wow' },
              { key: 'sad',   emoji: '😢', label: 'Verdrietig' },
            ]
            const totalReactions = Object.values(reactionCounts).reduce((a, b) => a + b, 0)
            return (
              <div class="bg-white rounded-lg shadow-md p-5 mb-6">
                <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 class="text-sm font-semibold text-gray-700 flex items-center">
                    <i class="fas fa-smile-beam text-animato-primary mr-2"></i>
                    Hoe vind je dit bericht?
                  </h3>
                  {totalReactions > 0 && (
                    <span class="text-xs text-gray-500">
                      {totalReactions} reactie{totalReactions === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div class="flex flex-wrap gap-2" id="emoji-reactions-bar" data-thread-id={threadId}>
                  {reactionTypes.map(rt => {
                    const count = reactionCounts[rt.key] || 0
                    const isMine = myReactionType === rt.key
                    return (
                      <button
                        type="button"
                        data-reaction-type={rt.key}
                        class={`emoji-reaction-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-full border-2 transition text-sm font-medium ${
                          isMine
                            ? 'bg-animato-primary/10 border-animato-primary text-animato-primary'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                        }`}
                        title={rt.label}
                        aria-pressed={isMine ? 'true' : 'false'}
                      >
                        <span class="text-base leading-none" aria-hidden="true">{rt.emoji}</span>
                        <span class="emoji-count tabular-nums">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Replies */}
          <div class="space-y-4">
            <h2 class="text-2xl font-bold text-gray-900">
              {replies.length} Reacties
            </h2>

            {replies.map((reply: any) => {
              const canDelete = user.id === reply.auteur_id || user.role === 'admin' || user.role === 'moderator' || user.is_bestuurslid === 1
              const initialen = (reply.auteur_voornaam?.[0] || '?') + (reply.auteur_achternaam?.[0] || '')
              return (
                <div class="bg-white rounded-lg shadow-md p-6">
                  <div class="flex items-start gap-4">
                    {reply.auteur_foto ? (
                      <img src={reply.auteur_foto}
                           alt={`${reply.auteur_voornaam} ${reply.auteur_achternaam}`}
                           class="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                    ) : (
                      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-animato-primary to-animato-secondary text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {initialen}
                      </div>
                    )}
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div>
                          <div class="font-semibold text-gray-900">
                            {reply.auteur_voornaam} {reply.auteur_achternaam}
                          </div>
                          <div class="text-xs text-gray-600">
                            {formatBrusselsDateTime(reply.created_at, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                        {canDelete && (
                          <form method="POST" action={`/leden/board/${threadId}/reply/${reply.id}/delete`}
                                onsubmit="return confirm('Reactie verwijderen?')"
                                class="inline-block">
                            <button type="submit" class="text-xs text-red-500 hover:text-red-700 hover:underline">
                              <i class="fas fa-trash-alt mr-1"></i> Verwijderen
                            </button>
                          </form>
                        )}
                      </div>
                      <div class="prose" dangerouslySetInnerHTML={{
                        __html: processBodyLinks(
                          reply._body_with_mentions || reply.body,
                          [new URL(c.req.url).hostname, 'animato-live.pages.dev', 'animato.be']
                        )
                      }} />
                      {/* Emoji-reacties op deze reply (auto-init door /static/js/comment-reactions.js) */}
                      <div
                        class="comment-reactions mt-2"
                        data-target-type="post_reply"
                        data-target-id={reply.id}
                        data-counts={JSON.stringify(reply._reactions_counts || {})}
                        data-mine={JSON.stringify(reply._reactions_mine || [])}
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Reactie toevoegen */}
            <form method="POST" action={`/leden/board/${threadId}/reply`}
                  class="bg-white rounded-lg shadow-md p-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                Plaats een reactie
              </h3>
              <textarea name="body" required rows={4} maxlength={5000}
                        placeholder="Schrijf hier je reactie..."
                        class="w-full border-gray-300 rounded-lg p-3 border focus:ring-animato-primary focus:border-animato-primary text-sm"></textarea>
              <div class="flex items-center justify-between mt-3 flex-wrap gap-2">
                <p class="text-xs text-gray-400">
                  <i class="fas fa-info-circle mr-1"></i>
                  Je naam en foto worden bij de reactie getoond.
                </p>
                <button type="submit"
                        class="inline-flex items-center bg-animato-primary hover:bg-animato-secondary text-white px-4 py-2 rounded-lg font-semibold text-sm transition">
                  <i class="fas fa-paper-plane mr-2"></i> Plaatsen
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* CLIENT-SIDE JS — emoji-reacties (toggle, switch, count)     */}
      {/* ========================================================== */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var bar = document.getElementById('emoji-reactions-bar');
          if (!bar) return;
          var threadId = bar.dataset.threadId;
          var draggedCard = null;

          bar.addEventListener('click', function(e) {
            var btn = e.target.closest('.emoji-reaction-btn');
            if (!btn) return;
            e.preventDefault();

            var type = btn.dataset.reactionType;
            btn.disabled = true;
            btn.style.opacity = '0.6';

            fetch('/leden/board/' + encodeURIComponent(threadId) + '/reactie-emoji', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ type: type }),
              credentials: 'same-origin'
            })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              var allBtns = bar.querySelectorAll('.emoji-reaction-btn');
              allBtns.forEach(function(b) {
                var t = b.dataset.reactionType;
                var n = (data.counts && data.counts[t]) || 0;
                var countEl = b.querySelector('.emoji-count');
                if (countEl) countEl.textContent = n;

                if (data.myReaction === t) {
                  b.classList.remove('bg-gray-50', 'border-gray-200', 'text-gray-700', 'hover:bg-gray-100', 'hover:border-gray-300');
                  b.classList.add('bg-animato-primary/10', 'border-animato-primary', 'text-animato-primary');
                  b.setAttribute('aria-pressed', 'true');
                } else {
                  b.classList.remove('bg-animato-primary/10', 'border-animato-primary', 'text-animato-primary');
                  b.classList.add('bg-gray-50', 'border-gray-200', 'text-gray-700', 'hover:bg-gray-100', 'hover:border-gray-300');
                  b.setAttribute('aria-pressed', 'false');
                }
              });
            })
            .catch(function(err) {
              console.warn('Reactie opslaan mislukt:', err);
            })
            .finally(function() {
              btn.disabled = false;
              btn.style.opacity = '1';
            });
          });
        })();
      ` }} />
      {/* Bootstrap voor polymorphic comment_reactions op replies */}
      <script src="/static/js/comment-reactions.js" defer></script>
    </Layout>
  )
})

// =====================================================
// BOARD — Reply POST + Delete + Emoji-reactie endpoints
// =====================================================

// Plaats een reactie op een board-thread
app.post('/leden/board/:id/reply', async (c) => {
  const user = c.get('user') as SessionUser
  const threadId = parseInt(c.req.param('id'))
  const body = await c.req.parseBody()
  const raw = String(body.body || '').trim()

  if (!raw || !threadId) {
    return c.redirect(`/leden/board/${threadId}`)
  }
  const safeBody = raw.length > 5000 ? raw.substring(0, 5000) : raw

  // Verifieer dat de thread bestaat en dat user toegang heeft (zelfde check als de detail-page)
  const thread = await queryOne<any>(
    c.env.DB,
    `SELECT id, titel, auteur_id, zichtbaarheid FROM posts WHERE id = ? AND type = 'board' LIMIT 1`,
    [threadId]
  )
  if (!thread) return c.notFound()

  const isStaff = user.role === 'admin' || user.role === 'bestuur' || user.is_bestuurslid === 1
  const userStemLower = (user.stemgroep || '').toLowerCase()
  const allowedVisibilities = ['leden']
  if (userStemLower) allowedVisibilities.push(userStemLower)
  if (isStaff) allowedVisibilities.push('bestuur')
  if (!isStaff && !allowedVisibilities.includes(thread.zichtbaarheid)) {
    return c.json({ error: 'Geen toegang tot dit bericht' }, 403)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO post_replies (post_id, auteur_id, body) VALUES (?, ?, ?)`
    ).bind(threadId, user.id, safeBody).run()
  } catch (e: any) {
    console.warn('Board reply insert failed:', e?.message)
  }

  // 🔔 Notify thread-auteur (tenzij hij zelf reageert). Honoreert opt-out 'board'.
  try {
    if (thread.auteur_id && thread.auteur_id !== user.id) {
      const replierName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || 'Een lid'
      const preview = safeBody.length > 100 ? safeBody.substring(0, 97) + '…' : safeBody
      await notifyUserIfEnabled(
        c.env.DB,
        thread.auteur_id,
        'board',
        `${replierName} reageerde op je bericht`,
        `${thread.titel || 'Forum'}: ${preview}`,
        `/leden/board/${threadId}`
      )
    }
  } catch (e) { console.error('[notif] board-reply notify failed:', e) }

  // 📣 @mentions in board reply
  try {
    const { extractMentionTokens, resolveMentions, notifyMentionedUsers } = await import('../utils/mentions')
    const tokens = extractMentionTokens(safeBody)
    if (tokens.length > 0) {
      const mentionMap = await resolveMentions(c.env.DB, tokens)
      // Sluit thread-auteur uit (al genotificeerd hierboven)
      if (thread.auteur_id) {
        for (const [k, v] of mentionMap) {
          if (v.userId === thread.auteur_id) mentionMap.delete(k)
        }
      }
      const replierName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || 'Een lid'
      const preview = safeBody.length > 120 ? safeBody.substring(0, 117) + '…' : safeBody
      await notifyMentionedUsers(c.env.DB, mentionMap, {
        authorId: user.id,
        authorName: replierName,
        title: `${replierName} noemde je in '${thread.titel || 'een bericht'}'`,
        bodySnippet: preview,
        link: `/leden/board/${threadId}`,
      })
    }
  } catch (e) { console.error('[mentions] board-reply failed:', e) }

  return c.redirect(`/leden/board/${threadId}`)
})

// Verwijder een reactie (eigenaar of admin/moderator/bestuur)
app.post('/leden/board/:id/reply/:replyId/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const threadId = c.req.param('id')
  const replyId = c.req.param('replyId')

  const reply = await queryOne<any>(
    c.env.DB,
    `SELECT auteur_id FROM post_replies WHERE id = ? LIMIT 1`,
    [replyId]
  )
  if (!reply) return c.redirect(`/leden/board/${threadId}`)

  const isOwner = reply.auteur_id === user.id
  const isStaff = user.role === 'admin' || user.role === 'moderator' || user.role === 'bestuur' || user.is_bestuurslid === 1
  if (!isOwner && !isStaff) {
    return c.redirect(`/leden/board/${threadId}`)
  }

  try {
    // Soft delete — behoudt thread-history
    await c.env.DB.prepare(
      `UPDATE post_replies SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(replyId).run()
  } catch (e: any) {
    console.warn('Board reply delete failed:', e?.message)
  }

  return c.redirect(`/leden/board/${threadId}`)
})

// Emoji-reactie op een board-thread (toggle/switch)
const BOARD_REACTION_TYPES = ['like', 'love', 'laugh', 'wow', 'sad']
app.post('/leden/board/:id/reactie-emoji', async (c) => {
  const user = c.get('user') as SessionUser
  const threadId = parseInt(c.req.param('id'))

  let body: any
  try { body = await c.req.json() } catch { body = {} }
  const type = String(body?.type || '').trim()
  if (!BOARD_REACTION_TYPES.includes(type)) {
    return c.json({ error: 'Ongeldig type' }, 400)
  }

  // Verifieer dat de board-thread bestaat
  const thread = await queryOne<any>(
    c.env.DB,
    `SELECT id FROM posts WHERE id = ? AND type = 'board' LIMIT 1`,
    [threadId]
  )
  if (!thread) return c.json({ error: 'Bericht niet gevonden' }, 404)

  // Bestaande reactie?
  const existing = await queryOne<any>(
    c.env.DB,
    `SELECT id, type FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1`,
    [threadId, user.id]
  )

  try {
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO post_reactions (post_id, user_id, type) VALUES (?, ?, ?)`
      ).bind(threadId, user.id, type).run()
    } else if (existing.type === type) {
      await c.env.DB.prepare(
        `DELETE FROM post_reactions WHERE id = ?`
      ).bind(existing.id).run()
    } else {
      await c.env.DB.prepare(
        `UPDATE post_reactions SET type = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(type, existing.id).run()
    }
  } catch (e: any) {
    console.warn('Board reactie mislukt:', e?.message)
    return c.json({ error: 'Opslaan mislukt' }, 500)
  }

  const countsRaw = await queryAll<any>(
    c.env.DB,
    `SELECT type, COUNT(*) as n FROM post_reactions WHERE post_id = ? GROUP BY type`,
    [threadId]
  )
  const counts: Record<string, number> = {}
  for (const row of countsRaw) counts[row.type] = row.n

  const mine = await queryOne<any>(
    c.env.DB,
    `SELECT type FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1`,
    [threadId, user.id]
  )

  return c.json({
    counts,
    myReaction: mine?.type || null
  })
})

// =====================================================
// PROFIEL BEWERKEN
// =====================================================

app.get('/leden/profiel', async (c) => {
  const user = c.get('user') as SessionUser
  const success = c.req.query('success')
  const error = c.req.query('error')
  const paymentId = c.req.query('payment_id')
  const paymentReturn = c.req.query('payment') === 'success'

  // Auto-confirm mock payments in dev
  if (paymentId && paymentId.startsWith('tr_MOCK_')) {
      const siteUrl = c.env.SITE_URL || 'http://localhost:3000'
      try {
          // Trigger webhook
          await fetch(`${siteUrl}/api/webhooks/mollie`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `id=${paymentId}`
          })
      } catch (e) {
          console.error('Failed to trigger mock webhook', e)
      }
  }

  // BUG-FIX (Dominique): Eager refresh wanneer lid terugkomt van Mollie met
  // ?payment=success. Webhook kan vertraagd zijn of (zelden) niet aankomen —
  // we polleren actief de openstaande membership voor deze user en vragen
  // Mollie naar de status. Dit zorgt dat de status én notificaties direct
  // kloppen, ook al heeft de webhook nog niet ingelopen.
  //
  // We accepteren elk mollie_payment_id behalve mock-IDs (tr_MOCK_*). Echte
  // Mollie test-mode IDs zien er uit als 'tr_xxxxxxxxxx' (geen MOCK in de naam).
  if (paymentReturn) {
    try {
      const pendingMembership = await queryOne<any>(c.env.DB,
        `SELECT um.id, um.mollie_payment_id, um.status
         FROM user_memberships um
         JOIN membership_years my ON my.id = um.year_id
         WHERE um.user_id = ?
           AND my.is_active = 1
           AND um.status IN ('pending', 'open')
           AND um.mollie_payment_id IS NOT NULL
           AND um.mollie_payment_id NOT LIKE 'tr_MOCK_%'
         ORDER BY um.id DESC LIMIT 1`,
        [user.id])
      if (pendingMembership?.mollie_payment_id) {
        const { getMolliePayment } = await import('../utils/mollie')
        const { getMollieApiKey } = await import('../utils/mollie-config')
        const apiKey = await getMollieApiKey(c.env)
        // Niet falen als Mollie tijdelijk onbereikbaar is — webhook pakt het wel op
        const molliePmt = await getMolliePayment(apiKey, pendingMembership.mollie_payment_id).catch((err) => {
          console.error('[eager-refresh] getMolliePayment failed:', err)
          return null
        })
        console.log('[eager-refresh] mollie status for', pendingMembership.mollie_payment_id, '=', molliePmt?.status)
        if (molliePmt?.status === 'paid') {
          // Update direct in DB (sneller dan webhook-roundtrip) + sluit notifs
          await execute(c.env.DB,
            `UPDATE user_memberships
             SET status = 'paid',
                 paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
             WHERE id = ?`,
            [pendingMembership.id])
          await execute(c.env.DB,
            `UPDATE notifications
             SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
            [user.id])
          // Bevestigings-notif (idempotent: check eerst of er al eentje is van vandaag)
          const existing = await queryOne<any>(c.env.DB,
            `SELECT id FROM notifications
             WHERE user_id = ? AND type = 'lidgeld'
               AND titel LIKE '%ontvangen%'
               AND date(created_at) = date('now')
             LIMIT 1`,
            [user.id])
          if (!existing) {
            const { createNotification } = await import('../utils/notifications')
            const m = await queryOne<any>(c.env.DB,
              `SELECT um.amount, my.season
               FROM user_memberships um
               JOIN membership_years my ON my.id = um.year_id
               WHERE um.id = ?`,
              [pendingMembership.id])
            if (m) {
              const bedrag = m.amount ? `€ ${Number(m.amount).toFixed(2)}` : ''
              await createNotification(
                c.env.DB,
                user.id,
                'lidgeld',
                `Lidgeld ${m.season} ontvangen — bedankt! 🎵`,
                bedrag ? `We hebben ${bedrag} ontvangen. Je lidmaatschap is actief.` : 'Je lidmaatschap is actief.',
                '/leden/profiel#lidgeld'
              )
            }
          }
        }
      }
    } catch (e) { console.error('eager payment refresh failed:', e) }
  }

  // Get full profile
  const profile = await queryOne<any>(
    c.env.DB,
    `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
            p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
            p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
            p.favoriete_werk, p.instrument, p.jaren_in_koor, p.geboortedatum,
            p.straat, p.huisnummer, p.bus, p.postcode, p.stad as gemeente,
            p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon, p.lid_sinds
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [user.id]
  )

  // If no profile exists, create one
  if (!profile || !profile.voornaam) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO profiles (user_id, voornaam, achternaam, smoelenboek_zichtbaar, toon_email, toon_telefoon, lid_sinds)
         VALUES (?, ?, ?, 1, 1, 0, DATE('now'))`
      ).bind(user.id, user.voornaam || 'Nieuwe', user.achternaam || 'Gebruiker').run()
      
      // Retry fetching the profile
      const newProfile = await queryOne<any>(
        c.env.DB,
        `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
                p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
                p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
                p.favoriete_werk, p.instrument, p.jaren_in_koor, p.geboortedatum,
                p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon, p.lid_sinds
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = ?`,
        [user.id]
      )
      
      if (newProfile) {
        // Use the newly created profile
        Object.assign(profile || {}, newProfile)
      }
    } catch (error) {
      console.error('Failed to create profile:', error)
      return c.redirect('/leden?error=profile_creation_failed')
    }
  }

  // Get most recent voice analysis for this user
  const voiceAnalysis = await queryOne<any>(
    c.env.DB,
    `SELECT lowest_note, lowest_frequency, highest_note, highest_frequency, 
            primary_stemgroep, primary_confidence, secondary_stemgroep, 
            voice_type, created_at
     FROM voice_analyses
     WHERE user_id = ? AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  )

  // Get membership history
  const allMemberships = await queryAll(
    c.env.DB,
    `SELECT um.*, my.season, my.start_date, my.end_date, my.is_active
     FROM user_memberships um
     JOIN membership_years my ON um.year_id = my.id
     WHERE um.user_id = ?
     ORDER BY my.start_date DESC`,
    [user.id]
  )

  // Find current active membership (or the most recent one if none active)
  const activeMembership = allMemberships.find((m: any) => m.is_active) || allMemberships[0]

  // Get activity history
  const myActivities = await queryAll(c.env.DB, `
    SELECT ar.*, e.titel, e.start_at, e.locatie, a.id as activity_id
    FROM activity_registrations ar
    JOIN activities a ON ar.activity_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE ar.user_id = ?
    ORDER BY e.start_at DESC
  `, [user.id])

  // Get attendance streak data
  let attendanceStreak = { current: 0, longest: 0, total: 0 }
  try {
    const checkins = await queryAll<any>(c.env.DB,
      `SELECT qc.event_id FROM qr_checkins qc
       JOIN events e ON e.id = qc.event_id
       WHERE qc.user_id = ? AND e.type = 'repetitie'
       ORDER BY e.start_at DESC`,
      [user.id]
    )
    const allRehearsals = await queryAll<any>(c.env.DB,
      `SELECT id FROM events WHERE type = 'repetitie' AND datetime(start_at) <= datetime('now') ORDER BY start_at DESC`
    )
    if (checkins.length > 0 && allRehearsals.length > 0) {
      const checkedIds = new Set(checkins.map((ci: any) => ci.event_id))
      let current = 0
      for (const r of allRehearsals) { if (checkedIds.has(r.id)) current++; else break; }
      let longest = 0, temp = 0
      for (const r of allRehearsals) { if (checkedIds.has(r.id)) { temp++; longest = Math.max(longest, temp); } else { temp = 0; } }
      attendanceStreak = { current, longest, total: checkins.length }
    }
  } catch (e) { /* table may not exist yet */ }

  // ─── #116/widget — Meldingen-kaart met 3 tabs ─────────────────────────
  // Bron 1: alle DB-notificaties (laatste 50, voor 'Alles'-tab)
  const allNotifications = await getNotificationsForUser(c.env.DB, user.id, 50)
  const unreadCount = allNotifications.filter((n: any) => !n.is_gelezen).length

  // Bron 2: openstaande nieuws-posts (laatste 14d) die het lid nog NIET
  // heeft gedismissed. Spiegelt /leden-widget zodat /profiel synchroon loopt.
  let openNews: Array<{ id: number; titel: string; slug: string; published_at: string }> = []
  try {
    const lastLoginRow = await queryOne<any>(c.env.DB,
      `SELECT previous_login_at FROM users WHERE id = ?`, [user.id])
    const sinceDate = lastLoginRow?.previous_login_at || null
    const sinceClause = sinceDate
      ? `AND datetime(p.published_at) >= datetime(?)`
      : `AND datetime(p.published_at) >= datetime('now', '-14 days')`
    // Bug #202 — bouw zichtbaarheidsfilter incl. eigen stemgroep
    const stemMapONews: Record<string, string> = { s:'sopraan', a:'alt', t:'tenor', b:'bas' }
    const stemLabelONews = stemMapONews[(user.stemgroep || '').toLowerCase()]
    const isStaffONews = user.role === 'admin' || (user as any).is_bestuurslid === 1
    const visONews: string[] = ['publiek', 'leden']
    if (stemLabelONews) visONews.push(stemLabelONews)
    if (isStaffONews) visONews.push('bestuur')
    const visPhONews = visONews.map(() => '?').join(',')
    const newsParams: any[] = sinceDate
      ? [user.id, ...visONews, sinceDate]
      : [user.id, ...visONews]
    openNews = await queryAll<any>(c.env.DB,
      `SELECT p.id, p.titel, p.slug, p.published_at
       FROM posts p
       LEFT JOIN user_news_dismissed und
         ON und.post_id = p.id AND und.user_id = ?
       WHERE p.type = 'nieuws'
         AND p.is_published = 1
         AND p.zichtbaarheid IN (${visPhONews})
         AND und.id IS NULL
         ${sinceClause}
       ORDER BY p.published_at DESC
       LIMIT 10`,
      newsParams)
  } catch (e) { /* ignore */ }

  // Bron 3: gearchiveerde (=gedismissede) nieuws-posts voor 'Archief'-tab.
  // Beperk tot laatste 90 dagen: dat houdt de lijst overzichtelijk en
  // werkt netjes samen met de 'Wis archief'-actie (die dismissed_at
  // terugzet naar 100d, waardoor items uit het zicht verdwijnen zonder
  // dat de records zelf weg moeten — anders komen die items op /leden
  // terug als 'openstaand'.)
  let archivedNews: Array<{ id: number; titel: string; slug: string; published_at: string; dismissed_at: string }> = []
  try {
    archivedNews = await queryAll<any>(c.env.DB,
      `SELECT p.id, p.titel, p.slug, p.published_at, und.dismissed_at
       FROM user_news_dismissed und
       JOIN posts p ON p.id = und.post_id
       WHERE und.user_id = ?
         AND datetime(und.dismissed_at) >= datetime('now', '-90 days')
       ORDER BY und.dismissed_at DESC
       LIMIT 50`,
      [user.id])
  } catch (e) { /* ignore */ }

  // Berekenen 'Openstaand'-tab items (zelfde shape als /leden-widget,
  // maar zonder dedup — gebruiker mag rustige overzicht zien).
  type ProfielActie = {
    icon: string; iconBg: string; iconColor: string;
    titel: string; body?: string; link?: string; cta?: string;
    dismissType?: 'news' | 'notification';
    dismissId?: number;
    canDismiss: boolean;  // sommige acties zijn niet weg te klikken (lidgeld!)
  }
  const profielOpenActies: ProfielActie[] = []

  // 1) Openstaand lidgeld — NIET dismissible (moet effectief afgehandeld)
  // Bug #207 — dirigent en pianist hoeven geen lidgeld te betalen → sla over
  let hasOpenLidgeldActie = false
  if (!['dirigent', 'pianist'].includes(user.role) &&
      activeMembership && activeMembership.is_active &&
      (!activeMembership.status || !['paid','waived'].includes(activeMembership.status))) {
    profielOpenActies.push({
      icon: 'fas fa-euro-sign', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      titel: `Lidgeld ${activeMembership.season} nog te betalen`,
      body: activeMembership.amount ? `Bedrag: € ${Number(activeMembership.amount).toFixed(2)}` : undefined,
      link: '/leden/profiel#lidgeld',
      cta: 'Bekijk',
      canDismiss: false
    })
    hasOpenLidgeldActie = true
  }

  // 2) Ongelezen DB-notificaties
  // BUG-FIX (Dominique, 23 mei): voor 'invitation'-type lidgeld notifs (bv.
  // "staat open", "te betalen", "herinnering", "betaalverzoek") alleen tonen
  // als er ook ECHT een pending membership-row is. Anders zijn ze stale
  // (bv. na een reset-season waar de notif bleef hangen).
  // Confirmation/paid-notifs ("ontvangen — bedankt!") blijven altijd zichtbaar.
  function isInvitationLidgeldNotif(x: any): boolean {
    if (x.type !== 'lidgeld') return false
    const t = (x.titel || '').toLowerCase()
    return t.includes('open') || t.includes('te betalen') || t.includes('herinnering') || t.includes('betaalverzoek')
  }
  for (const n of allNotifications.filter((x: any) => {
    if (x.is_gelezen) return false
    // Lidgeld-invitation: enkel als er een runtime-kaart is
    if (isInvitationLidgeldNotif(x)) return hasOpenLidgeldActie
    return true
  })) {
    const style = getNotificationStyle(n.type)
    profielOpenActies.push({
      icon: style.icon, iconBg: style.bg, iconColor: style.color,
      titel: n.titel,
      body: n.body || undefined,
      link: n.link || undefined,
      cta: n.link ? 'Bekijk' : undefined,
      dismissType: 'notification', dismissId: n.id, canDismiss: true
    })
  }

  // 3) Recent nieuws (openNews al gefilterd op niet-gedismissed)
  for (const nw of openNews) {
    profielOpenActies.push({
      icon: 'fas fa-newspaper', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      titel: 'Nieuw bericht: ' + nw.titel,
      link: `/nieuws/${nw.slug}`, cta: 'Lees',
      dismissType: 'news', dismissId: nw.id, canDismiss: true
    })
  }

  // 4) Profiel onvolledig (~ /leden-logica)
  const _pFields = profile ? [
    profile.voornaam, profile.achternaam, profile.email, profile.telefoon,
    profile.straat, profile.huisnummer, profile.postcode, profile.gemeente,
    profile.geboortedatum, profile.stemgroep, profile.bio, profile.profielfoto_url
  ] : []
  const _filledFields = _pFields.filter((f: any) => f && String(f).trim() !== '').length
  const _profielCompleet = profile ? Math.round((_filledFields / _pFields.length) * 100) : 0
  if (_profielCompleet < 60) {
    profielOpenActies.push({
      icon: 'fas fa-user-edit', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
      titel: `Vul je profiel verder aan (${_profielCompleet}% klaar)`,
      body: 'Foto, telefoon, adres en bio helpen ons om je beter te leren kennen.',
      link: '/leden/profiel#bewerken',
      cta: 'Vul aan',
      canDismiss: false
    })
  }

  // Buckets voor de 3 tabs
  const archivedNotifs = allNotifications.filter((n: any) => n.is_gelezen)
  const archiveCount = archivedNews.length + archivedNotifs.length
  const openCount = profielOpenActies.length

  // Notificatie-voorkeuren (settings-paneel onderaan profiel)
  const notifPrefs = await getUserNotificationPrefs(c.env.DB, user.id)

  // Privacy: tonen we de online-status van deze gebruiker aan anderen?
  // Default = 1 (zichtbaar), maar elke lid kan opt-out.
  const privacyRow = await queryOne<any>(
    c.env.DB,
    `SELECT COALESCE(show_online_status, 1) AS show_online_status FROM users WHERE id = ?`,
    [user.id]
  )
  const showOnlineStatus = privacyRow?.show_online_status === 1 || privacyRow?.show_online_status === true

  return c.html(
    <Layout 
      title="Mijn Profiel" 
      user={user}
      impersonating={!!(c.get('impersonating' as any))}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Mijn Profiel', href: '/leden/profiel' }
      ]}
    >
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-user-circle text-animato-primary mr-3"></i>
              Mijn Profiel
            </h1>
            <p class="mt-2 text-gray-600">
              Beheer je persoonlijke gegevens en voorkeuren
            </p>
          </div>

          {/* Success/Error Messages */}
          {success && (
            <div class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 mr-3"></i>
                <div class="text-sm text-green-800">
                  {success === 'profile' && 'Je profiel is succesvol bijgewerkt'}
                  {success === 'password' && 'Je wachtwoord is succesvol gewijzigd'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
                <div class="text-sm text-red-800">
                  {error === 'invalid_password' && 'Huidig wachtwoord is onjuist'}
                  {error === 'password_mismatch' && 'Nieuwe wachtwoorden komen niet overeen'}
                  {error === 'password_too_short' && 'Wachtwoord moet minimaal 8 tekens lang zijn'}
                  {error === 'update_failed' && 'Er is iets misgegaan bij het bijwerken'}
                  {error === 'profile_not_found' && 'Profiel niet gevonden'}
                </div>
              </div>
            </div>
          )}

          {/* #116 — Meldingen-kaart met 3 tabs: Openstaand / Archief / Alles */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6" id="notifications-card">
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 class="text-xl font-bold text-gray-900">
                <i class="fas fa-bell text-animato-primary mr-2"></i>
                Meldingen
                {openCount > 0 && (
                  <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                    {openCount} openstaand
                  </span>
                )}
              </h2>
              <div class="flex items-center gap-3">
                {unreadCount > 0 && (
                  <form method="POST" action="/api/leden/notifications/read-all" class="inline">
                    <button type="submit" class="text-xs text-animato-primary hover:underline font-medium">
                      <i class="fas fa-check-double mr-1"></i>
                      Markeer alles als gelezen
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Tab nav */}
            <div class="border-b border-gray-200 mb-4">
              <nav class="-mb-px flex space-x-6 text-sm" id="notifications-tabs" role="tablist">
                <button
                  type="button"
                  data-tab="open"
                  class="notif-tab whitespace-nowrap py-2 px-1 border-b-2 border-animato-primary text-animato-primary font-semibold"
                  role="tab"
                  aria-selected="true"
                >
                  Openstaand
                  {openCount > 0 && (
                    <span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-animato-primary text-white">
                      {openCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-tab="archief"
                  class="notif-tab whitespace-nowrap py-2 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  role="tab"
                  aria-selected="false"
                >
                  Archief
                  {archiveCount > 0 && (
                    <span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-700">
                      {archiveCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-tab="alles"
                  class="notif-tab whitespace-nowrap py-2 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  role="tab"
                  aria-selected="false"
                >
                  Alles
                  {allNotifications.length > 0 && (
                    <span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-700">
                      {allNotifications.length}
                    </span>
                  )}
                </button>
              </nav>
            </div>

            {/* TAB 1: Openstaand */}
            <div class="notif-pane" data-pane="open">
              {profielOpenActies.length === 0 ? (
                <div class="text-center py-8 text-gray-400">
                  <i class="fas fa-inbox text-4xl mb-2"></i>
                  <p class="text-sm">Geen openstaande meldingen — je bent helemaal bij!</p>
                </div>
              ) : (
                <ul id="profiel-open-list" class="divide-y divide-gray-100">
                  {profielOpenActies.map((a) => {
                    const dismissAttrs = a.canDismiss && a.dismissType && a.dismissId
                      ? {
                          'data-dismiss-type': a.dismissType,
                          'data-dismiss-id': String(a.dismissId)
                        }
                      : {}
                    return (
                      <li class="profiel-open-item flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition" {...dismissAttrs}>
                        <div class={`flex-shrink-0 w-9 h-9 rounded-full ${a.iconBg} ${a.iconColor} flex items-center justify-center`}>
                          <i class={a.icon}></i>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium text-gray-800 truncate">{a.titel}</p>
                          {a.body && <p class="text-xs text-gray-500 truncate">{a.body}</p>}
                        </div>
                        {a.link && (
                          <a href={a.link} data-action-link class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-animato-primary hover:bg-animato-primary/10 rounded-lg border border-animato-primary/30 transition">
                            {a.cta || 'Open'} <i class="fas fa-chevron-right text-[10px]"></i>
                          </a>
                        )}
                        {a.canDismiss && a.dismissType && a.dismissId && (
                          <button
                            type="button"
                            data-action-dismiss
                            aria-label="Archiveren"
                            title="Archiveren"
                            class="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition"
                          >
                            <i class="fas fa-times text-xs"></i>
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* TAB 2: Archief */}
            <div class="notif-pane hidden" data-pane="archief">
              {archiveCount === 0 ? (
                <div class="text-center py-8 text-gray-400">
                  <i class="fas fa-archive text-4xl mb-2"></i>
                  <p class="text-sm">Nog niets gearchiveerd.</p>
                </div>
              ) : (
                <>
                  <div class="flex justify-end mb-2">
                    <button
                      type="button"
                      id="clear-archive-btn"
                      class="text-xs text-gray-500 hover:text-red-600 hover:underline"
                      title="Verwijder alle gearchiveerde meldingen"
                    >
                      <i class="fas fa-trash-alt mr-1"></i>
                      Wis archief
                    </button>
                  </div>
                  <ul id="profiel-archive-list" class="divide-y divide-gray-100">
                    {archivedNews.map((nw) => {
                      const d = new Date(nw.dismissed_at)
                      const rel = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
                      return (
                        <li class="profiel-archive-item flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition opacity-80"
                            data-restore-type="news"
                            data-restore-id={String(nw.id)}>
                          <div class="flex-shrink-0 w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                            <i class="fas fa-newspaper"></i>
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium text-gray-700 truncate">{nw.titel}</p>
                            <p class="text-xs text-gray-400">Gearchiveerd op {rel}</p>
                          </div>
                          <a href={`/nieuws/${nw.slug}`} class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition">
                            Lees <i class="fas fa-chevron-right text-[10px]"></i>
                          </a>
                          <button
                            type="button"
                            data-action-restore
                            aria-label="Terugzetten"
                            title="Terugzetten naar Openstaand"
                            class="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center text-gray-400 hover:text-animato-primary hover:bg-animato-primary/10 rounded-full transition"
                          >
                            <i class="fas fa-undo text-xs"></i>
                          </button>
                        </li>
                      )
                    })}
                    {archivedNotifs.map((n: any) => {
                      const style = getNotificationStyle(n.type)
                      const d = n.gelezen_at ? new Date(n.gelezen_at) : new Date(n.created_at)
                      const rel = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
                      return (
                        <li class="profiel-archive-item flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition opacity-80"
                            data-restore-type="notification"
                            data-restore-id={String(n.id)}>
                          <div class={`flex-shrink-0 w-9 h-9 rounded-full ${style.bg} ${style.color} flex items-center justify-center`}>
                            <i class={style.icon}></i>
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium text-gray-700 truncate">{n.titel}</p>
                            <p class="text-xs text-gray-400">Gelezen op {rel}</p>
                          </div>
                          {n.link && (
                            <a href={n.link} class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition">
                              Bekijk <i class="fas fa-chevron-right text-[10px]"></i>
                            </a>
                          )}
                          <button
                            type="button"
                            data-action-restore
                            aria-label="Terugzetten"
                            title="Terugzetten naar Openstaand"
                            class="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center text-gray-400 hover:text-animato-primary hover:bg-animato-primary/10 rounded-full transition"
                          >
                            <i class="fas fa-undo text-xs"></i>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>

            {/* TAB 3: Alles — chronologisch, alle DB-notificaties */}
            <div class="notif-pane hidden" data-pane="alles">
              {allNotifications.length === 0 ? (
                <div class="text-center py-8 text-gray-400">
                  <i class="fas fa-list text-4xl mb-2"></i>
                  <p class="text-sm">Nog geen meldingen ontvangen.</p>
                </div>
              ) : (
                <ul class="divide-y divide-gray-100">
                  {allNotifications.map((n: any) => {
                    const style = getNotificationStyle(n.type)
                    const created = new Date(n.created_at)
                    const isUnread = !n.is_gelezen
                    const diffMs = Date.now() - created.getTime()
                    const diffMin = Math.floor(diffMs / 60000)
                    const diffHr = Math.floor(diffMin / 60)
                    const diffDay = Math.floor(diffHr / 24)
                    const relTime = diffMin < 1 ? 'zojuist'
                      : diffMin < 60 ? `${diffMin}m geleden`
                      : diffHr < 24 ? `${diffHr}u geleden`
                      : diffDay < 7 ? `${diffDay}d geleden`
                      : created.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })

                    const innerContent = (
                      <div class={`flex items-start gap-3 py-3 px-2 -mx-2 rounded-lg transition ${isUnread ? 'bg-animato-primary bg-opacity-5 hover:bg-opacity-10' : 'hover:bg-gray-50'}`}>
                        <div class={`flex-shrink-0 w-10 h-10 rounded-full ${style.bg} flex items-center justify-center`}>
                          <i class={`${style.icon} ${style.color}`}></i>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline justify-between gap-2 flex-wrap">
                            <h3 class={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                              {n.titel}
                              {isUnread && <span class="ml-2 inline-block w-2 h-2 bg-animato-primary rounded-full align-middle"></span>}
                            </h3>
                            <span class="text-[11px] text-gray-400 whitespace-nowrap">{relTime}</span>
                          </div>
                          {n.body && (
                            <p class={`text-xs mt-0.5 ${isUnread ? 'text-gray-700' : 'text-gray-500'}`}>{n.body}</p>
                          )}
                        </div>
                      </div>
                    )
                    return (
                      <li>
                        {n.link ? (<a href={n.link} class="block">{innerContent}</a>) : innerContent}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Tab + actions JS */}
            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var card = document.getElementById('notifications-card');
                if (!card) return;
                var tabs = card.querySelectorAll('.notif-tab');
                var panes = card.querySelectorAll('.notif-pane');

                function selectTab(name) {
                  tabs.forEach(function(t) {
                    var active = t.getAttribute('data-tab') === name;
                    t.setAttribute('aria-selected', active ? 'true' : 'false');
                    if (active) {
                      t.classList.add('border-animato-primary','text-animato-primary','font-semibold');
                      t.classList.remove('border-transparent','text-gray-500','hover:text-gray-700','hover:border-gray-300');
                    } else {
                      t.classList.remove('border-animato-primary','text-animato-primary','font-semibold');
                      t.classList.add('border-transparent','text-gray-500','hover:text-gray-700','hover:border-gray-300');
                    }
                  });
                  panes.forEach(function(p) {
                    p.classList.toggle('hidden', p.getAttribute('data-pane') !== name);
                  });
                  try {
                    var url = new URL(window.location.href);
                    url.hash = 'notificaties-' + name;
                    history.replaceState(null, '', url.toString());
                  } catch (e) {}
                }

                tabs.forEach(function(t) {
                  t.addEventListener('click', function() {
                    selectTab(t.getAttribute('data-tab'));
                  });
                });

                // Deep-link: #notificaties-archief / #notificaties-alles
                var h = (window.location.hash || '').replace('#','');
                if (h === 'notificaties-archief') selectTab('archief');
                else if (h === 'notificaties-alles') selectTab('alles');
                else if (h === 'notificaties') selectTab('open');

                // BUG-FIX (Claudine, 23 mei): wanneer #lidgeld in de URL staat en
                // de gebruiker al op /leden/profiel is, doet de browser geen
                // scroll-jump op mobiel — het ziet eruit alsof er "geladen
                // wordt zonder te voltooien". Force-scroll + flash om feedback
                // te geven dat de actie wel degelijk lukte.
                function flashScrollTo(id) {
                  var el = document.getElementById(id);
                  if (!el) return;
                  try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } catch(e) {
                    el.scrollIntoView();
                  }
                  el.style.transition = 'box-shadow .4s ease';
                  el.style.boxShadow = '0 0 0 4px rgba(0, 169, 206, 0.35)';
                  setTimeout(function(){
                    el.style.boxShadow = '';
                  }, 1400);
                }
                if (h === 'lidgeld') {
                  // Wacht 1 frame zodat layout klaar is voor scroll
                  setTimeout(function(){ flashScrollTo('lidgeld'); }, 50);
                }
                // Vang ook in-page clicks op notif-links af zodat het ook werkt
                // als de gebruiker al op de pagina is (hash change → geen reload).
                window.addEventListener('hashchange', function() {
                  var nh = (window.location.hash || '').replace('#','');
                  if (nh === 'lidgeld') flashScrollTo('lidgeld');
                  else if (nh === 'notificaties-archief') selectTab('archief');
                  else if (nh === 'notificaties-alles') selectTab('alles');
                  else if (nh === 'notificaties') selectTab('open');
                });

                // --- Openstaand: X-knop archiveert (fade out + API) ---
                var openList = document.getElementById('profiel-open-list');
                function endpointDismiss(type, id) {
                  if (type === 'news') return '/api/leden/news/' + id + '/dismiss';
                  if (type === 'notification') return '/api/leden/notifications/' + id + '/read';
                  return null;
                }
                if (openList) {
                  openList.addEventListener('click', function(e) {
                    var btn = e.target.closest('[data-action-dismiss]');
                    if (btn) {
                      e.preventDefault(); e.stopPropagation();
                      var li = btn.closest('.profiel-open-item');
                      if (!li) return;
                      var type = li.getAttribute('data-dismiss-type');
                      var id = li.getAttribute('data-dismiss-id');
                      var url = endpointDismiss(type, id);
                      if (!url) return;
                      try { fetch(url, { method: 'POST', credentials: 'same-origin' }).catch(function(){}); } catch(e) {}
                      li.style.transition = 'opacity .2s, transform .2s';
                      li.style.opacity = '0';
                      li.style.transform = 'translateX(8px)';
                      setTimeout(function(){
                        li.remove();
                        // Update badge in tab
                        var openTab = card.querySelector('.notif-tab[data-tab="open"] span');
                        if (openTab) {
                          var n = parseInt(openTab.textContent || '0', 10) - 1;
                          if (n > 0) openTab.textContent = String(n);
                          else if (openTab.parentNode) openTab.parentNode.removeChild(openTab);
                        }
                      }, 200);
                      return;
                    }
                    // Klik op Lees-link: ook archiveren in achtergrond
                    var link = e.target.closest('[data-action-link]');
                    if (link) {
                      var li2 = link.closest('.profiel-open-item');
                      if (!li2) return;
                      var type2 = li2.getAttribute('data-dismiss-type');
                      var id2 = li2.getAttribute('data-dismiss-id');
                      if (!type2 || !id2) return;
                      var url2 = endpointDismiss(type2, id2);
                      if (url2) {
                        try { fetch(url2, { method: 'POST', credentials: 'same-origin' }).catch(function(){}); } catch(e) {}
                      }
                    }
                  });
                }

                // --- Archief: terugzetten ---
                var archList = document.getElementById('profiel-archive-list');
                function endpointRestore(type, id) {
                  if (type === 'news') return '/api/leden/news/' + id + '/undismiss';
                  if (type === 'notification') return '/api/leden/notifications/' + id + '/unread';
                  return null;
                }
                if (archList) {
                  archList.addEventListener('click', function(e) {
                    var btn = e.target.closest('[data-action-restore]');
                    if (!btn) return;
                    e.preventDefault(); e.stopPropagation();
                    var li = btn.closest('.profiel-archive-item');
                    if (!li) return;
                    var type = li.getAttribute('data-restore-type');
                    var id = li.getAttribute('data-restore-id');
                    var url = endpointRestore(type, id);
                    if (!url) return;
                    try {
                      fetch(url, { method: 'POST', credentials: 'same-origin' })
                        .then(function(){ window.location.reload(); })
                        .catch(function(){ window.location.reload(); });
                    } catch(e) { window.location.reload(); }
                  });
                }

                // --- Wis archief ---
                var clearBtn = document.getElementById('clear-archive-btn');
                if (clearBtn) {
                  clearBtn.addEventListener('click', function() {
                    if (!confirm('Alle gearchiveerde meldingen definitief verwijderen?')) return;
                    fetch('/api/leden/notifications/clear-archive', { method: 'POST', credentials: 'same-origin' })
                      .then(function(){ window.location.reload(); })
                      .catch(function(){ alert('Kon archief niet wissen — probeer opnieuw.'); });
                  });
                }
              })();
            ` }} />
          </div>

          {/* Bug #207 — Dirigent en pianist hoeven geen lidgeld te betalen
              dus tonen we hen de hele Lidmaatschappen-sectie niet. */}
          {!['dirigent', 'pianist'].includes(user.role) && (
          <>
          {/* Membership Status & History
              BUG-FIX (Claudine, 23 mei): id="lidgeld" staat NU op de buitenkaart
              i.p.v. op het conditionele gele "openstaand"-blok. Reden: notifs
              linken naar /leden/profiel#lidgeld, maar leden zonder pending row
              hadden geen anchor → klik leek te "laden zonder te voltooien".
              Door het id op de altijd-aanwezige kaart te zetten, scrollt de
              klik altijd naar Lidmaatschappen — pending of niet. */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6 scroll-mt-24" id="lidgeld">
            <h3 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-id-card text-animato-secondary mr-2"></i>
              Lidmaatschappen
            </h3>
            
            {/* Active Membership Status */}
            {activeMembership && activeMembership.is_active && activeMembership.status === 'pending' ? (
              <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6 animate-pulse-slow">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div class="flex-1">
                    <div class="flex items-center text-yellow-800 font-bold text-lg mb-2">
                      <i class="fas fa-exclamation-circle mr-2"></i>
                      Lidgeld {activeMembership.season} Openstaand
                    </div>
                    <p class="text-yellow-800 mb-1">
                      Huidige formule: <strong>{activeMembership.type === 'full' ? 'Met Papieren Partituren' : 'Basis (digitaal)'}</strong>
                      {activeMembership.type !== 'full' && (
                        <span class="text-xs text-yellow-700 italic ml-1">— standaard zonder partituren</span>
                      )}
                    </p>
                    <p class="font-bold text-yellow-900 text-xl mb-2">
                      Te betalen: €{activeMembership.amount.toFixed(2)}
                    </p>
                    {activeMembership.type !== 'full' && (
                      <p class="text-xs text-yellow-700 mt-2">
                        <i class="fas fa-info-circle mr-1"></i>
                        Wil je toch papieren partituren? Klik op <strong>Nu Betalen</strong> en kies daar de formule "Met Partituren" — je kunt nog upgraden tot je betaalt.
                      </p>
                    )}
                  </div>
                  <a 
                    href="/leden/betaling-lidgeld" 
                    class="inline-flex items-center justify-center px-6 py-3 bg-animato-primary text-white rounded-lg hover:opacity-90 transition font-semibold shadow-lg transform hover:-translate-y-0.5 whitespace-nowrap"
                  >
                    <i class="fas fa-credit-card mr-2"></i>
                    Nu Betalen / Wijzigen
                  </a>
                </div>
              </div>
            ) : null}

            {/* Membership History Table */}
            {allMemberships.length > 0 ? (
              <div class="overflow-x-auto">
                <table class="w-full text-left">
                  <thead>
                    <tr class="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                      <th class="px-4 py-2 font-medium">Seizoen</th>
                      <th class="px-4 py-2 font-medium">Type</th>
                      <th class="px-4 py-2 font-medium">Bedrag</th>
                      <th class="px-4 py-2 font-medium">Status</th>
                      <th class="px-4 py-2 font-medium text-right">Betaald op</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    {allMemberships.map((m: any) => (
                      <tr class="hover:bg-gray-50 transition">
                        <td class="px-4 py-3 text-sm font-medium text-gray-900">
                          {m.season}
                          {m.is_active ? <span class="ml-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full">Actief</span> : ''}
                        </td>
                        <td class="px-4 py-3 text-sm text-gray-600">
                          {m.type === 'full' ? 'Full (+ Partituren)' : 'Basis'}
                        </td>
                        <td class="px-4 py-3 text-sm font-mono text-gray-600">
                          €{m.amount.toFixed(2)}
                        </td>
                        <td class="px-4 py-3">
                          {m.status === 'paid' ? (
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <i class="fas fa-check mr-1"></i> Betaald
                            </span>
                          ) : (
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <i class="fas fa-clock mr-1"></i> Openstaand
                            </span>
                          )}
                        </td>
                        <td class="px-4 py-3 text-sm text-gray-500 text-right">
                          {m.paid_at ? new Date(m.paid_at).toLocaleDateString('nl-BE') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div class="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <p>Nog geen lidmaatschappen gevonden.</p>
              </div>
            )}
          </div>
          </>
          )}

          {/* Activity History Card */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-calendar-check text-animato-secondary mr-2"></i>
              Mijn Activiteiten
            </h3>
            
            {myActivities.length > 0 ? (
              <div class="overflow-x-auto">
                <table class="w-full text-left">
                  <thead>
                    <tr class="text-xs text-gray-500 border-b border-gray-100">
                      <th class="pb-2 font-medium">Datum</th>
                      <th class="pb-2 font-medium">Activiteit</th>
                      <th class="pb-2 font-medium">Status</th>
                      <th class="pb-2 font-medium text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    {myActivities.map((act: any) => (
                      <tr>
                        <td class="py-3 text-sm text-gray-600">
                          {new Date(act.start_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td class="py-3">
                          <span class="font-medium text-gray-900">{act.titel}</span>
                          <div class="text-xs text-gray-500">{act.locatie}</div>
                        </td>
                        <td class="py-3">
                          <span class={`inline-flex px-2 py-1 text-xs rounded-full font-semibold ${
                            act.status === 'paid' ? 'bg-green-100 text-green-800' :
                            act.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                            act.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {act.status === 'paid' && 'Betaald'}
                            {act.status === 'confirmed' && 'Bevestigd'}
                            {act.status === 'cancelled' && 'Geannuleerd'}
                            {act.status === 'pending' && 'Te Betalen'}
                          </span>
                        </td>
                        <td class="py-3 text-right">
                          <a 
                            href={`/leden/activiteiten/${act.activity_id}`} 
                            class="text-animato-primary hover:text-animato-secondary text-sm font-medium"
                          >
                            Bekijk <i class="fas fa-chevron-right ml-1 text-xs"></i>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="text-gray-500 italic text-sm text-center py-4">
                Je hebt je nog niet ingeschreven voor activiteiten.
              </p>
            )}
          </div>

          {/* Attendance Streak Card */}
          {attendanceStreak.total > 0 && (
            <div class="bg-gradient-to-r from-orange-50 to-red-50 rounded-lg shadow-md p-6 mb-6 border-2 border-orange-200">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-xl font-bold text-gray-900">
                  <span class="mr-2">🔥</span>
                  Repetitie Streak
                </h3>
                <a href="/leden/streaks" class="text-sm px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
                  <i class="fas fa-trophy mr-1"></i> Leaderboard
                </a>
              </div>
              <div class="grid grid-cols-3 gap-4">
                <div class="bg-white rounded-lg p-4 text-center shadow-sm">
                  <div class="text-sm text-gray-600 mb-1">Huidige Streak</div>
                  <div class="text-3xl font-black text-orange-600">🔥 {attendanceStreak.current}</div>
                  <div class="text-xs text-gray-500">{attendanceStreak.current === 1 ? 'week' : 'weken'} op rij</div>
                </div>
                <div class="bg-white rounded-lg p-4 text-center shadow-sm">
                  <div class="text-sm text-gray-600 mb-1">Langste Streak</div>
                  <div class="text-3xl font-black text-purple-600">{attendanceStreak.longest}</div>
                  <div class="text-xs text-gray-500">weken</div>
                </div>
                <div class="bg-white rounded-lg p-4 text-center shadow-sm">
                  <div class="text-sm text-gray-600 mb-1">Totaal Aanwezig</div>
                  <div class="text-3xl font-black text-green-600">{attendanceStreak.total}</div>
                  <div class="text-xs text-gray-500">repetities</div>
                </div>
              </div>
              {attendanceStreak.current >= 52 && (
                <div class="mt-4 text-center bg-yellow-100 rounded-lg p-3">
                  <span class="text-xl">🏆</span> <span class="font-bold text-yellow-700">Gouden Noot - Fantastisch!</span>
                </div>
              )}
              {attendanceStreak.current >= 25 && attendanceStreak.current < 52 && (
                <div class="mt-4 text-center bg-gray-100 rounded-lg p-3">
                  <span class="text-xl">🥈</span> <span class="font-bold text-gray-700">Zilveren Noot</span>
                </div>
              )}
              {attendanceStreak.current >= 10 && attendanceStreak.current < 25 && (
                <div class="mt-4 text-center bg-amber-100 rounded-lg p-3">
                  <span class="text-xl">🥉</span> <span class="font-bold text-amber-700">Bronzen Noot</span>
                </div>
              )}
              {attendanceStreak.current >= 5 && attendanceStreak.current < 10 && (
                <div class="mt-4 text-center bg-blue-100 rounded-lg p-3">
                  <span class="text-xl">⭐</span> <span class="font-bold text-blue-700">Trouw Lid</span>
                </div>
              )}
            </div>
          )}

          {/* Voice Range Analysis Card */}
          {voiceAnalysis && (
            <div class="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg shadow-md p-6 mb-6 border-2 border-purple-200">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-xl font-bold text-gray-900">
                  <i class="fas fa-music text-purple-600 mr-2"></i>
                  Jouw Stembereik
                </h3>
                <a 
                  href="/stem-test"
                  class="text-sm px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <i class="fas fa-redo mr-2"></i>
                  Nieuwe Test
                </a>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Lowest Note */}
                <div 
                  class="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group voice-note-card"
                  data-note={voiceAnalysis.lowest_note}
                  data-freq={voiceAnalysis.lowest_frequency}
                >
                  <div class="text-sm text-gray-600 mb-2 flex items-center justify-between">
                    <span>Laagste Noot</span>
                    <i class="fas fa-volume-up text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                  </div>
                  <div class="text-2xl font-bold text-blue-600 mb-1">
                    {voiceAnalysis.lowest_note}
                  </div>
                  <div class="text-xs text-gray-500">
                    {Math.round(voiceAnalysis.lowest_frequency)} Hz
                  </div>
                  <div class="text-xs text-blue-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    Klik om deze noot te horen
                  </div>
                </div>

                {/* Highest Note */}
                <div 
                  class="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group voice-note-card"
                  data-note={voiceAnalysis.highest_note}
                  data-freq={voiceAnalysis.highest_frequency}
                >
                  <div class="text-sm text-gray-600 mb-2 flex items-center justify-between">
                    <span>Hoogste Noot</span>
                    <i class="fas fa-volume-up text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                  </div>
                  <div class="text-2xl font-bold text-purple-600 mb-1">
                    {voiceAnalysis.highest_note}
                  </div>
                  <div class="text-xs text-gray-500">
                    {Math.round(voiceAnalysis.highest_frequency)} Hz
                  </div>
                  <div class="text-xs text-purple-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    Klik om deze noot te horen
                  </div>
                </div>

                {/* Recommended Voice Group */}
                <div class="bg-white rounded-lg p-4 shadow-sm">
                  <div class="text-sm text-gray-600 mb-2">
                    Aanbevolen Stemgroep
                  </div>
                  <div class="text-2xl font-bold text-green-600 mb-1">
                    {voiceAnalysis.primary_stemgroep === 'S' && 'Sopraan'}
                    {voiceAnalysis.primary_stemgroep === 'A' && 'Alt'}
                    {voiceAnalysis.primary_stemgroep === 'T' && 'Tenor'}
                    {voiceAnalysis.primary_stemgroep === 'B' && 'Bas'}
                  </div>
                  {voiceAnalysis.primary_confidence && (
                    <div class="text-xs text-gray-500">
                      {Math.round(voiceAnalysis.primary_confidence * 100)}% zekerheid
                    </div>
                  )}
                  {voiceAnalysis.voice_type && (
                    <div class="text-xs text-gray-600 mt-2 italic">
                      {voiceAnalysis.voice_type}
                    </div>
                  )}
                </div>
              </div>

              <div class="text-xs text-gray-500 text-right">
                <i class="far fa-clock mr-1"></i>
                Getest op {new Date(voiceAnalysis.created_at).toLocaleDateString('nl-NL', { 
                  day: 'numeric', 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </div>
            </div>
          )}
          
          {/* No Voice Analysis - CTA */}
          {!voiceAnalysis && (
            <div class="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg shadow-md p-6 mb-6 border-2 border-dashed border-blue-300">
              <div class="text-center">
                <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i class="fas fa-microphone text-blue-600 text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-2">
                  Ontdek jouw stembereik!
                </h3>
                <p class="text-gray-600 mb-4">
                  Test je vocale bereik om de beste stemgroep voor jou te vinden.
                </p>
                <a 
                  href="/stem-test"
                  class="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  <i class="fas fa-music mr-2"></i>
                  Start Stem Test
                </a>
              </div>
            </div>
          )}

          {/* Profile Info Card */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="flex items-center mb-6 pb-6 border-b border-gray-200">
              <div class="w-20 h-20 bg-gradient-to-br from-animato-primary to-animato-secondary rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                {profile.profielfoto_url ? (
                  <img 
                    src={profile.profielfoto_url} 
                    alt={`${profile.voornaam} ${profile.achternaam}`}
                    class="w-full h-full object-cover"
                  />
                ) : (
                  <span>{profile.voornaam?.charAt(0) || 'U'}{profile.achternaam?.charAt(0) || ''}</span>
                )}
              </div>
              <div class="ml-6">
                <h2 class="text-2xl font-bold text-gray-900">
                  {profile.voornaam} {profile.achternaam}
                </h2>
                <div class="flex items-center gap-4 mt-2 text-sm text-gray-600">
                  <span>
                    <i class="fas fa-music mr-1 text-animato-primary"></i>
                    {profile.stemgroep === 'S' && 'Sopraan'}
                    {profile.stemgroep === 'A' && 'Alt'}
                    {profile.stemgroep === 'T' && 'Tenor'}
                    {profile.stemgroep === 'B' && 'Bas'}
                    {profile.stemgroep === 'Dirigent' && 'Dirigent'}
                    {profile.stemgroep === 'Pianist' && 'Pianist'}
                    {!profile.stemgroep && 'Geen stemgroep'}
                  </span>
                  <span>
                    <i class="fas fa-shield-alt mr-1 text-animato-accent"></i>
                    {profile.role === 'admin' && 'Beheerder'}
                    {profile.role === 'moderator' && 'Moderator'}
                    {profile.role === 'stemleider' && 'Stemleider'}
                    {profile.role === 'lid' && 'Lid'}
                    {profile.role === 'bezoeker' && 'Bezoeker'}
                    {profile.role === 'dirigent' && 'Dirigent'}
                    {profile.role === 'pianist' && 'Pianist'}
                  </span>
                  <span>
                    <i class="fas fa-calendar mr-1 text-gray-400"></i>
                    Lid sinds {(profile.lid_sinds ? new Date(profile.lid_sinds + 'T00:00:00') : new Date(profile.created_at)).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit Profile Form */}
            <form action="/api/leden/profiel" method="POST" class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label for="voornaam" class="block text-sm font-medium text-gray-700 mb-1">
                    Voornaam *
                  </label>
                  <input
                    type="text"
                    id="voornaam"
                    name="voornaam"
                    value={profile.voornaam || ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="achternaam" class="block text-sm font-medium text-gray-700 mb-1">
                    Achternaam *
                  </label>
                  <input
                    type="text"
                    id="achternaam"
                    name="achternaam"
                    value={profile.achternaam || ''}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="geboortedatum" class="block text-sm font-medium text-gray-700 mb-1">
                    Geboortedatum
                  </label>
                  <input
                    type="date"
                    id="geboortedatum"
                    name="geboortedatum"
                    value={profile.geboortedatum || ''}
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Profielfoto
                </label>
                <div class="flex items-start gap-4">
                  <div class="flex-1 space-y-3">
                    {/* File Upload with client-side compression */}
                    <div>
                      <label 
                        for="foto-upload" 
                        class="cursor-pointer inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
                        id="foto-upload-label"
                      >
                        <i class="fas fa-upload mr-2"></i>
                        Upload foto
                      </label>
                      <input
                        type="file"
                        id="foto-upload"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        class="hidden"
                      />
                      <span id="foto-upload-status" class="ml-3 text-xs text-gray-500"></span>
                    </div>
                    
                    {/* Hidden input for the photo URL (set by upload script) */}
                    <input type="hidden" id="profielfoto_url" name="profielfoto_url" value={profile.profielfoto_url || ''} />
                    <p class="text-xs text-gray-500">
                      Upload een foto (max 5MB). Wordt automatisch verkleind naar 400×400px.
                    </p>
                  </div>
                  
                  {/* Preview */}
                  <div class="w-24 h-24 border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
                    {profile.profielfoto_url ? (
                      <>
                        <img 
                          id="foto-preview"
                          src={profile.profielfoto_url} 
                          alt="Foto preview" 
                          class="w-full h-full object-cover"
                        />
                        <div id="foto-placeholder" class="hidden text-gray-400 text-center p-2">
                          <i class="fas fa-image text-2xl"></i>
                          <p class="text-xs mt-1">Preview</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <img 
                          id="foto-preview"
                          src="" 
                          alt="Foto preview" 
                          class="w-full h-full object-cover hidden"
                        />
                        <div id="foto-placeholder" class="text-gray-400 text-center p-2">
                          <i class="fas fa-image text-2xl"></i>
                          <p class="text-xs mt-1">Preview</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                  Email adres
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={profile.email}
                  disabled
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Email adres kan niet worden gewijzigd. Neem contact op met de beheerder als dit nodig is.
                </p>
              </div>

              <div>
                <label for="telefoon" class="block text-sm font-medium text-gray-700 mb-1">
                  Telefoonnummer
                </label>
                <input
                  type="tel"
                  id="telefoon"
                  name="telefoon"
                  value={profile.telefoon || ''}
                  placeholder="+32 123 45 67 89"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="stemgroep" class="block text-sm font-medium text-gray-700 mb-1">
                  Stemgroep *
                </label>
                <select
                  id="stemgroep"
                  name="stemgroep"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="">-- Kies je stemgroep --</option>
                  <option value="S" selected={profile.stemgroep === 'S'}>Sopraan</option>
                  <option value="A" selected={profile.stemgroep === 'A'}>Alt</option>
                  <option value="T" selected={profile.stemgroep === 'T'}>Tenor</option>
                  <option value="B" selected={profile.stemgroep === 'B'}>Bas</option>
                </select>
                <p class="mt-1 text-xs text-gray-500">
                  <i class="fas fa-music mr-1 text-animato-primary"></i>
                  Je zangroep bepaalt welk materiaal en events je ziet
                </p>
              </div>

              {/* Address split fields */}
              <div class="space-y-3">
                <label class="block text-sm font-medium text-gray-700">Adres</label>
                <div class="grid grid-cols-3 gap-2">
                  <div class="col-span-2">
                    <input
                      type="text"
                      id="straat"
                      name="straat"
                      value={profile.straat || ''}
                      placeholder="Straatnaam"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      id="huisnummer"
                      name="huisnummer"
                      value={profile.huisnummer || ''}
                      placeholder="Nr"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-3 gap-2">
                  <div>
                    <input
                      type="text"
                      id="postcode"
                      name="postcode"
                      value={profile.postcode || ''}
                      placeholder="Postcode"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                  <div class="col-span-2">
                    <input
                      type="text"
                      id="gemeente"
                      name="gemeente"
                      value={profile.gemeente || ''}
                      placeholder="Gemeente / Stad"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>
                </div>
                <input type="hidden" name="adres" value={`${profile.straat || ''} ${profile.huisnummer || ''}, ${profile.postcode || ''} ${profile.gemeente || ''}`} />
              </div>

              <div>
                <label for="bio" class="block text-sm font-medium text-gray-700 mb-1">
                  Bio
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  rows={3}
                  placeholder="Vertel iets over jezelf..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{profile.bio || ''}</textarea>
                <p class="mt-1 text-xs text-gray-500">
                  Optioneel - wordt getoond op je ledenprofiel
                </p>
              </div>

              <div>
                <label for="muzikale_ervaring" class="block text-sm font-medium text-gray-700 mb-1">
                  Muzikale ervaring
                </label>
                <textarea
                  id="muzikale_ervaring"
                  name="muzikale_ervaring"
                  rows={3}
                  placeholder="Eerdere koorervaring, instrumenten, opleidingen..."
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >{profile.muzikale_ervaring || ''}</textarea>
              </div>

              {/* Smoelenboek Fields */}
              <div class="pt-6 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                  <i class="fas fa-heart text-red-500 mr-2"></i>
                  Muzikale Voorkeuren (Smoelenboek)
                </h3>
                <p class="text-sm text-gray-600 mb-4">
                  Deze informatie wordt getoond in het smoelenboek zodat andere leden je beter leren kennen.
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="favoriete_genre" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete genre
                    </label>
                    <input
                      type="text"
                      id="favoriete_genre"
                      name="favoriete_genre"
                      value={String(profile.favoriete_genre || '')}
                      placeholder="Bijv. Barok, Romantiek, Jazz..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="favoriete_componist" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete componist
                    </label>
                    <input
                      type="text"
                      id="favoriete_componist"
                      name="favoriete_componist"
                      value={String(profile.favoriete_componist || '')}
                      placeholder="Bijv. J.S. Bach, Mozart..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="favoriete_werk" class="block text-sm font-medium text-gray-700 mb-1">
                      Favoriete muziekwerk
                    </label>
                    <input
                      type="text"
                      id="favoriete_werk"
                      name="favoriete_werk"
                      value={String(profile.favoriete_werk || '')}
                      placeholder="Bijv. Requiem van Fauré..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="instrument" class="block text-sm font-medium text-gray-700 mb-1">
                      Instrument (optioneel)
                    </label>
                    <input
                      type="text"
                      id="instrument"
                      name="instrument"
                      value={String(profile.instrument || '')}
                      placeholder="Bijv. Piano, Gitaar..."
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label for="jaren_in_koor" class="block text-sm font-medium text-gray-700 mb-1">
                      Jaren in dit koor
                    </label>
                    <input
                      type="number"
                      id="jaren_in_koor"
                      name="jaren_in_koor_display"
                      readonly
                      value={Math.max(0, new Date().getFullYear() - new Date(profile.lid_sinds || profile.created_at).getFullYear())}
                      class="w-full px-4 py-2 border border-gray-200 bg-gray-50 rounded-lg text-gray-700 cursor-not-allowed"
                    />
                    <p class="mt-1 text-xs text-gray-500">
                      <i class="fas fa-lock mr-1 text-gray-400"></i>
                      Automatisch berekend op basis van je aansluitingsdatum (lid sinds {profile.lid_sinds ? new Date(profile.lid_sinds + 'T00:00:00').toLocaleDateString('nl-BE', { month: 'short', year: 'numeric' }) : new Date(profile.created_at).toLocaleDateString('nl-BE', { month: 'short', year: 'numeric' })}).
                      Klopt dit niet? Vraag een bestuurslid om je <em>Lid sinds</em>-datum aan te passen.
                    </p>
                  </div>

                  <div>
                    <label for="zanger_type" class="block text-sm font-medium text-gray-700 mb-1">
                      Soort zanger
                    </label>
                    <select
                      id="zanger_type"
                      name="zanger_type"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    >
                      <option value="amateur" selected={profile.zanger_type === 'amateur'}>Amateur</option>
                      <option value="semi-professioneel" selected={profile.zanger_type === 'semi-professioneel'}>Semi-professioneel</option>
                      <option value="professioneel" selected={profile.zanger_type === 'professioneel'}>Professioneel</option>
                      <option value="student" selected={profile.zanger_type === 'student'}>Student</option>
                    </select>
                  </div>
                </div>

                {/* Hidden fields - Privacy settings always enabled */}
                <input type="hidden" name="smoelenboek_zichtbaar" value="1" />
                <input type="hidden" name="toon_email" value="1" />
                <input type="hidden" name="toon_telefoon" value="1" />
              </div>

              <div class="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <a
                  href="/leden"
                  class="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Annuleren
                </a>
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition-colors"
                >
                  <i class="fas fa-save mr-2"></i>
                  Profiel Opslaan
                </button>
              </div>
            </form>
            

            {/* Photo Upload Script — client-side compress + upload to /api/photos/upload */}
            <script dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  const fileInput = document.getElementById('foto-upload');
                  if (!fileInput) return;
                  
                  function compressImage(file, maxWidth, maxHeight, quality) {
                    return new Promise(function(resolve, reject) {
                      const reader = new FileReader();
                      reader.onload = function(e) {
                        const img = new Image();
                        img.onload = function() {
                          const canvas = document.createElement('canvas');
                          let w = img.width, h = img.height;
                          if (w > maxWidth || h > maxHeight) {
                            const ratio = Math.min(maxWidth / w, maxHeight / h);
                            w = Math.round(w * ratio);
                            h = Math.round(h * ratio);
                          }
                          canvas.width = w;
                          canvas.height = h;
                          const ctx = canvas.getContext('2d');
                          ctx.drawImage(img, 0, 0, w, h);
                          resolve(canvas.toDataURL('image/jpeg', quality));
                        };
                        img.onerror = reject;
                        img.src = e.target.result;
                      };
                      reader.onerror = reject;
                      reader.readAsDataURL(file);
                    });
                  }
                  
                  fileInput.addEventListener('change', async function(e) {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    if (file.size > 5 * 1024 * 1024) {
                      alert('Bestand is te groot. Maximum 5MB toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    if (!allowedTypes.includes(file.type)) {
                      alert('Ongeldig bestandstype. Alleen JPG, PNG, GIF en WEBP zijn toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    const btn = document.getElementById('foto-upload-label');
                    const status = document.getElementById('foto-upload-status');
                    const origHtml = btn?.innerHTML;
                    if (btn) btn.innerHTML = '<i class="fas fa-compress mr-2"></i>Verkleinen...';
                    if (status) status.textContent = '';
                    
                    try {
                      // Compress to max 400x400, JPEG quality 0.75
                      const compressed = await compressImage(file, 400, 400, 0.75);
                      
                      if (btn) btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Uploaden...';
                      
                      // Upload to server
                      const res = await fetch('/api/photos/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: compressed, content_type: 'image/jpeg' })
                      });
                      
                      const result = await res.json();
                      
                      if (result.success) {
                        // Update hidden input with new URL
                        const urlInput = document.getElementById('profielfoto_url');
                        if (urlInput) urlInput.value = result.url;
                        
                        // Update preview
                        const preview = document.getElementById('foto-preview');
                        const placeholder = document.getElementById('foto-placeholder');
                        if (preview) {
                          preview.src = compressed;
                          preview.classList.remove('hidden');
                          if (placeholder) placeholder.classList.add('hidden');
                        }
                        
                        // Update profile photo thumb if visible
                        const thumb = document.getElementById('profile-photo-thumb');
                        if (thumb) thumb.src = compressed;
                        
                        if (btn) btn.innerHTML = '<i class="fas fa-check mr-2"></i>Opgeslagen!';
                        if (status) status.textContent = Math.round(result.size / 1024) + ' KB';
                        status?.classList.add('text-green-600');
                        setTimeout(function() {
                          if (btn) btn.innerHTML = origHtml;
                          status?.classList.remove('text-green-600');
                        }, 3000);
                      } else {
                        throw new Error(result.error || 'Upload mislukt');
                      }
                    } catch (err) {
                      alert('Fout bij uploaden: ' + err.message);
                      if (btn) btn.innerHTML = origHtml;
                    }
                  });
                })();
              `
            }}></script>
          </div>

          {/* Notification preferences */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6" id="notif-prefs">
            <h3 class="text-xl font-bold text-gray-900 mb-2">
              <i class="fas fa-sliders-h text-animato-primary mr-2"></i>
              Notificatie-voorkeuren
            </h3>
            <p class="text-sm text-gray-500 mb-4">
              Vink uit waarover je géén meldingen wil ontvangen. Items blijven
              wel zichtbaar in het Archief als je later van gedacht verandert.
            </p>

            <form id="notif-prefs-form" class="space-y-3">
              {(() => {
                const labels: Array<{ key: NotificationType; label: string; desc: string; icon: string; canDisable: boolean }> = [
                  { key: 'nieuws',    label: 'Nieuwsberichten',        desc: 'Wanneer er een nieuw nieuwsbericht gepubliceerd wordt.', icon: 'fas fa-newspaper',     canDisable: true },
                  { key: 'concert',   label: 'Nieuwe concerten',       desc: 'Wanneer een concert wordt toegevoegd aan de agenda.',    icon: 'fas fa-music',         canDisable: true },
                  { key: 'repetitie', label: 'Nieuwe repetities',      desc: 'Wanneer een repetitie wordt toegevoegd aan de agenda.',  icon: 'fas fa-calendar-alt',  canDisable: true },
                  { key: 'materiaal', label: 'Nieuw materiaal',        desc: 'Nieuwe partituren of oefentracks (filter op stemgroep).', icon: 'fas fa-file-audio',    canDisable: true },
                  { key: 'board',     label: 'Reacties op je posts',   desc: 'Wanneer iemand reageert op jouw forum-bericht of agenda.', icon: 'fas fa-comments',      canDisable: true },
                  { key: 'systeem',   label: 'Systeem-meldingen',      desc: 'Overige aankondigingen vanuit het bestuur.',              icon: 'fas fa-bullhorn',      canDisable: true },
                  { key: 'lidgeld',   label: 'Lidgeld-herinneringen',  desc: 'Verplicht — kan niet uitgezet worden.',                   icon: 'fas fa-euro-sign',     canDisable: false },
                  { key: 'profiel',   label: 'Profiel-meldingen',      desc: 'Verplicht — kan niet uitgezet worden.',                   icon: 'fas fa-user-edit',     canDisable: false },
                ]
                return labels.map(item => {
                  const isOn = notifPrefs[item.key]
                  return (
                    <label class={`flex items-start gap-3 p-3 rounded-lg border ${item.canDisable ? 'border-gray-200 hover:bg-gray-50 cursor-pointer' : 'border-gray-100 bg-gray-50 opacity-70'} transition`}>
                      <input
                        type="checkbox"
                        name={`pref_${item.key}`}
                        data-pref-key={item.key}
                        checked={isOn}
                        disabled={!item.canDisable}
                        class="mt-1 h-4 w-4 rounded text-animato-primary focus:ring-animato-primary"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-gray-800 flex items-center gap-2">
                          <i class={`${item.icon} text-animato-primary/70`}></i>
                          {item.label}
                          {!item.canDisable && (
                            <span class="text-[10px] font-bold uppercase bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Verplicht</span>
                          )}
                        </div>
                        <p class="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                      </div>
                    </label>
                  )
                })
              })()}

              <div class="flex justify-end items-center gap-3 pt-2">
                <span id="notif-prefs-status" class="text-xs text-gray-500"></span>
                <button
                  type="submit"
                  class="px-5 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm font-medium"
                >
                  <i class="fas fa-save mr-1"></i>
                  Voorkeuren opslaan
                </button>
              </div>
            </form>

            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var form = document.getElementById('notif-prefs-form');
                var status = document.getElementById('notif-prefs-status');
                if (!form) return;
                form.addEventListener('submit', function(e) {
                  e.preventDefault();
                  var prefs = {};
                  form.querySelectorAll('input[data-pref-key]').forEach(function(cb) {
                    if (cb.disabled) return;
                    prefs[cb.getAttribute('data-pref-key')] = !!cb.checked;
                  });
                  status.textContent = 'Opslaan...';
                  status.classList.remove('text-red-600','text-green-600');
                  fetch('/api/leden/notification-prefs', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(prefs)
                  })
                  .then(function(r){ return r.ok ? r.json() : Promise.reject(r); })
                  .then(function() {
                    status.textContent = '✓ Voorkeuren opgeslagen';
                    status.classList.add('text-green-600');
                    setTimeout(function() { status.textContent = ''; status.classList.remove('text-green-600'); }, 3000);
                  })
                  .catch(function() {
                    status.textContent = 'Opslaan mislukt — probeer opnieuw';
                    status.classList.add('text-red-600');
                  });
                });
              })();
            ` }} />
          </div>

          {/* Privacy & zichtbaarheid */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6" id="privacy-prefs">
            <h3 class="text-xl font-bold text-gray-900 mb-2">
              <i class="fas fa-user-shield text-animato-primary mr-2"></i>
              Privacy & zichtbaarheid
            </h3>
            <p class="text-sm text-gray-500 mb-4">
              Bepaal zelf wat andere leden van jouw activiteit te zien krijgen.
            </p>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition">
              <input
                type="checkbox"
                id="show-online-status"
                checked={showOnlineStatus}
                class="mt-1 h-4 w-4 rounded text-animato-primary focus:ring-animato-primary"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-800 flex items-center gap-2">
                  <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                  Toon mijn online-status aan andere leden
                </div>
                <p class="text-xs text-gray-500 mt-0.5">
                  Wanneer ingeschakeld zien medeleden een groen bolletje naast jouw naam wanneer je actief bent op de site (laatste 5 minuten).
                  Schakel je dit uit, dan blijft je activiteit zichtbaar voor jezelf maar verborgen voor anderen.
                </p>
              </div>
              <span id="privacy-status" class="text-xs text-gray-500 self-center"></span>
            </label>

            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var cb = document.getElementById('show-online-status');
                var status = document.getElementById('privacy-status');
                if (!cb) return;
                cb.addEventListener('change', function() {
                  status.textContent = 'Opslaan...';
                  status.classList.remove('text-red-600','text-green-600');
                  fetch('/api/leden/privacy/online-status', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ show: cb.checked })
                  })
                  .then(function(r){ return r.ok ? r.json() : Promise.reject(r); })
                  .then(function() {
                    status.textContent = '✓ Opgeslagen';
                    status.classList.add('text-green-600');
                    setTimeout(function() { status.textContent = ''; status.classList.remove('text-green-600'); }, 2500);
                  })
                  .catch(function() {
                    // Revert
                    cb.checked = !cb.checked;
                    status.textContent = 'Opslaan mislukt';
                    status.classList.add('text-red-600');
                  });
                });
              })();
            ` }} />
          </div>

          {/* Change Password Card */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-lock text-animato-accent mr-2"></i>
              Wachtwoord wijzigen
            </h3>
            
            <form action="/api/leden/profiel/wachtwoord" method="POST" class="space-y-4">
              <div>
                <label for="current_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Huidig wachtwoord *
                </label>
                <div class="relative">
                  <input
                    type="password"
                    id="current_password"
                    name="current_password"
                    required
                    class="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <button type="button" onclick="togglePwdVis('current_password')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition" tabindex="-1" title="Toon/verberg wachtwoord">
                    <i class="far fa-eye" id="current_password-eye"></i>
                  </button>
                </div>
              </div>

              <div>
                <label for="new_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Nieuw wachtwoord *
                </label>
                <div class="relative">
                  <input
                    type="password"
                    id="new_password"
                    name="new_password"
                    required
                    minlength={8}
                    class="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <button type="button" onclick="togglePwdVis('new_password')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition" tabindex="-1" title="Toon/verberg wachtwoord">
                    <i class="far fa-eye" id="new_password-eye"></i>
                  </button>
                </div>
                <p class="mt-1 text-xs text-gray-500">
                  Minimaal 8 tekens
                </p>
              </div>

              <div>
                <label for="confirm_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Bevestig nieuw wachtwoord *
                </label>
                <div class="relative">
                  <input
                    type="password"
                    id="confirm_password"
                    name="confirm_password"
                    required
                    minlength={8}
                    class="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <button type="button" onclick="togglePwdVis('confirm_password')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition" tabindex="-1" title="Toon/verberg wachtwoord">
                    <i class="far fa-eye" id="confirm_password-eye"></i>
                  </button>
                </div>
              </div>

              <div class="flex justify-end pt-4">
                <button
                  type="submit"
                  class="px-6 py-2 bg-animato-accent text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <i class="fas fa-key mr-2"></i>
                  Wachtwoord Wijzigen
                </button>
              </div>
            </form>
          </div>

          {/* Password visibility toggle script */}
          <script dangerouslySetInnerHTML={{ __html: `
            function togglePwdVis(inputId) {
              var inp = document.getElementById(inputId);
              var eye = document.getElementById(inputId + '-eye');
              if (!inp || !eye) return;
              if (inp.type === 'password') {
                inp.type = 'text';
                eye.className = 'far fa-eye-slash';
              } else {
                inp.type = 'password';
                eye.className = 'far fa-eye';
              }
            }
          `}} />

          {/* Voice Analysis Playback Script */}
          {voiceAnalysis && (
            <script dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  // Define note frequency map (same as voice-analyzer)
                  const noteFrequencies = {
                    'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 
                    'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 
                    'A#2': 116.54, 'B2': 123.47,
                    'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 
                    'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 
                    'A#3': 233.08, 'B3': 246.94,
                    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 
                    'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 
                    'A#4': 466.16, 'B4': 493.88,
                    'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 
                    'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 
                    'A#5': 932.33, 'B5': 987.77,
                    'C6': 1046.50, 'C#6': 1108.73, 'D6': 1174.66, 'D#6': 1244.51, 'E6': 1318.51, 
                    'F6': 1396.91, 'F#6': 1479.98, 'G6': 1567.98, 'G#6': 1661.22, 'A6': 1760.00
                  };

                  // Play note function
                  function playNote(note, duration = 1.0) {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const frequency = noteFrequencies[note];
                    
                    if (!frequency) {
                      console.error('Unknown note:', note);
                      return;
                    }

                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();

                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

                    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);

                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + duration);
                  }

                  // Add click event listeners to voice note cards
                  document.querySelectorAll('.voice-note-card').forEach(function(card) {
                    card.addEventListener('click', function() {
                      const note = this.getAttribute('data-note');
                      if (note) {
                        // Visual feedback
                        this.classList.add('ring-4', 'ring-blue-400');
                        setTimeout(() => {
                          this.classList.remove('ring-4', 'ring-blue-400');
                        }, 1000);
                        
                        // Play the note
                        playNote(note, 1.0);
                      }
                    });
                  });
                })();
              `
            }}></script>
          )}

        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// BETALING LIDGELD
// =====================================================

app.get('/leden/betaling-lidgeld', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Get active unpaid membership — incl. beide formule-bedragen voor de keuze
  const membership = await queryOne<any>(
    c.env.DB,
    `SELECT um.*, my.season, my.description, my.fee_base, my.fee_full
     FROM user_memberships um
     JOIN membership_years my ON um.year_id = my.id
     WHERE um.user_id = ? AND um.status = 'pending' AND my.is_active = 1`,
    [user.id]
  )

  if (!membership) {
    return c.redirect('/leden/profiel')
  }

  // Fallback waarden als fee_base/fee_full niet gezet zijn op het seizoen
  const feeBase = Number(membership.fee_base ?? 35)
  const feeFull = Number(membership.fee_full ?? 70)

  // 🔧 AUTO-SYNC: corrigeer historische scheve data waar membership.amount
  // niet meer overeenkomt met het tarief van zijn type.
  // Dit gebeurt bv. wanneer een seizoen aangemaakt is met andere prijzen,
  // of wanneer fee_base/fee_full nadien is aangepast in /admin/lidgelden.
  // Voorwaarden om te syncen:
  //   1) er is geen openstaande Mollie-betaallink (anders wijken bedragen af van betaling)
  //   2) status is nog 'pending' (al gewaarborgd via WHERE)
  //   3) huidige amount wijkt af van de fee voor zijn type
  const expectedAmount = membership.type === 'full' ? feeFull : feeBase
  if (
    !membership.mollie_payment_url &&
    Number(membership.amount) !== expectedAmount
  ) {
    await execute(
      c.env.DB,
      `UPDATE user_memberships SET amount = ? WHERE id = ?`,
      [expectedAmount, membership.id]
    )
    membership.amount = expectedAmount
  }

  // Bank details
  const settingsRes = await queryAll(c.env.DB, "SELECT * FROM system_settings WHERE key IN ('bank_iban', 'bank_bic', 'bank_name')")
  const settings = settingsRes.reduce((acc: any, curr: any) => ({...acc, [curr.key]: curr.value}), {})

  const iban = settings.bank_iban || 'BE12 3456 7890 1234'
  const bic = settings.bank_bic || 'GEBA BE BB'
  const bankName = settings.bank_name || 'Koor Animato Rekening'
  const communication = `Lidgeld ${membership.season} - ${user.voornaam} ${user.achternaam}`

  return c.html(
    <Layout title="Lidgeld Betalen" user={user} impersonating={!!(c.get('impersonating' as any))}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-8">
            <a href="/leden/profiel" class="text-animato-primary hover:underline flex items-center">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar profiel
            </a>
          </div>

          <div class="bg-white rounded-lg shadow-lg overflow-hidden">
            <div class="bg-animato-primary px-6 py-4">
              <h1 class="text-2xl font-bold text-white flex items-center">
                <i class="fas fa-euro-sign bg-white text-animato-primary rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm"></i>
                Betaling Lidgeld {membership.season}
              </h1>
            </div>
            
            <div class="p-8">
              <div class="mb-8 text-center">
                <p class="text-gray-600 mb-2">Te betalen bedrag</p>
                <div class="text-4xl font-bold text-gray-900" id="displayTotal">€ {Number(membership.amount).toFixed(2)}</div>
                <p class="text-xs text-gray-400 mt-1" id="displayBreakdown">
                  Basis: € <span id="displayBase">{Number(membership.amount).toFixed(2)}</span>
                </p>
              </div>

              {/* #110/#111: Lidmaatschapsformule kiezer */}
              <div class="mb-8">
                <p class="text-sm font-semibold text-gray-700 mb-3 text-center">
                  <i class="fas fa-list-check text-animato-primary mr-1"></i> Kies je lidmaatschapsformule
                </p>
                <div class="grid sm:grid-cols-2 gap-3" id="formulaPicker">
                  <label
                    class={`formula-option relative cursor-pointer rounded-xl border-2 p-4 transition hover:shadow-md ${membership.type === 'basis' ? 'border-animato-primary bg-blue-50 ring-2 ring-animato-primary ring-opacity-30' : 'border-gray-200 bg-white'}`}
                    data-type="basis"
                    data-amount={feeBase}
                  >
                    <input
                      type="radio"
                      name="formula_choice"
                      value="basis"
                      checked={membership.type === 'basis'}
                      class="absolute top-3 right-3 w-4 h-4 accent-animato-primary"
                      onchange="selectFormula('basis')"
                    />
                    <div class="flex items-start gap-3">
                      <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-tablet-screen-button text-blue-600"></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <h4 class="font-bold text-gray-900">Basis Lidmaatschap</h4>
                        <p class="text-2xl font-bold text-animato-primary mt-1">€ {feeBase.toFixed(2)}</p>
                        <ul class="text-xs text-gray-600 mt-2 space-y-1">
                          <li><i class="fas fa-check text-green-500 mr-1"></i> Volwaardig lidmaatschap</li>
                          <li><i class="fas fa-check text-green-500 mr-1"></i> Digitale partituren</li>
                          <li><i class="fas fa-times text-gray-300 mr-1"></i> Geen papieren partituren</li>
                        </ul>
                      </div>
                    </div>
                  </label>

                  <label
                    class={`formula-option relative cursor-pointer rounded-xl border-2 p-4 transition hover:shadow-md ${membership.type === 'full' ? 'border-animato-primary bg-blue-50 ring-2 ring-animato-primary ring-opacity-30' : 'border-gray-200 bg-white'}`}
                    data-type="full"
                    data-amount={feeFull}
                  >
                    <input
                      type="radio"
                      name="formula_choice"
                      value="full"
                      checked={membership.type === 'full'}
                      class="absolute top-3 right-3 w-4 h-4 accent-animato-primary"
                      onchange="selectFormula('full')"
                    />
                    <div class="flex items-start gap-3">
                      <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-print text-purple-600"></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <h4 class="font-bold text-gray-900">Volledig + Partituren</h4>
                        <p class="text-2xl font-bold text-animato-primary mt-1">€ {feeFull.toFixed(2)}</p>
                        <ul class="text-xs text-gray-600 mt-2 space-y-1">
                          <li><i class="fas fa-check text-green-500 mr-1"></i> Volwaardig lidmaatschap</li>
                          <li><i class="fas fa-check text-green-500 mr-1"></i> Digitale partituren</li>
                          <li><i class="fas fa-check text-green-500 mr-1"></i> Papieren partituren</li>
                        </ul>
                      </div>
                    </div>
                  </label>
                </div>
                <p class="text-xs text-gray-500 text-center mt-2" id="formulaChangeNotice">
                  Je huidige formule is <strong>{membership.type === 'full' ? 'Volledig + Partituren' : 'Basis'}</strong>.
                  Je kan kiezen voor een andere formule — het bedrag wordt automatisch aangepast.
                </p>
              </div>

              {/* Donation Upsell */}
              <div class="bg-pink-50 border border-pink-100 rounded-lg p-6 mb-8">
                 <h3 class="font-bold text-pink-800 mb-2 flex items-center justify-center">
                   <i class="fas fa-heart mr-2"></i> Voeg een vrije gift toe
                 </h3>
                 <p class="text-sm text-pink-700 text-center mb-4">
                   Steun Animato extra en word officieel sympathisant!
                 </p>
                 <div class="flex justify-center gap-2 mb-4">
                    <button type="button" onclick="addDonation(0)" class="px-3 py-1 rounded border border-pink-200 bg-white hover:bg-pink-100 text-sm active-donation">Geen</button>
                    <button type="button" onclick="addDonation(10)" class="px-3 py-1 rounded border border-pink-200 bg-white hover:bg-pink-100 text-sm">€ 10</button>
                    <button type="button" onclick="addDonation(25)" class="px-3 py-1 rounded border border-pink-200 bg-white hover:bg-pink-100 text-sm">€ 25</button>
                    <button type="button" onclick="addDonation(50)" class="px-3 py-1 rounded border border-pink-200 bg-white hover:bg-pink-100 text-sm">€ 50</button>
                    <div class="relative w-24">
                        <span class="absolute left-2 top-1 text-gray-500 text-sm">€</span>
                        <input type="number" id="customDonation" oninput="updateCustomDonation(this.value)" class="w-full pl-6 pr-2 py-1 text-sm border border-pink-200 rounded" placeholder="Ander" />
                    </div>
                 </div>
              </div>

              <div class="grid md:grid-cols-2 gap-8">
                {/* Online Payment */}
                <div class="bg-gray-50 p-6 rounded-lg border border-gray-200">
                  <h3 class="font-bold text-lg text-gray-900 mb-4 flex items-center">
                    <i class="fas fa-globe text-animato-secondary mr-2"></i> Online Betalen
                  </h3>
                  <p class="text-sm text-gray-600 mb-6">
                    Betaal veilig en snel via Bancontact, Payconiq of kredietkaart.
                  </p>
                  
                  {membership.mollie_payment_url ? (
                    <div class="text-center">
                        <a href={membership.mollie_payment_url} class="block w-full py-3 px-4 bg-animato-accent text-white text-center rounded-lg hover:bg-amber-600 transition font-bold shadow mb-2">
                          Doorgaan naar betaling
                        </a>
                        <p class="text-xs text-gray-500 mb-3">Let op: dit is de link voor enkel het lidgeld.</p>
                        <form action="/api/leden/betaling/online" method="POST">
                          <input type="hidden" name="membership_id" value={membership.id} />
                          <input type="hidden" name="donation_amount" id="formDonationAmount" value="0" />
                          <input type="hidden" name="formula_type" id="formFormulaType" value={membership.type} />
                          <input type="hidden" name="regenerate" value="1" />
                          <button type="submit" class="text-xs text-animato-primary hover:underline" title="Genereer een nieuwe Mollie-betaallink met de huidige formule en gift">
                            <i class="fas fa-rotate mr-1"></i> Formule of gift gewijzigd? Klik hier om opnieuw te betalen
                          </button>
                        </form>
                    </div>
                  ) : (
                    <form action="/api/leden/betaling/online" method="POST">
                      <input type="hidden" name="membership_id" value={membership.id} />
                      <input type="hidden" name="donation_amount" id="formDonationAmount" value="0" />
                      <input type="hidden" name="formula_type" id="formFormulaType" value={membership.type} />
                      <button type="submit" class="w-full py-3 px-4 bg-animato-accent text-white text-center rounded-lg hover:bg-amber-600 transition font-bold shadow">
                        <i class="fas fa-credit-card mr-2"></i> Betalen
                      </button>
                    </form>
                  )}
                </div>

                {/* Bank Transfer */}
                <div class="bg-gray-50 p-6 rounded-lg border border-gray-200">
                  <h3 class="font-bold text-lg text-gray-900 mb-4 flex items-center">
                    <i class="fas fa-university text-gray-600 mr-2"></i> Overschrijving
                  </h3>
                  <div class="space-y-3 text-sm">
                    <div>
                      <div class="text-gray-500 text-xs">Naam begunstigde</div>
                      <div class="font-medium text-gray-900">{bankName}</div>
                    </div>
                    <div>
                      <div class="text-gray-500 text-xs">IBAN</div>
                      <div class="font-mono font-medium text-gray-900 tracking-wide select-all bg-white p-1 rounded border border-gray-200">{iban}</div>
                    </div>
                    <div>
                      <div class="text-gray-500 text-xs">BIC</div>
                      <div class="font-mono font-medium text-gray-900">{bic}</div>
                    </div>
                    <div>
                      <div class="text-gray-500 text-xs">Mededeling (belangrijk!)</div>
                      <div class="font-mono font-bold text-animato-primary bg-yellow-50 p-2 rounded border border-yellow-200 select-all">
                        {communication}
                      </div>
                    </div>
                    <div class="pt-2 text-xs text-gray-500 italic">
                        Bij een vrije gift via overschrijving, gelieve "Lidgeld + Gift" te vermelden of twee aparte overschrijvingen te doen.
                    </div>
                  </div>
                </div>
              </div>

              <div class="mt-8 pt-6 border-t border-gray-100 text-center text-sm text-gray-500">
                <p>Heb je vragen over je lidgeld? Neem contact op met de penningmeester.</p>
              </div>
            </div>
            
            <script dangerouslySetInnerHTML={{__html: `
                // Formule-prijzen vanuit server (membership_years.fee_base / fee_full)
                const FEE_BASE = ${feeBase};
                const FEE_FULL = ${feeFull};
                let baseAmount = ${Number(membership.amount)}; // start met huidige formule
                let donationAmount = 0;

                // #110/#111: Formule-keuze handler
                function selectFormula(type) {
                    baseAmount = (type === 'full') ? FEE_FULL : FEE_BASE;
                    const formField = document.getElementById('formFormulaType');
                    if (formField) formField.value = type;

                    // Visual highlight op de gekozen kaart
                    document.querySelectorAll('.formula-option').forEach(card => {
                        if (card.getAttribute('data-type') === type) {
                            card.classList.add('border-animato-primary', 'bg-blue-50', 'ring-2', 'ring-animato-primary', 'ring-opacity-30');
                            card.classList.remove('border-gray-200', 'bg-white');
                        } else {
                            card.classList.remove('border-animato-primary', 'bg-blue-50', 'ring-2', 'ring-animato-primary', 'ring-opacity-30');
                            card.classList.add('border-gray-200', 'bg-white');
                        }
                    });

                    // Update breakdown text
                    const baseEl = document.getElementById('displayBase');
                    if (baseEl) baseEl.innerText = baseAmount.toFixed(2);

                    updateDisplay();
                }
                
                function addDonation(amount) {
                    donationAmount = amount;
                    document.getElementById('customDonation').value = '';
                    updateDisplay();
                    highlightButton(amount);
                }
                
                function updateCustomDonation(val) {
                    donationAmount = parseFloat(val) || 0;
                    updateDisplay();
                    highlightButton(-1); // Clear highlights
                }
                
                function updateDisplay() {
                    const total = baseAmount + donationAmount;
                    document.getElementById('displayTotal').innerText = '€ ' + total.toFixed(2);
                    document.getElementById('formDonationAmount').value = donationAmount;
                }
                
                function highlightButton(amount) {
                    // Reset all
                    document.querySelectorAll('button[onclick^="addDonation"]').forEach(btn => {
                        if (amount === -1) {
                             btn.classList.remove('bg-pink-100', 'border-pink-400');
                             btn.classList.add('bg-white', 'border-pink-200');
                        } else {
                            // Check exact match in onclick attribute text is tricky, better rely on logic
                            // Simpler: just clear visual state and re-apply
                             btn.classList.remove('bg-pink-100', 'border-pink-400');
                             btn.classList.add('bg-white', 'border-pink-200');
                        }
                    });
                    
                    if (amount >= 0) {
                         // Find button with specific onclick
                         const btn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('onclick') === 'addDonation(' + amount + ')');
                         if (btn) {
                             btn.classList.remove('bg-white', 'border-pink-200');
                             btn.classList.add('bg-pink-100', 'border-pink-400');
                         }
                    }
                }
            `}} />
          </div>
        </div>
      </div>
    </Layout>
  )
})

// API to generate payment link if not exists
app.post('/api/leden/betaling/online', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const membershipId = body.membership_id
  const donationAmount = parseFloat(String(body.donation_amount || '0'))
  // #110/#111: gekozen formule (basis|full) — kan afwijken van wat in DB staat
  const requestedFormula = String(body.formula_type || '').trim()

  // Verify ownership — incl. fee_base/fee_full voor formule-validatie
  const membership = await queryOne<any>(
    c.env.DB, 
    `SELECT um.*, my.season, my.fee_base, my.fee_full
     FROM user_memberships um
     JOIN membership_years my ON um.year_id = my.id
     WHERE um.id = ? AND um.user_id = ?`, 
    [membershipId, user.id]
  )

  if (!membership) return c.redirect('/leden/betaling-lidgeld?error=invalid')

  // Als de gebruiker een andere formule koos: type + amount aanpassen op de membership row
  if (requestedFormula === 'basis' || requestedFormula === 'full') {
    if (requestedFormula !== membership.type) {
      const newAmount = requestedFormula === 'full'
        ? Number(membership.fee_full ?? 70)
        : Number(membership.fee_base ?? 35)
      // Bij wijziging van formule MOET de oude Mollie URL ongeldig worden — die was gekoppeld aan ander bedrag
      await execute(
        c.env.DB,
        `UPDATE user_memberships SET type = ?, amount = ?, mollie_payment_url = NULL WHERE id = ?`,
        [requestedFormula, newAmount, membership.id]
      )
      membership.type = requestedFormula
      membership.amount = newAmount
      membership.mollie_payment_url = null
    }
  }

  // Bij expliciete 'regenerate' actie: oude link wissen
  if (body.regenerate === '1' && membership.mollie_payment_url) {
    await execute(c.env.DB, `UPDATE user_memberships SET mollie_payment_url = NULL WHERE id = ?`, [membership.id])
    membership.mollie_payment_url = null
  }

  const siteUrl = c.env.SITE_URL || 'https://animato.be'
  
  // Calculate total
  const totalAmount = membership.amount + donationAmount
  
  // If donation included, use membership_donation type
  if (donationAmount > 0) {
      // 1. Create pending donation record
      const insertRes = await execute(c.env.DB, `
        INSERT INTO donations (user_id, amount, message, is_anonymous, status)
        VALUES (?, ?, ?, ?, 'pending')
      `, [user.id, donationAmount, `Extra gift bij lidgeld ${membership.season}`, 0])
      
      const donationId = insertRes.meta.last_row_id
      
      // 2. Create Payment
      // Referentie zodat het in Mollie en op bankafschrift makkelijk
      // terug te vinden is: bv. LID-2026-2027-M42-D17
      const paymentRef = `LID-${membership.season}-M${membership.id}-D${donationId}`
      const payerName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || user.email
      const payment = await createMolliePayment(await getMollieApiKey(c.env), {
        amount: totalAmount,
        description: `${payerName} — Lidgeld ${membership.season} + Vrije Gift [${paymentRef}]`,
        redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
          type: 'membership_donation',
          membership_id: membership.id,
          donation_id: donationId,
          user_id: user.id,
          payer_name: payerName,
          payment_ref: paymentRef
        }
      })
      
      // 3. Update records
      // BUG-FIX (Dominique): payment.id MOET opgeslagen worden, anders kan
      // de eager-refresh hem niet terugvinden en blijft status 'openstaand'.
      await execute(c.env.DB, `UPDATE donations SET payment_id = ?, status = 'pending' WHERE id = ?`, [payment.id, donationId])
      await execute(c.env.DB,
        `UPDATE user_memberships SET mollie_payment_url = ?, mollie_payment_id = ? WHERE id = ?`,
        [payment.checkoutUrl, payment.id, membership.id])
      
      return c.redirect(payment.checkoutUrl)
  } else {
      // Standard membership payment
      // Bug #197 — naam betaler + referentie meegeven zodat het op Mollie
      // dashboard én bankafschriften makkelijk terug te vinden is.
      // Voorbeeld: "Jan Janssens — Lidgeld 2026-2027 (Full) [LID-2026-2027-M42]"
      const paymentRef = `LID-${membership.season}-M${membership.id}`
      const payerName = `${user.voornaam || ''} ${user.achternaam || ''}`.trim() || user.email
      const typeLabel = membership.type === 'full' ? 'Full' : 'Basis'
      const payment = await createMolliePayment(await getMollieApiKey(c.env), {
        amount: membership.amount,
        description: `${payerName} — Lidgeld Animato ${membership.season} (${typeLabel}) [${paymentRef}]`,
        redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
          membership_id: membership.id,
          type: 'membership',
          payer_name: payerName,
          payment_ref: paymentRef
        }
      })
      
      const paymentUrl = payment.checkoutUrl

      // Save URL + payment ID (id is essentieel voor eager-refresh en
      // admin-side status-check)
      await execute(c.env.DB,
        `UPDATE user_memberships SET mollie_payment_url = ?, mollie_payment_id = ? WHERE id = ?`,
        [paymentUrl, payment.id, membership.id])

      return c.redirect(paymentUrl)
  }
})

// =====================================================
// EXTRA ROUTES VOOR DASHBOARD
// =====================================================

app.get('/leden/materiaal', async (c) => {
  const user = c.get('user') as SessionUser

  // Markeer dit als sectiebezoek voor "Nieuw sinds vorige bezoek"-badges
  try {
    const { markSectionVisit } = await import('../utils/section-visits')
    await markSectionVisit(c.env.DB, user.id, 'bestanden')
  } catch (_) {}

  // Query params for filtering
  const search = (c.req.query('search') || '').trim()
  const typeFilter = c.req.query('type') || 'all'
  const werkFilter = c.req.query('werk') || 'all'

  // Get all materials for user's stemgroep WITH view counts
  // BUGFIX (Dries): voorheen JOIN met (SELECT DISTINCT material_id, id ...) – als 1 user N keer een materiaal opende,
  // verscheen dat materiaal N× in de lijst. Nu via geaggregeerde subquery → exact één rij per material.
  const materials = await queryAll(
    c.env.DB,
    `SELECT m.id, m.type, m.titel, m.url, m.beschrijving, m.stem, m.created_at,
            pi.titel as stuk_titel, pi.nummer as stuk_nummer,
            w.titel as werk_titel, w.componist, w.id as werk_id,
            COALESCE(vc.view_count, 0) as view_count,
            COALESCE(uv.has_viewed, 0) as user_viewed
     FROM materials m
     JOIN pieces pi ON pi.id = m.piece_id
     JOIN works w ON w.id = pi.work_id
     LEFT JOIN (SELECT material_id, COUNT(*) as view_count FROM material_views GROUP BY material_id) vc ON vc.material_id = m.id
     LEFT JOIN (SELECT material_id, 1 as has_viewed FROM material_views WHERE user_id = ? GROUP BY material_id) uv ON uv.material_id = m.id
     WHERE m.is_actief = 1
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen'
            OR (m.stem = 'SA' AND ? IN ('S','A'))
            OR (m.stem = 'TB' AND ? IN ('T','B')))
       AND (m.zichtbaar_voor = 'alle_leden' OR
            (m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem'))
     ORDER BY w.titel ASC, pi.nummer ASC, m.type ASC`,
    [user.id, user.stemgroep || 'SATB', user.stemgroep || '', user.stemgroep || '']
  )

  // Helper: determine icon + label + style per material type/url
  function getTypeInfo(mat: any): { icon: string; label: string; colorClass: string; badgeClass: string; filterKey: string } {
    const url: string = (mat.url || '').toLowerCase()
    const type: string = (mat.type || '').toLowerCase()
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return { icon: 'fab fa-youtube', label: 'YouTube', colorClass: 'text-red-600', badgeClass: 'bg-red-100 text-red-700 border-red-200', filterKey: 'youtube' }
    }
    if (url.includes('drive.google.com')) {
      return { icon: 'fab fa-google-drive', label: 'Google Drive', colorClass: 'text-blue-600', badgeClass: 'bg-blue-100 text-blue-700 border-blue-200', filterKey: 'gdrive' }
    }
    if (type === 'audio' || url.match(/\.(mp3|wav|ogg|flac|aac)($|\?)/)) {
      return { icon: 'fas fa-headphones', label: 'Audio', colorClass: 'text-purple-600', badgeClass: 'bg-purple-100 text-purple-700 border-purple-200', filterKey: 'audio' }
    }
    if (type === 'pdf' || url.match(/\.pdf($|\?)/)) {
      return { icon: 'fas fa-file-pdf', label: 'PDF', colorClass: 'text-orange-600', badgeClass: 'bg-orange-100 text-orange-700 border-orange-200', filterKey: 'pdf' }
    }
    if (type === 'video' || url.match(/\.(mp4|mov|avi|mkv)($|\?)/)) {
      return { icon: 'fas fa-video', label: 'Video', colorClass: 'text-pink-600', badgeClass: 'bg-pink-100 text-pink-700 border-pink-200', filterKey: 'video' }
    }
    if (url.match(/\.(zip|rar|tar|gz)($|\?)/)) {
      return { icon: 'fas fa-file-archive', label: 'Archief', colorClass: 'text-gray-600', badgeClass: 'bg-gray-100 text-gray-700 border-gray-200', filterKey: 'archief' }
    }
    if (type === 'link') {
      return { icon: 'fas fa-link', label: 'Link', colorClass: 'text-teal-600', badgeClass: 'bg-teal-100 text-teal-700 border-teal-200', filterKey: 'link' }
    }
    return { icon: 'fas fa-file', label: type.toUpperCase() || 'Bestand', colorClass: 'text-gray-500', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200', filterKey: 'other' }
  }

  // Determine "new" threshold: 14 days
  const now = new Date()
  const newThresholdMs = 14 * 24 * 60 * 60 * 1000
  function isNew(createdAt: string): boolean {
    return (now.getTime() - new Date(createdAt + 'Z').getTime()) < newThresholdMs
  }

  // Enrich materials and apply filters
  const allMats = (materials as any[]).map(mat => ({
    ...mat,
    _info: getTypeInfo(mat),
    _isNew: isNew(mat.created_at)
  }))

  // Collect unique werk titles for the werk dropdown
  const werkTitles = [...new Set(allMats.map(m => m.werk_titel))].sort()

  // Count types for filter badges
  const typeCounts: Record<string, number> = {}
  for (const mat of allMats) {
    typeCounts[mat._info.filterKey] = (typeCounts[mat._info.filterKey] || 0) + 1
  }
  const newCount = allMats.filter(m => m._isNew).length

  // Apply filters
  let filtered = allMats
  if (typeFilter === 'new') {
    filtered = filtered.filter(m => m._isNew)
  } else if (typeFilter !== 'all') {
    filtered = filtered.filter(m => m._info.filterKey === typeFilter)
  }
  if (werkFilter !== 'all') {
    filtered = filtered.filter(m => m.werk_titel === werkFilter)
  }
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(m =>
      m.titel.toLowerCase().includes(q) ||
      m.werk_titel.toLowerCase().includes(q) ||
      m.componist.toLowerCase().includes(q) ||
      (m.beschrijving || '').toLowerCase().includes(q)
    )
  }

  // Group filtered materials by werk_titel + stuk_titel
  const grouped: Record<string, { werk_titel: string; stuk_titel: string; componist: string; items: any[]; hasNew: boolean }> = {}
  for (const mat of filtered) {
    const key = `${mat.werk_titel}||${mat.stuk_titel}`
    if (!grouped[key]) {
      grouped[key] = { werk_titel: mat.werk_titel, stuk_titel: mat.stuk_titel, componist: mat.componist, items: [], hasNew: false }
    }
    grouped[key].items.push(mat)
    if (mat._isNew) grouped[key].hasNew = true
  }

  const groupEntries = Object.values(grouped)

  const successMsg = c.req.query('success')
  const errorMsg = c.req.query('error')
  const infoMsg = c.req.query('info')

  // Build current filter URL helper
  function filterUrl(params: Record<string, string>): string {
    const p = new URLSearchParams()
    const finalSearch = params.search !== undefined ? params.search : search
    const finalType = params.type !== undefined ? params.type : typeFilter
    const finalWerk = params.werk !== undefined ? params.werk : werkFilter
    if (finalSearch) p.set('search', finalSearch)
    if (finalType !== 'all') p.set('type', finalType)
    if (finalWerk !== 'all') p.set('werk', finalWerk)
    const qs = p.toString()
    return `/leden/materiaal${qs ? '?' + qs : ''}`
  }

  // Filter pill config
  const filterPills = [
    { key: 'all', label: 'Alles', icon: 'fas fa-layer-group', cls: 'bg-gray-100 text-gray-700 border-gray-300', count: allMats.length },
    { key: 'new', label: 'Nieuw', icon: 'fas fa-sparkles', cls: 'bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-amber-300', count: newCount },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube', cls: 'bg-red-50 text-red-700 border-red-200', count: typeCounts['youtube'] || 0 },
    { key: 'gdrive', label: 'Drive', icon: 'fab fa-google-drive', cls: 'bg-blue-50 text-blue-700 border-blue-200', count: typeCounts['gdrive'] || 0 },
    { key: 'pdf', label: 'PDF', icon: 'fas fa-file-pdf', cls: 'bg-orange-50 text-orange-700 border-orange-200', count: typeCounts['pdf'] || 0 },
    { key: 'audio', label: 'Audio', icon: 'fas fa-headphones', cls: 'bg-purple-50 text-purple-700 border-purple-200', count: typeCounts['audio'] || 0 },
    { key: 'video', label: 'Video', icon: 'fas fa-video', cls: 'bg-pink-50 text-pink-700 border-pink-200', count: typeCounts['video'] || 0 },
    { key: 'link', label: 'Link', icon: 'fas fa-link', cls: 'bg-teal-50 text-teal-700 border-teal-200', count: typeCounts['link'] || 0 },
  ].filter(p => p.count > 0 || p.key === 'all')

  return c.html(
    <Layout title="Materiaal" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Materiaal', href: '/leden/materiaal'}]}>
      <div class="py-8 sm:py-12 bg-gray-50 min-h-screen">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-4">
            <a href="/leden" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
            </a>
          </div>
          {/* Success/Error/Info messages */}
          {successMsg === 'print_requested' && (
            <div class="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6 flex items-center">
              <i class="fas fa-check-circle text-green-500 mr-3"></i>
              <span>Je print-aanvraag is verstuurd! Het bestuur zal de papieren versie voor je klaarzetten.</span>
            </div>
          )}
          {infoMsg === 'already_requested' && (
            <div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-6 flex items-center">
              <i class="fas fa-info-circle text-blue-500 mr-3"></i>
              <span>Je hebt al een aanvraag lopen voor dit materiaal. Die wordt zo snel mogelijk verwerkt.</span>
            </div>
          )}
          {errorMsg && (
            <div class="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6 flex items-center">
              <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
              <span>Er is iets misgegaan bij het verwerken van je aanvraag.</span>
            </div>
          )}

          {/* Header */}
          <div class="mb-6">
            <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-music text-animato-primary mr-3"></i>
              Oefenmateriaal
            </h1>
            <p class="text-gray-600 mt-1">
              Downloads en oefenbestanden voor jouw stemgroep ({user.stemgroep || 'Algemeen'}) · {allMats.length} bestanden in {werkTitles.length} werken
            </p>
          </div>

          {/* ── Filter bar ── */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
            <div class="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <form method="GET" action="/leden/materiaal" class="flex-1 flex gap-2">
                <div class="relative flex-1">
                  <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                  <input
                    type="text"
                    name="search"
                    value={search}
                    placeholder="Zoek op titel, componist, werk..."
                    class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-animato-primary/50 focus:border-animato-primary"
                  />
                </div>
                {typeFilter !== 'all' && <input type="hidden" name="type" value={typeFilter} />}
                {werkFilter !== 'all' && <input type="hidden" name="werk" value={werkFilter} />}
                <button type="submit" class="px-4 py-2 bg-animato-primary text-white rounded-lg text-sm font-medium hover:bg-animato-secondary transition">
                  <i class="fas fa-search"></i>
                </button>
                {(search || typeFilter !== 'all' || werkFilter !== 'all') && (
                  <a href="/leden/materiaal" class="px-3 py-2 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg text-sm flex items-center gap-1 transition hover:bg-gray-50">
                    <i class="fas fa-times"></i> Reset
                  </a>
                )}
              </form>

              {/* Werk dropdown */}
              <div class="flex-shrink-0">
                <select
                  onchange={`window.location='${filterUrl({werk:''}).replace(werkFilter !== 'all' ? 'werk='+encodeURIComponent(werkFilter) : '___NOOP___', '')}' + (this.value !== 'all' ? (window.location.search ? '&' : '?') + 'werk=' + encodeURIComponent(this.value) : '')`}
                  class="w-full lg:w-56 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-animato-primary/50"
                >
                  <option value="all" selected={werkFilter === 'all'}>Alle werken</option>
                  {werkTitles.map(w => (
                    <option value={w} selected={werkFilter === w}>{w}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Type filter pills */}
            <div class="flex flex-wrap gap-2 mt-4">
              {filterPills.map(pill => {
                const isActive = typeFilter === pill.key
                return (
                  <a
                    href={filterUrl({ type: pill.key === 'all' ? 'all' : pill.key })}
                    class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all
                      ${isActive
                        ? (pill.key === 'new'
                          ? 'bg-gradient-to-r from-amber-400 to-yellow-400 text-white border-amber-500 shadow-md shadow-amber-200/50 scale-105'
                          : 'bg-animato-primary text-white border-animato-primary shadow-md scale-105')
                        : pill.cls + ' hover:shadow-sm hover:scale-[1.02]'
                      }`}
                  >
                    <i class={pill.icon}></i>
                    {pill.label}
                    <span class={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-white/30' : 'bg-black/5'}`}>
                      {pill.count}
                    </span>
                    {pill.key === 'new' && !isActive && pill.count > 0 && (
                      <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          </div>

          {/* Active filter feedback */}
          {(search || typeFilter !== 'all' || werkFilter !== 'all') && (
            <div class="flex items-center gap-2 mb-4 text-sm text-gray-600">
              <i class="fas fa-filter text-gray-400"></i>
              <span>{filtered.length} van {allMats.length} bestanden</span>
              {search && <span class="bg-gray-100 px-2 py-0.5 rounded-full text-xs">"{search}"</span>}
              {typeFilter !== 'all' && (
                <span class="bg-gray-100 px-2 py-0.5 rounded-full text-xs capitalize">
                  {typeFilter === 'new' ? 'Nieuw' : typeFilter}
                </span>
              )}
              {werkFilter !== 'all' && (
                <span class="bg-gray-100 px-2 py-0.5 rounded-full text-xs">{werkFilter}</span>
              )}
            </div>
          )}

          {/* ── Material cards ── */}
          {groupEntries.length > 0 ? (
            <div class="space-y-5">
              {groupEntries.map((group: any) => (
                <div class={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all ${group.hasNew ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200'}`}>
                  {/* Group header */}
                  <div class={`px-6 py-4 border-b ${group.hasNew ? 'bg-gradient-to-r from-amber-50 via-yellow-50/50 to-transparent border-amber-100' : 'bg-gradient-to-r from-animato-primary/10 to-transparent border-gray-100'}`}>
                    <div class="flex items-start justify-between">
                      <div class="flex items-start gap-3">
                        {group.hasNew && (
                          <span class="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-amber-400 to-yellow-400 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm animate-pulse">
                            <i class="fas fa-star text-[8px]"></i> Nieuw
                          </span>
                        )}
                        <div>
                          <h2 class="text-lg font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                            {group.werk_titel}
                          </h2>
                          {group.stuk_titel && group.stuk_titel !== group.werk_titel && (
                            <p class="text-sm text-gray-600 mt-0.5">{group.stuk_titel}</p>
                          )}
                          <p class="text-xs text-gray-400 mt-1">
                            <i class="fas fa-user-edit mr-1"></i>{group.componist}
                          </p>
                        </div>
                      </div>
                      <span class="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-1 ml-3 whitespace-nowrap">
                        {group.items.length} {group.items.length === 1 ? 'bestand' : 'bestanden'}
                      </span>
                    </div>
                  </div>

                  {/* Individual material items */}
                  <div class="divide-y divide-gray-100">
                    {group.items.map((mat: any) => {
                      const info = mat._info
                      const matIsNew = mat._isNew
                      return (
                        <div class={`flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-gray-50 transition group ${matIsNew ? 'bg-amber-50/30' : ''}`}>
                          {/* Type icon */}
                          <div class={`relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border ${matIsNew ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                            <i class={`${info.icon} ${info.colorClass} text-lg`}></i>
                            {matIsNew && (
                              <span class="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center">
                                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span class="relative inline-flex rounded-full h-3 w-3 bg-amber-500 text-white text-[6px] font-bold items-center justify-center">
                                  <i class="fas fa-star text-[5px]"></i>
                                </span>
                              </span>
                            )}
                          </div>

                          {/* Content */}
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${info.badgeClass}`}>
                                <i class={`${info.icon} text-xs`}></i>
                                {info.label}
                              </span>
                              <span class="text-sm font-medium text-gray-800 truncate">{mat.titel}</span>
                              {mat.stem && mat.stem !== 'algemeen' && mat.stem !== 'SATB' && (
                                <span class="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full">{mat.stem}</span>
                              )}
                              {matIsNew && (
                                <span class="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200">
                                  Nieuw!
                                </span>
                              )}
                            </div>
                            <div class="flex items-center gap-3 mt-0.5">
                              {mat.beschrijving && mat.beschrijving !== 'null' && (
                                <p class="text-xs text-gray-500 truncate">{mat.beschrijving}</p>
                              )}
                              <span class="text-[10px] text-gray-400 flex items-center gap-1 whitespace-nowrap" title={`${mat.view_count}x geopend`}>
                                <i class="fas fa-eye"></i> {mat.view_count}
                              </span>
                              {mat.user_viewed === 1 && (
                                <span class="text-[10px] text-green-500 flex items-center gap-0.5 whitespace-nowrap" title="Je hebt dit al bekeken">
                                  <i class="fas fa-check-circle"></i>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div class="flex-shrink-0 flex gap-2">
                            <a
                              href={mat.url}
                              target="_blank"
                              onclick={`fetch('/api/leden/materiaal/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({material_id:${mat.id}})})`}
                              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-animato-primary hover:bg-animato-secondary transition shadow-sm"
                              title={mat.beschrijving || mat.titel}
                            >
                              <i class={`${info.icon} text-xs`}></i>
                              <span class="hidden sm:inline">Openen</span>
                            </a>
                            {(info.label === 'PDF' || info.label === 'Google Drive') && (
                              <form action="/api/leden/materiaal/print-aanvraag" method="POST" class="inline"
                                    onsubmit={`return confirm('Wil je een papieren versie van \\'${(mat.titel || '').replace(/'/g, "\\'")}\\' bestellen?\\n\\nDe printservice drukt het voor je af en je krijgt het op de eerstvolgende repetitie. Dit is GEEN browser-print — gebruik daarvoor de \\'Openen\\' knop en print via je eigen pc.');`}>
                                <input type="hidden" name="material_id" value={mat.id} />
                                <button
                                  type="submit"
                                  class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 hover:text-amber-800 transition border border-amber-200"
                                  title="Bestel een papieren afdruk via de Printservice — je krijgt het op de eerstvolgende repetitie"
                                >
                                  <i class="fas fa-file-invoice text-xs"></i>
                                  <span class="hidden md:inline">Bestel afdruk</span>
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
              <i class="fas fa-folder-open text-4xl mb-4 text-gray-300"></i>
              {search || typeFilter !== 'all' || werkFilter !== 'all' ? (
                <div>
                  <p class="mb-2">Geen materiaal gevonden voor deze filters.</p>
                  <a href="/leden/materiaal" class="text-animato-primary hover:underline text-sm font-semibold">
                    <i class="fas fa-undo mr-1"></i> Toon alle materialen
                  </a>
                </div>
              ) : (
                <p>Geen materiaal beschikbaar voor jouw stemgroep.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Werk filter JS - proper select onchange */}
      <script dangerouslySetInnerHTML={{__html: `
        document.addEventListener('DOMContentLoaded', function() {
          var werkSelect = document.querySelector('select[onchange]');
          if (werkSelect) {
            werkSelect.removeAttribute('onchange');
            werkSelect.addEventListener('change', function() {
              var params = new URLSearchParams(window.location.search);
              if (this.value === 'all') {
                params.delete('werk');
              } else {
                params.set('werk', this.value);
              }
              var qs = params.toString();
              window.location.href = '/leden/materiaal' + (qs ? '?' + qs : '');
            });
          }
        });
      `}} />
    </Layout>
  )
})

app.get('/leden/smoelenboek', async (c) => {
  const user = c.get('user') as SessionUser
  const search = c.req.query('search') || ''
  const view = c.req.query('view') || 'grid' // 'grid' or 'list'
  const stemgroepFilter = c.req.query('stemgroep') || 'all'

  // Birthday members this week (Belgian time)
  function getBirthdayWeekRangeSB() {
    const now = new Date()
    const be = new Date(now.getTime() + 2 * 60 * 60 * 1000) // approx CEST
    const day = be.getUTCDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(be); mon.setUTCDate(be.getUTCDate() + diffToMon)
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    const fmt = (d: Date) => `${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
    return { start: fmt(mon), end: fmt(sun) }
  }
  const bwRange = getBirthdayWeekRangeSB()
  const [birthdayMembers, nextBirthdayMember] = await Promise.all([
    queryAll<any>(
      c.env.DB,
      `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.geboortedatum
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.status = 'actief'
         AND p.geboortedatum IS NOT NULL
         AND strftime('%m-%d', p.geboortedatum) BETWEEN ? AND ?
       ORDER BY strftime('%m-%d', p.geboortedatum) ASC`,
      [bwRange.start, bwRange.end]
    ),
    // Next upcoming birthday (after this week) for "coming soon" hint
    queryOne<any>(
      c.env.DB,
      `SELECT p.voornaam, p.achternaam, p.geboortedatum
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.status = 'actief'
         AND p.geboortedatum IS NOT NULL
         AND strftime('%m-%d', p.geboortedatum) > ?
       ORDER BY strftime('%m-%d', p.geboortedatum) ASC
       LIMIT 1`,
      [bwRange.end]
    )
  ])

  // Get members with optional search + stemgroep filter + checkin count for streaks
  // Online-status: last_seen_at binnen 5 minuten EN show_online_status = 1.
  // Eigen profiel ziet altijd z'n eigen status (anders verwarrend).
  let query = `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio, p.favoriete_werk,
            p.toon_email, p.toon_telefoon, u.email, p.telefoon,
            u.is_bestuurslid, p.bestuurs_functie,
            CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
            COUNT(qc.id) as total_checkins,
            CASE
              WHEN u.last_seen_at IS NOT NULL
                AND u.last_seen_at >= datetime('now', '-5 minutes')
                AND (u.show_online_status = 1 OR u.id = ?)
              THEN 1 ELSE 0
            END as is_online
     FROM users u
     JOIN profiles p ON u.id = p.user_id
     LEFT JOIN member_favorites f ON f.favorite_member_id = u.id AND f.user_id = ?
     LEFT JOIN qr_checkins qc ON qc.user_id = u.id
     WHERE u.status = 'actief' AND p.smoelenboek_zichtbaar = 1 AND u.is_test_account = 0`
  
  // params: eerste ? voor "eigen profiel ziet z'n eigen status",
  // tweede ? voor de member_favorites JOIN.
  const params: any[] = [user.id, user.id]

  if (search) {
    query += ` AND (p.voornaam LIKE ? OR p.achternaam LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }

  if (stemgroepFilter !== 'all') {
    query += ` AND u.stemgroep = ?`
    params.push(stemgroepFilter)
  }

  query += ` GROUP BY u.id ORDER BY p.voornaam ASC`

  const members = await queryAll(c.env.DB, query, params)

  // Calculate streaks for members that have checkins (batch all past rehearsals once)
  const allRehearsals = await queryAll<any>(c.env.DB,
    `SELECT id, start_at FROM events WHERE type = 'repetitie' AND datetime(start_at) <= datetime('now') ORDER BY start_at DESC`
  )
  const allCheckins = await queryAll<any>(c.env.DB,
    `SELECT user_id, event_id FROM qr_checkins`
  )
  // Build checkin sets per user
  const checkinsByUser: Record<number, Set<number>> = {}
  for (const ci of allCheckins) {
    if (!checkinsByUser[ci.user_id]) checkinsByUser[ci.user_id] = new Set()
    checkinsByUser[ci.user_id].add(ci.event_id)
  }
  // Quick streak calculator
  function quickStreak(userId: number): number {
    const userCheckins = checkinsByUser[userId]
    if (!userCheckins || userCheckins.size === 0) return 0
    let streak = 0
    for (const r of allRehearsals) {
      if (userCheckins.has(r.id)) streak++
      else break
    }
    return streak
  }
  // Attach streaks to members
  const memberStreaks: Record<number, number> = {}
  for (const m of members as any[]) {
    memberStreaks[m.id] = quickStreak(m.id)
  }

  // Group by voice (only for grid view grouping, list view is flat or sorted)
  const byVoice: any = { 'Dirigent': [], 'S': [], 'A': [], 'T': [], 'B': [], 'Pianist': [], 'Other': [] }
  members.forEach((m: any) => {
    const group = ['Dirigent', 'S', 'A', 'T', 'B', 'Pianist'].includes(m.stemgroep) ? m.stemgroep : 'Other'
    byVoice[group].push(m)
  })

  return c.html(
    <Layout title="Onze Zangers" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Smoelenboek', href: '/leden/smoelenboek'}]}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-4">
            <a href="/leden" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
            </a>
          </div>
          <div class="text-center mb-8">
            <h1 class="text-4xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
              Onze Zangers
            </h1>
            <p class="text-xl text-gray-600 mb-5">
              Ontmoet de stemmen van Animato
            </p>
            {/* Quiz CTA — leer namen kennen */}
            <a href="/leden/quiz"
               class="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 via-purple-500 to-animato-primary text-white px-6 py-3 rounded-full font-semibold shadow-md hover:shadow-lg hover:scale-105 transition">
              <i class="fas fa-question-circle text-lg"></i>
              <span>Wie-is-wie quiz</span>
              <span class="text-xs bg-white/20 px-2 py-0.5 rounded-full ml-1">Test je kennis!</span>
            </a>
          </div>

          {/* 🎂 Birthday banner — always visible, shows this week's birthdays or next upcoming */}
          <div class="mb-8 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-6 shadow-md relative overflow-hidden">
            {/* Decorative */}
            <div class="absolute top-2 right-4 text-2xl opacity-30 select-none">🎊</div>
            <div class="absolute bottom-2 left-4 text-2xl opacity-20 select-none">🎶</div>

            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
                <i class="fas fa-birthday-cake text-white text-lg"></i>
              </div>
              <div>
                <h2 class="text-xl font-bold text-amber-900" style="font-family: 'Playfair Display', serif;">
                  {birthdayMembers.length > 0 ? '🎉 Jarig deze week!' : '🎂 Verjaardagen'}
                </h2>
                <p class="text-xs text-amber-600 mt-0.5">
                  {birthdayMembers.length > 0
                    ? 'Proficiat aan de jarige(n)!'
                    : 'Geen jarigen deze week'}
                </p>
              </div>
            </div>

            {birthdayMembers.length > 0 ? (
              <div class="flex flex-wrap gap-6 justify-center sm:justify-start">
                {birthdayMembers.map((bm: any) => {
                  const isMe = bm.id === user.id
                  // Gebruik huidig jaar voor de weekdag-berekening
                  const [, mm2, dd2] = (bm.geboortedatum || '').split('-')
                  const now2 = new Date()
                  const thisYearBd2 = new Date(now2.getFullYear(), Number(mm2) - 1, Number(dd2))
                  const displayDate2 = thisYearBd2 < new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() - 7)
                    ? new Date(now2.getFullYear() + 1, Number(mm2) - 1, Number(dd2))
                    : thisYearBd2
                  return (
                    <a href={`/leden/smoelenboek/${bm.id}`} class="flex flex-col items-center group transition hover:scale-105">
                      {/* Photo with crown */}
                      <div class="relative mb-2">
                        <div class={`w-20 h-20 rounded-full overflow-hidden border-4 ${isMe ? 'border-amber-400 ring-2 ring-amber-200' : 'border-amber-200'} bg-white shadow-md`}>
                          <img src={bm.foto_url || getDefaultAvatar(bm.stemgroep)} class="w-full h-full object-cover" alt={`${bm.voornaam} ${bm.achternaam}`} />
                        </div>
                        <span class="absolute -top-4 left-1/2 -translate-x-1/2 text-3xl drop-shadow-sm" title="Jarig deze week!">👑</span>
                      </div>
                      {/* Full name */}
                      <span class={`text-sm font-bold ${isMe ? 'text-amber-800' : 'text-gray-800'} group-hover:text-amber-600 transition text-center leading-snug`}>
                        {bm.voornaam} {bm.achternaam}
                      </span>
                      {isMe && <span class="text-[10px] font-bold text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full mt-0.5">Dat ben jij! 🥳</span>}
                      {/* Day of week + date — in het huidige jaar */}
                      <span class="text-xs text-amber-600 font-semibold mt-0.5">
                        {displayDate2.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long' })}
                      </span>
                    </a>
                  )
                })}
              </div>
            ) : (
              <div class="flex items-center gap-3 text-amber-700">
                <i class="fas fa-calendar-check text-amber-400"></i>
                <span class="text-sm">
                  {nextBirthdayMember
                    ? <>Volgende jarige: <strong>{nextBirthdayMember.voornaam} {nextBirthdayMember.achternaam}</strong> op {new Date(nextBirthdayMember.geboortedatum).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</>
                    : 'Geen verjaardagen geregistreerd.'}
                </span>
              </div>
            )}
          </div>

          {/* Search, stemgroep filter & View Toggle */}
          <div class="bg-white rounded-xl shadow-md p-4 mb-8">
            <form method="GET" class="flex flex-wrap items-center gap-3">
              <input type="hidden" name="view" value={view} />
              {/* Search input */}
              <div class="relative flex-1 min-w-[200px]">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i class="fas fa-search text-gray-400"></i>
                </div>
                <input 
                  type="text" 
                  name="search" 
                  value={search} 
                  placeholder="Zoek op naam..." 
                  class="pl-10 w-full border border-gray-300 rounded-lg py-2.5 text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>
              {/* Stemgroep filter */}
              <div class="relative">
                <select
                  name="stemgroep"
                  onchange="this.form.submit()"
                  class="border border-gray-300 rounded-lg py-2.5 pl-3 pr-8 text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent appearance-none bg-white"
                >
                  <option value="all" selected={stemgroepFilter === 'all'}>Alle stemgroepen</option>
                  <option value="S" selected={stemgroepFilter === 'S'}>Sopraan</option>
                  <option value="A" selected={stemgroepFilter === 'A'}>Alt</option>
                  <option value="T" selected={stemgroepFilter === 'T'}>Tenor</option>
                  <option value="B" selected={stemgroepFilter === 'B'}>Bas</option>
                </select>
                <div class="absolute inset-y-0 right-2 flex items-center pointer-events-none">
                  <i class="fas fa-chevron-down text-gray-400 text-xs"></i>
                </div>
              </div>
              {/* Search button */}
              <button type="submit" class="px-5 py-2.5 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm font-semibold">
                <i class="fas fa-search mr-1.5"></i> Zoeken
              </button>
              {/* View toggles — aligned right */}
              <div class="flex gap-1.5 ml-auto">
                <a href={`/leden/smoelenboek?view=grid&search=${encodeURIComponent(search)}&stemgroep=${stemgroepFilter}`} class={`px-3 py-2.5 rounded-lg border text-sm font-medium transition ${view === 'grid' ? 'bg-animato-primary text-white border-animato-primary' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`} title="Grid weergave">
                  <i class="fas fa-th-large"></i>
                </a>
                <a href={`/leden/smoelenboek?view=list&search=${encodeURIComponent(search)}&stemgroep=${stemgroepFilter}`} class={`px-3 py-2.5 rounded-lg border text-sm font-medium transition ${view === 'list' ? 'bg-animato-primary text-white border-animato-primary' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`} title="Lijst weergave">
                  <i class="fas fa-list"></i>
                </a>
              </div>
            </form>
            {/* Active filter indicator */}
            {(stemgroepFilter !== 'all' || search) && (
              <div class="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-sm text-gray-500 flex-wrap">
                <i class="fas fa-filter text-animato-primary"></i>
                <span>Actieve filters:</span>
                {search && <span class="px-2 py-0.5 bg-gray-100 rounded-full text-gray-700">"{search}"</span>}
                {stemgroepFilter !== 'all' && (
                  <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    stemgroepFilter === 'S' ? 'bg-pink-100 text-pink-700' :
                    stemgroepFilter === 'A' ? 'bg-purple-100 text-purple-700' :
                    stemgroepFilter === 'T' ? 'bg-blue-100 text-blue-700' :
                    stemgroepFilter === 'B' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {stemgroepFilter === 'S' ? 'Sopraan' : stemgroepFilter === 'A' ? 'Alt' : stemgroepFilter === 'T' ? 'Tenor' : stemgroepFilter === 'B' ? 'Bas' : stemgroepFilter}
                  </span>
                )}
                <a href="/leden/smoelenboek" class="text-animato-primary hover:underline ml-1">✕ Wis filters</a>
                <span class="ml-auto text-xs text-gray-400">{members.length} leden gevonden</span>
              </div>
            )}
          </div>

          {view === 'grid' ? (
              ['Dirigent', 'S', 'A', 'T', 'B', 'Pianist', 'Other'].map(voice => {
                const voiceName = voice === 'S' ? 'Sopranen' : voice === 'A' ? 'Alten' : voice === 'T' ? 'Tenoren' : voice === 'B' ? 'Bassen' : voice === 'Dirigent' ? 'Dirigent' : voice === 'Pianist' ? 'Pianist' : 'Overige'
                const color = voice === 'S' ? 'pink' : voice === 'A' ? 'purple' : voice === 'T' ? 'blue' : voice === 'B' ? 'green' : voice === 'Dirigent' ? 'yellow' : voice === 'Pianist' ? 'indigo' : 'gray'
                const list = byVoice[voice]
                
                if (list.length === 0) return null

                return (
                  <div class="mb-12">
                    <h2 class={`text-2xl font-bold mb-6 text-${color}-800 border-b-2 border-${color}-200 pb-2 inline-block`}>
                      {voiceName}
                    </h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {list.map((m: any) => (
                        <div class="bg-white rounded-lg shadow hover:shadow-lg transition overflow-hidden group relative">
                          {/* Favorite Star */}
                          <button 
                            class={`absolute top-2 right-2 z-10 text-xl focus:outline-none ${m.is_favorite ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-200'}`}
                            onclick={`toggleFavorite(${m.id}, this)`}
                          >
                            <i class="fas fa-star"></i>
                          </button>

                          <a href={`/leden/smoelenboek/${m.id}`} class="block">
                              <div class={`h-2 bg-${color}-500`}></div>
                              <div class="p-6 text-center">
                                {/* Foto + streak-badge (altijd zichtbaar als streak > 0, ongeacht bio) */}
                                <div class="relative w-24 h-24 mx-auto mb-4">
                                  <div class="w-24 h-24 bg-gray-200 rounded-full overflow-hidden border-4 border-white shadow-sm">
                                    <img src={m.foto_url || getDefaultAvatar(m.stemgroep)} class="w-full h-full object-cover" alt={m.voornaam} />
                                  </div>
                                  {/* Online-indicator: groen bolletje bij actieve sessie binnen 5 min */}
                                  {m.is_online === 1 && (
                                    <span
                                      class="absolute bottom-0 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full shadow-sm"
                                      title="Nu actief"
                                      aria-label="Online"
                                    ></span>
                                  )}
                                  {memberStreaks[m.id] > 0 && (
                                    <div
                                      class="absolute -top-1 -right-1 inline-flex items-center gap-0.5 px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold shadow-md border-2 border-white"
                                      title={`${memberStreaks[m.id]} ${memberStreaks[m.id] === 1 ? 'week' : 'weken'} streak`}
                                    >
                                      <span>🔥</span>{memberStreaks[m.id]}
                                    </div>
                                  )}
                                </div>
                                <h3 class="font-bold text-gray-900 text-lg group-hover:text-animato-primary transition-colors">{m.voornaam} {m.achternaam}</h3>
                                {m.is_bestuurslid === 1 && (
                                  <div class="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold border border-amber-200" title={m.bestuurs_functie || 'Bestuurslid'}>
                                    <i class="fas fa-crown text-[10px]"></i>
                                    {m.bestuurs_functie || 'Bestuur'}
                                  </div>
                                )}
                                {m.bio && <p class="text-sm text-gray-500 mt-2 line-clamp-2">{m.bio}</p>}
                              </div>
                          </a>
                          
                          <div class="pb-4 pt-2 border-t border-gray-100 flex justify-center gap-4 text-gray-400">
                             {m.toon_email && m.email && <a href={`mailto:${m.email}`} title="Email" class="hover:text-animato-primary"><i class="fas fa-envelope"></i></a>}
                             {m.toon_telefoon && m.telefoon && <a href={`tel:${m.telefoon}`} title="Bel" class="hover:text-animato-primary"><i class="fas fa-phone"></i></a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
          ) : (
              <div class="bg-white rounded-lg shadow overflow-hidden">
                  <table class="min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-50">
                          <tr>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lid</th>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stemgroep</th>
                              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actie</th>
                          </tr>
                      </thead>
                      <tbody class="bg-white divide-y divide-gray-200">
                          {members.map((m: any) => (
                              <tr class="hover:bg-gray-50">
                                  <td class="px-6 py-4 whitespace-nowrap">
                                      <div class="flex items-center">
                                          <div class="flex-shrink-0 h-10 w-10 relative">
                                              {m.foto_url ? (
                                                  <img class="h-10 w-10 rounded-full object-cover" src={m.foto_url || getDefaultAvatar(m.stemgroep)} alt="" />
                                              ) : (
                                                  <img class="h-10 w-10 rounded-full object-cover" src={getDefaultAvatar(m.stemgroep)} alt="" />
                                              )}
                                              {/* Online-indicator (klein groen bolletje, hoek rechtsonder van avatar) */}
                                              {m.is_online === 1 && (
                                                <span
                                                  class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full"
                                                  title="Nu actief"
                                                  aria-label="Online"
                                                ></span>
                                              )}
                                          </div>
                                          <div class="ml-4">
                                              <div class="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                                                {m.voornaam} {m.achternaam}
                                                {m.is_online === 1 && <span class="inline-block w-2 h-2 bg-green-500 rounded-full" aria-hidden="true"></span>}
                                                {m.is_bestuurslid === 1 && (
                                                  <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-semibold border border-amber-200" title={m.bestuurs_functie || 'Bestuurslid'}>
                                                    <i class="fas fa-crown text-[9px]"></i>{m.bestuurs_functie || 'Bestuur'}
                                                  </span>
                                                )}
                                              </div>
                                              <div class="text-sm text-gray-500">{m.bio ? m.bio.substring(0, 30) + '...' : ''}</div>
                                          </div>
                                      </div>
                                  </td>
                                  <td class="px-6 py-4 whitespace-nowrap">
                                      <span class={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                        ${m.stemgroep === 'S' ? 'bg-pink-100 text-pink-800' : 
                                          m.stemgroep === 'A' ? 'bg-purple-100 text-purple-800' :
                                          m.stemgroep === 'T' ? 'bg-blue-100 text-blue-800' : 
                                          m.stemgroep === 'B' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                          {m.stemgroep === 'S' ? 'Sopraan' : m.stemgroep === 'A' ? 'Alt' : m.stemgroep === 'T' ? 'Tenor' : m.stemgroep === 'B' ? 'Bas' : m.stemgroep}
                                      </span>
                                  </td>
                                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <div class="flex space-x-3">
                                          {m.toon_email && m.email && <a href={`mailto:${m.email}`} class="text-gray-400 hover:text-animato-primary"><i class="fas fa-envelope"></i></a>}
                                          {m.toon_telefoon && m.telefoon && <a href={`tel:${m.telefoon}`} class="text-gray-400 hover:text-animato-primary"><i class="fas fa-phone"></i></a>}
                                      </div>
                                  </td>
                                  <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                      <div class="flex items-center justify-end space-x-3">
                                          <button onclick={`toggleFavorite(${m.id}, this)`} class={`text-xl focus:outline-none ${m.is_favorite ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-200'}`}>
                                              <i class="fas fa-star"></i>
                                          </button>
                                          {memberStreaks[m.id] > 0 && (
                                              <span class="text-orange-500 text-xs font-bold">🔥 {memberStreaks[m.id]}</span>
                                          )}
                                          <a href={`/leden/smoelenboek/${m.id}`} class="text-animato-primary hover:text-animato-secondary">Bekijk <i class="fas fa-chevron-right ml-1"></i></a>
                                      </div>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          )}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{__html: `
        async function toggleFavorite(memberId, btn) {
            try {
                const icon = btn.querySelector('i');
                const isFav = btn.classList.contains('text-yellow-400');
                
                const res = await fetch('/api/leden/favorites/toggle', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ memberId })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.is_favorite) {
                        btn.classList.remove('text-gray-300', 'hover:text-yellow-200');
                        btn.classList.add('text-yellow-400');
                    } else {
                        btn.classList.remove('text-yellow-400');
                        btn.classList.add('text-gray-300', 'hover:text-yellow-200');
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
      `}} />
    </Layout>
  )
})

app.get('/leden/smoelenboek/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const memberId = c.req.param('id')
  const isOwnProfile = String(user.id) === String(memberId)
  const isAdmin = (user as any).role === 'admin'

  // Admins and own profile can see non-smoelenboek members too
  const visibilityClause = (isOwnProfile || isAdmin) ? '' : ' AND p.smoelenboek_zichtbaar = 1'

  const member = await queryOne<any>(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio, 
            p.favoriete_werk, p.favoriete_genre, p.favoriete_componist, p.instrument, p.jaren_in_koor, p.zanger_type,
            p.toon_email, p.toon_telefoon, u.email, p.telefoon, p.adres, u.created_at, p.geboortedatum, p.lid_sinds,
            u.is_bestuurslid, p.bestuurs_functie,
            CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
     FROM users u
     JOIN profiles p ON u.id = p.user_id
     LEFT JOIN member_favorites f ON f.favorite_member_id = u.id AND f.user_id = ?
     WHERE u.id = ? AND u.status = 'actief'${visibilityClause}`,
    [user.id, memberId]
  )

  if (!member) return c.redirect('/leden/smoelenboek')

  // Calculate streak for this member
  const memberCheckins = await queryAll<any>(c.env.DB,
    `SELECT qc.event_id FROM qr_checkins qc
     JOIN events e ON e.id = qc.event_id
     WHERE qc.user_id = ? AND e.type = 'repetitie'
     ORDER BY e.start_at DESC`,
    [memberId]
  )
  const allPastRehearsals = await queryAll<any>(c.env.DB,
    `SELECT id FROM events WHERE type = 'repetitie' AND datetime(start_at) <= datetime('now') ORDER BY start_at DESC`
  )
  const checkedEventIds = new Set(memberCheckins.map((ci: any) => ci.event_id))
  let memberCurrentStreak = 0
  let memberLongestStreak = 0
  let memberTempStreak = 0
  for (const r of allPastRehearsals) {
    if (checkedEventIds.has(r.id)) {
      if (memberCurrentStreak === memberTempStreak) memberCurrentStreak++
      memberTempStreak++
      memberLongestStreak = Math.max(memberLongestStreak, memberTempStreak)
    } else {
      if (memberCurrentStreak === memberTempStreak) { /* streak already broken */ }
      memberTempStreak = 0
    }
  }
  // Simpler approach for current streak
  memberCurrentStreak = 0
  for (const r of allPastRehearsals) {
    if (checkedEventIds.has(r.id)) memberCurrentStreak++
    else break
  }
  const memberStreakBadge = memberCurrentStreak >= 52 ? { name: 'Gouden Noot', icon: 'fas fa-trophy', bg: 'bg-yellow-100 text-yellow-700' } :
    memberCurrentStreak >= 25 ? { name: 'Zilveren Noot', icon: 'fas fa-medal', bg: 'bg-gray-100 text-gray-700' } :
    memberCurrentStreak >= 10 ? { name: 'Bronzen Noot', icon: 'fas fa-award', bg: 'bg-amber-100 text-amber-700' } :
    memberCurrentStreak >= 5 ? { name: 'Trouw Lid', icon: 'fas fa-star', bg: 'bg-blue-100 text-blue-700' } : null

  // Calculate jaren bij Animato from lid_sinds (or fallback to created_at)
  const lidSindsDate = member.lid_sinds ? new Date(member.lid_sinds + 'T00:00:00') : new Date(member.created_at)
  const now = new Date()
  const jarenBerekend = now.getFullYear() - lidSindsDate.getFullYear()

  // Favorited-by stats (only show on own profile or admin)
  let favorieten: any[] = []
  let favCount = { S: 0, A: 0, T: 0, B: 0, total: 0 }
  if (isOwnProfile || isAdmin) {
    favorieten = await queryAll<any>(
      c.env.DB,
      `SELECT u.stemgroep, p.voornaam, p.achternaam, p.foto_url, mf.created_at
       FROM member_favorites mf
       JOIN users u ON u.id = mf.user_id
       JOIN profiles p ON p.user_id = u.id
       WHERE mf.favorite_member_id = ?
       ORDER BY mf.created_at DESC`,
      [memberId]
    )
    for (const f of favorieten) {
      const sg = f.stemgroep as string
      if (sg === 'S') favCount.S++
      else if (sg === 'A') favCount.A++
      else if (sg === 'T') favCount.T++
      else favCount.B++
      favCount.total++
    }
  }

  const stemgroepLabel = (s: string) => s === 'S' ? 'Sopraan' : s === 'A' ? 'Alt' : s === 'T' ? 'Tenor' : 'Bas'

  return c.html(
    <Layout title={`${member.voornaam} ${member.achternaam}`} user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Smoelenboek', href: '/leden/smoelenboek'}, {label: `${member.voornaam} ${member.achternaam}`, href: '#'}]}>
        <div class="py-12 bg-gray-50 min-h-screen">
            <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

              {/* Navigation bar */}
              <div class="flex items-center justify-between mb-6">
                <a href="/leden" class="inline-flex items-center gap-2 text-gray-500 hover:text-animato-primary transition text-sm font-medium">
                  <i class="fas fa-arrow-left"></i> Terug naar dashboard
                </a>
                <a href="/leden/smoelenboek" class="inline-flex items-center gap-2 text-gray-500 hover:text-animato-primary transition text-sm font-medium">
                  <i class="fas fa-users"></i> Smoelenboek
                </a>
              </div>

                <div class="bg-white rounded-xl shadow-lg overflow-hidden">
                    {/* Header Banner */}
                    <div class={`h-32 bg-gradient-to-r ${
                        member.stemgroep === 'S' ? 'from-pink-400 to-pink-600' : 
                        member.stemgroep === 'A' ? 'from-purple-400 to-purple-600' :
                        member.stemgroep === 'T' ? 'from-blue-400 to-blue-600' : 
                        'from-green-400 to-green-600'
                    }`}></div>
                    
                    <div class="px-8 pb-8">
                        <div class="flex flex-col md:flex-row items-start md:items-end -mt-12 mb-6">
                            {/* Clickable photo for zoom */}
                            <div class="w-32 h-32 rounded-full border-4 border-white shadow-lg overflow-hidden bg-white flex items-center justify-center cursor-pointer" onclick="openPhotoModal()" title="Klik om te vergroten">
                                <img src={member.foto_url || getDefaultAvatar(member.stemgroep)} class="w-full h-full object-cover" alt={member.voornaam} id="profile-photo-thumb" />
                            </div>
                            <div class="mt-4 md:mt-0 md:ml-6 flex-1">
                                <div class="flex items-center gap-3 flex-wrap">
                                  <h1 class="text-3xl font-bold text-gray-900">{member.voornaam} {member.achternaam}</h1>
                                  {member.is_bestuurslid === 1 && (
                                    <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 rounded-full text-sm font-semibold border border-amber-300 shadow-sm" title={member.bestuurs_functie || 'Bestuurslid'}>
                                      <i class="fas fa-crown text-amber-600"></i>
                                      {member.bestuurs_functie || 'Bestuurslid'}
                                    </span>
                                  )}
                                </div>
                                <p class="text-gray-600 flex items-center mt-1">
                                    <span class={`inline-block w-3 h-3 rounded-full mr-2 ${
                                        member.stemgroep === 'S' ? 'bg-pink-500' : 
                                        member.stemgroep === 'A' ? 'bg-purple-500' :
                                        member.stemgroep === 'T' ? 'bg-blue-500' : 
                                        'bg-green-500'
                                    }`}></span>
                                    {member.stemgroep === 'S' ? 'Sopraan' : member.stemgroep === 'A' ? 'Alt' : member.stemgroep === 'T' ? 'Tenor' : 'Bas'}
                                    {member.zanger_type && <span class="mx-2 text-gray-300">•</span>}
                                    {member.zanger_type && <span class="capitalize">{member.zanger_type}</span>}
                                </p>
                            </div>
                            <div class="mt-4 md:mt-0 flex gap-2">
                                {isOwnProfile ? (
                                    <a href="/leden/profiel" class="px-4 py-2 rounded-lg border border-animato-primary text-animato-primary flex items-center gap-2 hover:bg-animato-primary hover:text-white transition">
                                        <i class="fas fa-edit"></i> Profiel bewerken
                                    </a>
                                ) : (
                                    <button onclick={`toggleFavorite(${member.id}, this)`} class={`btn-fav px-4 py-2 rounded-lg border flex items-center gap-2 transition ${member.is_favorite ? 'bg-yellow-50 border-yellow-200 text-yellow-600' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                                        <i class={`fas fa-star ${member.is_favorite ? '' : 'text-gray-300'}`}></i>
                                        {member.is_favorite ? 'Favoriet' : 'Favoriet maken'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div class="md:col-span-2 space-y-6">
                                {member.bio && (
                                    <div>
                                        <h3 class="text-lg font-semibold text-gray-900 mb-2">Over mij</h3>
                                        <p class="text-gray-600 leading-relaxed">{member.bio}</p>
                                    </div>
                                )}

                                <div class="bg-gray-50 rounded-lg p-6">
                                    <h3 class="text-lg font-semibold text-gray-900 mb-4">Muzikaal Profiel</h3>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {member.favoriete_werk && (
                                            <div>
                                                <span class="block text-xs text-gray-500 uppercase tracking-wide">Favoriete werk</span>
                                                <span class="font-medium text-gray-800">{member.favoriete_werk}</span>
                                            </div>
                                        )}
                                        {member.favoriete_componist && (
                                            <div>
                                                <span class="block text-xs text-gray-500 uppercase tracking-wide">Componist</span>
                                                <span class="font-medium text-gray-800">{member.favoriete_componist}</span>
                                            </div>
                                        )}
                                        {member.favoriete_genre && (
                                            <div>
                                                <span class="block text-xs text-gray-500 uppercase tracking-wide">Genre</span>
                                                <span class="font-medium text-gray-800">{member.favoriete_genre}</span>
                                            </div>
                                        )}
                                        {member.instrument && (
                                            <div>
                                                <span class="block text-xs text-gray-500 uppercase tracking-wide">Instrument</span>
                                                <span class="font-medium text-gray-800">{member.instrument}</span>
                                            </div>
                                        )}
                                        <div>
                                            <span class="block text-xs text-gray-500 uppercase tracking-wide">Jaren bij Animato</span>
                                            <span class="font-medium text-gray-800">{jarenBerekend} jaar</span>
                                        </div>
                                        <div>
                                            <span class="block text-xs text-gray-500 uppercase tracking-wide">Lid sinds</span>
                                            <span class="font-medium text-gray-800">{lidSindsDate.toLocaleDateString('nl-BE', {month: 'long', year: 'numeric'})}</span>
                                        </div>
                                        {(isOwnProfile || isAdmin) && member.geboortedatum && (
                                            <div>
                                                <span class="block text-xs text-gray-500 uppercase tracking-wide">Geboortedatum</span>
                                                <span class="font-medium text-gray-800">
                                                    {new Date(member.geboortedatum).toLocaleDateString('nl-BE', {day: 'numeric', month: 'long', year: 'numeric'})}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Favorited-by stats (own profile or admin) */}
                                {(isOwnProfile || isAdmin) && (
                                    <div class="bg-yellow-50 border border-yellow-100 rounded-lg p-6">
                                        <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                            <i class="fas fa-star text-yellow-400"></i>
                                            {isOwnProfile ? 'Jij bent favoriet bij' : 'Favoriet bij'}
                                            <span class="text-2xl font-bold text-yellow-600 ml-1">{favCount.total}</span>
                                            <span class="text-sm font-normal text-gray-500">leden</span>
                                        </h3>
                                        {favCount.total > 0 ? (
                                            <>
                                                {/* SATB breakdown */}
                                                <div class="grid grid-cols-4 gap-3 mb-5">
                                                    {[{label:'Sopraan', key:'S', color:'pink'},{label:'Alt', key:'A', color:'purple'},{label:'Tenor', key:'T', color:'blue'},{label:'Bas', key:'B', color:'green'}].map(sg => (
                                                        <div class={`text-center rounded-lg p-3 bg-${sg.color}-50 border border-${sg.color}-100`}>
                                                            <div class={`text-2xl font-bold text-${sg.color}-600`}>{(favCount as any)[sg.key]}</div>
                                                            <div class={`text-xs text-${sg.color}-500 font-medium`}>{sg.label}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {/* Who favorited */}
                                                <div class="space-y-2">
                                                    <p class="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Gefavoriet door</p>
                                                    <div class="flex flex-wrap gap-2">
                                                        {favorieten.map((f: any) => (
                                                            <span class={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                                                f.stemgroep === 'S' ? 'bg-pink-100 text-pink-700' :
                                                                f.stemgroep === 'A' ? 'bg-purple-100 text-purple-700' :
                                                                f.stemgroep === 'T' ? 'bg-blue-100 text-blue-700' :
                                                                'bg-green-100 text-green-700'
                                                            }`}>
                                                                {f.foto_url ? (
                                                                    <img src={f.foto_url} class="w-4 h-4 rounded-full object-cover" alt="" />
                                                                ) : (
                                                                    <i class="fas fa-user" style="font-size:10px"></i>
                                                                )}
                                                                {f.voornaam} {f.achternaam}
                                                                <span class="opacity-60">({stemgroepLabel(f.stemgroep)})</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <p class="text-gray-500 text-sm">Nog niemand heeft je als favoriet aangeduid. Wees actief in het koor! 🎶</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div class="space-y-6">
                                <div class="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                                    <h3 class="text-lg font-semibold text-gray-900 mb-4">Contact</h3>
                                    <ul class="space-y-3">
                                        <li class="flex items-center text-gray-600">
                                            <div class="w-8 flex justify-center"><i class="fas fa-envelope text-gray-400"></i></div>
                                            {member.toon_email && member.email ? (
                                                <a href={`mailto:${member.email}`} class="hover:text-animato-primary hover:underline truncate">{member.email}</a>
                                            ) : (
                                                <span class="italic text-gray-400">Niet zichtbaar</span>
                                            )}
                                        </li>
                                        <li class="flex items-center text-gray-600">
                                            <div class="w-8 flex justify-center"><i class="fas fa-phone text-gray-400"></i></div>
                                            {member.toon_telefoon && member.telefoon ? (
                                                <a href={`tel:${member.telefoon}`} class="hover:text-animato-primary hover:underline">{member.telefoon}</a>
                                            ) : (
                                                <span class="italic text-gray-400">Niet zichtbaar</span>
                                            )}
                                        </li>
                                    </ul>
                                </div>

                                {/* Streak Card */}
                                {(memberCheckins.length > 0 || memberCurrentStreak > 0) && (
                                    <div class={`rounded-lg p-6 shadow-sm border ${memberCurrentStreak >= 10 ? 'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                                        <h3 class="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <span class="text-xl">🔥</span> Repetitie Streak
                                        </h3>
                                        <div class="text-center mb-4">
                                            <div class={`text-4xl font-black ${memberCurrentStreak >= 10 ? 'text-orange-600' : memberCurrentStreak >= 5 ? 'text-amber-600' : 'text-gray-700'}`}>
                                                {memberCurrentStreak}
                                            </div>
                                            <div class="text-xs text-gray-500 uppercase tracking-wide mt-1">
                                                {memberCurrentStreak === 1 ? 'week op rij' : 'weken op rij'}
                                            </div>
                                        </div>
                                        {memberStreakBadge && (
                                            <div class={`flex items-center justify-center gap-2 ${memberStreakBadge.bg} rounded-full px-3 py-1.5 text-sm font-bold mb-3`}>
                                                <i class={memberStreakBadge.icon}></i> {memberStreakBadge.name}
                                            </div>
                                        )}
                                        <div class="grid grid-cols-2 gap-3 text-center">
                                            <div class="bg-white bg-opacity-60 rounded-lg p-2">
                                                <div class="text-lg font-bold text-gray-800">{memberLongestStreak}</div>
                                                <div class="text-xs text-gray-500">Langste</div>
                                            </div>
                                            <div class="bg-white bg-opacity-60 rounded-lg p-2">
                                                <div class="text-lg font-bold text-gray-800">{memberCheckins.length}</div>
                                                <div class="text-xs text-gray-500">Totaal</div>
                                            </div>
                                        </div>
                                        <a href="/leden/streaks" class="block mt-3 text-center text-xs text-animato-primary hover:underline">
                                            Bekijk leaderboard <i class="fas fa-chevron-right ml-1"></i>
                                        </a>
                                    </div>
                                )}

                                {/* Admin birthday list link */}
                                {isAdmin && (
                                    <a href="/leden/verjaardagen" class="block bg-amber-50 border border-amber-200 rounded-lg p-4 text-center hover:bg-amber-100 transition">
                                        <i class="fas fa-birthday-cake text-amber-500 text-2xl mb-2"></i>
                                        <div class="text-sm font-semibold text-amber-700">Verjaardagslijst</div>
                                        <div class="text-xs text-amber-500">Alle verjaardagen overzicht</div>
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Photo zoom modal */}
        <div id="photo-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black bg-opacity-80" onclick="closePhotoModal()">
            <div class="relative max-w-2xl max-h-screen p-4">
                <button class="absolute top-2 right-2 text-white text-2xl z-10 hover:text-gray-300" onclick="closePhotoModal()">
                    <i class="fas fa-times"></i>
                </button>
                <img src={member.foto_url || getDefaultAvatar(member.stemgroep)} class="max-w-full max-h-screen object-contain rounded-lg shadow-2xl" alt={`${member.voornaam} ${member.achternaam}`} />
                <p class="text-white text-center mt-3 font-semibold text-lg">{member.voornaam} {member.achternaam}</p>
                {!member.foto_url && (
                    <p class="text-gray-400 text-center text-sm mt-1 italic">
                        Cartoon: {member.stemgroep === 'S' ? 'Maria Callas' : member.stemgroep === 'A' ? 'Cecilia Bartoli' : member.stemgroep === 'T' ? 'Luciano Pavarotti' : 'Bryn Terfel'}
                        {' '} — upload je eigen foto via Profiel!
                    </p>
                )}
            </div>
        </div>

        <script dangerouslySetInnerHTML={{__html: `
            function openPhotoModal() {
                const modal = document.getElementById('photo-modal');
                if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
            }
            function closePhotoModal() {
                const modal = document.getElementById('photo-modal');
                if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
            }
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhotoModal(); });

            async function toggleFavorite(memberId, btn) {
                try {
                    const res = await fetch('/api/leden/favorites/toggle', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ memberId })
                    });
                    
                    if (res.ok) {
                        const data = await res.json();
                        if (data.is_favorite) {
                            btn.classList.remove('bg-white', 'border-gray-200', 'text-gray-500', 'hover:bg-gray-50');
                            btn.classList.add('bg-yellow-50', 'border-yellow-200', 'text-yellow-600');
                            btn.innerHTML = '<i class="fas fa-star mr-2"></i> Favoriet';
                        } else {
                            btn.classList.remove('bg-yellow-50', 'border-yellow-200', 'text-yellow-600');
                            btn.classList.add('bg-white', 'border-gray-200', 'text-gray-500', 'hover:bg-gray-50');
                            btn.innerHTML = '<i class="fas fa-star text-gray-300 mr-2"></i> Favoriet maken';
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        `}} />
    </Layout>
  )
})

// =====================================================
// #116 — NOTIFICATIONS API: count + mark as read / mark all read
// =====================================================
app.get('/api/leden/notifications/unread-count', async (c) => {
  const user = c.get('user') as SessionUser
  // 1) Ongelezen DB-notificaties
  const notifCount = await getUnreadCount(c.env.DB, user.id)

  // 2) Recent nieuws (sinds previous_login_at of laatste 14d) dat NIET
  //    al door dit lid gedismissed is. Spiegelt de bron-logica van het
  //    /leden-widget en de Openstaand-tab op /leden/profiel — zo blijft
  //    de bell-badge in de header consistent met wat de gebruiker
  //    werkelijk ziet als "openstaand".
  let newsCount = 0
  try {
    const lastLoginRow = await queryOne<any>(c.env.DB,
      `SELECT previous_login_at FROM users WHERE id = ?`, [user.id])
    const sinceDate = lastLoginRow?.previous_login_at || null
    const sinceClause = sinceDate
      ? `AND datetime(p.published_at) >= datetime(?)`
      : `AND datetime(p.published_at) >= datetime('now', '-14 days')`
    // Bug #202 — bouw zichtbaarheidsfilter incl. eigen stemgroep + bestuur
    // DB stemgroep = 'S'/'A'/'T'/'B' (single letter), posts.zichtbaarheid = 'sopraan'/'alt'/'tenor'/'bas' (full word)
    const stemMapNC: Record<string, string> = { s: 'sopraan', a: 'alt', t: 'tenor', b: 'bas' }
    const stemLabelNC = stemMapNC[(user.stemgroep || '').toLowerCase()]
    const isStaffNC = user.role === 'admin' || (user as any).is_bestuurslid === 1
    const visNC: string[] = ['publiek', 'leden']
    if (stemLabelNC) visNC.push(stemLabelNC)
    if (isStaffNC) visNC.push('bestuur')
    const visPhNC = visNC.map(() => '?').join(',')
    const params: any[] = sinceDate
      ? [user.id, ...visNC, sinceDate]
      : [user.id, ...visNC]
    const row = await queryOne<{ cnt: number }>(c.env.DB,
      `SELECT COUNT(*) as cnt
       FROM posts p
       LEFT JOIN user_news_dismissed und
         ON und.post_id = p.id AND und.user_id = ?
       WHERE p.type = 'nieuws'
         AND p.is_published = 1
         AND p.zichtbaarheid IN (${visPhNC})
         AND und.id IS NULL
         ${sinceClause}`,
      params)
    newsCount = row?.cnt || 0
  } catch (e) { /* ignore */ }

  const count = notifCount + newsCount
  // Cache uit zodat de badge altijd actueel is
  c.header('Cache-Control', 'no-store, max-age=0')
  return c.json({ count, notifications: notifCount, news: newsCount })
})

app.post('/api/leden/notifications/:id/read', async (c) => {
  const user = c.get('user') as SessionUser
  const id = parseInt(c.req.param('id'))
  if (!id) return c.json({ error: 'invalid id' }, 400)
  const ok = await markAsRead(c.env.DB, id, user.id)
  return c.json({ success: ok })
})

app.post('/api/leden/notifications/read-all', async (c) => {
  const user = c.get('user') as SessionUser
  const count = await markAllAsRead(c.env.DB, user.id)
  // Voor browser-form posts: redirect terug naar profiel
  const accept = c.req.header('Accept') || ''
  if (accept.includes('text/html')) {
    return c.redirect('/leden/profiel?success=notifications_read')
  }
  return c.json({ success: true, count })
})

// =====================================================
// NOTIFICATION PREFERENCES — per-user opt-in/opt-out per type
// =====================================================
app.get('/api/leden/notification-prefs', async (c) => {
  const user = c.get('user') as SessionUser
  const prefs = await getUserNotificationPrefs(c.env.DB, user.id)
  return c.json({ prefs })
})

app.post('/api/leden/notification-prefs', async (c) => {
  const user = c.get('user') as SessionUser
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  // Whitelist: enkel keys die in NotificationType passen accepteren.
  // 'lidgeld' en 'profiel' zijn 'verplichte' types die niet uitgezet
  // kunnen worden — we negeren stilletjes pogingen om die op false te zetten.
  const allowedTypes: NotificationType[] = ['nieuws','materiaal','repetitie','concert','board','systeem']
  const sanitized: Partial<Record<NotificationType, boolean>> = {}
  for (const t of allowedTypes) {
    if (t in body) sanitized[t] = !!body[t]
  }
  try {
    await setUserNotificationPrefs(c.env.DB, user.id, sanitized)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'save_failed', detail: String(e?.message || e) }, 500)
  }
})

// =====================================================
// NIEUWS — per-user dismiss voor het "Wat staat er voor jou open?"-widget
// =====================================================
// Idempotent. Wordt aangeroepen vanuit het dashboard-widget op /leden:
//   - X-knop op een "Nieuw bericht: ..." item
//   - implicit bij klik op "Lees" (zo verschijnt het bericht niet opnieuw)
app.post('/api/leden/news/:postId/dismiss', async (c) => {
  const user = c.get('user') as SessionUser
  const postId = parseInt(c.req.param('postId'))
  if (!postId || Number.isNaN(postId)) {
    return c.json({ error: 'invalid post id' }, 400)
  }
  try {
    await execute(
      c.env.DB,
      `INSERT OR IGNORE INTO user_news_dismissed (user_id, post_id)
       VALUES (?, ?)`,
      [user.id, postId]
    )
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'dismiss failed', detail: String(e?.message || e) }, 500)
  }
})

// Privacy: online-status toggle (opt-out)
app.post('/api/leden/privacy/online-status', async (c) => {
  const user = c.get('user') as SessionUser
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const show = body?.show === true || body?.show === 1
  try {
    await execute(
      c.env.DB,
      `UPDATE users SET show_online_status = ? WHERE id = ?`,
      [show ? 1 : 0, user.id]
    )
    return c.json({ success: true, show_online_status: show })
  } catch (e: any) {
    return c.json({ error: 'update failed', detail: String(e?.message || e) }, 500)
  }
})

// 🌟 Spotlight wegklikken — onthouden per (user, spotlight_key)
app.post('/api/leden/spotlight/dismiss', async (c) => {
  const user = c.get('user') as SessionUser
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const key = String(body?.key || '').trim()
  if (!key || key.length > 100) {
    return c.json({ error: 'invalid spotlight key' }, 400)
  }
  // Whitelist op prefix om DB-vervuiling te voorkomen
  if (!/^(birthday|newmember|random|welcomeback):/.test(key)) {
    return c.json({ error: 'invalid spotlight key format' }, 400)
  }
  try {
    await execute(
      c.env.DB,
      `INSERT OR IGNORE INTO user_dismissed_spotlights (user_id, spotlight_key)
       VALUES (?, ?)`,
      [user.id, key]
    )
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'dismiss failed', detail: String(e?.message || e) }, 500)
  }
})

// Tegenhanger: terugzetten uit archief naar 'Openstaand'
app.post('/api/leden/news/:postId/undismiss', async (c) => {
  const user = c.get('user') as SessionUser
  const postId = parseInt(c.req.param('postId'))
  if (!postId || Number.isNaN(postId)) {
    return c.json({ error: 'invalid post id' }, 400)
  }
  try {
    await execute(
      c.env.DB,
      `DELETE FROM user_news_dismissed WHERE user_id = ? AND post_id = ?`,
      [user.id, postId]
    )
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'undismiss failed', detail: String(e?.message || e) }, 500)
  }
})

// NB: het algemene endpoint POST /api/comment-reactions/toggle leeft in
// src/routes/comment-reactions.tsx en wordt geregistreerd in index.tsx.
// Geen dupe nodig in deze module.

// Notificatie terug naar ongelezen (uit archief naar openstaand)
app.post('/api/leden/notifications/:id/unread', async (c) => {
  const user = c.get('user') as SessionUser
  const id = parseInt(c.req.param('id'))
  if (!id || Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400)
  try {
    await execute(
      c.env.DB,
      `UPDATE notifications
       SET is_gelezen = 0, gelezen_at = NULL
       WHERE id = ? AND user_id = ?`,
      [id, user.id]
    )
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'unread failed', detail: String(e?.message || e) }, 500)
  }
})

// Wis archief: verwijdert alle GELEZEN notificaties.
// Voor nieuws: we BEHOUDEN user_news_dismissed records (anders komen ze
// terug als openstaand op /leden). De archief-lijst toont alleen items
// jonger dan 90 dagen, dus oudere dismisses verdwijnen vanzelf uit het zicht.
app.post('/api/leden/notifications/clear-archive', async (c) => {
  const user = c.get('user') as SessionUser
  try {
    await execute(
      c.env.DB,
      `DELETE FROM notifications WHERE user_id = ? AND is_gelezen = 1`,
      [user.id]
    )
    // Verberg ook recent-gedismissede nieuws-items uit de archief-view door
    // hun dismissed_at terug te zetten tot >90 dagen geleden. Tabel-record
    // blijft staan zodat het item niet als 'openstaand' terugkeert op /leden.
    await execute(
      c.env.DB,
      `UPDATE user_news_dismissed
         SET dismissed_at = datetime('now', '-100 days')
         WHERE user_id = ?
           AND datetime(dismissed_at) > datetime('now', '-90 days')`,
      [user.id]
    )
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'clear failed', detail: String(e?.message || e) }, 500)
  }
})

app.post('/api/leden/favorites/toggle', async (c) => {
    const user = c.get('user') as SessionUser
    const body = await c.req.json()
    const memberId = body.memberId

    if (!memberId) return c.json({error: 'No member ID'}, 400)

    // Check if exists
    const existing = await queryOne(c.env.DB, "SELECT id FROM member_favorites WHERE user_id = ? AND favorite_member_id = ?", [user.id, memberId])

    if (existing) {
        await execute(c.env.DB, "DELETE FROM member_favorites WHERE id = ?", [existing.id])
        return c.json({ is_favorite: false })
    } else {
        await execute(c.env.DB, "INSERT INTO member_favorites (user_id, favorite_member_id) VALUES (?, ?)", [user.id, memberId])
        return c.json({ is_favorite: true })
    }
})

app.get('/leden/agenda', (c) => c.redirect('/agenda'))

// =====================================================
// ADMIN VERJAARDAGSLIJST
// =====================================================
app.get('/leden/verjaardagen', async (c) => {
  const user = c.get('user') as SessionUser
  if ((user as any).role !== 'admin') return c.redirect('/leden')

  // Fetch all members with birthdays, sorted by month/day
  const members = await queryAll<any>(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, p.geboortedatum, u.stemgroep, u.role, p.foto_url
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     WHERE u.status = 'actief'
       AND p.geboortedatum IS NOT NULL
     ORDER BY strftime('%m-%d', p.geboortedatum) ASC`
  )

  // Group by month
  const byMonth: Record<string, any[]> = {}
  const monthNames = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December']
  for (const m of members) {
    const d = new Date(m.geboortedatum)
    const key = String(d.getMonth()) // 0-indexed
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(m)
  }

  // Label per rol/stemgroep. Dirigenten hebben geen stemgroep → toon 'Dirigent'.
  const roleLabel = (m: any): { label: string; cls: string } => {
    if (m.role === 'dirigent') return { label: 'Dirigent', cls: 'bg-amber-100 text-amber-800' }
    if (m.role === 'admin' && !m.stemgroep) return { label: 'Admin', cls: 'bg-gray-200 text-gray-700' }
    switch (m.stemgroep) {
      case 'S': return { label: 'Sopraan', cls: 'bg-pink-100 text-pink-700' }
      case 'A': return { label: 'Alt', cls: 'bg-purple-100 text-purple-700' }
      case 'T': return { label: 'Tenor', cls: 'bg-blue-100 text-blue-700' }
      case 'B': return { label: 'Bas', cls: 'bg-green-100 text-green-700' }
      default: return { label: '—', cls: 'bg-gray-100 text-gray-500' }
    }
  }

  return c.html(
    <Layout title="Verjaardagslijst" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Verjaardagslijst', href: '#'}]}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-birthday-cake text-amber-500"></i>
                Verjaardagslijst
              </h1>
              <p class="text-gray-500 mt-1">Overzicht van alle verjaardagen (enkel zichtbaar voor admins)</p>
            </div>
            <div class="flex gap-3">
              <a href="/leden" class="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                <i class="fas fa-arrow-left"></i> Terug naar dashboard
              </a>
              <button onclick="window.print()" class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm">
                <i class="fas fa-print"></i> Afdrukken
              </button>
            </div>
          </div>

          <div class="space-y-8 print-area">
            {(() => {
              // Rotatie: start bij huidige maand en toon alle 12 maanden
              // in chronologische volgorde. Vb: in april → apr, mei, jun, …, mrt.
              const today = new Date()
              const currentMonth = today.getMonth() // 0-11
              const orderedKeys: number[] = []
              for (let i = 0; i < 12; i++) {
                orderedKeys.push((currentMonth + i) % 12)
              }
              return orderedKeys
                .filter(m => byMonth[String(m)] && byMonth[String(m)].length > 0)
                .map((monthIdx) => {
                  const monthKey = String(monthIdx)
                  // Deze maand wordt 'volgend jaar' gezien als ze al voorbij is
                  // t.o.v. vandaag én we zijn niet de huidige maand
                  const isWrapped = monthIdx < currentMonth
                  return (
              <div class="bg-white rounded-xl shadow-sm overflow-hidden">
                <div class={`border-b px-6 py-3 ${monthIdx === currentMonth ? 'bg-animato-accent/10 border-animato-accent/30' : 'bg-amber-50 border-amber-100'}`}>
                  <h2 class={`text-lg font-bold flex items-center gap-2 ${monthIdx === currentMonth ? 'text-animato-secondary' : 'text-amber-800'}`}>
                    <i class={`fas fa-calendar-alt ${monthIdx === currentMonth ? 'text-animato-accent' : 'text-amber-400'}`}></i>
                    {monthNames[monthIdx]}
                    {monthIdx === currentMonth && (
                      <span class="text-xs font-semibold bg-animato-accent text-white px-2 py-0.5 rounded-full ml-1">
                        Deze maand
                      </span>
                    )}
                    {isWrapped && (
                      <span class="text-xs font-normal text-gray-500 ml-1">
                        ({today.getFullYear() + 1})
                      </span>
                    )}
                    <span class={`text-sm font-normal ml-1 ${monthIdx === currentMonth ? 'text-animato-primary' : 'text-amber-600'}`}>
                      ({byMonth[monthKey].length} leden)
                    </span>
                  </h2>
                </div>
                <div class="divide-y divide-gray-100">
                  {byMonth[monthKey].map((m: any) => {
                    const bd = new Date(m.geboortedatum)
                    const isThisWeek = (() => {
                      const day = today.getDay()
                      const diffToMon = (day === 0 ? -6 : 1 - day)
                      const mon = new Date(today)
                      mon.setDate(today.getDate() + diffToMon)
                      const sun = new Date(mon)
                      sun.setDate(mon.getDate() + 6)
                      const fmt = (d: Date) => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
                      const bdFmt = fmt(bd)
                      return bdFmt >= fmt(mon) && bdFmt <= fmt(sun)
                    })()
                    // Leeftijd die ze bereiken op hun volgende verjaardag.
                    // Als de maand voorbij is (wrapped → volgend jaar), tel extra jaar.
                    const refYear = isWrapped ? today.getFullYear() + 1 : today.getFullYear()
                    const age = refYear - bd.getFullYear()
                    // Weekdag in het referentiejaar (huidig of volgend), niet in het geboortejaar
                    const bdInRefYear = new Date(refYear, bd.getMonth(), bd.getDate())
                    const weekdayStr = bdInRefYear.toLocaleDateString('nl-BE', { weekday: 'long' })
                    return (
                      <div class={`flex items-center gap-4 px-6 py-3 ${isThisWeek ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}>
                        <div class="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <img src={m.foto_url || getDefaultAvatar(m.stemgroep)} class="w-full h-full object-cover" alt={m.voornaam} />
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-semibold text-gray-900">{m.voornaam} {m.achternaam}</span>
                            {isThisWeek && <span class="text-lg" title="Jarig deze week!">👑</span>}
                          </div>
                          <div class="text-sm text-gray-500 flex items-center gap-3 flex-wrap">
                            <span><i class="fas fa-calendar mr-1"></i>{bdInRefYear.toLocaleDateString('nl-BE', {weekday:'long', day:'numeric', month:'long'})}</span>
                            <span class="text-gray-400">•</span>
                            <span>{age} jaar</span>
                          </div>
                        </div>
                        <div>
                          {(() => {
                            const rl = roleLabel(m)
                            return <span class={`px-2 py-1 rounded text-xs font-semibold ${rl.cls}`}>{rl.label}</span>
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
                  )
                })
            })()}
          </div>
          {members.length === 0 && (
            <div class="text-center text-gray-500 py-12">
              <i class="fas fa-birthday-cake text-4xl mb-4 text-gray-300"></i>
              <p>Geen verjaardagen gevonden</p>
            </div>
          )}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          nav, header, footer, .no-print { display: none !important; }
          body { background: white; }
          .print-area { display: block; }
        }
      `}} />
    </Layout>
  )
})

// =====================================================
// PROFIEL BEWERKEN API - Update Profile
// =====================================================

app.post('/api/leden/profiel', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const { voornaam, achternaam, telefoon, straat, huisnummer, bus, postcode, gemeente, bio, muzikale_ervaring, profielfoto_url,
            favoriete_genre, favoriete_componist, favoriete_werk, instrument, zanger_type, geboortedatum } = body

    // Validation
    if (!voornaam || !achternaam) {
      return c.redirect('/leden/profiel?error=required_fields')
    }

    // #24: jaren_in_koor wordt automatisch berekend uit lid_sinds (gewone leden kunnen niet meer overschrijven, alleen admin via /admin/leden)
    const profileRow = await c.env.DB.prepare(
      `SELECT p.lid_sinds, u.created_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`
    ).bind(user.id).first<{ lid_sinds: string | null, created_at: string }>()
    const lidSinds = profileRow?.lid_sinds ? new Date(profileRow.lid_sinds + 'T00:00:00') : new Date(profileRow?.created_at || new Date())
    const jaren_in_koor = Math.max(0, new Date().getFullYear() - lidSinds.getFullYear())

    // Update profile
    const result = await c.env.DB.prepare(
      `UPDATE profiles 
       SET voornaam = ?, achternaam = ?, telefoon = ?, straat = ?, huisnummer = ?, bus = ?, postcode = ?, stad = ?, bio = ?, muzikale_ervaring = ?, foto_url = ?,
           favoriete_genre = ?, favoriete_componist = ?, favoriete_werk = ?, instrument = ?, jaren_in_koor = ?, zanger_type = ?, geboortedatum = ?
       WHERE user_id = ?`
    ).bind(
      voornaam,
      achternaam,
      telefoon || null,
      straat || null,
      huisnummer || null,
      bus || null,
      postcode || null,
      gemeente || null, // Map UI 'gemeente' to DB 'stad'
      bio || null,
      muzikale_ervaring || null,
      profielfoto_url || null,
      favoriete_genre || null,
      favoriete_componist || null,
      favoriete_werk || null,
      instrument || null,
      jaren_in_koor || null,
      zanger_type || null,
      geboortedatum || null,
      user.id
    ).run()

    if (!result.success) {
      return c.redirect('/leden/profiel?error=update_failed')
    }

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'profile_update', 'profile', ?, ?)`
    ).bind(
      user.id,
      user.id,
      JSON.stringify({ fields: ['voornaam', 'achternaam', 'smoelenboek_data'] })
    ).run()

    return c.redirect('/leden/profiel?success=profile')
  } catch (error) {
    console.error('Profile update error:', error)
    return c.redirect('/leden/profiel?error=update_failed')
  }
})

// =====================================================
// PROFIEL BEWERKEN API - Change Password
// =====================================================

app.post('/api/leden/profiel/wachtwoord', async (c) => {
  const user = c.get('user') as SessionUser

  try {
    const body = await c.req.parseBody()
    const { current_password, new_password, confirm_password } = body

    // Validation
    if (!current_password || !new_password || !confirm_password) {
      return c.redirect('/leden/profiel?error=required_fields')
    }

    if (new_password !== confirm_password) {
      return c.redirect('/leden/profiel?error=password_mismatch')
    }

    if ((new_password as string).length < 8) {
      return c.redirect('/leden/profiel?error=password_too_short')
    }

    // Get current password hash
    const userRecord = await queryOne<any>(
      c.env.DB,
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    )

    if (!userRecord) {
      return c.redirect('/leden/profiel?error=user_not_found')
    }

    // Verify current password
    const { verifyPassword } = await import('../utils/auth')
    const isValid = await verifyPassword(current_password as string, userRecord.password_hash)

    if (!isValid) {
      return c.redirect('/leden/profiel?error=invalid_password')
    }

    // Hash new password
    const { hashPassword } = await import('../utils/auth')
    const newHash = await hashPassword(new_password as string)

    // Update password
    const result = await c.env.DB.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).bind(newHash, user.id).run()

    if (!result.success) {
      return c.redirect('/leden/profiel?error=update_failed')
    }

    // Audit log
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
       VALUES (?, 'password_change', 'user', ?, ?)`
    ).bind(
      user.id,
      user.id,
      JSON.stringify({ method: 'self_service' })
    ).run()

    return c.redirect('/leden/profiel?success=password')
  } catch (error) {
    console.error('Password change error:', error)
    return c.redirect('/leden/profiel?error=update_failed')
  }
})

// =====================================================
// MATERIAL VIEW TRACKING
// =====================================================

app.post('/api/leden/materiaal/track', async (c) => {
  try {
    const user = c.get('user') as SessionUser
    const body = await c.req.json()
    const materialId = body.material_id
    if (!materialId) return c.json({ error: 'missing material_id' }, 400)

    await c.env.DB.prepare(
      'INSERT INTO material_views (material_id, user_id) VALUES (?, ?)'
    ).bind(materialId, user.id).run()

    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: true }) // silently succeed on error (tracking is non-critical)
  }
})

// MATERIAL PRINT REQUEST (#1)
// =====================================================

app.post('/api/leden/materiaal/print-aanvraag', async (c) => {
  const user = c.get('user') as SessionUser
  
  try {
    const body = await c.req.parseBody()
    const material_id = body.material_id

    if (!material_id) {
      return c.redirect('/leden/materiaal?error=missing_material')
    }

    // Check if material exists and get work_id
    const material = await queryOne<any>(
      c.env.DB,
      `SELECT m.*, pi.work_id FROM materials m JOIN pieces pi ON pi.id = m.piece_id WHERE m.id = ?`,
      [material_id]
    )

    if (!material) {
      return c.redirect('/leden/materiaal?error=material_not_found')
    }

    // Check for existing pending request to avoid duplicates
    const existingRequest = await queryOne<any>(
      c.env.DB,
      `SELECT id FROM print_requests WHERE user_id = ? AND material_id = ? AND status = 'pending'`,
      [user.id, material_id]
    )

    if (existingRequest) {
      return c.redirect('/leden/materiaal?info=already_requested')
    }

    // Create print request
    await c.env.DB.prepare(
      `INSERT INTO print_requests (user_id, material_id, work_id, status) VALUES (?, ?, ?, 'pending')`
    ).bind(user.id, material_id, material.work_id).run()

    return c.redirect('/leden/materiaal?success=print_requested')
  } catch (error) {
    console.error('Print request error:', error)
    return c.redirect('/leden/materiaal?error=print_failed')
  }
})

// =====================================================
// /leden/reglementen — Reglementen & documenten voor leden
//
// Toont een lijst van alle actieve documenten uit reglementen_documenten.
// Admins kunnen deze beheren via /admin/reglementen.
// =====================================================
app.get('/leden/reglementen', async (c) => {
  const user = c.get('user') as SessionUser
  const isAdmin = user.role === 'admin' || user.role === 'bestuur' || (user as any).is_bestuurslid === 1

  const docs = await queryAll<any>(c.env.DB,
    `SELECT id, titel, beschrijving, url, icoon, volgorde
     FROM reglementen_documenten
     WHERE is_actief = 1
     ORDER BY volgorde ASC, created_at DESC`
  ).catch(() => [])

  return c.html(
    <Layout title="Reglementen & Documenten" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Reglementen', href: '#'}]}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-4">
            <a href="/leden" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
            </a>
          </div>

          <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <i class="fas fa-scroll text-amber-600"></i>
                Reglementen & Documenten
              </h1>
              <p class="text-gray-600 mt-2">
                Alle nuttige documenten over de werking en afspraken van het koor.
              </p>
            </div>
            {isAdmin && (
              <a href="/admin/reglementen" class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm">
                <i class="fas fa-cog"></i> Beheren
              </a>
            )}
          </div>

          {docs.length === 0 ? (
            <div class="bg-white rounded-xl shadow-sm p-12 text-center">
              <i class="fas fa-folder-open text-6xl text-gray-300 mb-4"></i>
              <h3 class="text-xl font-semibold text-gray-700 mb-2">Nog geen documenten beschikbaar</h3>
              <p class="text-gray-500 mb-4">
                Het bestuur heeft nog geen reglementen of documenten geüpload.
              </p>
              {isAdmin && (
                <a href="/admin/reglementen" class="inline-flex items-center gap-2 px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition text-sm">
                  <i class="fas fa-plus"></i> Document toevoegen
                </a>
              )}
            </div>
          ) : (
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              {docs.map((d: any) => (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener"
                  class="group bg-white rounded-xl shadow-sm hover:shadow-lg transition p-6 border border-gray-100 flex items-start gap-4"
                >
                  <div class="flex-shrink-0 w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center group-hover:bg-amber-200 transition">
                    <i class={`fas ${d.icoon || 'fa-file-pdf'} text-amber-700 text-xl`}></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <h3 class="font-bold text-gray-900 group-hover:text-animato-primary transition">
                      {d.titel}
                    </h3>
                    {d.beschrijving && (
                      <p class="text-sm text-gray-600 mt-1">{d.beschrijving}</p>
                    )}
                    <div class="mt-2 text-xs text-animato-primary font-medium inline-flex items-center gap-1">
                      <i class="fas fa-external-link-alt"></i> Openen
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}

          <div class="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
            <p>
              <i class="fas fa-info-circle mr-1 text-animato-primary"></i>
              Heb je vragen over een reglement? Neem contact op via <a href="mailto:gemengdkooranimato@gmail.com" class="text-animato-primary hover:underline">gemengdkooranimato@gmail.com</a>.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
