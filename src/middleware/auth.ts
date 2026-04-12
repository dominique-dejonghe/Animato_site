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
 */
export async function requireAuth(c: Context<{ Bindings: Bindings }>, next: Next) {
  // Check for token in cookie or Authorization header
  const token = getCookie(c, 'auth_token') || 
                c.req.header('Authorization')?.replace('Bearer ', '')

  if (!token) {
    return c.json({ error: 'Niet ingelogd' }, 401)
  }

  const jwtSecret = c.env.JWT_SECRET
  const user = await verifyToken(token, jwtSecret)

  if (!user) {
    return c.json({ error: 'Ongeldige of verlopen sessie' }, 401)
  }

  // Attach user to context
  c.set('user', user)
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
