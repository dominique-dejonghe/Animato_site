import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken, isAdmin } from '../utils/auth'
import { execute, queryOne, queryAll } from '../utils/db'
import { sendEmail, adminAlertEmail, EMAIL_REPLY_TO } from '../utils/email'
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

// Get user's own feedback with comments (Auth required)
app.get('/api/feedback/mine', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const items = await queryAll(
    c.env.DB,
    `SELECT f.id, f.type, f.message, f.status, f.admin_notes, f.created_at,
            (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count,
            (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id AND fc.is_admin = 1 
              AND fc.created_at > COALESCE(
                (SELECT MAX(fc2.created_at) FROM feedback_comments fc2 WHERE fc2.feedback_id = f.id AND fc2.is_admin = 0),
                f.created_at
              )
            ) as unread_admin_replies
     FROM feedback f
     WHERE f.user_id = ? 
     ORDER BY f.created_at DESC 
     LIMIT 20`,
    [user.id]
  )

  return c.json({ items: items || [] })
})

// Get comments for a specific feedback item (Auth required - user must own it)
app.get('/api/feedback/:id/comments', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const feedbackId = parseInt(c.req.param('id'))
  
  // Check ownership (user owns it OR user is admin)
  const feedback = await queryOne<{ user_id: number }>(
    c.env.DB,
    'SELECT user_id FROM feedback WHERE id = ?',
    [feedbackId]
  )

  if (!feedback) return c.json({ error: 'Not found' }, 404)
  if (feedback.user_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const comments = await queryAll(
    c.env.DB,
    `SELECT fc.id, fc.message, fc.is_admin, fc.created_at,
            p.voornaam, p.achternaam
     FROM feedback_comments fc
     LEFT JOIN profiles p ON p.user_id = fc.user_id
     ORDER BY fc.created_at ASC`,
    []
  )

  // Filter to only this feedback's comments (safer approach for D1)
  const filtered = await queryAll(
    c.env.DB,
    `SELECT fc.id, fc.message, fc.is_admin, fc.created_at,
            p.voornaam, p.achternaam
     FROM feedback_comments fc
     LEFT JOIN profiles p ON p.user_id = fc.user_id
     WHERE fc.feedback_id = ?
     ORDER BY fc.created_at ASC`,
    [feedbackId]
  )

  return c.json({ comments: filtered || [] })
})

