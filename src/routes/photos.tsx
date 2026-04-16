// Photo Upload & Serving API
// Stores compressed member_photos in D1 member_photos table, serves with proper headers + caching

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { requireAuth } from '../middleware/auth'
import { queryOne } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// SERVE PHOTO - Public endpoint with aggressive caching
// =====================================================

app.get('/api/photos/:userId', async (c) => {
  const userId = c.req.param('userId')
  
  const photo = await queryOne<any>(
    c.env.DB,
    'SELECT data, content_type FROM member_photos WHERE user_id = ?',
    [userId]
  )
  
  if (!photo || !photo.data) {
    return c.body(null, 404)
  }
  
  try {
    // Validate base64 padding before decoding
    let base64Data = photo.data
    const remainder = base64Data.length % 4
    if (remainder === 2) base64Data += '=='
    else if (remainder === 3) base64Data += '='
    else if (remainder === 1) {
      // Truncated data - remove last incomplete character
      base64Data = base64Data.slice(0, -1)
    }
    
    // Decode base64 to binary
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    
    return new Response(bytes.buffer, {
      headers: {
        'Content-Type': photo.content_type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800', // 1 day browser, 7 days CDN
        'ETag': `"photo-${userId}-${photo.data.length}"`,
      }
    })
  } catch (err) {
    console.error(`Photo decode error for user ${userId}:`, err)
    return c.body(null, 404)
  }
})

// =====================================================
// UPLOAD PHOTO - Requires authentication
// =====================================================

app.post('/api/photos/upload', requireAuth, async (c) => {
  const user = c.get('user') as any
  
  try {
    const body = await c.req.json()
    const { data, content_type, target_user_id } = body
    
    if (!data) {
      return c.json({ error: 'Geen foto data ontvangen' }, 400)
    }
    
    // Determine which user's photo to update
    // Admins can upload for other users
    const targetUserId = (user.role === 'admin' && target_user_id) ? target_user_id : user.id
    
    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,")
    let cleanData = data
    let detectedType = content_type || 'image/jpeg'
    
    if (data.startsWith('data:')) {
      const match = data.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        detectedType = match[1]
        cleanData = match[2]
      }
    }
    
    // Validate size (max ~500KB of base64 = ~375KB actual image)
    if (cleanData.length > 700000) {
      return c.json({ error: 'Foto is te groot. Maximum ~500KB na compressie.' }, 400)
    }
    
    // Calculate approximate size in bytes
    const sizeBytes = Math.round(cleanData.length * 3 / 4)
    
    // Upsert into member_photos table
    await c.env.DB.prepare(
      `INSERT INTO member_photos (user_id, data, content_type, size_bytes, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         data = excluded.data,
         content_type = excluded.content_type,
         size_bytes = excluded.size_bytes,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(targetUserId, cleanData, detectedType, sizeBytes).run()
    
    // Update profiles.foto_url to point to the serving endpoint
    const photoUrl = `/api/photos/${targetUserId}`
    await c.env.DB.prepare(
      'UPDATE profiles SET foto_url = ? WHERE user_id = ?'
    ).bind(photoUrl, targetUserId).run()
    
    return c.json({ 
      success: true, 
      url: photoUrl,
      size: sizeBytes
    })
  } catch (err: any) {
    console.error('Photo upload error:', err)
    return c.json({ error: 'Upload mislukt: ' + (err.message || 'onbekende fout') }, 500)
  }
})

// =====================================================
// DELETE PHOTO
// =====================================================

app.post('/api/photos/delete', requireAuth, async (c) => {
  const user = c.get('user') as any
  
  try {
    const body = await c.req.json()
    const { target_user_id } = body
    
    const targetUserId = (user.role === 'admin' && target_user_id) ? target_user_id : user.id
    
    await c.env.DB.prepare('DELETE FROM member_photos WHERE user_id = ?').bind(targetUserId).run()
    await c.env.DB.prepare('UPDATE profiles SET foto_url = NULL WHERE user_id = ?').bind(targetUserId).run()
    
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'Verwijderen mislukt' }, 500)
  }
})

// =====================================================
// MIGRATE EXISTING BASE64 PHOTOS (Admin only, one-time)
// =====================================================

app.post('/api/photos/migrate', requireAuth, async (c) => {
  const user = c.get('user') as any
  if (user.role !== 'admin') {
    return c.json({ error: 'Alleen admins' }, 403)
  }
  
  try {
    // Find all profiles with base64 foto_url
    const profiles = await c.env.DB.prepare(
      `SELECT p.user_id, p.foto_url 
       FROM profiles p 
       WHERE p.foto_url IS NOT NULL 
         AND p.foto_url LIKE 'data:%'`
    ).all()
    
    let migrated = 0
    let errors = 0
    const details: any[] = []
    
    for (const row of (profiles.results || []) as any[]) {
      try {
        const match = row.foto_url.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) {
          details.push({ user_id: row.user_id, status: 'skip', reason: 'invalid format' })
          continue
        }
        
        const contentType = match[1]
        const base64Data = match[2]
        const sizeBytes = Math.round(base64Data.length * 3 / 4)
        
        // Insert into member_photos table
        await c.env.DB.prepare(
          `INSERT INTO member_photos (user_id, data, content_type, size_bytes, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             data = excluded.data,
             content_type = excluded.content_type,
             size_bytes = excluded.size_bytes,
             updated_at = CURRENT_TIMESTAMP`
        ).bind(row.user_id, base64Data, contentType, sizeBytes).run()
        
        // Update foto_url to point to serving endpoint
        await c.env.DB.prepare(
          'UPDATE profiles SET foto_url = ? WHERE user_id = ?'
        ).bind(`/api/photos/${row.user_id}`, row.user_id).run()
        
        migrated++
        details.push({ user_id: row.user_id, status: 'ok', size: sizeBytes })
      } catch (err: any) {
        errors++
        details.push({ user_id: row.user_id, status: 'error', message: err.message })
      }
    }
    
    return c.json({ 
      success: true, 
      total: (profiles.results || []).length,
      migrated,
      errors,
      details
    })
  } catch (err: any) {
    return c.json({ error: 'Migratie mislukt: ' + (err.message || 'onbekende fout') }, 500)
  }
})

export default app
