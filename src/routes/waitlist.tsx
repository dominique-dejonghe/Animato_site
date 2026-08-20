// Wachtlijst routes: publieke inschrijving + admin overzicht/beheer.
// Publiek endpoint POST /api/waitlist/:concertId is bewust zonder auth: laag drempel,
// wel rate-limited op email+concert (max 1 inschrijving per uur voor dezelfde email).

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { queryOne, queryAll, execute } from '../utils/db'
import { sendEmail } from '../utils/email'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { formatBrusselsDate, formatBrusselsDateTime } from '../utils/time'
import { getSiteUrl } from '../utils/site-url'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// PUBLIC POST /api/waitlist/:concertId — wachtlijst-inschrijving
// =====================================================
app.post('/api/waitlist/:concertId', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  if (!concertId || Number.isNaN(concertId)) {
    return c.json({ error: 'Ongeldig concert' }, 400)
  }

  // Concert moet bestaan én wachtlijst moet ingeschakeld zijn
  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.id, c.waitlist_enabled, c.uitverkocht, e.titel, e.start_at
    FROM concerts c JOIN events e ON e.id = c.event_id
    WHERE c.id = ?`, [concertId])

  if (!concert) return c.json({ error: 'Concert niet gevonden' }, 404)
  if (concert.waitlist_enabled != 1) {
    return c.json({ error: 'Wachtlijst niet ingeschakeld voor dit concert' }, 400)
  }

  const body = await c.req.parseBody()
  const naam = String(body.naam || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const telefoon = String(body.telefoon || '').trim() || null
  const aantalRaw = parseInt(String(body.aantal_gewenst || '1'))
  const aantal = Math.min(Math.max(1, aantalRaw || 1), 20)
  const notities = String(body.notities || '').trim() || null

  if (!naam || naam.length < 2) return c.json({ error: 'Vul je naam in' }, 400)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Ongeldig e-mailadres' }, 400)
  }

  // Rate-limit: max 1 inschrijving per uur per (email, concert) — voorkomt bots
  const recent = await queryOne<any>(c.env.DB, `
    SELECT id FROM concert_waitlist
    WHERE concert_id = ? AND LOWER(email) = ?
      AND datetime(created_at) > datetime('now', '-1 hour')
    LIMIT 1`, [concertId, email])
  if (recent) {
    return c.json({ error: 'Je staat al op de wachtlijst — we contacteren je zodra er nieuws is.' }, 409)
  }

  try {
    await execute(c.env.DB, `
      INSERT INTO concert_waitlist (concert_id, naam, email, telefoon, aantal_gewenst, notities)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [concertId, naam, email, telefoon, aantal, notities])
  } catch (e: any) {
    console.error('[waitlist] insert failed:', e?.message)
    return c.json({ error: 'Opslaan mislukt' }, 500)
  }

  // Best-effort: bevestigingsmail naar inschrijver + admin-notif
  const siteUrl = await getSiteUrl(c)
  try {
    const concertDatumFmt = formatBrusselsDate(concert.start_at, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
    await sendEmail({
      to: email,
      subject: `✅ Je staat op de wachtlijst voor "${concert.titel}"`,
      html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;margin:0;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:#d97706;padding:24px;color:#fff;">
            <h1 style="margin:0;font-size:22px;">⏳ Wachtlijst bevestigd</h1>
            <p style="margin:6px 0 0;opacity:0.9;font-size:14px;">${concert.titel}</p>
          </td></tr>
          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px;">Hoi ${naam.split(' ')[0] || naam},</p>
            <p style="margin:0 0 16px;">Bedankt om je in te schrijven op de wachtlijst voor <strong>${concert.titel}</strong> op ${concertDatumFmt}.</p>
            <p style="margin:0 0 16px;">
              We hebben genoteerd dat je <strong>${aantal} kaart${aantal === 1 ? '' : 'en'}</strong>
              zou willen. Zodra er plaats vrijkomt of we een extra concert-datum
              plannen, mailen we je op <strong>${email}</strong>${telefoon ? ` of bellen we ${telefoon}` : ''}.
            </p>
            <p style="margin:24px 0 0;color:#666;font-size:13px;">
              Vragen? Antwoord gewoon op deze e-mail — dan bereik je ons rechtstreeks.
            </p>
          </td></tr>
        </table>
      </body></html>`
    }, c.env.RESEND_API_KEY)
  } catch (e: any) {
    console.warn('[waitlist] bevestigingsmail mislukt (non-fatal):', e?.message)
  }

  // Admin notificatie — herhaalt hetzelfde patroon als ticket-sale notif
  try {
    const admins = await queryAll<any>(c.env.DB, `
      SELECT u.email, p.voornaam FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'actief' AND COALESCE(u.is_test_account, 0) = 0
        AND (u.role = 'admin' OR u.is_bestuurslid = 1)
        AND COALESCE(u.notify_ticket_sales, 1) = 1
        AND u.email IS NOT NULL AND u.email != ''`)
    for (const a of admins) {
      await sendEmail({
        to: a.email,
        subject: `⏳ Nieuwe wachtlijst-inschrijving: ${concert.titel}`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;">
          <p>Hoi ${a.voornaam || 'admin'},</p>
          <p>Er staat een nieuwe naam op de wachtlijst voor <strong>${concert.titel}</strong>:</p>
          <ul>
            <li><strong>${naam}</strong></li>
            <li>📧 ${email}</li>
            ${telefoon ? `<li>📞 ${telefoon}</li>` : ''}
            <li>Aantal gewenst: <strong>${aantal}</strong></li>
            ${notities ? `<li>Notities: ${notities}</li>` : ''}
          </ul>
          <p><a href="${siteUrl}/admin/tickets/concert/${concertId}/waitlist">📋 Bekijk volledige wachtlijst</a></p>
        </body></html>`
      }, c.env.RESEND_API_KEY)
    }
  } catch (e: any) {
    console.warn('[waitlist] admin notif mislukt (non-fatal):', e?.message)
  }

  return c.json({ success: true })
})

