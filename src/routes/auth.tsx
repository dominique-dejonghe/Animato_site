// Authentication routes
// Login, Register, Logout, Password Reset

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { hashPassword, verifyPassword, generateToken, generateRandomToken, hashSessionToken } from '../utils/auth'
import { queryOne, execute, isValidEmail, formatDateForDB } from '../utils/db'
import { sendEmail } from '../utils/email'
import { siteUrlFromEnv } from '../utils/site-url'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// LOGIN PAGE
// =====================================================

app.get('/login', async (c) => {
  const redirect = c.req.query('redirect') || '/'
  const error = c.req.query('error')
  const success = c.req.query('success')

  return c.html(
    <Layout title="Inloggen">
      <div class="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
          <div class="text-center">
            <a href="/" class="inline-block mb-4" aria-label="Animato Home">
              <img src="/static/images/animato-logo-full.png" alt="Animato - Koor met passie" class="h-20 w-auto mx-auto" />
            </a>
            <h2 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              Inloggen
            </h2>
            <p class="mt-2 text-gray-600">
              Toegang tot het ledenportaal
            </p>
          </div>

          {error && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex">
                <i class="fas fa-exclamation-circle text-red-500 mr-3 mt-0.5"></i>
                <div class="text-sm text-red-800 flex-1">
                  {error === 'invalid' && (
                    <>
                      <strong>Onjuiste email of wachtwoord.</strong>
                      <p class="mt-1 text-xs text-red-700">
                        Nooit eerder een wachtwoord gekozen? Een admin heeft je account misschien aangemaakt
                        zonder reset-link. Klik op <a href="/auth/forgot-password" class="underline font-semibold">Wachtwoord vergeten?</a> om er één in te stellen,
                        of neem contact op via <a href="mailto:info@gemengdkooranimato.be" class="underline font-semibold">info@gemengdkooranimato.be</a>.
                      </p>
                    </>
                  )}
                  {error === 'required' && 'Vul alle velden in'}
                  {error === 'unauthorized' && 'Je moet ingelogd zijn om deze pagina te bekijken'}
                  {error === 'inactive' && (
                    <>
                      <strong>Je account is nog niet actief.</strong>
                      <p class="mt-1 text-xs text-red-700">
                        Stuur een mailtje naar <a href="mailto:info@gemengdkooranimato.be" class="underline">info@gemengdkooranimato.be</a> zodat we je account activeren.
                      </p>
                    </>
                  )}
                  {error === 'deleted' && (
                    <>
                      <strong>Dit account is verwijderd.</strong>
                      <p class="mt-1 text-xs text-red-700">
                        Denk je dat dit een vergissing is? Stuur een mailtje naar <a href="mailto:info@gemengdkooranimato.be" class="underline">info@gemengdkooranimato.be</a>.
                      </p>
                    </>
                  )}
                  {error === 'server' && 'Er ging iets mis aan onze kant. Probeer het later opnieuw.'}
                </div>
              </div>
            </div>
          )}

          {success && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex">
                <i class="fas fa-check-circle text-green-500 mr-3 mt-0.5"></i>
                <div class="text-sm text-green-800">
                  {success === 'reset_email_sent' && 'We hebben een e-mail gestuurd met instructies om je wachtwoord te resetten.'}
                  {success === 'password_reset' && 'Je wachtwoord is succesvol gewijzigd. Je kunt nu inloggen.'}
                </div>
              </div>
            </div>
          )}

          <form class="mt-8 space-y-6" action="/api/auth/login" method="POST">
            <input type="hidden" name="redirect" value={redirect} />
            
            <div class="space-y-4">
              <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                  <i class="fas fa-envelope text-animato-primary mr-2"></i>
                  Email adres
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  placeholder="naam@example.com"
                />
              </div>

              <div>
                <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
                  <i class="fas fa-lock text-animato-primary mr-2"></i>
                  Wachtwoord
                </label>
                <div class="relative">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    required
                    class="block w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onclick="togglePwd('password','eye-login')"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    tabindex="-1"
                    title="Toon/verberg wachtwoord"
                  >
                    <i id="eye-login" class="fas fa-eye text-lg"></i>
                  </button>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <input
                  id="remember"
                  name="remember"
                  type="checkbox"
                  class="h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded"
                />
                <label for="remember" class="ml-2 block text-sm text-gray-700">
                  Onthoud mij
                </label>
              </div>

              <div class="text-sm">
                <a href="/wachtwoord-vergeten" class="text-animato-primary hover:text-animato-secondary font-medium">
                  Wachtwoord vergeten?
                </a>
              </div>
            </div>

            <button
              type="submit"
              class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-white bg-animato-primary hover:bg-animato-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-animato-primary font-semibold transition"
            >
              <i class="fas fa-sign-in-alt mr-2"></i>
              Inloggen
            </button>
          </form>

          <div class="text-center">
            <p class="text-sm text-gray-600">
              Nog geen account?{' '}
              <a href="/registreer" class="text-animato-primary hover:text-animato-secondary font-semibold">
                Registreer hier
              </a>
            </p>
          </div>

          <div class="text-center pt-6 border-t border-gray-200">
            <a href="/" class="text-sm text-gray-600 hover:text-gray-900">
              <i class="fas fa-arrow-left mr-1"></i>
              Terug naar home
            </a>
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{__html: `
        function togglePwd(inputId, eyeId) {
          var inp = document.getElementById(inputId);
          var eye = document.getElementById(eyeId);
          if (inp.type === 'password') {
            inp.type = 'text';
            eye.classList.remove('fa-eye'); eye.classList.add('fa-eye-slash');
          } else {
            inp.type = 'password';
            eye.classList.remove('fa-eye-slash'); eye.classList.add('fa-eye');
          }
        }
      `}} />
    </Layout>
  )
})

