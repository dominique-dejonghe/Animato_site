// Email Service using Resend API
// Handles all email notifications for the application

import type { D1Database } from '@cloudflare/workers-types'

// ==========================================================================
// GLOBALE AFZENDER-CONFIGURATIE
// ==========================================================================
// Bepaald door Dominique (2026-07-08): één afzender, één reply-to.
// Wil je later per event-type een andere afzender? Overschrijf dan
// options.from bij de individuele sendEmail-call.
export const EMAIL_FROM = 'Gemengd Koor Animato <info@gemengdkooranimato.be>'
export const EMAIL_REPLY_TO = 'info@gemengdkooranimato.be'

interface EmailAttachment {
  filename: string
  /** Base64-encoded content (Resend-compat) */
  content: string
  contentType?: string
}

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
  /** Bijlagen — bv. PDF-tickets. Resend slikt base64-content. */
  attachments?: EmailAttachment[]
}

export async function sendEmail(options: EmailOptions, resendApiKey: string | undefined): Promise<boolean> {
  // Skip when API key is missing — clear log so the cause is obvious
  if (!resendApiKey || resendApiKey.trim() === '') {
    console.error('[email] RESEND_API_KEY is not configured — cannot send email to', options.to)
    return false
  }

  try {
    const payload: any = {
      from: options.from || EMAIL_FROM,
      to: [options.to],
      reply_to: options.replyTo || EMAIL_REPLY_TO,
      subject: options.subject,
      html: options.html
    }
    if (options.attachments && options.attachments.length > 0) {
      payload.attachments = options.attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType || undefined
      }))
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorBody = await response.text()
      // Log met alle context zodat we in de Cloudflare-logs snel zien
      // waarom Resend weigert (bv. domein niet geverifieerd, ongeldige API key,
      // rate limit, ontvanger in sandbox-mode…).
      console.error('[email] Resend API error',
        'status=', response.status,
        'from=', payload.from,
        'to=', options.to,
        'subject=', options.subject.substring(0, 80),
        'body=', errorBody.substring(0, 500)
      )
      return false
    }

    return true
  } catch (error: any) {
    console.error('[email] network/exception sending to', options.to, ':', error?.message || error)
    return false
  }
}

// ==========================================
// ORDER CONFIRMATION EMAIL
// ==========================================
export function orderConfirmationEmail(data: {
  orderRef: string
  koperNaam: string
  concertTitel: string
  concertDatum: string
  concertLocatie: string
  tickets: string
  totaalBedrag: number
  betaalUrl?: string
}): string {
  return `
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bestelbevestiging</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8B5CF6; }
    .button { display: inline-block; background: #8B5CF6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
    .order-ref { background: white; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 2px; margin: 20px 0; border: 2px dashed #8B5CF6; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
    .highlight { color: #8B5CF6; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">🎵 Bestelbevestiging</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Gemengd Koor Animato</p>
  </div>
  
  <div class="content">
    <h2>Beste ${data.koperNaam},</h2>
    
    <p>Hartelijk dank voor je bestelling! We hebben je aanvraag ontvangen en verwerkt.</p>
    
    <div class="order-ref">
      ${data.orderRef}
    </div>
    
    <div class="box">
      <h3 style="margin-top: 0; color: #8B5CF6;">📅 Concert Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Concert:</td>
          <td style="padding: 8px 0;">${data.concertTitel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Datum:</td>
          <td style="padding: 8px 0;">${data.concertDatum}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Locatie:</td>
          <td style="padding: 8px 0;">${data.concertLocatie}</td>
        </tr>
      </table>
    </div>
    
    <div class="box">
      <h3 style="margin-top: 0; color: #8B5CF6;">🎫 Je Bestelling</h3>
      <p style="margin: 0; font-size: 16px;">${data.tickets}</p>
      <p style="font-size: 24px; font-weight: bold; margin: 15px 0 0 0; color: #8B5CF6;">
        Totaal: €${data.totaalBedrag.toFixed(2)}
      </p>
    </div>
    
    ${data.betaalUrl ? `
    <div style="text-align: center; margin: 30px 0;">
      <p style="font-size: 16px; margin-bottom: 15px;">Voltooi je bestelling door te betalen:</p>
      <a href="${data.betaalUrl}" class="button">
        💳 Betaal €${data.totaalBedrag.toFixed(2)}
      </a>
      <p style="font-size: 14px; color: #666; margin-top: 15px;">
        Deze betaallink is 24 uur geldig
      </p>
    </div>
    ` : `
    <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold;">⏳ Wachten op betaling</p>
      <p style="margin: 5px 0 0 0;">Je ontvangt spoedig een email met betaalinstructies.</p>
    </div>
    `}
    
    <div style="background: #DBEAFE; border-left: 4px solid #3B82F6; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0;">ℹ️ Wat gebeurt er nu?</h4>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Na betaling vind je je tickets in de Koorportaal (voor koorleden) of in je mailbox</li>
        <li>Elk ticket bevat een unieke QR-code</li>
        <li>Toon je QR-code bij de ingang van het concert</li>
        <li>Bewaar deze email en je bestelreferentie</li>
      </ul>
    </div>
    
    <p>Bij vragen kun je contact opnemen via <a href="mailto:info@animato.be">info@animato.be</a></p>
    
    <p style="margin-top: 30px;">
      Met vriendelijke groet,<br>
      <strong>Gemengd Koor Animato</strong>
    </p>
  </div>
  
  <div class="footer">
    <p>Gemengd Koor Animato | www.animato.be</p>
    <p style="font-size: 12px; color: #999;">
      Deze email is verstuurd naar ${data.koperNaam}
    </p>
  </div>
</body>
</html>
  `
}