// =====================================================
// ADMIN: /admin/tickets/concert/:concertId/waitlist — overzicht
// =====================================================
app.get('/admin/tickets/concert/:concertId/waitlist', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  if (!concertId || Number.isNaN(concertId)) {
    return c.html(<Layout title="Ongeldig" user={user}><div>Ongeldig concert-ID</div></Layout>)
  }

  const concert = await queryOne<any>(c.env.DB, `
    SELECT c.id, c.uitverkocht, c.waitlist_enabled, e.titel, e.start_at
    FROM concerts c JOIN events e ON e.id = c.event_id WHERE c.id = ?`, [concertId])
  if (!concert) {
    return c.html(<Layout title="Niet gevonden" user={user}><div>Concert niet gevonden</div></Layout>)
  }

  const entries = await queryAll<any>(c.env.DB, `
    SELECT id, naam, email, telefoon, aantal_gewenst, notities, status,
           notified_at, admin_notes, created_at
    FROM concert_waitlist WHERE concert_id = ?
    ORDER BY created_at DESC`, [concertId])

  // Aggregaten voor de header
  const totalPeople = entries.length
  const totalSeatsWanted = entries.reduce((s: number, e: any) => s + (Number(e.aantal_gewenst) || 0), 0)
  const wachtend = entries.filter((e: any) => e.status === 'wachtend').length

  return c.html(
    <Layout title={`Wachtlijst — ${concert.titel}`} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="tickets" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <main class="flex-1 p-6 md:p-8">
          <div class="max-w-6xl mx-auto">
            <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div>
                <a href={`/admin/tickets/concert/${concertId}/orders`}
                   class="text-sm text-animato-primary hover:underline">
                  <i class="fas fa-arrow-left mr-1"></i> Terug naar orders
                </a>
                <h1 class="text-3xl font-bold text-gray-900 mt-1">
                  <i class="fas fa-hourglass-half text-amber-500 mr-2"></i>
                  Wachtlijst
                </h1>
                <p class="text-gray-600 mt-1">{concert.titel} — {formatBrusselsDateTime(concert.start_at)}</p>
              </div>
              <a href={`/admin/tickets/concert/${concertId}/waitlist/export.csv`}
                 class="inline-flex items-center bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-animato-secondary shadow-sm">
                <i class="fas fa-download mr-2"></i> Export CSV
              </a>
            </div>

            {/* Summary */}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Inschrijvingen</div>
                <div class="text-3xl font-bold text-gray-900">{totalPeople}</div>
                <div class="text-xs text-gray-500 mt-1">personen op de lijst</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Gewenste stoelen</div>
                <div class="text-3xl font-bold text-amber-600">{totalSeatsWanted}</div>
                <div class="text-xs text-gray-500 mt-1">totaal gevraagd</div>
              </div>
              <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Nog niet gecontacteerd</div>
                <div class="text-3xl font-bold text-red-600">{wachtend}</div>
                <div class="text-xs text-gray-500 mt-1">status = wachtend</div>
              </div>
            </div>

            {concert.waitlist_enabled != 1 && (
              <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
                <p class="text-amber-900 text-sm">
                  <i class="fas fa-info-circle mr-1"></i>
                  Wachtlijst is momenteel <strong>uitgeschakeld</strong> voor dit concert.
                  Bezoekers zien geen inschrijfformulier meer op de publieke pagina.
                  Bestaande inschrijvingen blijven wel bewaard.
                  <a href={`/admin/tickets/concert/${concertId}/settings`} class="underline ml-1">Inschakelen in instellingen</a>
                </p>
              </div>
            )}

            {/* Lijst */}
            {entries.length === 0 ? (
              <div class="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                <i class="fas fa-hourglass-half text-4xl mb-3 text-gray-300"></i>
                <p>Nog geen inschrijvingen op de wachtlijst.</p>
              </div>
            ) : (
              <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="w-full text-sm">
                  <thead class="bg-gray-100 text-xs uppercase text-gray-600">
                    <tr>
                      <th class="px-3 py-2 text-left">Datum</th>
                      <th class="px-3 py-2 text-left">Naam</th>
                      <th class="px-3 py-2 text-left">Contact</th>
                      <th class="px-3 py-2 text-center">#</th>
                      <th class="px-3 py-2 text-left">Notities</th>
                      <th class="px-3 py-2 text-center">Status</th>
                      <th class="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e: any) => (
                      <tr class="border-t border-gray-100 hover:bg-gray-50">
                        <td class="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                          {formatBrusselsDate(e.created_at, { day: '2-digit', month: 'short' })}
                        </td>
                        <td class="px-3 py-2 font-medium text-gray-900">{e.naam}</td>
                        <td class="px-3 py-2">
                          <a href={`mailto:${e.email}`} class="text-animato-primary hover:underline block text-xs">{e.email}</a>
                          {e.telefoon && <a href={`tel:${e.telefoon}`} class="text-gray-600 text-xs block">{e.telefoon}</a>}
                        </td>
                        <td class="px-3 py-2 text-center font-semibold">{e.aantal_gewenst}</td>
                        <td class="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">{e.notities || '—'}</td>
                        <td class="px-3 py-2 text-center">
                          <form method="POST" action={`/admin/tickets/concert/${concertId}/waitlist/${e.id}/status`} class="inline">
                            <select name="status"
                                    onchange="this.form.submit()"
                                    class={`text-xs rounded-md border px-2 py-1 ${
                                      e.status === 'wachtend' ? 'bg-red-50 border-red-200 text-red-800' :
                                      e.status === 'gecontacteerd' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                      e.status === 'geboekt' ? 'bg-green-50 border-green-200 text-green-800' :
                                      'bg-gray-50 border-gray-200 text-gray-600'
                                    }`}>
                              <option value="wachtend" selected={e.status === 'wachtend'}>Wachtend</option>
                              <option value="gecontacteerd" selected={e.status === 'gecontacteerd'}>Gecontacteerd</option>
                              <option value="geboekt" selected={e.status === 'geboekt'}>Geboekt</option>
                              <option value="afgemeld" selected={e.status === 'afgemeld'}>Afgemeld</option>
                            </select>
                          </form>
                        </td>
                        <td class="px-3 py-2 text-right">
                          <form method="POST" action={`/admin/tickets/concert/${concertId}/waitlist/${e.id}/delete`} class="inline"
                                onsubmit="return confirm('Deze wachtlijst-inschrijving definitief verwijderen?')">
                            <button type="submit" class="text-red-500 hover:text-red-700 text-xs" title="Verwijderen">
                              <i class="fas fa-trash"></i>
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </Layout>
  )
})

// Status update
app.post('/admin/tickets/concert/:concertId/waitlist/:id/status', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const id = parseInt(c.req.param('id'))
  const body = await c.req.parseBody()
  const status = String(body.status || 'wachtend')
  const allowed = ['wachtend', 'gecontacteerd', 'geboekt', 'afgemeld']
  if (!allowed.includes(status)) {
    return c.redirect(`/admin/tickets/concert/${concertId}/waitlist`)
  }
  await execute(c.env.DB, `
    UPDATE concert_waitlist SET
      status = ?,
      notified_at = CASE WHEN ? IN ('gecontacteerd', 'geboekt') AND notified_at IS NULL THEN CURRENT_TIMESTAMP ELSE notified_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND concert_id = ?`,
    [status, status, id, concertId])
  return c.redirect(`/admin/tickets/concert/${concertId}/waitlist`)
})

