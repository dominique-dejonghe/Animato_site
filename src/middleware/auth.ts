// Authentication middleware voor Hono
// Role-based access control

import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Bindings, SessionUser, UserRole, Stemgroep } from '../types'
import { verifyToken, hasRole, canAccessStem, canModerate, isAdmin } from '../utils/auth'

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

/**
 * Require authenticated user
 * Attaches user to context as c.get('user')
 *
 * Impersonate-aware: probeert in volgorde:
 *   1. auth_token (de "live" sessie)
 *   2. admin_impersonate_token (gestashte admin-sessie tijdens "Bekijk als lid")
 *
 * Belangrijk: we doen géén redirect naar c.req.url om cookies te herstellen
 * (zoals de vorige implementatie). Reden: dat veroorzaakte een race waarbij de
 * Set-Cookie header soms niet bij was aangekomen vóór de redirect-fetch, en
 * de gebruiker dus een "Ongeldige sessie" zag op /admin terwijl er nochtans
 * een geldig admin-token in het impersonate-cookie zat.
 *
 * Nu: als auth_token onbruikbaar is maar impersonate-token werkt, gebruiken
 * we die meteen voor DEZE request, en updaten we de cookies in dezelfde
 * response. Geen redirect-dance.
 */
export async function requireAuth(c: Context<{ Bindings: Bindings }>, next: Next) {
  const jwtSecret = c.env.JWT_SECRET
  const authToken = getCookie(c, 'auth_token') ||
                    c.req.header('Authorization')?.replace('Bearer ', '')
  const impersonateToken = getCookie(c, 'admin_impersonate_token')

  // Probeer eerst de live-sessie
  let token: string | undefined = authToken
  let user = authToken ? await verifyToken(authToken, jwtSecret) : null

  // Als die niet werkt maar er is een gestashte admin-sessie, probeer die.
  // Dit dekt twee scenario's:
  //   a) auth_token bestaat niet (cookie verwijderd / nooit gezet)
  //   b) auth_token bestaat maar JWT-verify faalt (verlopen, secret rotated)
  if (!user && impersonateToken) {
    const adminUser = await verifyToken(impersonateToken, jwtSecret)
    if (adminUser) {
      // Promoveer impersonate-token naar live-sessie en wis de stash
      const { setCookie } = await import('hono/cookie')
      setCookie(c, 'auth_token', impersonateToken, {
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
      token = impersonateToken
      user = adminUser
    }
  }

  if (!user) {
    // Onderscheid: helemaal geen token vs ongeldig token. Voor admin-paths
    // willen we HTML i.p.v. JSON tonen (vriendelijker dan een rauwe dump
    // van { error: "..." }). De handler op /admin neemt dit over.
    const path = c.req.path
    const wantsHtml = (c.req.header('Accept') || '').includes('text/html') &&
                      !path.startsWith('/api/')
    if (wantsHtml && (path === '/admin' || path.startsWith('/admin/'))) {
      // Wis stale cookies preventief zodat de gebruiker een schone re-login krijgt
      const { setCookie } = await import('hono/cookie')
      setCookie(c, 'auth_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
      setCookie(c, 'admin_impersonate_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
      return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Sessie verlopen</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        </head>
        <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
            <i class="fas fa-clock text-amber-500 text-5xl mb-4"></i>
            <h1 class="text-2xl font-bold text-gray-800 mb-2">Sessie verlopen</h1>
            <p class="text-gray-600 mb-6">Je beheerderssessie is niet meer geldig. Log opnieuw in om verder te gaan.</p>
            <a href="/login?redirect=${encodeURIComponent(path)}" class="inline-block px-6 py-3 bg-animato-primary text-white rounded-lg font-medium hover:bg-animato-secondary transition" style="background-color:#00A9CE">
              <i class="fas fa-sign-in-alt mr-2"></i>Opnieuw inloggen
            </a>
          </div>
        </body></html>`, 401)
    }
    if (!authToken && !impersonateToken) {
      return c.json({ error: 'Niet ingelogd' }, 401)
    }
    return c.json({ error: 'Ongeldige of verlopen sessie' }, 401)
  }

  // Attach user to context
  c.set('user', user)

  // Heartbeat: raak user_sessions.updated_at aan zodat we
  // inactiviteit kunnen meten op /admin/audit. Niet-blokkerend.
  try {
    const tokenPrefix = (token || '').substring(0, 32)
    if (tokenPrefix) {
      await c.env.DB.prepare(
        `UPDATE user_sessions SET updated_at = CURRENT_TIMESTAMP
         WHERE session_token = ? AND is_active = 1`
      ).bind(tokenPrefix).run()
    }
  } catch (_) { /* stil falen — niet kritiek */ }

  // Users-heartbeat: last_seen_at op user-niveau, voor "wie is online?" en
  // accurate sessie-duur in audit. Throttled op DB-niveau: enkel updaten
  // als de vorige heartbeat > 5 minuten oud is. Houdt de write-load laag
  // (1 update per user per 5 min, niet per request). Niet-blokkerend.
  try {
    await c.env.DB.prepare(
      `UPDATE users
         SET last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (last_seen_at IS NULL
              OR last_seen_at < datetime(CURRENT_TIMESTAMP, '-5 minutes'))`
    ).bind(user.id).run()
  } catch (_) { /* stil falen */ }

  await next()
}

/**
 * Require specific role(s)
 * Must be used after requireAuth
 */
export function requireRole(...roles: UserRole[]) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    const user = c.get('user') as SessionUser

    if (!user) {
      return c.json({ error: 'Niet ingelogd' }, 401)
    }

    if (!hasRole(user, roles)) {
      // Stale-token detectie: token zegt 'lid' maar DB zegt iets hogers.
      // Gebeurt na "Bekijk als lid" of na een role-upgrade door een andere
      // admin. Vriendelijke re-login pagina i.p.v. rauwe JSON-403.
      const path = c.req.path
      const wantsHtml = (c.req.header('Accept') || '').includes('text/html') &&
                        !path.startsWith('/api/')

      let dbRole: string | null = null
      try {
        const row = await c.env.DB.prepare(
          'SELECT role FROM users WHERE id = ?'
        ).bind(user.id).first<{ role: string }>()
        dbRole = row?.role ?? null
      } catch (_) { /* niet kritiek */ }

      const tokenIsStale = dbRole && dbRole !== user.role &&
                           roles.includes(dbRole as UserRole)

      if (tokenIsStale && wantsHtml) {
        // Wis stale cookies → schone re-login
        const { setCookie } = await import('hono/cookie')
        setCookie(c, 'auth_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
        setCookie(c, 'admin_impersonate_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
        return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Sessie verouderd</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
          </head>
          <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
              <i class="fas fa-sync-alt text-amber-500 text-5xl mb-4"></i>
              <h1 class="text-2xl font-bold text-gray-800 mb-2">Sessie verouderd</h1>
              <p class="text-gray-600 mb-2">Je rechten zijn ondertussen aangepast (nu: <strong>${dbRole}</strong>), maar je sessie bevat nog de oude rol (<strong>${user.role}</strong>).</p>
              <p class="text-gray-500 text-sm mb-6">Dit gebeurt typisch na "Bekijk als lid" of na een rol-upgrade. Log opnieuw in om verder te gaan.</p>
              <a href="/login?redirect=${encodeURIComponent(path)}" class="inline-block px-6 py-3 text-white rounded-lg font-medium hover:opacity-90 transition" style="background-color:#00A9CE">
                <i class="fas fa-sign-in-alt mr-2"></i>Opnieuw inloggen
              </a>
            </div>
          </body></html>`, 403)
      }

      return c.json({
        error: 'Onvoldoende rechten',
        requiredRole: roles,
        yourRole: user.role,
        ...(tokenIsStale ? { hint: 'token-stale', dbRole } : {})
      }, 403)
    }

    await next()
  }
}

/**
 * Require admin role
 */
export async function requireAdmin(c: Context<{ Bindings: Bindings }>, next: Next) {
  const user = c.get('user') as SessionUser

  if (!user) {
    return c.json({ error: 'Niet ingelogd' }, 401)
  }

  if (!isAdmin(user)) {
    return c.json({ error: 'Alleen voor administrators' }, 403)
  }

  await next()
}

/**
 * Require moderator or admin
 */
export async function requireModerator(c: Context<{ Bindings: Bindings }>, next: Next) {
  const user = c.get('user') as SessionUser

  if (!user) {
    return c.json({ error: 'Niet ingelogd' }, 401)
  }

  if (!canModerate(user)) {
    return c.json({ error: 'Alleen voor moderators en administrators' }, 403)
  }

  await next()
}

/**
 * Require access to specific stemgroep
 * Must be used after requireAuth
 */
export function requireStemgroep(stem: Stemgroep) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    const user = c.get('user') as SessionUser

    if (!user) {
      return c.json({ error: 'Niet ingelogd' }, 401)
    }

    if (!canAccessStem(user, stem)) {
      return c.json({ 
        error: 'Geen toegang tot deze stemgroep', 
        requiredStem: stem,
        yourStem: user.stemgroep 
      }, 403)
    }

    await next()
  }
}