// Add comment to feedback (Auth required - user must own it)
app.post('/api/feedback/:id/comments', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const feedbackId = parseInt(c.req.param('id'))
  
  // Check ownership
  const feedback = await queryOne<{ user_id: number }>(
    c.env.DB,
    'SELECT user_id FROM feedback WHERE id = ?',
    [feedbackId]
  )

  if (!feedback) return c.json({ error: 'Not found' }, 404)
  if (feedback.user_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  try {
    const body = await c.req.json()
    const message = (body.message as string || '').trim()

    if (!message) return c.json({ error: 'Bericht is verplicht' }, 400)
    if (message.length > 2000) return c.json({ error: 'Bericht is te lang (max 2000 tekens)' }, 400)

    const isAdmin = (user.role === 'admin') ? 1 : 0

    await execute(
      c.env.DB,
      `INSERT INTO feedback_comments (feedback_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)`,
      [feedbackId, user.id, message, isAdmin]
    )

    // If admin replies, update feedback status to in_progress if it was open
    if (isAdmin) {
      await execute(
        c.env.DB,
        `UPDATE feedback SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'`,
        [feedbackId]
      )
    } else {
      // If user replies to 'meer_info_nodig', set back to 'open' (info provided)
      await execute(
        c.env.DB,
        `UPDATE feedback SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'meer_info_nodig'`,
        [feedbackId]
      )
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
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
    const browserInfo = body.browser_info as string || null

    if (!message) return c.json({ error: 'Message required' }, 400)

    // Validate screenshot size (max 2MB base64 ≈ 2.7MB raw)
    if (screenshot && screenshot.length > 3_000_000) {
      return c.json({ error: 'Screenshot te groot (max 2MB)' }, 400)
    }

    // assigned_to = melder zelf — zo blijft het ticket bij de eigenaar staan
    // tot een admin het overneemt of resolved.
    const inserted = await execute(
      c.env.DB,
      `INSERT INTO feedback (user_id, assigned_to, type, message, url, screenshot, browser_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [user.id, user.id, type, message, url, screenshot, browserInfo]
    )

    // Admin-alert email — webmaster ziet nieuwe feedback meteen binnen
    // Best-effort: fout in mail mag POST /api/feedback niet stukmaken
    try {
      const userInfo = await queryOne<any>(c.env.DB,
        `SELECT u.email, p.voornaam, p.achternaam FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = ? LIMIT 1`, [user.id])
      const naam = userInfo
        ? `${userInfo.voornaam || ''} ${userInfo.achternaam || ''}`.trim() || userInfo.email
        : `User #${user.id}`
      const feedbackId = (inserted as any)?.meta?.last_row_id
      await sendEmail({
        to: EMAIL_REPLY_TO,
        replyTo: userInfo?.email || undefined,
        subject: `[Animato ${type === 'bug' ? 'Bug' : 'Feedback'}] ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
        html: adminAlertEmail({
          titel: `Nieuwe ${type === 'bug' ? 'bug-melding' : 'feedback'} van ${naam}`,
          intro: `Er is een nieuwe ${type === 'bug' ? 'bug' : 'feature request'} binnengekomen via het feedback-widget.`,
          details: [
            { label: 'Type',       value: type },
            { label: 'Melder',     value: naam },
            { label: 'E-mail',     value: userInfo?.email || '—' },
            { label: 'Pagina',     value: url || '—' },
            { label: 'Bericht',    value: message },
            { label: 'Browser',    value: browserInfo || '—' },
          ],
          actionLink: feedbackId ? `/admin/feedback?id=${feedbackId}` : '/admin/feedback',
          actionLabel: 'Bekijk in admin',
        }),
      }, c.env.RESEND_API_KEY)
    } catch (mailErr) {
      console.error('feedback admin email failed (non-fatal):', mailErr)
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// =====================================================
// USER RETEST RESPONSE - Confirm fix or report still broken
// =====================================================

app.post('/api/feedback/:id/retest-response', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const feedbackId = parseInt(c.req.param('id'))
  
  // Check ownership
  const feedback = await queryOne<{ user_id: number; status: string }>(
    c.env.DB,
    'SELECT user_id, status FROM feedback WHERE id = ?',
    [feedbackId]
  )

  if (!feedback) return c.json({ error: 'Not found' }, 404)

  // Admins/moderators mogen elk item heropenen ("opnieuw programmeren")
  // ook al staat het op 'resolved' of een andere status. Voor gewone
  // melders blijft de strikte check: alleen eigen items op 'hertesten'.
  const adminOverride = isAdmin(user) || user.role === 'moderator'
  const isOwner = feedback.user_id === user.id

  if (!adminOverride && !isOwner) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (!adminOverride && feedback.status !== 'hertesten') {
    return c.json({ error: 'Dit item staat niet op hertesten' }, 400)
  }

  try {
    const body = await c.req.json()
    const verdict = body.verdict as string // 'ok' or 'not_ok'
    const comment = (body.comment as string || '').trim()

    if (verdict !== 'ok' && verdict !== 'not_ok') {
      return c.json({ error: 'Ongeldige reactie. Kies "ok" of "not_ok".' }, 400)
    }

    if (verdict === 'ok') {
      // User confirms: fix works → mark as resolved
      await execute(
        c.env.DB,
        `UPDATE feedback SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [feedbackId]
      )

      // Add auto-comment
      const autoMessage = comment 
        ? `✅ Bevestigd als opgelost door melder: "${comment}"`
        : '✅ Bevestigd als opgelost door melder.'

      await execute(
        c.env.DB,
        `INSERT INTO feedback_comments (feedback_id, user_id, message, is_admin) VALUES (?, ?, ?, 0)`,
        [feedbackId, user.id, autoMessage]
      )
    } else {
      // User says: still broken → reopen
      await execute(
        c.env.DB,
        `UPDATE feedback SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [feedbackId]
      )

      // Add comment with the user's feedback
      const reopenMessage = comment 
        ? `❌ Nog niet opgelost – ${comment}`
        : '❌ Nog niet opgelost. Het probleem bestaat nog steeds.'

      await execute(
        c.env.DB,
        `INSERT INTO feedback_comments (feedback_id, user_id, message, is_admin) VALUES (?, ?, ?, 0)`,
        [feedbackId, user.id, reopenMessage]
      )
    }

    return c.json({ success: true, new_status: verdict === 'ok' ? 'resolved' : 'open' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default app
