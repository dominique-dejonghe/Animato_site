// API routes
// ICS export, Word Lid submission, etc.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { queryOne, queryAll, execute, isValidEmail, isValidPhone, formatDateForDB, safeJsonStringify } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// ICS EXPORT - Single Event
// =====================================================

app.get('/api/agenda/ics', async (c) => {
  const eventId = c.req.query('event')

  if (!eventId) {
    return c.text('Missing event parameter', 400)
  }

  // Get event
  const event = await queryOne<any>(
    c.env.DB,
    'SELECT * FROM events WHERE id = ?',
    [eventId]
  )

  if (!event) {
    return c.text('Event not found', 404)
  }

  // Generate ICS content
  const startDate = new Date(event.start_at)
  const endDate = new Date(event.end_at)
  
  const formatICSDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gemengd Koor Animato//NONSGML Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Animato Agenda',
    'X-WR-TIMEZONE:Europe/Brussels',
    'BEGIN:VEVENT',
    `UID:${event.ics_uid || `event-${event.id}@animato.be`}`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:${event.titel}`,
    event.beschrijving ? `DESCRIPTION:${event.beschrijving.replace(/\n/g, '\\n')}` : '',
    `LOCATION:${event.locatie}${event.adres ? ', ' + event.adres : ''}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n')

  return c.text(icsContent, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="animato-${event.slug || event.id}.ics"`
  })
})

// =====================================================
// ICS EXPORT - All Public Events
// =====================================================

app.get('/api/agenda/ics/all', async (c) => {
  // Get all public upcoming events
  const events = await queryAll<any>(
    c.env.DB,
    `SELECT * FROM events 
     WHERE is_publiek = 1 AND start_at >= datetime('now')
     ORDER BY start_at ASC
     LIMIT 100`
  )

  const formatICSDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const vcalendarHeader = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gemengd Koor Animato//NONSGML Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Animato Agenda',
    'X-WR-TIMEZONE:Europe/Brussels'
  ]

  const vevents = events.map((event: any) => {
    const startDate = new Date(event.start_at)
    const endDate = new Date(event.end_at)

    return [
      'BEGIN:VEVENT',
      `UID:${event.ics_uid || `event-${event.id}@animato.be`}`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${event.titel}`,
      event.beschrijving ? `DESCRIPTION:${event.beschrijving.replace(/\n/g, '\\n')}` : '',
      `LOCATION:${event.locatie}${event.adres ? ', ' + event.adres : ''}`,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT'
    ].filter(Boolean).join('\r\n')
  })

  const icsContent = [
    ...vcalendarHeader,
    ...vevents,
    'END:VCALENDAR'
  ].join('\r\n')

  return c.text(icsContent, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="animato-agenda.ics"'
  })
})

// =====================================================
// WORD LID SUBMISSION
// =====================================================

app.post('/api/word-lid', async (c) => {
  try {
    const body = await c.req.parseBody()

    const voornaam = body.voornaam as string
    const achternaam = body.achternaam as string
    const email = (body.email as string).toLowerCase()
    const telefoon = body.telefoon as string
    const stemgroep = body.stemgroep as string
    const muzikale_ervaring = body.muzikale_ervaring as string
    const motivatie = body.motivatie as string
    const consent = body.consent === 'on'

    // Validation — telefoon is optional
    if (!voornaam || !achternaam || !email || !stemgroep || !consent) {
      return c.redirect('/word-lid?error=required')
    }

    if (!isValidEmail(email)) {
      return c.redirect('/word-lid?error=invalid_email')
    }

    if (telefoon && !isValidPhone(telefoon)) {
      return c.redirect('/word-lid?error=invalid_phone')
    }

    // Check if email already registered
    const existingUser = await queryOne(
      c.env.DB,
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE',
      [email]
    )

    if (existingUser) {
      return c.redirect('/word-lid?error=email_exists')
    }

    // Check if submission already exists (prevent duplicates)
    const existingSubmission = await queryOne(
      c.env.DB,
      `SELECT id FROM form_submissions 
       WHERE type = 'word_lid' 
         AND email = ? COLLATE NOCASE 
         AND status = 'nieuw'`,
      [email]
    )

    if (existingSubmission) {
      return c.redirect('/word-lid?error=duplicate')
    }

    // Store submission
    const payload = {
      voornaam,
      achternaam,
      email,
      telefoon,
      stemgroep,
      muzikale_ervaring: muzikale_ervaring || null,
      motivatie: motivatie || null,
      submitted_at: formatDateForDB()
    }

    const result = await execute(
      c.env.DB,
      `INSERT INTO form_submissions (type, payload, email, naam, status, consent, created_at) 
       VALUES ('word_lid', ?, ?, ?, 'nieuw', ?, ?)`,
      [
        safeJsonStringify(payload),
        email,
        `${voornaam} ${achternaam}`,
        consent ? 1 : 0,
        formatDateForDB()
      ]
    )

    // TODO: Send email to admin (when Resend is configured)
    // TODO: Send confirmation email to applicant

    return c.redirect('/word-lid?success=true')
  } catch (error) {
    console.error('Word lid submission error:', error)
    return c.redirect('/word-lid?error=server')
  }
})

// =====================================================
// CONTACT FORM SUBMISSION
// =====================================================

