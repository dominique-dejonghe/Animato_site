// ────────────────────────────────────────────────────────────────────────────
// requireTicketScanner — middleware voor de QR-scanner routes.
//
// Toegang voor:
//   1. admin / moderator (volle admin-rechten)
//   2. bestuurslid (is_bestuurslid = 1)
//   3. user met can_scan_tickets = 1 (vinkje op /admin/leden/:id)
//
// De can_scan_tickets-vlag wordt NIET in JWT bijgehouden (anders moeten we
// elke toekenning expliciet uitloggen om te activeren). In plaats daarvan
// halen we de actuele waarde op uit users-tabel bij elke scanner-request —
// dat is goedkoop genoeg (één SELECT, geen joins).
// ────────────────────────────────────────────────────────────────────────────

import { Context, Next } from 'hono'
import type { Bindings, SessionUser } from '../types'

export async function requireTicketScanner(
  c: Context<{ Bindings: Bindings }>,
  next: Next
) {
  const user = c.get('user') as SessionUser | undefined

  if (!user) {
    return c.json({ error: 'Niet ingelogd' }, 401)
  }

  // Snel-pad: admin/moderator/bestuurslid — geen DB-call nodig
  if (user.role === 'admin' || user.role === 'moderator' || user.is_bestuurslid) {
    await next()
    return
  }

  // Anders: checken of can_scan_tickets gezet is in de DB
  try {
    const row = await c.env.DB.prepare(
      'SELECT can_scan_tickets FROM users WHERE id = ?'
    ).bind(user.id).first<{ can_scan_tickets: number | null }>()

    if (row && row.can_scan_tickets) {
      // Extra metadata op de user-context zodat downstream code kan kijken
      ;(user as any).can_scan_tickets = 1
      c.set('user', user)
      await next()
      return
    }
  } catch (e) {
    console.warn('[requireTicketScanner] DB-check faalde:', e)
  }

  // 403 — vriendelijk voor browsers, JSON voor API-calls
  const path = c.req.path
  const wantsHtml = (c.req.header('Accept') || '').includes('text/html')
                    && !path.startsWith('/api/')
  if (wantsHtml) {
    return c.html(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Geen toegang</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      </head>
      <body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <i class="fas fa-camera-retro text-teal-400 text-5xl mb-4"></i>
          <h1 class="text-2xl font-bold text-gray-800 mb-2">Geen scan-rechten</h1>
          <p class="text-gray-600 mb-6">De QR-scanner is enkel toegankelijk voor admins, bestuursleden en uitgenodigde scanners. Vraag een bestuurslid om je scan-rechten te geven.</p>
          <a href="/" class="inline-block bg-animato-primary text-white px-6 py-2 rounded-lg hover:bg-animato-secondary">Naar startpagina</a>
        </div>
      </body></html>`, 403)
  }

  return c.json({ error: 'Geen scan-rechten' }, 403)
}