// Delete
app.post('/admin/tickets/concert/:concertId/waitlist/:id/delete', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const id = parseInt(c.req.param('id'))
  await execute(c.env.DB, `DELETE FROM concert_waitlist WHERE id = ? AND concert_id = ?`, [id, concertId])
  return c.redirect(`/admin/tickets/concert/${concertId}/waitlist`)
})

// CSV export
app.get('/admin/tickets/concert/:concertId/waitlist/export.csv', async (c) => {
  const concertId = parseInt(c.req.param('concertId'))
  const concert = await queryOne<any>(c.env.DB, `SELECT e.titel FROM concerts c JOIN events e ON e.id = c.event_id WHERE c.id = ?`, [concertId])
  const rows = await queryAll<any>(c.env.DB, `
    SELECT naam, email, telefoon, aantal_gewenst, notities, status, created_at
    FROM concert_waitlist WHERE concert_id = ? ORDER BY created_at DESC`, [concertId])

  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const header = 'Naam;Email;Telefoon;Aantal gewenst;Notities;Status;Ingeschreven op\n'
  const body = rows.map((r: any) => [r.naam, r.email, r.telefoon, r.aantal_gewenst, r.notities, r.status, r.created_at].map(esc).join(';')).join('\n')
  const csv = '\uFEFF' + header + body  // BOM voor Excel
  const filename = `wachtlijst-${(concert?.titel || 'concert').replace(/[^a-z0-9]/gi, '_')}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  })
})

export default app