// ==========================================
// TICKET EMAIL WITH QR CODE
// ==========================================
export function ticketEmail(data: {
  orderRef: string
  koperNaam: string
  concertTitel: string
  concertDatum: string
  concertTijd: string
  concertLocatie: string
  tickets: string
  qrCode: string
  totaalBedrag: number
  /** Indien het emailadres matcht met een actief lid → link naar /leden/mijn-tickets */
  memberPortalUrl?: string
  /** Aantal stoelen waarvoor er een aparte PDF in de bijlage zit (informatief) */
  seatCount?: number
  /** Magic-link naar /account/setup?token=... — alleen voor NIEUWE kaartkopers (geen bestaand account) */
  accountSetupUrl?: string
}): string {
  return `
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Je Tickets</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .ticket { background: white; padding: 25px; border-radius: 12px; margin: 20px 0; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 2px solid #10B981; }
    .qr-section { background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 3px dashed #10B981; }
    .qr-code { font-family: monospace; font-size: 18px; background: #f3f4f6; padding: 15px; border-radius: 6px; letter-spacing: 2px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">✅ Je Tickets Zijn Klaar!</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Betaling ontvangen</p>
  </div>
  
  <div class="content">
    <h2>Gefeliciteerd ${data.koperNaam}! 🎉</h2>
    
    <p>Je betaling is succesvol ontvangen. Hier zijn je tickets voor:</p>
    
    <div class="ticket">
      <h3 style="margin: 0 0 15px 0; color: #10B981; font-size: 24px;">
        🎵 ${data.concertTitel}
      </h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; width: 100px;">📅 Datum:</td>
          <td style="padding: 10px 0;">${data.concertDatum}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold;">⏰ Tijd:</td>
          <td style="padding: 10px 0;">${data.concertTijd}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold;">📍 Locatie:</td>
          <td style="padding: 10px 0;">${data.concertLocatie}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold;">🎫 Tickets:</td>
          <td style="padding: 10px 0;">${data.tickets}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold;">💰 Betaald:</td>
          <td style="padding: 10px 0; font-size: 18px; color: #10B981;">€${data.totaalBedrag.toFixed(2)}</td>
        </tr>
      </table>
    </div>
    
    <div class="qr-section">
      <h3 style="margin: 0 0 15px 0; color: #10B981;">📎 Je tickets zitten in bijlage</h3>
      <p style="margin: 0 0 10px 0;">
        ${data.seatCount && data.seatCount > 0
          ? `Je vindt <strong>${data.seatCount} individuele PDF-ticket${data.seatCount > 1 ? 's' : ''}</strong> als bijlage bij deze mail — één per stoel. Elk ticket heeft een eigen scanbare QR-code.`
          : `Je vindt <strong>${data.tickets}</strong> als PDF-bijlage bij deze mail. Elk ticket heeft een eigen scanbare QR-code.`}
      </p>
      <p style="margin: 0; font-size: 13px; color: #555;">
        Print de PDF uit óf toon de QR-code op je smartphone bij de ingang.
      </p>
      <div style="font-size: 12px; color: #666; margin-top: 15px;">
        Order: ${data.orderRef}
      </div>
    </div>

    ${data.memberPortalUrl ? `
    <div style="background: linear-gradient(135deg, #10A8CF 0%, #0891B2 100%); color: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0; font-size: 18px;">🎵 Tip voor Animato-leden</h4>
      <p style="margin: 0 0 12px 0;">
        Je tickets zijn ook beschikbaar in je ledenportaal — handig als je de mail kwijt bent.
      </p>
      <a href="${data.memberPortalUrl}" style="display: inline-block; background: white; color: #0891B2; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        📋 Bekijk in ledenportaal
      </a>
    </div>` : ''}

    ${data.accountSetupUrl ? `
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); color: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0; font-size: 18px;">🔐 Maak een account aan om je tickets te beheren</h4>
      <p style="margin: 0 0 12px 0;">
        Wil je je tickets later opnieuw afdrukken, of je gegevens aanpassen? Activeer dan een gratis account. Geen verplichting — je kan deze mail ook gewoon bewaren.
      </p>
      <a href="${data.accountSetupUrl}" style="display: inline-block; background: white; color: #2563EB; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        ▶ Activeer mijn account
      </a>
      <p style="margin: 12px 0 0 0; font-size: 12px; opacity: 0.85;">
        Deze link is 14 dagen geldig. Klik erop, kies een wachtwoord, en je bent klaar.
      </p>
    </div>` : ''}
    
    <div style="background: #DBEAFE; border-left: 4px solid #3B82F6; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0;">💡 Belangrijke informatie</h4>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Bewaar de PDF-bijlage goed — je hebt hem nodig bij de ingang</li>
        <li>Print je ticket uit OF toon de QR-code op je smartphone</li>
        <li>Kom op tijd — deuren openen ca. 30 minuten voor aanvang</li>
        <li>Bij verlies: neem contact op met <a href="mailto:tickets@animato.be">tickets@animato.be</a> (vermeld je ordernummer)</li>
      </ul>
    </div>
    
    <p style="margin-top: 30px;">
      We kijken ernaar uit je te verwelkomen bij ons concert! 🎶
    </p>
    
    <p style="margin-top: 20px;">
      Met muzikale groet,<br>
      <strong>Gemengd Koor Animato</strong>
    </p>
  </div>
  
  <div class="footer">
    <p>Gemengd Koor Animato | www.animato.be</p>
    <p style="font-size: 12px; color: #999;">
      Order referentie: ${data.orderRef}
    </p>
  </div>
</body>
</html>
  `
}

