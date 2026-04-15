// Ledenportaal routes
// Dashboard, Materiaal, Messageboard, Profiel

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll, execute } from '../utils/db'
import { createMolliePayment } from '../utils/mollie'

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
  const adminToken = c.req.header('Cookie')?.match(/admin_impersonate_token=([^;]+)/)?.[1]

  if (adminToken) {
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
  }

  return c.redirect('/admin')
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
     WHERE start_at >= datetime('now')
       AND (doelgroep = 'all' OR doelgroep LIKE ?)
     ORDER BY start_at ASC
     LIMIT 5`,
    [`%${user.stemgroep || ''}%`]
  )

  // Get latest nieuws for members
  const nieuws = await queryAll(
    c.env.DB,
    `SELECT id, titel, slug, published_at
     FROM posts
     WHERE type = 'nieuws' 
       AND is_published = 1
       AND (zichtbaarheid = 'publiek' OR zichtbaarheid = 'leden')
     ORDER BY published_at DESC
     LIMIT 3`
  )

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
       AND (p.zichtbaarheid = 'leden' OR p.zichtbaarheid = ?)
     ORDER BY p.is_pinned DESC, p.created_at DESC
     LIMIT 5`,
    [user.stemgroep?.toLowerCase() || 'admin']
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
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen')
       AND (m.zichtbaar_voor = 'alle_leden' OR 
            (m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem'))
     ORDER BY m.created_at DESC
     LIMIT 5`,
    [user.stemgroep || 'SATB']
  )

  // Fetch enabled modules for conditional rendering
  const enabledModulesRaw = await queryAll<any>(c.env.DB,
    `SELECT module_key, is_enabled FROM module_settings`, [])
  const enabledModules = new Set(
    enabledModulesRaw.filter((m: any) => m.is_enabled === 1).map((m: any) => m.module_key)
  )
  const isAdmin = user.role === 'admin' || user.role === 'bestuur'

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

  return c.html(
    <Layout title="Ledenportaal" user={user} impersonating={impersonating}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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

          {/* 🎂 Birthday banner — week overview for trakteermoment */}
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
                    Er wordt getrakteerd op de repetitie — proficiat!
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap gap-6 justify-center sm:justify-start">
                {birthdayMembers.map((bm: any) => {
                  const isMe = bm.id === user.id
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
                        {new Date(bm.geboortedatum).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long' })}
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
              { key: 'voice_analyzer', href: '/stem-test',         icon: 'fas fa-microphone',   iconBg: 'bg-purple-100',                    iconColor: 'text-purple-600 text-xl',      title: 'Stem Test',      desc: 'Test je stembereik',            border: '' },
              { key: null,           href: '/leden/profiel',       icon: 'fas fa-user',         iconBg: 'bg-animato-primary bg-opacity-10', iconColor: 'text-animato-primary text-xl', title: 'Profiel',        desc: 'Mijn gegevens',                 border: '', isProfile: true },
            ]
            // Filter: admin sees everything, members only see enabled modules (null key = always visible)
            const visibleModules = allModules.filter(m => isAdmin || m.key === null || enabledModules.has(m.key))

            return (
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-12">
                {visibleModules.map(m => (
                  <a href={m.href} class={`bg-white rounded-lg shadow-md hover:shadow-lg transition p-6 text-center relative ${m.border} ${isAdmin && m.key && !enabledModules.has(m.key) ? 'opacity-50 ring-2 ring-red-300' : ''}`}>
                    {/* Admin-only badge for disabled modules */}
                    {isAdmin && m.key && !enabledModules.has(m.key) && (
                      <span class="absolute top-1 right-1 bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">UIT</span>
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
                ))}
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
    const donationRef = 'DON-' + Date.now().toString(36).toUpperCase()

    // Create Payment
    const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: amount,
        description: `Vrije Gift Animato - ${user.voornaam} ${user.achternaam}`,
        redirectUrl: `${siteUrl}/leden/donaties?success=true`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
            type: 'donation',
            user_id: user.id,
            donation_id: 0 // Will update later
        }
    })

    // Insert into DB
    const res = await execute(c.env.DB, `
        INSERT INTO donations (user_id, amount, message, is_anonymous, status, payment_id)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `, [user.id, amount, body.message, body.anonymous ? 1 : 0, payment.id])

    // Update metadata with real ID (Mollie allows updating metadata on open payments usually, but simpler to just use payment_id in webhook lookup if needed, but we used donation_id in webhook logic previously. Actually wait, the webhook logic used metadata.donation_id. We need to pass it. Since we get ID after insert, maybe we can't pass it in creation? 
    // Actually, we can rely on payment_id lookup in webhook OR create record first.
    // Let's create record first with 'preparing' status.
    
    // Correction: Let's use the Insert ID strategy.
    // We already called createMolliePayment. We can't update metadata easily without another API call.
    // Better strategy for next time: Insert DB -> Create Payment -> Update DB.
    // For now, let's update the Webhook logic to look up by payment_id if donation_id is missing/0, OR just use payment_id.
    
    // Actually, in webhooks.tsx I wrote: UPDATE donations ... WHERE id = ? using metadata.donation_id.
    // I should update that logic or ensure I pass it.
    // Let's update the DB record with the payment ID we got.
    // AND let's rely on finding the donation by payment_id in webhook if possible?
    // No, standard is metadata.
    // Let's do: Insert -> Create Payment -> Update DB with payment ID.
    
    // RE-DO:
    // 1. Insert
    const insertRes = await execute(c.env.DB, `
        INSERT INTO donations (user_id, amount, message, is_anonymous, status)
        VALUES (?, ?, ?, ?, 'pending')
    `, [user.id, amount, body.message, body.anonymous ? 1 : 0])
    
    const donationId = insertRes.meta.last_row_id

    // 2. Payment
    const payment2 = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: amount,
        description: `Vrije Gift Animato - ${user.voornaam} ${user.achternaam}`,
        redirectUrl: `${siteUrl}/leden/donaties?success=true`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
            type: 'donation',
            user_id: user.id,
            donation_id: donationId
        }
    })

    // 3. Update DB
    await execute(c.env.DB, `UPDATE donations SET payment_id = ?, status = 'pending' WHERE id = ?`, [payment2.id, donationId])

    return c.redirect(payment2.checkoutUrl)
})

// =====================================================
// MESSAGEBOARD OVERZICHT
// =====================================================

app.get('/leden/board', async (c) => {
  const user = c.get('user') as SessionUser
  const categorie = c.req.query('cat') || 'all'
  const search = c.req.query('search') || ''

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
      AND (p.zichtbaarheid = 'leden' OR p.zichtbaarheid = ?)
  `

  const filters: any[] = [user.stemgroep?.toLowerCase() || 'algemeen']

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
                <a
                  href="/leden/board?cat=bestuur"
                  class={`px-4 py-2 rounded-lg font-semibold transition ${
                    categorie === 'bestuur'
                      ? 'bg-animato-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Bestuur
                </a>
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

  // Check visibility
  if (thread.zichtbaarheid !== 'leden' && thread.zichtbaarheid !== user.stemgroep?.toLowerCase()) {
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
              dangerouslySetInnerHTML={{ __html: thread.body }}
            />
          </div>

          {/* Replies */}
          <div class="space-y-4">
            <h2 class="text-2xl font-bold text-gray-900">
              {replies.length} Reacties
            </h2>

            {replies.map((reply: any) => (
              <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-start gap-4">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-user text-animato-primary"></i>
                  </div>
                  <div class="flex-1">
                    <div class="flex items-center justify-between mb-2">
                      <div>
                        <div class="font-semibold text-gray-900">
                          {reply.auteur_voornaam} {reply.auteur_achternaam}
                        </div>
                        <div class="text-xs text-gray-600">
                          {new Date(reply.created_at).toLocaleDateString('nl-BE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                    <div class="prose" dangerouslySetInnerHTML={{ __html: reply.body }} />
                  </div>
                </div>
              </div>
            ))}

            {/* Reply form placeholder */}
            <div class="bg-white rounded-lg shadow-md p-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">
                Plaats een reactie
              </h3>
              <div class="bg-gray-50 rounded-lg p-8 text-center">
                <i class="fas fa-comment-dots text-gray-300 text-4xl mb-3"></i>
                <p class="text-gray-600">
                  Reactiefunctionaliteit komt binnenkort beschikbaar!
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// PROFIEL BEWERKEN
// =====================================================

app.get('/leden/profiel', async (c) => {
  const user = c.get('user') as SessionUser
  const success = c.req.query('success')
  const error = c.req.query('error')
  const paymentId = c.req.query('payment_id')

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

  // Get full profile
  const profile = await queryOne<any>(
    c.env.DB,
    `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
            p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
            p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
            p.favoriete_werk, p.instrument, p.jaren_in_koor, p.geboortedatum,
            p.straat, p.huisnummer, p.bus, p.postcode, p.stad as gemeente,
            p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [user.id]
  )

  // If no profile exists, create one
  if (!profile || !profile.voornaam) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO profiles (user_id, voornaam, achternaam, smoelenboek_zichtbaar, toon_email, toon_telefoon)
         VALUES (?, ?, ?, 1, 1, 0)`
      ).bind(user.id, user.voornaam || 'Nieuwe', user.achternaam || 'Gebruiker').run()
      
      // Retry fetching the profile
      const newProfile = await queryOne<any>(
        c.env.DB,
        `SELECT u.email, u.stemgroep, u.role, u.status, u.created_at,
                p.voornaam, p.achternaam, p.telefoon, p.adres, p.bio, p.muzikale_ervaring, 
                p.foto_url as profielfoto_url, p.favoriete_genre, p.favoriete_componist, 
                p.favoriete_werk, p.instrument, p.jaren_in_koor, p.geboortedatum,
                p.smoelenboek_zichtbaar, p.toon_email, p.toon_telefoon
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
      `SELECT id FROM events WHERE type = 'repetitie' AND start_at <= datetime('now') ORDER BY start_at DESC`
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

          {/* Membership Status & History */}
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-id-card text-animato-secondary mr-2"></i>
              Lidmaatschappen
            </h3>
            
            {/* Active Membership Status */}
            {activeMembership && activeMembership.is_active && activeMembership.status === 'pending' ? (
              <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6 animate-pulse-slow">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div class="flex items-center text-yellow-800 font-bold text-lg mb-2">
                      <i class="fas fa-exclamation-circle mr-2"></i>
                      Lidgeld {activeMembership.season} Openstaand
                    </div>
                    <p class="text-yellow-800 mb-1">
                      Het lidgeld voor het huidige seizoen ({activeMembership.type === 'full' ? 'Met Partituren' : 'Basis'}) staat nog open.
                    </p>
                    <p class="font-bold text-yellow-900 text-xl">
                      Te betalen: €{activeMembership.amount.toFixed(2)}
                    </p>
                  </div>
                  <a 
                    href="/leden/betaling-lidgeld" 
                    class="inline-flex items-center justify-center px-6 py-3 bg-animato-primary text-white rounded-lg hover:opacity-90 transition font-semibold shadow-lg transform hover:-translate-y-0.5"
                  >
                    <i class="fas fa-credit-card mr-2"></i>
                    Nu Betalen
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
                    Lid sinds {new Date(profile.created_at).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })}
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
                    {/* File Upload - Simple approach with file reader */}
                    <div>
                      <label 
                        for="foto-upload" 
                        class="cursor-pointer inline-flex items-center px-4 py-2 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
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
                      <span class="ml-3 text-xs text-gray-500">
                        of
                      </span>
                    </div>
                    
                    {/* URL Input */}
                    <div>
                      <input
                        type="url"
                        id="profielfoto_url"
                        name="profielfoto_url"
                        value={profile.profielfoto_url || ''}
                        placeholder="https://example.com/mijn-foto.jpg"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      />
                      <p class="mt-1 text-xs text-gray-500">
                        Plak een foto URL of upload een bestand (max 5MB). Ondersteunt JPG, PNG, GIF, WEBP.
                      </p>
                      <script dangerouslySetInnerHTML={{
                        __html: `
                          (function() {
                            const urlInput = document.getElementById('profielfoto_url');
                            if (!urlInput) return;
                            
                            urlInput.addEventListener('input', function(e) {
                              const preview = document.getElementById('foto-preview');
                              const placeholder = document.getElementById('foto-placeholder');
                              if (e.target.value) {
                                preview.src = e.target.value;
                                preview.classList.remove('hidden');
                                if (placeholder) placeholder.classList.add('hidden');
                              } else {
                                preview.classList.add('hidden');
                                if (placeholder) placeholder.classList.remove('hidden');
                              }
                            });
                          })();
                        `
                      }}></script>
                    </div>
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
                  <option value="Dirigent" selected={profile.stemgroep === 'Dirigent'}>Dirigent</option>
                  <option value="Pianist" selected={profile.stemgroep === 'Pianist'}>Pianist</option>
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
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Jaren in dit koor
                    </label>
                    {/* Auto-calculated from account creation date */}
                    <div class="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 flex items-center gap-2">
                      <i class="fas fa-calculator text-animato-primary text-sm"></i>
                      <span>{Math.max(0, new Date().getFullYear() - new Date(profile.created_at).getFullYear())} jaar</span>
                      <span class="text-xs text-gray-400 ml-1">(automatisch berekend op basis van registratiedatum)</span>
                    </div>
                    <input type="hidden" name="jaren_in_koor" value={Math.max(0, new Date().getFullYear() - new Date(profile.created_at).getFullYear())} />
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
            

            {/* Photo Upload Script */}
            <script dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  const fileInput = document.getElementById('foto-upload');
                  if (!fileInput) return;
                  
                  fileInput.addEventListener('change', function(e) {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    // Check file size (max 5MB)
                    if (file.size > 5 * 1024 * 1024) {
                      alert('Bestand is te groot. Maximum 5MB toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    // Check file type
                    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    if (!allowedTypes.includes(file.type)) {
                      alert('Ongeldig bestandstype. Alleen JPG, PNG, GIF en WEBP zijn toegestaan.');
                      e.target.value = '';
                      return;
                    }
                    
                    // Show uploading state
                    const uploadBtn = document.querySelector('label[for="foto-upload"]');
                    const originalText = uploadBtn?.innerHTML;
                    if (uploadBtn) {
                      uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Bezig...';
                    }
                    
                    // Use FileReader to convert to data URL
                    const reader = new FileReader();
                    reader.onload = function(event) {
                      const dataUrl = event.target.result;
                      
                      // Update URL input with data URL
                      const urlInput = document.getElementById('profielfoto_url');
                      if (urlInput && dataUrl) {
                        urlInput.value = dataUrl;
                        
                        // Update preview
                        const preview = document.getElementById('foto-preview');
                        const placeholder = document.getElementById('foto-placeholder');
                        if (preview) {
                          preview.src = dataUrl;
                          preview.classList.remove('hidden');
                          if (placeholder) placeholder.classList.add('hidden');
                        }
                      }
                      
                      // Show success
                      if (uploadBtn && originalText) {
                        uploadBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Geladen!';
                        setTimeout(function() {
                          uploadBtn.innerHTML = originalText;
                        }, 2000);
                      }
                    };
                    
                    reader.onerror = function() {
                      alert('Fout bij het laden van de foto. Probeer het opnieuw.');
                      if (uploadBtn && originalText) {
                        uploadBtn.innerHTML = originalText;
                      }
                    };
                    
                    reader.readAsDataURL(file);
                  });
                })();
              `
            }}></script>
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
                <input
                  type="password"
                  id="current_password"
                  name="current_password"
                  required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="new_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Nieuw wachtwoord *
                </label>
                <input
                  type="password"
                  id="new_password"
                  name="new_password"
                  required
                  minlength={8}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Minimaal 8 tekens
                </p>
              </div>

              <div>
                <label for="confirm_password" class="block text-sm font-medium text-gray-700 mb-1">
                  Bevestig nieuw wachtwoord *
                </label>
                <input
                  type="password"
                  id="confirm_password"
                  name="confirm_password"
                  required
                  minlength={8}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
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
  
  // Get active unpaid membership
  const membership = await queryOne<any>(
    c.env.DB,
    `SELECT um.*, my.season, my.description
     FROM user_memberships um
     JOIN membership_years my ON um.year_id = my.id
     WHERE um.user_id = ? AND um.status = 'pending' AND my.is_active = 1`,
    [user.id]
  )

  if (!membership) {
    return c.redirect('/leden/profiel')
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
                <div class="text-4xl font-bold text-gray-900" id="displayTotal">€ {membership.amount.toFixed(2)}</div>
                <div class="mt-2 inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                  {membership.type === 'full' ? 'Lidmaatschap + Partituren' : 'Basis Lidmaatschap'}
                </div>
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
                        <p class="text-xs text-gray-500">Let op: dit is de link voor enkel het lidgeld.</p>
                    </div>
                  ) : (
                    <form action="/api/leden/betaling/online" method="POST">
                      <input type="hidden" name="membership_id" value={membership.id} />
                      <input type="hidden" name="donation_amount" id="formDonationAmount" value="0" />
                      <button type="submit" class="w-full py-3 px-4 bg-animato-accent text-white text-center rounded-lg hover:bg-amber-600 transition font-bold shadow">
                        Link Aanmaken & Betalen
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
                const baseAmount = ${membership.amount};
                let donationAmount = 0;
                
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

  // Verify ownership
  const membership = await queryOne<any>(
    c.env.DB, 
    `SELECT um.*, my.season 
     FROM user_memberships um
     JOIN membership_years my ON um.year_id = my.id
     WHERE um.id = ? AND um.user_id = ?`, 
    [membershipId, user.id]
  )

  if (!membership) return c.redirect('/leden/betaling-lidgeld?error=invalid')

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
      const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: totalAmount,
        description: `Lidgeld ${membership.season} + Vrije Gift - ${user.voornaam}`,
        redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
          type: 'membership_donation',
          membership_id: membership.id,
          donation_id: donationId,
          user_id: user.id
        }
      })
      
      // 3. Update records
      await execute(c.env.DB, `UPDATE donations SET payment_id = ?, status = 'pending' WHERE id = ?`, [payment.id, donationId])
      await execute(c.env.DB, `UPDATE user_memberships SET mollie_payment_url = ? WHERE id = ?`, [payment.checkoutUrl, membership.id])
      
      return c.redirect(payment.checkoutUrl)
  } else {
      // Standard membership payment
      const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: membership.amount,
        description: `Lidgeld Animato ${membership.season} - ${membership.type}`,
        redirectUrl: `${siteUrl}/leden/profiel?payment=success`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
          membership_id: membership.id,
          type: 'membership'
        }
      })
      
      const paymentUrl = payment.checkoutUrl
      
      // Save URL
      await execute(c.env.DB, `UPDATE user_memberships SET mollie_payment_url = ? WHERE id = ?`, [paymentUrl, membership.id])
    
      return c.redirect(paymentUrl)
  }
})

// =====================================================
// EXTRA ROUTES VOOR DASHBOARD
// =====================================================

app.get('/leden/materiaal', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Get all materials for user's stemgroep
  const materials = await queryAll(
    c.env.DB,
    `SELECT m.id, m.type, m.titel, m.url, m.beschrijving, m.stem, m.created_at,
            pi.titel as stuk_titel, pi.nummer as stuk_nummer,
            w.titel as werk_titel, w.componist, w.id as werk_id
     FROM materials m
     JOIN pieces pi ON pi.id = m.piece_id
     JOIN works w ON w.id = pi.work_id
     WHERE m.is_actief = 1
       AND (m.stem = ? OR m.stem = 'SATB' OR m.stem = 'algemeen')
       AND (m.zichtbaar_voor = 'alle_leden' OR 
            (m.zichtbaar_voor = 'stem_specifiek' OR m.zichtbaar_voor = 'eigen_stem'))
     ORDER BY w.titel ASC, pi.nummer ASC, m.type ASC`,
    [user.stemgroep || 'SATB']
  )

  // Group materials by werk_titel + stuk_titel
  const grouped: Record<string, { werk_titel: string; stuk_titel: string; componist: string; items: any[] }> = {}
  for (const mat of materials as any[]) {
    const key = `${mat.werk_titel}||${mat.stuk_titel}`
    if (!grouped[key]) {
      grouped[key] = { werk_titel: mat.werk_titel, stuk_titel: mat.stuk_titel, componist: mat.componist, items: [] }
    }
    grouped[key].items.push(mat)
  }

  // Helper: determine icon + label + style per material type/url
  function getTypeInfo(mat: any): { icon: string; label: string; colorClass: string; badgeClass: string } {
    const url: string = (mat.url || '').toLowerCase()
    const type: string = (mat.type || '').toLowerCase()
    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return { icon: 'fab fa-youtube', label: 'YouTube', colorClass: 'text-red-600', badgeClass: 'bg-red-100 text-red-700 border-red-200' }
    }
    // Google Drive
    if (url.includes('drive.google.com')) {
      return { icon: 'fab fa-google-drive', label: 'Google Drive', colorClass: 'text-blue-600', badgeClass: 'bg-blue-100 text-blue-700 border-blue-200' }
    }
    // Audio
    if (type === 'audio' || url.match(/\.(mp3|wav|ogg|flac|aac)($|\?)/)) {
      return { icon: 'fas fa-headphones', label: 'Audio', colorClass: 'text-purple-600', badgeClass: 'bg-purple-100 text-purple-700 border-purple-200' }
    }
    // PDF
    if (type === 'pdf' || url.match(/\.pdf($|\?)/)) {
      return { icon: 'fas fa-file-pdf', label: 'PDF', colorClass: 'text-orange-600', badgeClass: 'bg-orange-100 text-orange-700 border-orange-200' }
    }
    // Video
    if (type === 'video' || url.match(/\.(mp4|mov|avi|mkv)($|\?)/)) {
      return { icon: 'fas fa-video', label: 'Video', colorClass: 'text-pink-600', badgeClass: 'bg-pink-100 text-pink-700 border-pink-200' }
    }
    // Zip/archive
    if (url.match(/\.(zip|rar|tar|gz)($|\?)/)) {
      return { icon: 'fas fa-file-archive', label: 'Archief', colorClass: 'text-gray-600', badgeClass: 'bg-gray-100 text-gray-700 border-gray-200' }
    }
    // Generic link
    if (type === 'link') {
      return { icon: 'fas fa-link', label: 'Link', colorClass: 'text-teal-600', badgeClass: 'bg-teal-100 text-teal-700 border-teal-200' }
    }
    // Default
    return { icon: 'fas fa-file', label: type.toUpperCase() || 'Bestand', colorClass: 'text-gray-500', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' }
  }

  const groupEntries = Object.values(grouped)

  const successMsg = c.req.query('success')
  const errorMsg = c.req.query('error')
  const infoMsg = c.req.query('info')

  return c.html(
    <Layout title="Materiaal" user={user} impersonating={!!(c.get('impersonating' as any))} breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Materiaal', href: '/leden/materiaal'}]}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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

          <div class="mb-8 flex items-center gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-music text-animato-primary mr-3"></i>
                Oefenmateriaal
              </h1>
              <p class="text-gray-600 mt-1">
                Downloads en oefenbestanden voor jouw stemgroep ({user.stemgroep || 'Algemeen'}) · {groupEntries.length} werken
              </p>
            </div>
          </div>

          {/* Legend */}
          <div class="flex flex-wrap gap-2 mb-6">
            {[
              { icon: 'fab fa-youtube', label: 'YouTube', cls: 'bg-red-100 text-red-700 border-red-200' },
              { icon: 'fab fa-google-drive', label: 'Google Drive', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
              { icon: 'fas fa-file-pdf', label: 'PDF', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
              { icon: 'fas fa-headphones', label: 'Audio', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
              { icon: 'fas fa-video', label: 'Video', cls: 'bg-pink-100 text-pink-700 border-pink-200' },
              { icon: 'fas fa-link', label: 'Link', cls: 'bg-teal-100 text-teal-700 border-teal-200' },
            ].map(leg => (
              <span class={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${leg.cls}`}>
                <i class={leg.icon}></i> {leg.label}
              </span>
            ))}
          </div>

          {groupEntries.length > 0 ? (
            <div class="space-y-5">
              {groupEntries.map((group: any) => (
                <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  {/* Group header */}
                  <div class="bg-gradient-to-r from-animato-primary/10 to-transparent px-6 py-4 border-b border-gray-100">
                    <div class="flex items-start justify-between">
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
                      <span class="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-1 ml-3 whitespace-nowrap">
                        {group.items.length} {group.items.length === 1 ? 'bestand' : 'bestanden'}
                      </span>
                    </div>
                  </div>

                  {/* Individual material items */}
                  <div class="divide-y divide-gray-100">
                    {group.items.map((mat: any) => {
                      const info = getTypeInfo(mat)
                      return (
                        <div class="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition group">
                          {/* Type icon */}
                          <div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-gray-50 border border-gray-200">
                            <i class={`${info.icon} ${info.colorClass} text-lg`}></i>
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
                            </div>
                            {mat.beschrijving && mat.beschrijving !== 'null' && (
                              <p class="text-xs text-gray-500 mt-0.5 truncate">{mat.beschrijving}</p>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div class="flex-shrink-0 flex gap-2">
                            <a 
                              href={mat.url} 
                              target="_blank" 
                              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-animato-primary hover:bg-animato-secondary transition shadow-sm"
                              title={mat.beschrijving || mat.titel}
                            >
                              <i class={`${info.icon} text-xs`}></i>
                              <span class="hidden sm:inline">Openen</span>
                            </a>
                            {/* Print request button for PDF materials */}
                            {(info.label === 'PDF' || info.label === 'Google Drive') && (
                              <form action="/api/leden/materiaal/print-aanvraag" method="POST" class="inline">
                                <input type="hidden" name="material_id" value={mat.id} />
                                <button 
                                  type="submit"
                                  class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-amber-100 hover:text-amber-700 transition border border-gray-200"
                                  title="Papieren versie aanvragen"
                                >
                                  <i class="fas fa-print text-xs"></i>
                                  <span class="hidden lg:inline">Print</span>
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
              <p>Geen materiaal beschikbaar voor jouw stemgroep.</p>
            </div>
          )}
        </div>
      </div>
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
  let query = `SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep, p.bio, p.favoriete_werk,
            p.toon_email, p.toon_telefoon, u.email, p.telefoon,
            CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
            COUNT(qc.id) as total_checkins
     FROM users u
     JOIN profiles p ON u.id = p.user_id
     LEFT JOIN member_favorites f ON f.favorite_member_id = u.id AND f.user_id = ?
     LEFT JOIN qr_checkins qc ON qc.user_id = u.id
     WHERE u.status = 'actief' AND p.smoelenboek_zichtbaar = 1`
  
  const params: any[] = [user.id]

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
    `SELECT id, start_at FROM events WHERE type = 'repetitie' AND start_at <= datetime('now') ORDER BY start_at DESC`
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
            <p class="text-xl text-gray-600">
              Ontmoet de stemmen van Animato
            </p>
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
                    ? 'Er wordt getrakteerd op de repetitie — proficiat!'
                    : 'Geen jarigen deze week'}
                </p>
              </div>
            </div>

            {birthdayMembers.length > 0 ? (
              <div class="flex flex-wrap gap-6 justify-center sm:justify-start">
                {birthdayMembers.map((bm: any) => {
                  const isMe = bm.id === user.id
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
                      {/* Day of week + date */}
                      <span class="text-xs text-amber-600 font-semibold mt-0.5">
                        {new Date(bm.geboortedatum).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long' })}
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
                  <option value="Dirigent" selected={stemgroepFilter === 'Dirigent'}>Dirigent</option>
                  <option value="Pianist" selected={stemgroepFilter === 'Pianist'}>Pianist</option>
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
                                <div class="w-24 h-24 mx-auto bg-gray-200 rounded-full mb-4 overflow-hidden border-4 border-white shadow-sm">
                                  <img src={m.foto_url || getDefaultAvatar(m.stemgroep)} class="w-full h-full object-cover" alt={m.voornaam} />
                                </div>
                                <h3 class="font-bold text-gray-900 text-lg group-hover:text-animato-primary transition-colors">{m.voornaam} {m.achternaam}</h3>
                                {memberStreaks[m.id] > 0 && (
                                  <div class="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full text-xs font-bold">
                                    <span>🔥</span> {memberStreaks[m.id]} week{memberStreaks[m.id] !== 1 ? 'en' : ''} streak
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
                                          <div class="flex-shrink-0 h-10 w-10">
                                              {m.foto_url ? (
                                                  <img class="h-10 w-10 rounded-full object-cover" src={m.foto_url || getDefaultAvatar(m.stemgroep)} alt="" />
                                              ) : (
                                                  <img class="h-10 w-10 rounded-full object-cover" src={getDefaultAvatar(m.stemgroep)} alt="" />
                                              )}
                                          </div>
                                          <div class="ml-4">
                                              <div class="text-sm font-medium text-gray-900">{m.voornaam} {m.achternaam}</div>
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
            p.toon_email, p.toon_telefoon, u.email, p.telefoon, p.adres, u.created_at, p.geboortedatum,
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
    `SELECT id FROM events WHERE type = 'repetitie' AND start_at <= datetime('now') ORDER BY start_at DESC`
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

  // Auto-calculate jaren in koor from created_at (account registration date)
  const lidSindsDate = new Date(member.created_at)
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
                                <h1 class="text-3xl font-bold text-gray-900">{member.voornaam} {member.achternaam}</h1>
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
    `SELECT u.id, p.voornaam, p.achternaam, p.geboortedatum, u.stemgroep, p.foto_url
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

  const stemgroepLabel = (s: string) => s === 'S' ? 'Sopraan' : s === 'A' ? 'Alt' : s === 'T' ? 'Tenor' : 'Bas'

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
            {Object.keys(byMonth).sort((a,b) => Number(a)-Number(b)).map((monthKey) => (
              <div class="bg-white rounded-xl shadow-sm overflow-hidden">
                <div class="bg-amber-50 border-b border-amber-100 px-6 py-3">
                  <h2 class="text-lg font-bold text-amber-800 flex items-center gap-2">
                    <i class="fas fa-calendar-alt text-amber-400"></i>
                    {monthNames[Number(monthKey)]}
                    <span class="text-sm font-normal text-amber-600 ml-1">({byMonth[monthKey].length} leden)</span>
                  </h2>
                </div>
                <div class="divide-y divide-gray-100">
                  {byMonth[monthKey].map((m: any) => {
                    const bd = new Date(m.geboortedatum)
                    const today = new Date()
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
                    const age = today.getFullYear() - bd.getFullYear()
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
                          <div class="text-sm text-gray-500 flex items-center gap-3">
                            <span><i class="fas fa-calendar mr-1"></i>{bd.toLocaleDateString('nl-BE', {day:'numeric', month:'long'})}</span>
                            <span class="text-gray-400">•</span>
                            <span>{age} jaar</span>
                          </div>
                        </div>
                        <div>
                          <span class={`px-2 py-1 rounded text-xs font-semibold ${
                            m.stemgroep === 'S' ? 'bg-pink-100 text-pink-700' :
                            m.stemgroep === 'A' ? 'bg-purple-100 text-purple-700' :
                            m.stemgroep === 'T' ? 'bg-blue-100 text-blue-700' :
                            'bg-green-100 text-green-700'
                          }`}>{stemgroepLabel(m.stemgroep)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
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
            favoriete_genre, favoriete_componist, favoriete_werk, instrument, jaren_in_koor, zanger_type, geboortedatum } = body

    // Validation
    if (!voornaam || !achternaam) {
      return c.redirect('/leden/profiel?error=required_fields')
    }

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

export default app