/**
 * Require board member (bestuurslid) - or admin/moderator
 * Board members have is_bestuurslid=1, admins/moderators always have access
 *
 * Voor browser-requests op /admin tonen we een vriendelijke HTML-pagina
 * i.p.v. een rauwe JSON-dump (consistent met requireAuth).
 */
export async function requireBestuurslid(c: Context<{ Bindings: Bindings }>, next: Next) {
  const user = c.get('user') as SessionUser

  if (!user) {
    return c.json({ error: 'Niet ingelogd' }, 401)
  }

  // Admins and moderators always have access
  if (user.role === 'admin' || user.role === 'moderator') {
    await next()
    return
  }

  // Check is_bestuurslid flag
  if (user.is_bestuurslid) {
    await next()
    return
  }

  // Stale-token detectie voor is_bestuurslid: JWT bevat een snapshot van de
  // vlag op moment van inloggen. Als een admin nadien iemand promoveert tot
  // bestuurslid, blijft het oude token zeggen "0" totdat de gebruiker uitlogt
  // en opnieuw inlogt — wat zelden gebeurt. Daarom checken we de DB als
  // bron-of-truth, en als die zegt "ja" → toegang verlenen + JWT-cookie
  // stilletjes verversen zodat het probleem zichzelf oplost.
  try {
    const dbRow = await c.env.DB.prepare(
      'SELECT id, email, role, stemgroep, is_bestuurslid FROM users WHERE id = ?'
    ).bind(user.id).first<{ id: number; email: string; role: string; stemgroep: string | null; is_bestuurslid: number }>()

    if (dbRow && (dbRow.is_bestuurslid === 1 || dbRow.role === 'admin' || dbRow.role === 'moderator')) {
      // Update de Context-user zodat downstream code de juiste waarden ziet
      const refreshedUser: SessionUser = {
        ...user,
        role: dbRow.role as UserRole,
        is_bestuurslid: dbRow.is_bestuurslid as 0 | 1,
        stemgroep: (dbRow.stemgroep ?? user.stemgroep) as Stemgroep | null,
      }
      c.set('user', refreshedUser)

      // Cookie stilletjes verversen — nieuwe JWT met juiste claims.
      // Best-effort: als er iets fout gaat, log + ga toch door (toegang
      // is al bevestigd op basis van DB).
      try {
        const { generateToken } = await import('../utils/auth')
        const { setCookie } = await import('hono/cookie')
        const freshToken = await generateToken(refreshedUser, c.env.JWT_SECRET, '7d')
        setCookie(c, 'auth_token', freshToken, {
          maxAge: 7 * 24 * 60 * 60,
          httpOnly: true, secure: true, sameSite: 'Lax', path: '/'
        })
      } catch (e) {
        console.warn('[requireBestuurslid] kon JWT niet verversen:', e)
      }

      await next()
      return
    }
  } catch (e) {
    console.warn('[requireBestuurslid] DB-check faalde, val terug op JWT-claims:', e)
  }

  // IMPERSONATE-AWARE: vóór we 403 retourneren, kijken of er een gestashte
  // admin-sessie is. Scenario: admin klikt "Bekijk als lid", auth_token =
  // lid-token, en navigeert dan terug naar /admin. Zonder deze check zou
  // de geldige lid-sessie de admin uitsluiten van z'n eigen admin-paneel.
  const impersonateToken = getCookie(c, 'admin_impersonate_token')
  if (impersonateToken) {
    const adminUser = await verifyToken(impersonateToken, c.env.JWT_SECRET)
    if (adminUser && (adminUser.role === 'admin' || adminUser.role === 'moderator' || adminUser.is_bestuurslid)) {
      const { setCookie } = await import('hono/cookie')
      // Promoveer impersonate-token naar live-sessie en wis de stash
      setCookie(c, 'auth_token', impersonateToken, {
        maxAge: 7 * 24 * 60 * 60,
        httpOnly: true, secure: true, sameSite: 'Lax', path: '/'
      })
      setCookie(c, 'admin_impersonate_token', '', {
        maxAge: 0, httpOnly: true, secure: true, sameSite: 'Lax', path: '/'
      })
      c.set('user', adminUser)
      await next()
      return
    }
  }

  // 403 — afhankelijk van wie er aanklopt: HTML voor browser, JSON voor API
  const path = c.req.path
  const wantsHtml = (c.req.header('Accept') || '').includes('text/html') &&
                    !path.startsWith('/api/')
  if (wantsHtml) {
    return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Geen toegang</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      </head>
      <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <i class="fas fa-lock text-red-500 text-5xl mb-4"></i>
          <h1 class="text-2xl font-bold text-gray-800 mb-2">Geen toegang</h1>
          <p class="text-gray-600 mb-6">Dit deel van de site is enkel voor bestuursleden, moderators en administrators. Heb je per ongeluk de verkeerde link gevolgd?</p>
          <div class="flex flex-col gap-2">
            <a href="/leden" class="inline-block px-6 py-3 bg-animato-primary text-white rounded-lg font-medium hover:bg-animato-secondary transition" style="background-color:#00A9CE">
              <i class="fas fa-arrow-left mr-2"></i>Terug naar ledenportaal
            </a>
            <a href="/" class="text-sm text-gray-500 hover:underline">Of naar de homepage</a>
          </div>
        </div>
      </body></html>`, 403)
  }

  return c.json({ 
    error: 'Alleen voor bestuursleden', 
    message: 'Je hebt geen toegang tot dit gedeelte. Neem contact op met het bestuur.'
  }, 403)
}

/**
 * Optional auth - attach user if present but don't require
 */
export async function optionalAuth(c: Context<{ Bindings: Bindings }>, next: Next) {
  const token = getCookie(c, 'auth_token') ||
                c.req.header('Authorization')?.replace('Bearer ', '')

  if (token) {
    const jwtSecret = c.env.JWT_SECRET
    const user = await verifyToken(token, jwtSecret)

    if (user) {
      c.set('user', user)
      // Heartbeat: zie requireAuth
      try {
        const tokenPrefix = token.substring(0, 32)
        await c.env.DB.prepare(
          `UPDATE user_sessions SET updated_at = CURRENT_TIMESTAMP
           WHERE session_token = ? AND is_active = 1`
        ).bind(tokenPrefix).run()
      } catch (_) { /* stil falen */ }
    }
  }

  await next()
}

/**
 * Check if current user can edit resource
 * Resource must have auteur_id or user_id field
 */
export function canEditResource(resourceUserId: number) {
  return (c: Context<{ Bindings: Bindings }>) => {
    const user = c.get('user') as SessionUser

    if (!user) {
      return false
    }

    // Admins and moderators can edit anything
    if (canModerate(user)) {
      return true
    }

    // Users can edit their own resources
    return user.id === resourceUserId
  }
}