// ==========================================
// PAYMENT REMINDER EMAIL
// ==========================================
export function paymentReminderEmail(data: {
  orderRef: string
  koperNaam: string
  concertTitel: string
  totaalBedrag: number
  betaalUrl: string
  expiryDate: string
}): string {
  return `
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0;">
  <title>Betaalherinnering</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #F59E0B; color: white; padding: 15px 40px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; font-size: 16px; }
    .warning { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">⏰ Betaalherinnering</h1>
  </div>
  
  <div class="content">
    <h2>Beste ${data.koperNaam},</h2>
    
    <p>Je hebt tickets besteld voor <strong>${data.concertTitel}</strong>, maar we hebben je betaling nog niet ontvangen.</p>
    
    <div class="warning">
      <p style="margin: 0; font-weight: bold;">⚠️ Je bestelling verloopt op ${data.expiryDate}</p>
      <p style="margin: 5px 0 0 0;">Voltooi je betaling om je tickets te behouden.</p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <p style="font-size: 18px; margin-bottom: 15px;">
        <strong>Order: ${data.orderRef}</strong><br>
        Bedrag: €${data.totaalBedrag.toFixed(2)}
      </p>
      <a href="${data.betaalUrl}" class="button">
        💳 Betaal Nu
      </a>
    </div>
    
    <p>Na betaling vind je je tickets in de Koorportaal (voor koorleden) of in je mailbox.</p>
    
    <p style="margin-top: 30px;">
      Met vriendelijke groet,<br>
      <strong>Gemengd Koor Animato</strong>
    </p>
  </div>
</body>
</html>
  `
}

