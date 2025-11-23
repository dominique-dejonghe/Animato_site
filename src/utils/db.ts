// Database utility functions
// Helper methods voor D1 database queries

import type { D1Database, D1Result } from '@cloudflare/workers-types'

// =====================================================
// QUERY HELPERS
// =====================================================

/**
 * Execute a SELECT query and return first row
 */
export async function queryOne<T = any>(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first<T>()
  return result || null
}

/**
 * Execute a SELECT query and return all rows
 */
export async function queryAll<T = any>(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>()
  return result.results || []
}

/**
 * Execute an INSERT/UPDATE/DELETE query
 */
export async function execute(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<D1Result> {
  return await db.prepare(sql).bind(...params).run()
}

/**
 * Execute a batch of queries in a transaction
 */
export async function executeBatch(
  db: D1Database,
  queries: Array<{ sql: string; params?: any[] }>
): Promise<D1Result[]> {
  const statements = queries.map(q => 
    db.prepare(q.sql).bind(...(q.params || []))
  )
  return await db.batch(statements)
}

// =====================================================
// PAGINATION
// =====================================================

export interface PaginationParams {
  page?: number
  limit?: number
  offset?: number
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

/**
 * Helper for paginated queries
 */
export async function paginate<T = any>(
  db: D1Database,
  baseQuery: string,
  countQuery: string,
  params: PaginationParams & { filters?: any[] } = {}
): Promise<PaginatedResult<T>> {
  const page = params.page || 1
  const limit = params.limit || 20
  const offset = params.offset !== undefined ? params.offset : (page - 1) * limit
  const filters = params.filters || []

  // Get total count
  const countResult = await queryOne<{ total: number }>(db, countQuery, filters)
  const total = countResult?.total || 0

  // Get data with pagination
  const data = await queryAll<T>(
    db,
    `${baseQuery} LIMIT ? OFFSET ?`,
    [...filters, limit, offset]
  )

  const totalPages = Math.ceil(total / limit)

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  }
}

// =====================================================
// SLUG GENERATION
// =====================================================

/**
 * Generate URL-safe slug from text
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Remove consecutive hyphens
}

/**
 * Ensure unique slug by appending number if needed
 */
export async function ensureUniqueSlug(
  db: D1Database,
  table: string,
  baseSlug: string,
  excludeId?: number
): Promise<string> {
  let slug = baseSlug
  let counter = 1

  while (true) {
    const existing = await queryOne(
      db,
      `SELECT id FROM ${table} WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`,
      excludeId ? [slug, excludeId] : [slug]
    )

    if (!existing) {
      return slug
    }

    slug = `${baseSlug}-${counter}`
    counter++
  }
}

// =====================================================
// HTTP HELPERS
// =====================================================

/**
 * Disable caching for admin pages
 * Prevents browser and CDN caching to ensure fresh data
 */
export function noCacheHeaders(c: any): void {
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
}

// =====================================================
// DATE HELPERS
// =====================================================

/**
 * Format date for SQLite
 */
export function formatDateForDB(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Parse SQLite datetime to Date object
 */
export function parseDateFromDB(dateString: string): Date {
  return new Date(dateString.replace(' ', 'T') + 'Z')
}

// =====================================================
// VALIDATION HELPERS
// =====================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate phone number (Belgian format)
 */
export function isValidPhone(phone: string): boolean {
  // Belgian phone: +32 followed by 9 digits, or 0 followed by 9 digits
  const phoneRegex = /^(\+32|0)[1-9]\d{8}$/
  return phoneRegex.test(phone.replace(/\s/g, ''))
}

/**
 * Sanitize HTML to prevent XSS (basic version)
 * In production, use a proper HTML sanitizer library
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
}

// =====================================================
// SEARCH HELPERS
// =====================================================

/**
 * Build LIKE query for search
 */
export function buildSearchQuery(fields: string[], searchTerm: string): { sql: string; params: string[] } {
  const likeTerm = `%${searchTerm}%`
  const conditions = fields.map(field => `${field} LIKE ?`).join(' OR ')
  const params = fields.map(() => likeTerm)

  return {
    sql: `(${conditions})`,
    params
  }
}

// =====================================================
// JSON HELPERS
// =====================================================

/**
 * Safely parse JSON from database
 */
export function safeJsonParse<T = any>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * Safely stringify for database storage
 */
export function safeJsonStringify(data: any): string {
  try {
    return JSON.stringify(data)
  } catch {
    return '{}'
  }
}
