import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { sendEmail } from '../utils/email'

const app = new Hono()

// Auth Middleware
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

// ─── REDIRECTS: Old activity URLs → Unified Events ─────────────────────────

// Overview → events filtered by type activiteit
app.get('/admin/activities', async (c) => {
  return c.redirect('/admin/events?type=activiteit', 302)
})

// New → events nieuw (type=activiteit pre-select via query param handled in events form)
app.get('/admin/activities/new', async (c) => {
  return c.redirect('/admin/events/nieuw?type=activiteit', 302)
})

// Edit → look up event_id and redirect to unified event editor
app.get('/admin/activities/:id/edit', async (c) => {
  const id = c.req.param('id')
  const activity = await queryOne<any>(c.env.DB, `SELECT event_id FROM activities WHERE id = ?`, [id])
  if (activity?.event_id) return c.redirect(`/admin/events/${activity.event_id}`, 302)
  return c.redirect('/admin/events?type=activiteit', 302)
})

// Detail view → redirect to event detail (which now shows activity details too)
app.get('/admin/activities/:id', async (c) => {
  const id = c.req.param('id')
  const activity = await queryOne<any>(c.env.DB, `SELECT event_id FROM activities WHERE id = ?`, [id])
  if (activity?.event_id) return c.redirect(`/admin/events/${activity.event_id}`, 302)
  return c.redirect('/admin/events?type=activiteit', 302)
})

// ─── POST API: Create Activity ───────────────────────────────────────────────
// Still used by legacy forms; new form goes through /admin/events/save
app.post('/api/admin/activities/create', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  // Calculate end_at (default +3 hours after start)
  const startDate = new Date(String(body.start_at))
  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)

  const eventRes = await execute(db, `
    INSERT INTO events (titel, type, start_at, end_at, locatie, beschrijving, doelgroep)
    VALUES (?, 'activiteit', ?, ?, ?, ?, 'leden')
  `, [body.titel, body.start_at, endDate.toISOString(), body.locatie, body.intro_text])

  const eventId = eventRes.meta.last_row_id

  await execute(db, `
    INSERT INTO activities (event_id, price_member, price_guest, deadline, max_guests, intro_text, image_url, payment_instruction, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    eventId,
    parseFloat(String(body.price_member || '0')),
    parseFloat(String(body.price_guest || '0')),
    body.deadline || null,
    parseInt(String(body.max_guests || '0')),
    body.intro_text || null,
    body.image_url || null,
    body.payment_instruction || null
  ])

  return c.redirect('/admin/events?type=activiteit')
})

// ─── POST API: Send Invitations ──────────────────────────────────────────────
app.post('/api/admin/activities/send-invites', async (c) => {
  const body = await c.req.parseBody()
  const db = c.env.DB

  const activity = await queryOne<any>(db,
    `SELECT a.*, e.titel FROM activities a JOIN events e ON a.event_id = e.id WHERE a.id = ?`,
    [body.activity_id]
  )
  if (!activity) return c.redirect('/admin/events?type=activiteit')

  // Normalize selected user IDs (string or array)
  const rawIds = body['user_ids[]']
  if (!rawIds) return c.redirect(`/admin/events/${activity.event_id}?error=no_selection`)

  const ids = Array.isArray(rawIds) ? rawIds : [rawIds]
  const placeholders = ids.map(() => '?').join(',')

  const members = await queryAll<any>(db,
    `SELECT u.id, u.email, p.voornaam FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.id IN (${placeholders})`,
    ids
  )

  const siteUrl = c.env.SITE_URL || 'https://animato.be'
  const SAFE_LIMIT = 100
  let count = 0

  for (const member of members.slice(0, SAFE_LIMIT)) {
    const emailHtml = `
      <h1>Uitnodiging: ${activity.titel}</h1>
      <p>Beste ${member.voornaam},</p>
      <p>We nodigen je van harte uit voor <strong>${activity.titel}</strong>!</p>
      <p>${activity.intro_text || 'Kom gezellig meedoen.'}</p>
      <p>
        <a href="${siteUrl}/leden/activiteiten/${activity.id}"
           style="background-color:#00A9CE;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">
          Schrijf je nu in
        </a>
      </p>
      <p>Tot dan,<br>Het Bestuur</p>
    `

    await sendEmail({
      to: member.email,
      subject: `Uitnodiging: ${activity.titel}`,
      html: emailHtml
    }, c.env.RESEND_API_KEY)

    const existing = await queryOne(db,
      `SELECT id FROM activity_invitations WHERE activity_id = ? AND user_id = ?`,
      [activity.id, member.id]
    )

    if (!existing) {
      await execute(db,
        `INSERT INTO activity_invitations (activity_id, user_id, status) VALUES (?, ?, 'sent')`,
        [activity.id, member.id]
      )
    } else {
      await execute(db,
        `UPDATE activity_invitations SET status = 'sent' WHERE id = ?`,
        [(existing as any).id]
      )
    }

    count++
  }

  return c.redirect(`/admin/events/${activity.event_id}?invited=${count}`)
})

// ─── POST API: Update Activity ───────────────────────────────────────────────
app.post('/api/admin/activities/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const db = c.env.DB

  const activity = await queryOne<any>(db, `SELECT event_id FROM activities WHERE id = ?`, [id])
  if (!activity) return c.redirect('/admin/events?type=activiteit')

  const startDate = new Date(String(body.start_at))
  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)

  await execute(db, `
    UPDATE events SET titel=?, start_at=?, end_at=?, locatie=?, beschrijving=? WHERE id=?
  `, [body.titel, body.start_at, endDate.toISOString(), body.locatie, body.intro_text, activity.event_id])

  await execute(db, `
    UPDATE activities
    SET price_member=?, price_guest=?, deadline=?, max_guests=?, intro_text=?, image_url=?, payment_instruction=?
    WHERE id=?
  `, [
    parseFloat(String(body.price_member || '0')),
    parseFloat(String(body.price_guest || '0')),
    body.deadline || null,
    parseInt(String(body.max_guests || '0')),
    body.intro_text || null,
    body.image_url || null,
    body.payment_instruction || null,
    id
  ])

  // Replace custom fields
  await execute(db, `DELETE FROM activity_custom_fields WHERE activity_id = ?`, [id])
  const customFieldsJSON = body.custom_fields_json
  if (customFieldsJSON) {
    const fields = JSON.parse(String(customFieldsJSON))
    for (const [index, field] of fields.entries()) {
      await execute(db, `
        INSERT INTO activity_custom_fields (activity_id, label, field_type, options, is_required, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [id, field.label, field.field_type, field.options, field.is_required ? 1 : 0, index])
    }
  }

  return c.redirect(`/admin/events/${activity.event_id}`)
})

export default app
