// Authentication utilities
// Uses Web Crypto API (Cloudflare Workers compatible)

import type { SessionUser, UserRole, Stemgroep } from '../types'

// =====================================================
// PASSWORD HASHING (using Web Crypto API)
// =====================================================

/**
 * Hash a password using PBKDF2 (Web Crypto API)
 * Cloudflare Workers compatible
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordData = encoder.encode(password)

  const key = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  )

  const hashArray = new Uint8Array(hashBuffer)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')

  return `${saltHex}:${hashHex}`
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(':')
  
  if (!saltHex || !hashHex) {
    return false
  }

  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)

  const key = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  )

  const hashArray = new Uint8Array(hashBuffer)
  const computedHashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')

  return computedHashHex === hashHex
}

// =====================================================
// JWT TOKEN GENERATION
// =====================================================

/**
 * Generate JWT token (manual implementation for Cloudflare Workers)
 */
export async function generateToken(payload: SessionUser, secret: string, expiresIn: string = '7d'): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }

  // Calculate expiration
  const now = Math.floor(Date.now() / 1000)
  let exp = now
  
  if (expiresIn.endsWith('d')) {
    exp += parseInt(expiresIn) * 24 * 60 * 60
  } else if (expiresIn.endsWith('h')) {
    exp += parseInt(expiresIn) * 60 * 60
  } else if (expiresIn.endsWith('m')) {
    exp += parseInt(expiresIn) * 60
  }

  const tokenPayload = {
    ...payload,
    iat: now,
    exp
  }

  const encoder = new TextEncoder()
  const headerBase64 = btoa(JSON.stringify(header))
  const payloadBase64 = btoa(JSON.stringify(tokenPayload))
  const unsignedToken = `${headerBase64}.${payloadBase64}`

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(unsignedToken)
  )

  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
  
  return `${unsignedToken}.${signatureBase64}`
}

/**
 * Verify and decode JWT token
 */
export async function verifyToken(token: string, secret: string): Promise<SessionUser | null> {
  try {
    const [headerBase64, payloadBase64, signatureBase64] = token.split('.')
    
    if (!headerBase64 || !payloadBase64 || !signatureBase64) {
      return null
    }

    const encoder = new TextEncoder()
    const unsignedToken = `${headerBase64}.${payloadBase64}`

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0))
    
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(unsignedToken)
    )

    if (!valid) {
      return null
    }

    const payload = JSON.parse(atob(payloadBase64))
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      stemgroep: payload.stemgroep,
      voornaam: payload.voornaam,
      achternaam: payload.achternaam
    }
  } catch (error) {
    console.error('Token verification error:', error)
    return null
  }
}

// =====================================================
// PERMISSION CHECKING
// =====================================================

/**
 * Check if user has required role
 */
export function hasRole(user: SessionUser, requiredRole: UserRole | UserRole[]): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    admin: 4,
    moderator: 3,
    stemleider: 2,
    lid: 1,
    bezoeker: 0
  }

  const userLevel = roleHierarchy[user.role]

  if (Array.isArray(requiredRole)) {
    return requiredRole.some(role => roleHierarchy[role] <= userLevel)
  }

  return roleHierarchy[requiredRole] <= userLevel
}

/**
 * Check if user can access stem-specific content
 */
export function canAccessStem(user: SessionUser, requiredStem: Stemgroep): boolean {
  // Admins and moderators can access everything
  if (user.role === 'admin' || user.role === 'moderator') {
    return true
  }

  // Stemleiders can access their own stem
  if (user.role === 'stemleider' && user.stemgroep === requiredStem) {
    return true
  }

  // Regular members can only access their own stem
  return user.stemgroep === requiredStem
}

/**
 * Check if user can moderate content
 */
export function canModerate(user: SessionUser): boolean {
  return ['admin', 'moderator'].includes(user.role)
}

/**
 * Check if user is admin
 */
export function isAdmin(user: SessionUser): boolean {
  return user.role === 'admin'
}

// =====================================================
// RANDOM TOKEN GENERATION
// =====================================================

/**
 * Generate random token for password reset, invites, etc.
 */
export function generateRandomToken(length: number = 32): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}
