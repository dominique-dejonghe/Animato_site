import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../utils/auth'
import { execute, queryOne } from '../utils/db'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Check beta status (Public)
app.get('/api/system/beta-status', async (c) => {
  const setting = await queryOne<{ value: string }>(
    c.env.DB, 
    "SELECT value FROM system_settings WHERE key = 'beta_features'"
  )
  return c.json({ enabled: setting?.value === '1' })
})

// Submit feedback (Auth required)
app.post('/api/feedback', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const body = await c.req.json()
    const type = body.type as string || 'bug'
    const message = body.message as string
    const url = body.url as string
    const screenshot = body.screenshot as string || null

    if (!message) return c.json({ error: 'Message required' }, 400)

    // Validate screenshot size (max 2MB base64 ≈ 2.7MB raw)
    if (screenshot && screenshot.length > 3_000_000) {
      return c.json({ error: 'Screenshot te groot (max 2MB)' }, 400)
    }

    await execute(
      c.env.DB,
      `INSERT INTO feedback (user_id, type, message, url, screenshot, status) VALUES (?, ?, ?, ?, ?, 'open')`,
      [user.id, type, message, url, screenshot]
    )

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default app
