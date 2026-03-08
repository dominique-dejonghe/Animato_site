// Authentication routes
// Login, Register, Logout, Password Reset

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { hashPassword, verifyPassword, generateToken, generateRandomToken } from '../utils/auth'
import { queryOne, execute, isValidEmail, formatDateForDB } from '../utils/db'
import { sendEmail } from '../utils/email'

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
            <div class="text-animato-primary text-5xl mb-4">
              <i class="fas fa-music"></i>
            </div>
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
                <div class="text-sm text-red-800">
                  {error === 'invalid' && 'Onjuiste email of wachtwoord'}
                  {error === 'required' && 'Vul alle velden in'}
                  {error === 'unauthorized' && 'Je moet ingelogd zijn om deze pagina te bekijken'}
                  {error === 'inactive' && 'Je account is nog niet actief'}
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
                <input
                  id="password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                  class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  placeholder="••••••••"
                />
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
    </Layout>
  )
})

// =====================================================
// FORGOT PASSWORD PAGE
// =====================================================

app.get('/wachtwoord-vergeten', (c) => {
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
                class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                placeholder="naam@example.com"
              />
            </div>

            <button
              type="submit"
              class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-white bg-animato-primary hover:bg-animato-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-animato-primary font-semibold transition"
            >
              Verstuur reset link
            </button>
          </form>

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
                <input id="password" name="password" type="password" required minlength="8" class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
              </div>
              <div>
                <label for="password_confirm" class="block text-sm font-medium text-gray-700 mb-1">Bevestig Wachtwoord</label>
                <input id="password_confirm" name="password_confirm" type="password" required minlength="8" class="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
              </div>
            </div>

            <button type="submit" class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-white bg-animato-primary hover:bg-animato-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-animato-primary font-semibold transition">
              Wachtwoord Opslaan
            </button>
          </form>
        </div>
      </div>
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

    // Check if user is active
    if (user.status === 'inactief') {
      return c.redirect('/login?error=inactive')
    }

    // Create session user
    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      stemgroep: user.stemgroep,
      voornaam: user.voornaam || 'Gebruiker',
      achternaam: user.achternaam || ''
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

    // Update last login
    await execute(
      c.env.DB,
      'UPDATE users SET last_login_at = ? WHERE id = ?',
      [formatDateForDB(), user.id]
    )

    // Create user session record
    await execute(
      c.env.DB,
      `INSERT INTO user_sessions (user_id, session_token, login_at, ip_address, user_agent, login_method, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [user.id, token.substring(0, 32), formatDateForDB(), ipAddress, userAgent, 'password']
    )

    // Audit log
    await execute(
      c.env.DB,
      `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta, ip_adres, user_agent) 
       VALUES (?, 'user_login', 'user', ?, ?, ?, ?)`,
      [user.id, user.id, JSON.stringify({ method: 'password', remember }), ipAddress, userAgent]
    )

    // Smart redirect based on role
    let finalRedirect = redirect
    if (redirect === '/leden' || redirect === '/') {
      // If no specific redirect, send admin/moderator to admin panel
      if (user.role === 'admin' || user.role === 'moderator') {
        finalRedirect = '/admin'
      } else {
        finalRedirect = '/leden'
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
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon, muzikale_ervaring) 
       VALUES (?, ?, ?, ?, ?)`,
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
      achternaam
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
      const tokenPrefix = token.substring(0, 32)
      
      // Close active session - calculate duration
      await execute(
        c.env.DB,
        `UPDATE user_sessions 
         SET logout_at = ?, 
             duration_seconds = CAST((julianday(?) - julianday(login_at)) * 86400 AS INTEGER),
             is_active = 0,
             updated_at = ?
         WHERE session_token = ? AND is_active = 1`,
        [formatDateForDB(), formatDateForDB(), formatDateForDB(), tokenPrefix]
      )
    }
  } catch (error) {
    console.error('Logout session tracking error:', error)
    // Continue with logout even if session tracking fails
  }
  
  deleteCookie(c, 'auth_token', { path: '/' })
  return c.redirect('/?logout=1')
})

// =====================================================
// FORGOT & RESET PASSWORD APIS
// =====================================================

app.post('/api/auth/forgot-password', async (c) => {
  const body = await c.req.parseBody()
  const email = (body.email as string).toLowerCase()

  // Always say "sent" for security (prevent email enumeration)
  // unless invalid email format
  if (!isValidEmail(email)) return c.redirect('/wachtwoord-vergeten')

  const user = await queryOne<any>(c.env.DB, "SELECT id, email FROM users WHERE email = ?", [email])
  
  if (user) {
    const token = generateRandomToken(32)
    // Expire in 1 hour
    await execute(
        c.env.DB, 
        `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`,
        [user.id, token]
    )

    const siteUrl = c.env.SITE_URL || 'https://animato.be'
    const resetLink = `${siteUrl}/reset-wachtwoord/${token}`

    await sendEmail({
        to: user.email,
        subject: 'Wachtwoord Herstellen - Animato',
        html: `
            <h1>Wachtwoord Herstellen</h1>
            <p>Er is een aanvraag gedaan om je wachtwoord te resetten.</p>
            <p>Klik op de onderstaande link om een nieuw wachtwoord in te stellen:</p>
            <a href="${resetLink}" style="display:inline-block;background:#00A9CE;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;">Wachtwoord Resetten</a>
            <p>Deze link is 1 uur geldig.</p>
            <p>Heb je dit niet aangevraagd? Negeer deze mail.</p>
        `
    }, c.env.RESEND_API_KEY)
  }

  return c.redirect('/login?success=reset_email_sent')
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
