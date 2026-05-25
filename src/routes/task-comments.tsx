/**
 * Task comments API + render helper
 *
 * Endpoints (alle onder /api/admin/tasks/comments/*, bestuurslid-only):
 *   GET    /list/:taskType/:taskId       — lijst comments + auteur info
 *   POST   /                             — nieuwe comment (form: task_type, task_id, body, parent_id?)
 *   POST   /:id/delete                   — soft delete (eigen comment of admin)
 *
 * Convention: task_type is 'meeting_action' of 'project_task'.
 *
 * UI helper:
 *   - renderCommentsBlock({taskType, taskId, comments, currentUserId}) → JSX
 *     gebruikt overal (lijst + kanban) zodat de styling consistent is.
 */

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { requireAuth, requireBestuurslid } from '../middleware/auth'
import { queryAll, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/admin/tasks/comments/*', requireAuth, requireBestuurslid)

// ---------- LIST ----------
app.get('/api/admin/tasks/comments/list/:taskType/:taskId', async (c) => {
  const taskType = c.req.param('taskType')
  const taskId   = c.req.param('taskId')
  if (!['meeting_action', 'project_task'].includes(taskType)) {
    return c.json({ error: 'invalid task_type' }, 400)
  }
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT
       tc.id, tc.task_type, tc.task_id, tc.user_id, tc.parent_id, tc.body,
       tc.created_at, tc.updated_at,
       p.voornaam, p.achternaam, p.foto_url
     FROM task_comments tc
     JOIN users u ON u.id = tc.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE tc.task_type = ? AND tc.task_id = ? AND tc.deleted_at IS NULL
     ORDER BY tc.created_at ASC`,
    [taskType, taskId]
  )
  return c.json({ ok: true, comments: rows })
})

// ---------- CREATE ----------
app.post('/api/admin/tasks/comments', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const taskType = String(body.task_type || '')
  const taskId   = Number(body.task_id || 0)
  const parentId = body.parent_id ? Number(body.parent_id) : null
  const text     = String(body.body || '').trim()

  if (!['meeting_action', 'project_task'].includes(taskType)) {
    return c.json({ error: 'invalid task_type' }, 400)
  }
  if (!taskId || !text) {
    return c.json({ error: 'task_id en body zijn vereist' }, 400)
  }
  if (text.length > 4000) {
    return c.json({ error: 'comment te lang (max 4000 tekens)' }, 400)
  }

  // Validate task exists
  const taskTable = taskType === 'meeting_action' ? 'meeting_action_items' : 'concert_project_tasks'
  const taskCheck = await c.env.DB.prepare(`SELECT id FROM ${taskTable} WHERE id = ?`).bind(taskId).first()
  if (!taskCheck) return c.json({ error: 'taak niet gevonden' }, 404)

  // Validate parent if given
  if (parentId) {
    const parent = await c.env.DB.prepare(
      `SELECT id FROM task_comments WHERE id = ? AND task_type = ? AND task_id = ? AND deleted_at IS NULL`
    ).bind(parentId, taskType, taskId).first()
    if (!parent) return c.json({ error: 'parent comment niet gevonden' }, 404)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO task_comments (task_type, task_id, user_id, parent_id, body)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(taskType, taskId, user.id, parentId, text).run()

  // AJAX: return JSON with new comment; otherwise redirect back
  const wantJson = c.req.header('accept')?.includes('json') || body._ajax
  if (wantJson) {
    return c.json({ ok: true, id: result.meta?.last_row_id })
  }
  // Fallback redirect to referer
  const ref = c.req.header('referer') || '/admin'
  return c.redirect(ref)
})

// ---------- DELETE (soft) ----------
app.post('/api/admin/tasks/comments/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(
    `SELECT user_id FROM task_comments WHERE id = ? AND deleted_at IS NULL`
  ).bind(id).first<any>()
  if (!row) return c.json({ error: 'comment niet gevonden' }, 404)

  const canDelete = row.user_id === user.id || user.role === 'admin' || user.role === 'moderator'
  if (!canDelete) return c.json({ error: 'geen rechten' }, 403)

  await c.env.DB.prepare(`UPDATE task_comments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

export default app
