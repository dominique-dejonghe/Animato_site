// Kaartkoper-portaal
// ------------------
// Routes:
//   GET  /account/setup?token=...     → magic-link landing → wachtwoord instellen
//   POST /account/setup                → submit nieuw wachtwoord → log in → /mijn-tickets
//   GET  /mijn-tickets                 → alias-redirect naar /leden/mijn-tickets
//   GET  /profiel                      → vereenvoudigd kaartkoper-profiel
//   POST /api/profiel                  → kaartkoper-profiel updaten
//
// Toelichting:
// - /mijn-tickets is een ALIAS naar /leden/mijn-tickets om de UI voor kaartkopers
//   "normaal" te laten aanvoelen (geen /leden/ prefix). De onderliggende code in
//   leden-tickets.tsx werkt voor beide rollen (requireAuth, geen requireLid).
// - /account/setup gebruikt GEEN requireAuth — de token IS het auth-mechanisme.

import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, execute } from '../utils/db'
import { hashPassword, generateToken } from '../utils/auth'
import { formatBrusselsDateTime } from '../utils/time'

const app = new Hono<{ Bindings: Bindings }>()

// ═══════════════════════════════════════════════════════════
// /mijn-tickets — alias-redirect naar /leden/mijn-tickets
// ═══════════════════════════════════════════════════════════
// Zowel leden als kaartkopers zien hier hun ticketgeschiedenis.
// De onderliggende route /leden/mijn-tickets gebruikt requireAuth (niet requireLid)
// → werkt voor beide rollen.
app.get('/mijn-tickets', (c) => c.redirect('/leden/mijn-tickets', 302))
app.get('/mijn-tickets/:rest{.*}', (c) => {
  const rest = c.req.param('rest')
  return c.redirect('/leden/mijn-tickets/' + rest, 302)
})

// ═══════════════════════════════════════════════════════════
// /account/setup — magic-link wachtwoord instellen
// ═══════════════════════════════════════════════════════════
app.get('/account/setup', async (c) => {
  const token = c.req.query('token') || ''
  if (!token) {
    return c.html(renderSetupError('Ongeldige link', 'De link bevat geen token. Vraag een nieuwe link aan via je bevestigingsmail.'))
  }

  const user = await queryOne<any>(c.env.DB,
    `SELECT id, email, account_setup_token_expires, account_setup_completed
       FROM users
      WHERE account_setup_token = ?`,
    [token])

  if (!user) {
    return c.html(renderSetupError('Onbekende link', 'Deze link is niet (meer) geldig. Mogelijk werd hij al gebruikt.'))
  }

  if (user.account_setup_completed) {
    return c.html(renderSetupError('Account al actief',
      'Je hebt deze link al gebruikt en je account is al geactiveerd. Log gewoon in met je e-mail en wachtwoord.',
      '/login'))
  }

  if (user.account_setup_token_expires && new Date(user.account_setup_token_expires) < new Date()) {
    return c.html(renderSetupError('Link verlopen', 'Deze link is meer dan 14 dagen oud. Neem contact op met tickets@animato.be voor een nieuwe.'))
  }

  // Toon wachtwoord-formulier
  return c.html(`<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Account activeren — Animato</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 p-4">
<div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
  <div class="text-center mb-6">
    <i class="fas fa-ticket-alt text-5xl text-blue-500 mb-3"></i>
    <h1 class="text-2xl font-bold text-gray-800">Activeer je account</h1>
    <p class="text-sm text-gray-600 mt-2">Welkom! Stel een wachtwoord in om je tickets te beheren.</p>
    <p class="text-xs text-gray-500 mt-1">Voor <strong>${escapeHtml(user.email)}</strong></p>
  </div>
  <form method="POST" action="/account/setup" class="space-y-4">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">Nieuw wachtwoord</label>
      <input type="password" name="password" required minlength="8" autocomplete="new-password"
        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder="Minimum 8 tekens">
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">Bevestig wachtwoord</label>
      <input type="password" name="password_confirm" required minlength="8" autocomplete="new-password"
        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder="Herhaal je wachtwoord">
    </div>
    <button type="submit"
      class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg shadow transition">
      <i class="fas fa-check-circle mr-2"></i>Account activeren
    </button>
  </form>
  <p class="text-xs text-gray-500 mt-6 text-center">
    Door verder te gaan ga je akkoord met onze voorwaarden. Je gegevens worden enkel gebruikt voor je tickets en je profiel.
  </p>
</div>
</body></html>`)
})

