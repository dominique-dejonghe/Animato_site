// =====================================================
// NIEUWE-LID AANKONDIGINGEN
// =====================================================
//
// API endpoints voor de "Hey, Rudy is erbij!" popup die ingelogde
// koorleden zien op /leden. Werkt samen met migratie 0083:
// member_announcement_seen.
//
// Endpoints:
//   GET  /api/leden/new-members        \u2192 ongelezen nieuwe leden van laatste 14 dagen
//   POST /api/leden/new-members/mark-seen \u2192 markeer alle als gezien
//
// Beide vereisen auth. Bedoeld om door /leden front-end aangeroepen
// te worden via fetch().

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { requireAuth } from '../middleware/auth'
import { queryAll, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/leden/new-members', requireAuth)
app.use('/api/leden/new-members/*', requireAuth)

// =====================================================
// GET /api/leden/new-members
// =====================================================
// Returnt array van nieuwe koorleden die de huidige user nog niet
// heeft gezien in de popup, gelimiteerd tot laatste 14 dagen.
// Sorteert nieuwste eerst.

app.get('/api/leden/new-members', async (c) => {
  const user = c.get('user') as SessionUser

  // Iedereen mag aankondigingen zien (lid, dirigent, admin, moderator, bestuur)
  // Behalve aanvragers (role='aanvrager') en gasten \u2014 die zijn niet relevant
  if (user.role === 'aanvrager') {
    return c.json({ items: [] })
  }

  // Stemgroep-label voor leesbaarheid in front-end
  const stemgroepLabel = (code: string | null): string => {
    switch (code) {
      case 'S': return 'sopraan'
      case 'A': return 'alt'
      case 'T': return 'tenor'
      case 'B': return 'bas'
      default: return ''
    }
  }

  // Query: alle leden met role='lid', toegevoegd binnen laatste 14 dagen,
  // die NIET in member_announcement_seen staan voor deze viewer.
  // Sluit altijd de viewer zelf uit (zien jezelf niet als nieuw lid).
  const rows = await queryAll<{
    id: number
    voornaam: string
    achternaam: string
    stemgroep: string | null
    foto_url: string | null
    created_at: string
  }>(
    c.env.DB,
    `SELECT u.id, p.voornaam, p.achternaam, u.stemgroep, p.foto_url, u.created_at
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     WHERE u.role = 'lid'
       AND u.id != ?
       AND date(u.created_at) >= date('now', '-14 days')
       AND NOT EXISTS (
         SELECT 1 FROM member_announcement_seen mas
         WHERE mas.viewer_user_id = ?
           AND mas.new_member_user_id = u.id
       )
     ORDER BY u.created_at DESC`,
    [user.id, user.id]
  )

  const items = rows.map(r => ({
    id: r.id,
    voornaam: r.voornaam,
    achternaam: r.achternaam,
    fullname: `${r.voornaam} ${r.achternaam}`.trim(),
    stemgroep: r.stemgroep,
    stemgroep_label: stemgroepLabel(r.stemgroep),
    foto_url: r.foto_url,
    created_at: r.created_at,
  }))

  return c.json({ items, count: items.length })
})

// =====================================================
// POST /api/leden/new-members/mark-seen
// =====================================================
// Markeert opgegeven nieuw-lid-IDs als gezien voor de huidige viewer.
// Front-end roept deze aan wanneer de popup wordt gesloten.
// Body: { ids: number[] }

app.post('/api/leden/new-members/mark-seen', async (c) => {
  const user = c.get('user') as SessionUser

  let body: { ids?: number[] } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(i => Number.isInteger(i)) : []
  if (ids.length === 0) {
    return c.json({ marked: 0 })
  }

  // INSERT OR IGNORE: idempotent, bij dubbel-klik geen error
  // Bouw multi-row insert voor efficiency
  const placeholders = ids.map(() => '(?, ?)').join(', ')
  const params: (number | string)[] = []
  for (const id of ids) {
    params.push(user.id, id)
  }

  await execute(
    c.env.DB,
    `INSERT OR IGNORE INTO member_announcement_seen (viewer_user_id, new_member_user_id)
     VALUES ${placeholders}`,
    params
  )

  return c.json({ marked: ids.length })
})

export default app
