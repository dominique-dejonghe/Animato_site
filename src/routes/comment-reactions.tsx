// =====================================================================
// Comment reactions API — polymorphic toggle + summary endpoints
// =====================================================================

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { requireAuth } from '../middleware/auth'
import {
  toggleReaction,
  getReactionsForTarget,
  renderReactionsBarHtml,
  REACTION_TYPES,
  type ReactionTarget,
  type ReactionType,
} from '../utils/comment-reactions'

const app = new Hono<{ Bindings: Bindings }>()

const VALID_TARGETS: ReactionTarget[] = [
  'event_reply', 'post_reply', 'post_comment', 'feedback_comment',
]

// Alle endpoints vereisen login
app.use('/api/comment-reactions/*', requireAuth)

/**
 * POST /api/comment-reactions/toggle
 * Body: { target_type, target_id, reaction }
 * Response: { success, added, html, summary }
 */
app.post('/api/comment-reactions/toggle', async (c) => {
  const user = c.get('user') as SessionUser
  let body: any
  try { body = await c.req.json() } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const targetType = String(body?.target_type || '') as ReactionTarget
  const targetId = parseInt(body?.target_id, 10)
  const reaction = String(body?.reaction || '') as ReactionType

  if (!VALID_TARGETS.includes(targetType)) {
    return c.json({ error: 'invalid target_type' }, 400)
  }
  if (!targetId || Number.isNaN(targetId)) {
    return c.json({ error: 'invalid target_id' }, 400)
  }
  if (!REACTION_TYPES.includes(reaction)) {
    return c.json({ error: 'invalid reaction' }, 400)
  }

  // Bescherm tegen reactions op niet-bestaande targets
  const tableMap: Record<ReactionTarget, string> = {
    event_reply: 'event_replies',
    post_reply: 'post_replies',
    post_comment: 'post_comments',
    feedback_comment: 'feedback_comments',
  }
  const table = tableMap[targetType]
  const exists = await c.env.DB.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`
  ).bind(targetId).first()
  if (!exists) {
    return c.json({ error: 'target not found' }, 404)
  }

  try {
    const { added, summary } = await toggleReaction(c.env.DB, targetType, targetId, user.id, reaction)
    const html = renderReactionsBarHtml(targetType, targetId, summary)
    // summary.mine is Set — converteer naar array voor JSON
    return c.json({
      success: true,
      added,
      html,
      summary: {
        counts: summary.counts,
        mine: Array.from(summary.mine),
        total: summary.total,
      },
    })
  } catch (e: any) {
    return c.json({ error: 'toggle failed', detail: String(e?.message || e) }, 500)
  }
})

/**
 * GET /api/comment-reactions/:type/:id
 * Geeft de huidige summary (HTML) terug.
 */
app.get('/api/comment-reactions/:type/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const targetType = c.req.param('type') as ReactionTarget
  const targetId = parseInt(c.req.param('id'), 10)
  if (!VALID_TARGETS.includes(targetType) || !targetId) {
    return c.json({ error: 'invalid params' }, 400)
  }
  const summary = await getReactionsForTarget(c.env.DB, targetType, targetId, user.id)
  return c.json({
    success: true,
    html: renderReactionsBarHtml(targetType, targetId, summary),
    summary: {
      counts: summary.counts,
      mine: Array.from(summary.mine),
      total: summary.total,
    },
  })
})

export default app
