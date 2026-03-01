// Walkthrough API
// Frontend API for tour execution and progress tracking

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Auth required for all walkthrough API endpoints
app.use('*', requireAuth)

// =====================================================
// GET TOURS FOR CURRENT USER
// =====================================================

app.get('/api/walkthrough/tours', async (c) => {
  const user = c.get('user') as SessionUser

  // Get tours for user's role (or 'all')
  const tours = await queryAll(c.env.DB, `
    SELECT 
      t.*,
      COUNT(s.id) as step_count,
      p.current_step,
      p.completed,
      p.skipped,
      p.started_at,
      p.completed_at
    FROM walkthrough_tours t
    LEFT JOIN walkthrough_steps s ON s.tour_id = t.id
    LEFT JOIN walkthrough_progress p ON p.tour_id = t.id AND p.user_id = ?
    WHERE t.is_active = 1 
      AND (
        ? = 'admin' OR 
        t.target_role = ? OR 
        t.target_role = 'all'
      )
    GROUP BY t.id
    ORDER BY t.sort_order ASC
  `, [user.id, user.role, user.role])

  return c.json({ tours })
})

// =====================================================
// GET SPECIFIC TOUR WITH STEPS
// =====================================================

app.get('/api/walkthrough/tours/:tourId', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('tourId')

  // Get tour info
  const tour = await queryOne(c.env.DB, `
    SELECT t.*, p.current_step, p.completed, p.skipped
    FROM walkthrough_tours t
    LEFT JOIN walkthrough_progress p ON p.tour_id = t.id AND p.user_id = ?
    WHERE t.id = ? AND t.is_active = 1
  `, [user.id, tourId])

  if (!tour) {
    return c.json({ error: 'Tour niet gevonden' }, 404)
  }

  // Get steps
  const steps = await queryAll(c.env.DB, `
    SELECT * FROM walkthrough_steps
    WHERE tour_id = ?
    ORDER BY step_number ASC
  `, [tourId])

  return c.json({ 
    tour,
    steps 
  })
})

// =====================================================
// START TOUR
// =====================================================

app.post('/api/walkthrough/tours/:tourId/start', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('tourId')

  try {
    // Insert or update progress
    await execute(c.env.DB, `
      INSERT INTO walkthrough_progress (user_id, tour_id, current_step, started_at, last_viewed_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, tour_id) 
      DO UPDATE SET 
        current_step = 1,
        completed = 0,
        skipped = 0,
        started_at = datetime('now'),
        last_viewed_at = datetime('now')
    `, [user.id, tourId])

    return c.json({ success: true })
  } catch (error) {
    console.error('Error starting tour:', error)
    return c.json({ error: 'Kon tour niet starten' }, 500)
  }
})

// =====================================================
// UPDATE PROGRESS (next/back step)
// =====================================================

app.post('/api/walkthrough/tours/:tourId/progress', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('tourId')
  const body = await c.req.json()
  const { current_step } = body

  try {
    await execute(c.env.DB, `
      UPDATE walkthrough_progress
      SET current_step = ?,
          last_viewed_at = datetime('now')
      WHERE user_id = ? AND tour_id = ?
    `, [current_step, user.id, tourId])

    return c.json({ success: true })
  } catch (error) {
    console.error('Error updating progress:', error)
    return c.json({ error: 'Kon voortgang niet bijwerken' }, 500)
  }
})

// =====================================================
// COMPLETE TOUR
// =====================================================

app.post('/api/walkthrough/tours/:tourId/complete', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('tourId')

  try {
    await execute(c.env.DB, `
      UPDATE walkthrough_progress
      SET completed = 1,
          completed_at = datetime('now'),
          last_viewed_at = datetime('now')
      WHERE user_id = ? AND tour_id = ?
    `, [user.id, tourId])

    return c.json({ success: true })
  } catch (error) {
    console.error('Error completing tour:', error)
    return c.json({ error: 'Kon tour niet voltooien' }, 500)
  }
})

// =====================================================
// SKIP TOUR
// =====================================================

app.post('/api/walkthrough/tours/:tourId/skip', async (c) => {
  const user = c.get('user') as SessionUser
  const tourId = c.req.param('tourId')

  try {
    await execute(c.env.DB, `
      UPDATE walkthrough_progress
      SET skipped = 1,
          last_viewed_at = datetime('now')
      WHERE user_id = ? AND tour_id = ?
    `, [user.id, tourId])

    return c.json({ success: true })
  } catch (error) {
    console.error('Error skipping tour:', error)
    return c.json({ error: 'Kon tour niet overslaan' }, 500)
  }
})

// =====================================================
// GET AUTO-START TOURS (for first login)
// =====================================================

app.get('/api/walkthrough/auto-start', async (c) => {
  const user = c.get('user') as SessionUser

  // Get auto-start tours that user hasn't completed/skipped yet
  const tours = await queryAll(c.env.DB, `
    SELECT t.*, COUNT(s.id) as step_count
    FROM walkthrough_tours t
    LEFT JOIN walkthrough_steps s ON s.tour_id = t.id
    LEFT JOIN walkthrough_progress p ON p.tour_id = t.id AND p.user_id = ?
    WHERE t.is_active = 1 
      AND t.auto_start = 1
      AND (t.target_role = ? OR t.target_role = 'all')
      AND (p.id IS NULL OR (p.completed = 0 AND p.skipped = 0))
    GROUP BY t.id
    ORDER BY t.sort_order ASC
    LIMIT 1
  `, [user.id, user.role])

  return c.json({ tour: tours[0] || null })
})

export default app
