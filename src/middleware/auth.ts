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
      return c.json({ 
        error: 'Onvoldoende rechten', 
        requiredRole: roles,
        yourRole: user.role 
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