app.post('/api/contact', async (c) => {
  try {
    const body = await c.req.parseBody()

    const naam = body.naam as string
    const email = (body.email as string).toLowerCase()
    const onderwerp = body.onderwerp as string
    const bericht = body.bericht as string
    const consent = body.consent === 'on'

    // Validation
    if (!naam || !email || !onderwerp || !bericht || !consent) {
      return c.redirect('/contact?error=required')
    }

    if (!isValidEmail(email)) {
      return c.redirect('/contact?error=invalid_email')
    }

    // Store submission
    const payload = {
      naam,
      email,
      onderwerp,
      bericht,
      submitted_at: formatDateForDB()
    }

    await execute(
      c.env.DB,
      `INSERT INTO form_submissions (type, payload, email, naam, status, consent, created_at) 
       VALUES ('contact', ?, ?, ?, 'nieuw', ?, ?)`,
      [
        safeJsonStringify(payload),
        email,
        naam,
        consent ? 1 : 0,
        formatDateForDB()
      ]
    )

    // Email versturen naar het koor
    const emailHtml = [
      '<h2>Nieuw contactbericht via animato.be</h2>',
      '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">',
      `<tr><td style="padding:8px;font-weight:bold;background:#f5f5f5;width:120px;">Naam</td><td style="padding:8px;border-bottom:1px solid #eee;">${naam}</td></tr>`,
      `<tr><td style="padding:8px;font-weight:bold;background:#f5f5f5;">E-mail</td><td style="padding:8px;border-bottom:1px solid #eee;"><a href="mailto:${email}">${email}</a></td></tr>`,
      `<tr><td style="padding:8px;font-weight:bold;background:#f5f5f5;">Onderwerp</td><td style="padding:8px;border-bottom:1px solid #eee;">${onderwerp}</td></tr>`,
      `<tr><td style="padding:8px;font-weight:bold;background:#f5f5f5;vertical-align:top;">Bericht</td><td style="padding:8px;white-space:pre-wrap;">${bericht.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td></tr>`,
      '</table>',
      '<p style="color:#888;font-size:12px;margin-top:16px;">Verzonden via het contactformulier op animato.be</p>'
    ].join('')

    try {
      await sendEmail({
        to: 'gemengdkooranimato@gmail.com',
        replyTo: email,
        subject: `[Animato Contact] ${onderwerp}`,
        html: emailHtml
      }, c.env.RESEND_API_KEY)
    } catch (mailErr) {
      console.error('Contact mail error (non-fatal):', mailErr)
      // Niet blokkeren — bericht staat in DB, mail is best-effort
    }

    return c.redirect('/contact?success=true')
  } catch (error) {
    console.error('Contact form submission error:', error)
    return c.redirect('/contact?error=server')
  }
})

// =====================================================
// ONE-TIME SEED: #43 Anja dirigent + #53 Arjan Vervaet
// Remove this endpoint after running once!
// =====================================================
app.get('/api/admin/seed-once', async (c) => {
  const secret = c.req.query('key')
  if (secret !== 'animato-seed-2026') {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const results: string[] = []

  try {
    // #43: Set Anja Holbrechts (id=28) as dirigent
    // First check current constraint — if it fails, the migration hasn't run yet
    try {
      await c.env.DB.prepare("UPDATE users SET role = 'dirigent' WHERE id = 28").run()
      results.push('✅ Anja Holbrechts (id=28) → rol dirigent')
    } catch (e: any) {
      results.push('⚠️ Anja rol update mislukt (CHECK constraint?): ' + e.message)
    }

    // #53: Add Arjan Vervaet
    const existingArjan = await c.env.DB.prepare(
      "SELECT id FROM users WHERE email = 'arjan.vervaet@gmail.com'"
    ).first()

    if (existingArjan) {
      results.push('ℹ️ Arjan Vervaet bestaat al (id=' + existingArjan.id + ')')
    } else {
      // Hash password using Web Crypto (same as auth.ts)
      const encoder = new TextEncoder()
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const passwordData = encoder.encode('Animato2025!')
      const key = await crypto.subtle.importKey('raw', passwordData, { name: 'PBKDF2' }, false, ['deriveBits'])
      const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        key, 256
      )
      const hashArray = new Uint8Array(hashBuffer)
      const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
      const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
      const password_hash = saltHex + ':' + hashHex

      const userResult = await c.env.DB.prepare(
        "INSERT INTO users (email, password_hash, role, stemgroep, status, email_verified) VALUES (?, ?, 'lid', 'B', 'actief', 1)"
      ).bind('arjan.vervaet@gmail.com', password_hash).run()

      const newId = userResult.meta.last_row_id
      await c.env.DB.prepare(
        "INSERT INTO profiles (user_id, voornaam, achternaam) VALUES (?, 'Arjan', 'Vervaet')"
      ).bind(newId).run()

      results.push('✅ Arjan Vervaet aangemaakt (id=' + newId + '), stemgroep=Bas, wachtwoord=Animato2025!')
    }

    // #53: Clear Els Bocken's invalid birthday (29/2)
    const els = await c.env.DB.prepare(
      "SELECT u.id, p.geboortedatum FROM users u JOIN profiles p ON p.user_id = u.id WHERE p.voornaam LIKE '%Els%' AND p.achternaam LIKE '%Bocken%'"
    ).first()

    if (els) {
      await c.env.DB.prepare(
        "UPDATE profiles SET geboortedatum = NULL WHERE user_id = ?"
      ).bind(els.id).run()
      results.push('✅ Els Bocken (id=' + els.id + ') geboortedatum gewist (was: ' + els.geboortedatum + ')')
    } else {
      results.push('ℹ️ Els Bocken niet gevonden')
    }

  } catch (error: any) {
    results.push('❌ Fout: ' + error.message)
  }

  return c.json({ results })
})

export default app