app.post('/account/setup', async (c) => {
  let token = ''
  let password = ''
  let passwordConfirm = ''

  const ct = c.req.header('Content-Type') || ''
  if (ct.includes('application/json')) {
    const body = await c.req.json().catch(() => ({} as any))
    token = String(body.token || '')
    password = String(body.password || '')
    passwordConfirm = String(body.password_confirm || '')
  } else {
    const form = await c.req.parseBody()
    token = String((form as any).token || '')
    password = String((form as any).password || '')
    passwordConfirm = String((form as any).password_confirm || '')
  }

  if (!token) return c.html(renderSetupError('Ongeldige link', 'Geen token meegegeven.'))
  if (!password || password.length < 8) {
    return c.html(renderSetupError('Te kort wachtwoord', 'Wachtwoord moet minimaal 8 tekens lang zijn.', `/account/setup?token=${encodeURIComponent(token)}`))
  }
  if (password !== passwordConfirm) {
    return c.html(renderSetupError('Wachtwoorden komen niet overeen', 'Probeer opnieuw.', `/account/setup?token=${encodeURIComponent(token)}`))
  }

  const user = await queryOne<any>(c.env.DB,
    `SELECT id, email, role, stemgroep, account_setup_token_expires, account_setup_completed
       FROM users WHERE account_setup_token = ?`,
    [token])

  if (!user) return c.html(renderSetupError('Onbekende link', 'Deze link is niet (meer) geldig.'))
  if (user.account_setup_completed) {
    return c.html(renderSetupError('Account al actief',
      'Deze link is al gebruikt. Log in met je e-mail en wachtwoord.', '/login'))
  }
  if (user.account_setup_token_expires && new Date(user.account_setup_token_expires) < new Date()) {
    return c.html(renderSetupError('Link verlopen', 'Vraag een nieuwe link via tickets@animato.be.'))
  }

  // Wachtwoord hashen en opslaan, token invalideren, account markeren als compleet
  const hash = await hashPassword(password)
  await execute(c.env.DB, `
    UPDATE users
       SET password_hash = ?,
           account_setup_token = NULL,
           account_setup_token_expires = NULL,
           account_setup_completed = 1,
           email_verified = 1,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [hash, user.id])

  // Audit
  await execute(c.env.DB,
    `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
     VALUES (?, 'kaartkoper_account_activated', 'users', ?, ?)`,
    [user.id, user.id, JSON.stringify({ email: user.email })])

  // Sessie aanmaken via JWT-cookie (consistent met /api/auth/login)
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    stemgroep: user.stemgroep,
    voornaam: '',
    achternaam: '',
    is_bestuurslid: 0
  }
  const jwt = await generateToken(sessionUser, c.env.JWT_SECRET, '7d')
  setCookie(c, 'auth_token', jwt, {
    maxAge: 7 * 24 * 60 * 60,
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/'
  })

  // Welkomstpagina (geen rauwe redirect — kleine bevestiging)
  return c.html(`<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Account geactiveerd — Animato</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<meta http-equiv="refresh" content="3;url=/mijn-tickets">
</head>
<body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 p-4">
<div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
  <i class="fas fa-check-circle text-green-500 text-6xl mb-4"></i>
  <h1 class="text-2xl font-bold text-gray-800 mb-2">Account geactiveerd!</h1>
  <p class="text-gray-600 mb-6">Je wordt doorgestuurd naar je tickets...</p>
  <a href="/mijn-tickets" class="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition">
    <i class="fas fa-ticket-alt mr-2"></i>Naar mijn tickets
  </a>
</div>
</body></html>`)
})

// ═══════════════════════════════════════════════════════════
// /profiel — vereenvoudigd profiel voor kaartkopers (en redirect voor leden)
// ═══════════════════════════════════════════════════════════
app.get('/profiel', requireAuth, async (c) => {
  const user = c.get('user') as SessionUser

  // Leden hebben hun eigen, uitgebreide profielpagina onder /leden — daarheen.
  if (user.role !== 'kaartkoper') {
    return c.redirect('/leden/profiel', 302)
  }

  // Kaartkoper: vereenvoudigd profiel
  const profile = await queryOne<any>(c.env.DB,
    `SELECT voornaam, achternaam, telefoon FROM profiles WHERE user_id = ?`,
    [user.id])

  return c.html(
    <Layout title="Mijn Profiel — Animato" user={user as any}>
      <div class="max-w-2xl mx-auto px-4 py-12">
        <div class="bg-white rounded-2xl shadow-md p-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">
            <i class="fas fa-user-circle mr-3 text-blue-500"></i>Mijn Profiel
          </h1>
          <p class="text-gray-600 mb-8">Beheer hier je contactgegevens. Deze worden gebruikt voor je tickets en eventuele communicatie rond je bestellingen.</p>

          <form method="POST" action="/api/profiel" class="space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
              <input type="email" value={user.email} disabled
                class="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600" />
              <p class="text-xs text-gray-500 mt-1">E-mail kan niet gewijzigd worden. Neem contact op met tickets@animato.be indien nodig.</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Voornaam</label>
                <input type="text" name="voornaam" required defaultValue={profile?.voornaam || ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Achternaam</label>
                <input type="text" name="achternaam" required defaultValue={profile?.achternaam || ''}
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Telefoon <span class="text-gray-400 text-xs">(optioneel)</span></label>
              <input type="tel" name="telefoon" defaultValue={profile?.telefoon || ''}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="+32 ..." />
            </div>

            <hr class="my-6" />
            <h2 class="text-lg font-bold text-gray-800">Wachtwoord wijzigen</h2>
            <p class="text-sm text-gray-500">Laat leeg om je huidige wachtwoord te behouden.</p>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nieuw wachtwoord</label>
              <input type="password" name="new_password" minlength={8} autocomplete="new-password"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Minimum 8 tekens" />
            </div>

            <div class="flex gap-3 pt-4">
              <button type="submit"
                class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg shadow">
                <i class="fas fa-save mr-2"></i>Opslaan
              </button>
              <a href="/mijn-tickets"
                class="px-6 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg">
                Annuleer
              </a>
            </div>
          </form>
        </div>
      </div>
    </Layout> as any
  )
})

app.post('/api/profiel', requireAuth, async (c) => {
  const user = c.get('user') as SessionUser
  // Enkel voor kaartkopers via deze route — leden gebruiken /leden/profiel
  if (user.role !== 'kaartkoper') {
    return c.json({ error: 'Gebruik /leden/profiel voor je profiel' }, 400)
  }

  let voornaam = '', achternaam = '', telefoon = '', new_password = ''
  const ct = c.req.header('Content-Type') || ''
  if (ct.includes('application/json')) {
    const b = await c.req.json().catch(() => ({} as any))
    voornaam = String(b.voornaam || '').trim()
    achternaam = String(b.achternaam || '').trim()
    telefoon = String(b.telefoon || '').trim()
    new_password = String(b.new_password || '')
  } else {
    const f = await c.req.parseBody()
    voornaam = String((f as any).voornaam || '').trim()
    achternaam = String((f as any).achternaam || '').trim()
    telefoon = String((f as any).telefoon || '').trim()
    new_password = String((f as any).new_password || '')
  }

  if (!voornaam || !achternaam) {
    return c.html(renderSetupError('Onvolledig', 'Voor- en achternaam zijn verplicht.', '/profiel'))
  }

  // Profile upsert
  const existing = await queryOne<any>(c.env.DB, `SELECT id FROM profiles WHERE user_id = ?`, [user.id])
  if (existing) {
    await execute(c.env.DB,
      `UPDATE profiles SET voornaam = ?, achternaam = ?, telefoon = ? WHERE user_id = ?`,
      [voornaam, achternaam, telefoon || null, user.id])
  } else {
    await execute(c.env.DB,
      `INSERT INTO profiles (user_id, voornaam, achternaam, telefoon) VALUES (?, ?, ?, ?)`,
      [user.id, voornaam, achternaam, telefoon || null])
  }

  if (new_password) {
    if (new_password.length < 8) {
      return c.html(renderSetupError('Te kort wachtwoord', 'Wachtwoord moet minimaal 8 tekens lang zijn.', '/profiel'))
    }
    const hash = await hashPassword(new_password)
    await execute(c.env.DB, `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hash, user.id])
  }

  return c.redirect('/profiel?saved=1', 302)
})

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════
function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

function renderSetupError(title: string, message: string, retryUrl?: string): string {
  const button = retryUrl
    ? `<a href="${retryUrl}" class="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">Opnieuw proberen</a>`
    : `<a href="/" class="inline-block px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium">Naar de homepage</a>`
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Animato</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
<div class="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
  <i class="fas fa-exclamation-triangle text-amber-500 text-5xl mb-4"></i>
  <h1 class="text-2xl font-bold text-gray-800 mb-2">${escapeHtml(title)}</h1>
  <p class="text-gray-600 mb-6">${escapeHtml(message)}</p>
  ${button}
</div>
</body></html>`
}

export default app