// ==========================================================================
// GENERIEKE NOTIFICATIE-EMAIL (2026-07-08)
// ==========================================================================
// Één template die de meeste notif-types dekt. Individuele functies (zoals
// orderConfirmationEmail hierboven) kunnen dit overrulen als ze bijzondere
// info moeten laten zien (tabellen, bijlagen, etc.).
//
// De styling matcht globaal de Animato huisstijl (animato-primary #00A9CE
// als hoofdkleur, met per-type accent-kleur).

const TYPE_ACCENT: Record<string, { color: string; emoji: string; label: string }> = {
  nieuws:        { color: '#2563EB', emoji: '📰', label: 'Nieuwsbericht' },
  materiaal:     { color: '#7C3AED', emoji: '🎵', label: 'Oefenmateriaal' },
  repetitie:     { color: '#16A34A', emoji: '🎼', label: 'Repetitie' },
  concert:       { color: '#DB2777', emoji: '🎤', label: 'Concert' },
  agenda:        { color: '#0891B2', emoji: '📅', label: 'Agenda' },
  taak:          { color: '#7C3AED', emoji: '📋', label: 'Taak' },
  deadline:      { color: '#CA8A04', emoji: '⏰', label: 'Deadline' },
  lidgeld:       { color: '#EA580C', emoji: '💰', label: 'Lidgeld' },
  gift:          { color: '#E11D48', emoji: '💝', label: 'Gift' },
  board:         { color: '#B45309', emoji: '👥', label: 'Bestuur' },
  systeem:       { color: '#4B5563', emoji: '⚙️', label: 'Systeem' },
  profiel:       { color: '#4F46E5', emoji: '👤', label: 'Profiel' },
  verjaardag:    { color: '#EC4899', emoji: '🎂', label: 'Verjaardag' },
  ledenaanvraag: { color: '#0D9488', emoji: '👋', label: 'Nieuwe aanvraag' },
  contact:       { color: '#0284C7', emoji: '✉️', label: 'Contactformulier' },
  feedback:      { color: '#DC2626', emoji: '🐛', label: 'Beta feedback' },
}

/**
 * Bouw een simpele, mobiel-vriendelijke HTML-email voor een notificatie.
 *
 * @param data.link — optioneel. Als het een pad is (/leden/…) prependen we
 *                    https://animato.be zodat de link ook in mail-clients klopt.
 */
