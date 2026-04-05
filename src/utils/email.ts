// Email Service using Resend API
// Handles all email notifications for the application

import type { D1Database } from '@cloudflare/workers-types'

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
}

export async function sendEmail(options: EmailOptions, resendApiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: options.from || 'Gemengd Koor Animato <noreply@animato.be>',
        to: [options.to],
        reply_to: options.replyTo || undefined,
        subject: options.subject,
        html: options.html
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Email send failed:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Email error:', error)
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
        <li>Na betaling ontvang je je tickets per email</li>
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
      <h3 style="margin: 0 0 15px 0; color: #10B981;">📱 Je Toegangscode</h3>
      <p style="margin: 0 0 15px 0;">Toon deze QR-code bij de ingang:</p>
      <div class="qr-code">
        ${data.qrCode}
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 15px;">
        Order: ${data.orderRef}
      </div>
    </div>
    
    <div style="background: #DBEAFE; border-left: 4px solid #3B82F6; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0;">💡 Belangrijke informatie</h4>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Bewaar deze email goed - je hebt hem nodig bij de ingang</li>
        <li>Print je ticket uit OF toon de QR-code op je smartphone</li>
        <li>Kom op tijd - deuren openen 30 minuten voor aanvang</li>
        <li>Bij verlies: neem contact op met <a href="mailto:tickets@animato.be">tickets@animato.be</a></li>
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
    
    <p>Na betaling ontvang je direct je tickets per email.</p>
    
    <p style="margin-top: 30px;">
      Met vriendelijke groet,<br>
      <strong>Gemengd Koor Animato</strong>
    </p>
  </div>
</body>
</html>
  `
}
