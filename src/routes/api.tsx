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

    // Validation
    if (!voornaam || !achternaam || !email || !telefoon || !stemgroep || !consent) {
      return c.redirect('/word-lid?error=required')
    }

    if (!isValidEmail(email)) {
      return c.redirect('/word-lid?error=invalid_email')
    }

    if (!isValidPhone(telefoon)) {
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

export default app