export function notificationEmail(data: {
  voornaam: string | null
  titel: string
  body: string
  link?: string
  type: string
}): string {
  const accent = TYPE_ACCENT[data.type] || TYPE_ACCENT.systeem
  const greet = data.voornaam ? `Beste ${escapeHtml(data.voornaam)}` : 'Beste'

  // Link naar absolute URL forceren
  let absoluteLink: string | null = null
  if (data.link) {
    absoluteLink = data.link.startsWith('http')
      ? data.link
      : `https://animato.be${data.link.startsWith('/') ? '' : '/'}${data.link}`
  }

  // Body ondersteunt eenvoudige newlines
  const bodyHtml = escapeHtml(data.body).replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.titel)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#00A9CE 0%,${accent.color} 100%);color:#ffffff;padding:24px 28px;border-radius:12px 12px 0 0;">
      <div style="font-size:12px;letter-spacing:1px;opacity:0.85;text-transform:uppercase;margin-bottom:6px;">
        ${accent.emoji} ${accent.label}
      </div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;">
        ${escapeHtml(data.titel)}
      </h1>
    </div>

    <!-- Content -->
    <div style="background:#ffffff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 16px 0;font-size:16px;">${greet},</p>

      ${data.body ? `<div style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">${bodyHtml}</div>` : ''}

      ${absoluteLink ? `
      <div style="text-align:center;margin:28px 0 16px 0;">
        <a href="${escapeHtml(absoluteLink)}" style="display:inline-block;background:${accent.color};color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Bekijk in Animato →
        </a>
      </div>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:12px 0 0 0;">
        Werkt de knop niet? Kopieer deze link:<br>
        <a href="${escapeHtml(absoluteLink)}" style="color:${accent.color};word-break:break-all;">${escapeHtml(absoluteLink)}</a>
      </p>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 12px;color:#6b7280;font-size:12px;line-height:1.5;">
      Deze e-mail komt van <strong>Gemengd Koor Animato</strong>.<br>
      Wil je dit soort mails niet meer ontvangen? Pas je voorkeuren aan via
      <a href="https://animato.be/leden/profiel#notificaties" style="color:#00A9CE;">je profielinstellingen</a>.<br>
      <span style="color:#9ca3af;">info@gemengdkooranimato.be</span>
    </div>
  </div>
</body>
</html>`
}

/**
 * Speciale template voor admin-only notificaties (registratie-aanvraag,
 * contact, feedback). Iets soberder, en toont de rauwe payload voor
 * snelle triage.
 */
export function adminAlertEmail(data: {
  titel: string
  intro: string
  details: Array<{ label: string; value: string }>
  actionLink?: string
  actionLabel?: string
}): string {
  const detailsHtml = data.details.map(d => `
    <tr>
      <td style="padding:8px 12px;background:#f9fafb;font-weight:600;color:#4b5563;border-bottom:1px solid #e5e7eb;width:30%;vertical-align:top;">${escapeHtml(d.label)}</td>
      <td style="padding:8px 12px;background:#ffffff;color:#1f2937;border-bottom:1px solid #e5e7eb;">${escapeHtml(d.value).replace(/\n/g, '<br>')}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.titel)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:640px;margin:0 auto;padding:20px;">
    <div style="background:#1B4D5C;color:#ffffff;padding:20px 24px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;letter-spacing:1px;opacity:0.75;text-transform:uppercase;margin-bottom:4px;">🛡️ Admin melding</div>
      <h1 style="margin:0;font-size:20px;font-weight:700;">${escapeHtml(data.titel)}</h1>
    </div>
    <div style="background:#ffffff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.5;">${escapeHtml(data.intro)}</p>
      <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        ${detailsHtml}
      </table>
      ${data.actionLink ? `
      <div style="text-align:center;margin:24px 0 8px 0;">
        <a href="${escapeHtml(data.actionLink.startsWith('http') ? data.actionLink : 'https://animato.be' + data.actionLink)}"
           style="display:inline-block;background:#00A9CE;color:#ffffff;padding:11px 24px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
          ${escapeHtml(data.actionLabel || 'Bekijk in admin')} →
        </a>
      </div>` : ''}
    </div>
    <div style="text-align:center;padding:16px 12px;color:#9ca3af;font-size:11px;">
      Automatische melding van animato.be — niet beantwoorden.
    </div>
  </div>
</body>
</html>`
}

/**
 * XSS-safe HTML escape voor waarden die in email-templates komen.
 * Nodig want data komt uit gebruikers-input (namen, berichten, etc.).
 */
function escapeHtml(s: string): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