// =====================================================
// FORGOT PASSWORD PAGE
// =====================================================

app.get('/wachtwoord-vergeten', (c) => {
  const error = c.req.query('error')
  const success = c.req.query('success')
  const email = c.req.query('email') || ''

  return c.html(
    <Layout title="Wachtwoord vergeten">
      <div class="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
          <div class="text-center">
            <div class="text-animato-primary text-5xl mb-4">
              <i class="fas fa-key"></i>
            </div>
            <h2 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              Wachtwoord Vergeten
            </h2>
            <p class="mt-2 text-gray-600">
              Vul je e-mailadres in en we sturen je een link om je wachtwoord te resetten.
            </p>
          </div>

          {error && (
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex">
                <i class="fas fa-exclamation-circle text-red-500 mr-3 mt-0.5"></i>
                <div class="text-sm text-red-800">
                  {error === 'not_found' && 'Dit e-mailadres is niet gekend in ons systeem. Controleer of je het juiste adres hebt ingevoerd, of neem contact op met de beheerder.'}
                  {error === 'invalid_email' && 'Vul een geldig e-mailadres in.'}
                  {error === 'send_failed' && (
                    <>
                      <strong>De reset-mail kon niet verstuurd worden.</strong>
                      <p class="mt-1 text-xs text-red-700">
                        Dit is een technisch probleem aan onze kant (mail-provider). Probeer het later opnieuw,
                        of stuur een mailtje naar <a href="mailto:info@gemengdkooranimato.be" class="underline font-semibold">info@gemengdkooranimato.be</a> —
                        een beheerder kan dan een persoonlijke reset-link voor je genereren.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {success === 'sent' && (
            <div class="bg-green-50 border border-green-200 rounded-lg p-4">
              <div class="flex">
                <i class="fas fa-check-circle text-green-500 mr-3 mt-0.5"></i>
                <div class="text-sm text-green-800">
                  <p class="font-semibold mb-1">E-mail verstuurd!</p>
                  <p>We hebben een reset-link gestuurd naar <strong>{email}</strong>. Controleer ook je spam-map. De link is 1 uur geldig.</p>
                </div>
              </div>
            </div>
          )}

          {success !== 'sent' && (
            <form class="mt-8 space-y-6" action="/api/auth/forgot-password" method="POST">
              <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                  Email adres
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  value={email}
                  class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  placeholder="naam@example.com"
                />
              </div>

              <button
                type="submit"
                class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-white bg-animato-primary hover:bg-animato-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-animato-primary font-semibold transition"
              >
                <i class="fas fa-paper-plane mr-2"></i>
                Verstuur reset link
              </button>
            </form>
          )}

          <div class="text-center">
            <a href="/login" class="text-sm text-animato-primary hover:text-animato-secondary font-medium">
              <i class="fas fa-arrow-left mr-1"></i> Terug naar inloggen
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// RESET PASSWORD PAGE
// =====================================================

app.get('/reset-wachtwoord/:token', async (c) => {
  const token = c.req.param('token')
  
  // Verify token existence and expiry
  const resetRequest = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    [token]
  )

  if (!resetRequest) {
    return c.html(
      <Layout title="Ongeldige Link">
        <div class="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
          <div class="max-w-md w-full text-center">
            <div class="text-red-500 text-5xl mb-4"><i class="fas fa-times-circle"></i></div>
            <h2 class="text-2xl font-bold text-gray-900 mb-2">Ongeldige of verlopen link</h2>
            <p class="text-gray-600 mb-6">Deze reset-link is niet meer geldig. Vraag een nieuwe aan.</p>
            <a href="/wachtwoord-vergeten" class="bg-animato-primary text-white px-6 py-2 rounded-lg font-semibold hover:bg-animato-secondary transition">
              Nieuwe aanvraag
            </a>
          </div>
        </div>
      </Layout>
    )
  }

  return c.html(
    <Layout title="Nieuw Wachtwoord">
      <div class="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
          <div class="text-center">
            <h2 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
              Nieuw Wachtwoord
            </h2>
            <p class="mt-2 text-gray-600">Kies een nieuw veilig wachtwoord.</p>
          </div>

          <form class="mt-8 space-y-6" action="/api/auth/reset-password" method="POST">
            <input type="hidden" name="token" value={token} />
            
            <div class="space-y-4">
              <div>
                <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Nieuw Wachtwoord</label>
                <div class="relative">
                  <input id="password" name="password" type="password" required minlength="8" class="block w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  <button type="button" onclick="togglePwd('password','eye-pw1')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none" tabindex="-1">
                    <i id="eye-pw1" class="fas fa-eye text-lg"></i>
                  </button>
                </div>
              </div>
              <div>
                <label for="password_confirm" class="block text-sm font-medium text-gray-700 mb-1">Bevestig Wachtwoord</label>
                <div class="relative">
                  <input id="password_confirm" name="password_confirm" type="password" required minlength="8" class="block w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
                  <button type="button" onclick="togglePwd('password_confirm','eye-pw2')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none" tabindex="-1">
                    <i id="eye-pw2" class="fas fa-eye text-lg"></i>
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-white bg-animato-primary hover:bg-animato-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-animato-primary font-semibold transition">
              Wachtwoord Opslaan
            </button>
          </form>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{__html: `
        function togglePwd(inputId, eyeId) {
          var inp = document.getElementById(inputId);
          var eye = document.getElementById(eyeId);
          if (inp.type === 'password') {
            inp.type = 'text';
            eye.classList.remove('fa-eye'); eye.classList.add('fa-eye-slash');
          } else {
            inp.type = 'password';
            eye.classList.remove('fa-eye-slash'); eye.classList.add('fa-eye');
          }
        }
      `}} />
    </Layout>
  )
})

// =====================================================
// AUTH APIS
// =====================================================

app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.parseBody()
    const email = body.email as string
    const password = body.password as string
    const remember = body.remember === 'on'
    const redirect = (body.redirect as string) || '/'

    // Validation
    if (!email || !password) {
      return c.redirect('/login?error=required')
    }

    if (!isValidEmail(email)) {
      return c.redirect('/login?error=invalid')
    }

    // Find user
    const user = await queryOne<any>(
      c.env.DB,
      `SELECT u.*, p.voornaam, p.achternaam 
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.email = ? COLLATE NOCASE`,
      [email]
    )

    if (!user) {
      return c.redirect('/login?error=invalid')
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash)
    
    if (!valid) {
      return c.redirect('/login?error=invalid')
    }

    // Verwijderde accounts kunnen niet inloggen (soft-delete). Inactieve
    // leden mogen wél inloggen: ze moeten hun eigen historiek (aangekochte
    // tickets, lidgelden, notificaties) kunnen blijven raadplegen. Rechten
    // op leden-specifieke acties (aanwezigheid, polls voor actieve leden…)
    // hangen af van role/permissies, niet van status.
    if (user.status === 'verwijderd') {
      return c.redirect('/login?error=deleted')
    }

    // Update last_login_at timestamp (#128) — fire-and-forget, mag niet blokkeren
    // Voor admin-zicht: zo zien we wie nog nooit ingelogd is en hulp nodig heeft.
    // Voor #116: bewaar de vorige login-tijd in previous_login_at zodat het dashboard
    // "wat is nieuw sinds je laatste bezoek?" correct kan tonen.
    try {
      await c.env.DB.prepare(
        `UPDATE users SET previous_login_at = last_login_at, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(user.id).run()
    } catch (e) {
      console.warn('Could not update last_login_at:', e)
    }

    // Create session user
    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      stemgroep: user.stemgroep,
      voornaam: user.voornaam || 'Gebruiker',
      achternaam: user.achternaam || '',
      is_bestuurslid: user.is_bestuurslid || 0
    }

    // Generate JWT token
    const expiresIn = remember ? '30d' : '7d'
    const token = await generateToken(sessionUser, c.env.JWT_SECRET, expiresIn)

    // Set cookie
    const maxAge = remember ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60
    setCookie(c, 'auth_token', token, {
      maxAge,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/'
    })

    // Get IP address and User Agent
    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'

    // Bug #163 — verwijderde dubbele UPDATE op last_login_at. De eerste UPDATE
    // hierboven (regel 423) zet previous_login_at + last_login_at correct in
    // één atomaire query. Een tweede UPDATE hier zou previous_login_at niet
    // aanraken (al goed) maar voegt niks toe — dus weggehaald.

    // Create user session record
    // NB: bewaar SHA-256 hash van token, niet de eerste 32 chars (die zijn voor
    // elke JWT identiek — zie hashSessionToken() voor uitleg).
    const loginTokenHash = await hashSessionToken(token)
    await execute(
      c.env.DB,
      `INSERT INTO user_sessions (user_id, session_token, login_at, ip_address, user_agent, login_method, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [user.id, loginTokenHash, formatDateForDB(), ipAddress, userAgent, 'password']
    )

    // Audit log
    await execute(
      c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta, ip_adres, user_agent) 
       VALUES (?, 'user_login', 'user', ?, ?, ?, ?)`,
      [user.id, user.id, JSON.stringify({ method: 'password', remember }), ipAddress, userAgent]
    )

    // Badges-evaluatie na login (niet-blokkerend, stil falen bij DB-issues).
    // Kent badges toe als criteria gehaald — gebruiker ziet ze bij volgend bezoek
    // aan /leden/badges. Geen redirect-flow om te vermijden dat we de login traag maken.
    try {
      const { evaluateBadges } = await import('../utils/badges')
      await evaluateBadges(c.env.DB, user.id)
    } catch (_) { /* stil falen — niet kritiek voor login */ }

    // Smart redirect based on role
    let finalRedirect = redirect
    if (redirect === '/leden' || redirect === '/') {
      // If no specific redirect, send admin/moderator to admin panel
      if (user.role === 'admin' || user.role === 'moderator') {
        finalRedirect = '/admin'
      } else if (user.role === 'kaartkoper') {
        // Kaartkopers hebben GEEN toegang tot /leden — stuur naar hun eigen portaal
        finalRedirect = '/mijn-tickets'
      } else {
        finalRedirect = '/leden'
      }
    } else if (user.role === 'kaartkoper' && redirect.startsWith('/leden')) {
      // Iemand probeert na inloggen naar een leden-pagina te gaan,
      // maar is enkel kaartkoper — fall back naar /mijn-tickets ipv 403
      finalRedirect = '/mijn-tickets'
    }

    // Welkom-splash voor leden die hem nog niet gezien hebben.
    // Dominique vraagde dit als feestelijk moment voor net-goedgekeurde aanvragen.
    // We checken alleen wanneer de standaard /leden-redirect zou triggeren,
    // niet bij externe redirects (bv. ticket-pagina, agenda-event, etc.) \u2014
    // anders verlies je dat moment achter een willekeurig deeplink.
    if (user.role === 'lid' && finalRedirect === '/leden') {
      try {
        const splashRow = await queryOne<{ welcome_splash_seen: number }>(
          c.env.DB,
          `SELECT welcome_splash_seen FROM users WHERE id = ?`,
          [user.id]
        )
        if (splashRow && splashRow.welcome_splash_seen === 0) {
          finalRedirect = '/leden/welkom'
        }
      } catch (e) {
        // Bij DB-fout: stilletjes door naar /leden, geen UX-blocker
        console.warn('[welkom] splash check failed:', e)
      }
    }

    return c.redirect(finalRedirect)
  } catch (error) {
    console.error('Login error:', error)
    return c.redirect('/login?error=server')
  }
})

app.post('/api/auth/register', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    const voornaam = body.voornaam as string
    const achternaam = body.achternaam as string
    const email = (body.email as string).toLowerCase()
    const telefoon = body.telefoon as string
    const stemgroep = body.stemgroep as string
    const muzikale_ervaring = body.muzikale_ervaring as string
    const password = body.password as string
    const password_confirm = body.password_confirm as string
    const consent = body.consent === 'on'

    // Validation
    if (!voornaam || !achternaam || !email || !stemgroep || !password || !consent) {
      return c.html('<script>alert("Vul alle verplichte velden in"); window.history.back();</script>')
    }

    if (!isValidEmail(email)) {
      return c.html('<script>alert("Ongeldig email adres"); window.history.back();</script>')
    }

    if (password !== password_confirm) {
      return c.html('<script>alert("Wachtwoorden komen niet overeen"); window.history.back();</script>')
    }

    if (password.length < 8) {
      return c.html('<script>alert("Wachtwoord moet minimaal 8 karakters zijn"); window.history.back();</script>')
    }

    // Check if email already exists
    const existing = await queryOne(
      c.env.DB,
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE',
      [email]
    )

    if (existing) {
      return c.html('<script>alert("Dit email adres is al geregistreerd"); window.history.back();</script>')
    }

    // Hash password
    const password_hash = await hashPassword(password)

    // Create user
    const userResult = await execute(
      c.env.DB,
      `INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) 
       VALUES (?, ?, 'lid', ?, 'proeflid', 0)`,
      [email, password_hash, stemgroep]
    )

    const userId = userResult.meta.last_row_id

    // Create profile
    await execute(
      c.env.DB,
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring, lid_sinds) 
       VALUES (?, ?, ?, ?, ?, DATE('now'))`,
      [userId, voornaam, achternaam, telefoon || null, muzikale_ervaring || null]
    )

    // Audit log
    await execute(
      c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) 
       VALUES (?, 'user_registered', 'user', ?, ?)`,
      [userId, userId, JSON.stringify({ stemgroep, consent })]
    )

    // Auto-login after registration
    const sessionUser: SessionUser = {
      id: Number(userId),
      email,
      role: 'lid',
      stemgroep: stemgroep as any,
      voornaam,
      achternaam,
      is_bestuurslid: 0
    }

    const token = await generateToken(sessionUser, c.env.JWT_SECRET, '7d')

    setCookie(c, 'auth_token', token, {
      maxAge: 7 * 24 * 60 * 60,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/'
    })

    // Redirect to welcome page
    return c.redirect('/leden?welcome=1')
  } catch (error) {
    console.error('Registration error:', error)
    return c.html('<script>alert("Er is een fout opgetreden. Probeer het later opnieuw."); window.history.back();</script>')
  }
})

app.get('/api/auth/logout', async (c) => {
  try {
    // Get user from cookie before deleting
    const token = c.req.header('Cookie')?.split('auth_token=')[1]?.split(';')[0]
    
    if (token) {
      const tokenHash = await hashSessionToken(token)
      
      // Close active session - calculate duration
      await execute(
        c.env.DB,
        `UPDATE user_sessions 
         SET logout_at = ?, 
             duration_seconds = CAST((julianday(?) - julianday(login_at)) * 86400 AS INTEGER),
             is_active = 0,
             updated_at = ?
         WHERE session_token = ? AND is_active = 1`,
        [formatDateForDB(), formatDateForDB(), formatDateForDB(), tokenHash]
      )
    }
  } catch (error) {
    console.error('Logout session tracking error:', error)
    // Continue with logout even if session tracking fails
  }
  
  // Wis ALLE auth-gerelateerde cookies (auth_token + impersonate stash).
  // Vroeger werd alleen auth_token gewist, waardoor admin_impersonate_token
  // bleef hangen en bij de volgende request alsnog werd gepromoveerd. Dat
  // veroorzaakte vreemde "ik ben uitgelogd maar nog ingelogd"-gedragingen.
  deleteCookie(c, 'auth_token', { path: '/' })
  deleteCookie(c, 'admin_impersonate_token', { path: '/' })
  return c.redirect('/?logout=1')
})

// =====================================================
// DIAGNOSTICS — /api/auth/whoami
// =====================================================
// Toont WAT de server in jouw cookies/JWT ziet versus WAT er in de DB
// staat. Onmisbaar voor het debuggen van "ik ben admin in DB maar krijg
// 'Onvoldoende rechten' op /admin" scenario's.
//
// Veilig: toont geen wachtwoorden of secrets, alleen je eigen rol-info.
app.get('/api/auth/whoami', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const { verifyToken } = await import('../utils/auth')

  const authToken = getCookie(c, 'auth_token')
  const impersonateToken = getCookie(c, 'admin_impersonate_token')
  const jwtSecret = c.env.JWT_SECRET

  const result: any = {
    cookies_present: {
      auth_token: !!authToken,
      admin_impersonate_token: !!impersonateToken,
    },
    auth_token: null,
    impersonate_token: null,
    db_record: null,
    diagnosis: ''
  }

  if (authToken) {
    const user = await verifyToken(authToken, jwtSecret)
    if (user) {
      result.auth_token = {
        valid: true,
        id: user.id,
        email: user.email,
        role: user.role,
        is_bestuurslid: user.is_bestuurslid,
        stemgroep: user.stemgroep,
      }
      // Match met DB
      try {
        const dbRow = await c.env.DB.prepare(
          'SELECT id, email, role, is_bestuurslid, status FROM users WHERE id = ?'
        ).bind(user.id).first<any>()
        result.db_record = dbRow || { error: 'user_id_not_in_db' }
      } catch (e: any) {
        result.db_record = { error: e.message }
      }
    } else {
      result.auth_token = { valid: false, reason: 'JWT verification failed (expired or wrong secret)' }
    }
  }

  if (impersonateToken) {
    const adminUser = await verifyToken(impersonateToken, jwtSecret)
    if (adminUser) {
      result.impersonate_token = {
        valid: true,
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      }
    } else {
      result.impersonate_token = { valid: false, reason: 'JWT verification failed' }
    }
  }

  // Diagnose
  if (!authToken && !impersonateToken) {
    result.diagnosis = 'Niet ingelogd — geen cookies.'
  } else if (result.auth_token?.valid && result.db_record && !result.db_record.error) {
    const tokenRole = result.auth_token.role
    const dbRole = result.db_record.role
    if (tokenRole !== dbRole) {
      result.diagnosis = `MISMATCH: token zegt '${tokenRole}', DB zegt '${dbRole}'. Token is stale — log uit via /api/auth/force-logout en log opnieuw in.`
    } else {
      result.diagnosis = `OK: token en DB beide '${tokenRole}'.`
    }
  } else if (!result.auth_token?.valid && result.impersonate_token?.valid) {
    result.diagnosis = `auth_token is ongeldig of weg, maar admin_impersonate_token is geldig (admin ${result.impersonate_token.email}). Bij volgende request wordt deze automatisch gepromoveerd.`
  } else if (result.auth_token?.valid === false) {
    result.diagnosis = 'auth_token bestaat maar JWT-verify faalt — verlopen of secret rotated.'
  }

  return c.json(result, 200, {
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  })
})

// =====================================================
// FORCE LOGOUT — wist ALLE auth cookies onvoorwaardelijk
// =====================================================
// Gebruik dit als de gewone /api/auth/logout je niet helpt (bv. omdat
// admin_impersonate_token in een vorige bug-versie bleef hangen).
app.get('/api/auth/force-logout', async (c) => {
  const { deleteCookie } = await import('hono/cookie')
  deleteCookie(c, 'auth_token', { path: '/' })
  deleteCookie(c, 'admin_impersonate_token', { path: '/' })
  // Setter met maxAge=0 voor extra zekerheid (sommige browsers gedragen
  // zich anders bij delete vs expire)
  const { setCookie } = await import('hono/cookie')
  setCookie(c, 'auth_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
  setCookie(c, 'admin_impersonate_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
  return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Uitgelogd</title>
    <link href="/static/css/tailwind.css" rel="stylesheet" />
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <i class="fas fa-broom text-green-500 text-5xl mb-4"></i>
        <h1 class="text-2xl font-bold text-gray-800 mb-2">Alle sessies gewist</h1>
        <p class="text-gray-600 mb-6">Alle authenticatie-cookies zijn gewist. Je kan nu opnieuw inloggen met een schone lei.</p>
        <a href="/login" class="inline-block px-6 py-3 text-white rounded-lg font-medium hover:opacity-90 transition" style="background-color:#00A9CE">
          <i class="fas fa-sign-in-alt mr-2"></i>Naar inloggen
        </a>
      </div>
    </body></html>`)
})

// =====================================================
// FORGOT & RESET PASSWORD APIS
// =====================================================

app.post('/api/auth/forgot-password', async (c) => {
  const body = await c.req.parseBody()
  const email = ((body.email as string) || '').trim().toLowerCase()
  const encodedEmail = encodeURIComponent(email)

  // Validate email format
  if (!email || !isValidEmail(email)) {
    return c.redirect(`/wachtwoord-vergeten?error=invalid_email`)
  }

  // Check if user exists — show clear error if not found
  const user = await queryOne<any>(c.env.DB, "SELECT id, email FROM users WHERE email = ? AND status != 'verwijderd'", [email])

  if (!user) {
    return c.redirect(`/wachtwoord-vergeten?error=not_found&email=${encodedEmail}`)
  }

  // Generate reset token and store it
  const token = generateRandomToken(32)
  await execute(
    c.env.DB,
    `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`,
    [user.id, token]
  )

  const siteUrl = siteUrlFromEnv(c.env.SITE_URL)
  const resetLink = `${siteUrl}/reset-wachtwoord/${token}`

  const emailSent = await sendEmail({
    to: user.email,
    subject: 'Wachtwoord herstellen – Gemengd Koor Animato',
    html: `
<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #6B46C1 0%, #4A9CC1 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">🔑 Wachtwoord Herstellen</h1>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">Gemengd Koor Animato</p>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
    <p>Hallo,</p>
    <p>We hebben een aanvraag ontvangen om het wachtwoord van <strong>${user.email}</strong> te resetten.</p>
    <p>Klik op de knop hieronder om een nieuw wachtwoord in te stellen:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetLink}"
         style="display:inline-block; background:#6B46C1; color:white; padding:14px 32px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:16px;">
        Wachtwoord Resetten
      </a>
    </div>
    <p style="color: #666; font-size: 14px;">Of kopieer deze link in je browser:<br>
      <a href="${resetLink}" style="color:#6B46C1; word-break:break-all;">${resetLink}</a>
    </p>
    <div style="background:#FEF3C7; border-left:4px solid #F59E0B; padding:12px 16px; border-radius:6px; margin: 20px 0;">
      <p style="margin:0; font-size:14px;">⏰ <strong>Deze link is 1 uur geldig.</strong> Daarna moet je een nieuwe aanvraag indienen.</p>
    </div>
    <p style="font-size:14px; color:#666;">Heb je dit niet aangevraagd? Dan hoef je niets te doen — je wachtwoord blijft ongewijzigd.</p>
    <p style="margin-top: 24px;">Met vriendelijke groet,<br><strong>Gemengd Koor Animato</strong></p>
  </div>
  <div style="text-align:center; padding:16px; color:#999; font-size:12px;">
    Gemengd Koor Animato | info@gemengdkooranimato.be
  </div>
</body>
</html>
    `
  }, c.env.RESEND_API_KEY)

  if (!emailSent) {
    console.error(`[forgot-password] Email send FAILED for user ${user.id} (${user.email}) — RESEND_API_KEY=${c.env.RESEND_API_KEY ? 'set' : 'MISSING'}`)
    // Token blijft 1u geldig in DB; admin kan via /admin/leden -> "Reset link genereren" een nieuwe maken
    await execute(c.env.DB, `DELETE FROM password_resets WHERE token = ?`, [token])
    return c.redirect(`/wachtwoord-vergeten?error=send_failed&email=${encodedEmail}`)
  }

  console.log(`[forgot-password] Reset email sent successfully to ${user.email}`)
  return c.redirect(`/wachtwoord-vergeten?success=sent&email=${encodedEmail}`)
})

// =====================================================
// ADMIN: Generate reset link manually (no email needed)
// Useful when RESEND_API_KEY is not configured or as backup
// =====================================================
app.post('/api/admin/users/:id/reset-link', async (c) => {
  const user = c.get('user') as SessionUser
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
    return c.json({ error: 'Onvoldoende rechten' }, 403)
  }

  const targetId = parseInt(c.req.param('id'))
  if (!targetId) return c.json({ error: 'Ongeldig ID' }, 400)

  const target = await queryOne<any>(c.env.DB,
    `SELECT id, email FROM users WHERE id = ? AND status != 'verwijderd'`,
    [targetId]
  )
  if (!target) return c.json({ error: 'Gebruiker niet gevonden' }, 404)

  const token = generateRandomToken(32)
  await execute(c.env.DB,
    `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+24 hour'))`,
    [target.id, token]
  )

  // Audit log
  try {
    await execute(c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta) VALUES (?, 'password_reset_link_generated', 'user', ?, ?)`,
      [user.id, target.id, JSON.stringify({ target_email: target.email, generated_by: user.email })]
    )
  } catch (_) {}

  const siteUrl = siteUrlFromEnv(c.env.SITE_URL)
  return c.json({
    success: true,
    email: target.email,
    reset_link: `${siteUrl}/reset-wachtwoord/${token}`,
    expires_in: '24 uur',
    note: 'Stuur deze link manueel door naar de gebruiker. Eénmalig bruikbaar.'
  })
})

app.post('/api/auth/reset-password', async (c) => {
  const body = await c.req.parseBody()
  const token = body.token as string
  const password = body.password as string
  const confirm = body.password_confirm as string

  if (password !== confirm) return c.html("Wachtwoorden komen niet overeen")
  if (password.length < 8) return c.html("Wachtwoord te kort")

  const resetRequest = await queryOne<any>(
    c.env.DB,
    `SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    [token]
  )

  if (!resetRequest) return c.redirect('/wachtwoord-vergeten')

  const newHash = await hashPassword(password)
  await execute(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", [newHash, resetRequest.user_id])
  await execute(c.env.DB, "UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [resetRequest.id])

  return c.redirect('/login?success=password_reset')
})

export default app
