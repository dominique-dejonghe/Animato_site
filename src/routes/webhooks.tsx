import { Hono } from 'hono'
import { queryOne, execute } from '../utils/db'
import { getMolliePayment } from '../utils/mollie'
import { getMollieApiKey } from '../utils/mollie-config'
import { sendEmail, ticketEmail } from '../utils/email'
import { createNotification } from '../utils/notifications'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

/**
 * Helper voor lidgeld-betaalbevestiging:
 * - markeer alle openstaande 'lidgeld'-notifs van deze user als gelezen
 * - voeg één bevestigings-notif toe ('Lidgeld ontvangen, bedankt!')
 * Zo verdwijnen 'Openstaand'-meldingen en krijgt het lid positieve feedback.
 */
async function finalizeLidgeldNotifications(
  db: D1Database,
  membershipId: number | string
): Promise<void> {
  try {
    const m = await queryOne<any>(db,
      `SELECT um.user_id, um.amount, my.season
       FROM user_memberships um
       JOIN membership_years my ON my.id = um.year_id
       WHERE um.id = ?`,
      [membershipId])
    if (!m) return
    // Sluit alle openstaande lidgeld-notifs van deze user (markeer als gelezen)
    await execute(db,
      `UPDATE notifications
       SET is_gelezen = 1, gelezen_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND type = 'lidgeld' AND is_gelezen = 0`,
      [m.user_id])
    // Voeg positieve bevestiging toe
    const bedrag = m.amount ? `€ ${Number(m.amount).toFixed(2)}` : ''
    await createNotification(
      db,
      m.user_id,
      'lidgeld',
      `Lidgeld ${m.season} ontvangen — bedankt! 🎵`,
      bedrag ? `We hebben ${bedrag} ontvangen. Je lidmaatschap is actief.` : 'Je lidmaatschap is actief.',
      '/leden/profiel#lidgeld'
    )
  } catch (e) {
    console.error('finalizeLidgeldNotifications failed:', e)
  }
}

// ==========================================
// MOLLIE WEBHOOK
// ==========================================
//
// Best-effort diagnostic logging helper. Mag NOOIT de hoofdflow blokkeren —
// een log-failure mag niet leiden tot een 500 die Mollie laat retryen.
async function logWebhookCall(
  db: D1Database,
  data: {
    paymentId?: string
    paymentType?: string
    mollieStatus?: string
    localAction?: string
    httpStatus?: number
    errorMessage?: string
    rawBody?: string
  }
): Promise<void> {
  try {
    await execute(db, `
      INSERT INTO mollie_webhook_log
        (payment_id, payment_type, mollie_status, local_action, http_status, error_message, raw_body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      data.paymentId || null,
      data.paymentType || null,
      data.mollieStatus || null,
      data.localAction || null,
      data.httpStatus ?? null,
      data.errorMessage || null,
      (data.rawBody || '').slice(0, 500),
    ])
  } catch (e) {
    // Log-tabel bestaat misschien niet in een dev-DB — slik en negeer
    console.error('[Mollie webhook] kon log-row niet schrijven:', e)
  }
}

app.post('/api/webhooks/mollie', async (c) => {
  let rawForLog = ''
  let paymentId = ''
  try {
    // Mollie stuurt application/x-www-form-urlencoded met één veld: id
    // We ondersteunen ook JSON voor eigen/test-calls
    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('application/json')) {
      const json = await c.req.json().catch(() => ({} as any))
      paymentId = String((json as any).id || '')
      rawForLog = JSON.stringify(json).slice(0, 500)
    } else {
      const body = await c.req.parseBody().catch(() => ({} as any))
      paymentId = String((body as any).id || '')
      rawForLog = `id=${paymentId}`
    }

    if (!paymentId) {
      console.warn('[Mollie webhook] Geen payment ID in request')
      await logWebhookCall(c.env.DB, {
        errorMessage: 'No payment ID in request', httpStatus: 400, rawBody: rawForLog
      })
      return c.json({ error: 'No payment ID' }, 400)
    }

    console.log('[Mollie webhook] Ontvangen voor payment', paymentId)

    // 1. Get payment status from Mollie (revalidatie — nooit vertrouwen op de request body)
    const molliePayment = await getMolliePayment(await getMollieApiKey(c.env), paymentId)
    if (!molliePayment) {
      console.warn('[Mollie webhook] Payment niet gevonden bij Mollie:', paymentId)
      await logWebhookCall(c.env.DB, {
        paymentId, errorMessage: 'Payment not found at Mollie',
        httpStatus: 404, rawBody: rawForLog
      })
      return c.json({ error: 'Payment not found' }, 404)
    }

    // 2. Check metadata to route properly
    const type = molliePayment.metadata?.type

    // === DONATION FLOW ===
    if (type === 'donation') {
      const donationId = molliePayment.metadata.donation_id
      const status = molliePayment.status
      const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'

      await execute(c.env.DB, `
        UPDATE donations 
        SET status = ? 
        WHERE id = ?
      `, [newStatus, donationId])

      if (newStatus === 'paid') {
        // Optional: Send thank you email
        const user = molliePayment.metadata.user_id ? await queryOne(c.env.DB, "SELECT email, voornaam FROM users JOIN profiles ON users.id=profiles.user_id WHERE users.id=?", [molliePayment.metadata.user_id]) : null;
        
        if (user) {
            await sendEmail({
                to: user.email,
                subject: 'Bedankt voor je donatie aan Animato!',
                html: `<h1>Bedankt ${user.voornaam}!</h1><p>We hebben je donatie van €${molliePayment.amount.value} goed ontvangen.</p><p>Met muzikale groet,<br>Het Bestuur</p>`
            }, c.env.RESEND_API_KEY);
        }
      }

      return c.json({ success: true, type: 'donation', status: newStatus })
    }

    if (type === 'activity') {
      // === ACTIVITY REGISTRATION FLOW ===
      const userId = molliePayment.metadata.user_id
      const activityId = molliePayment.metadata.activity_id

      // Determine status
      const status = molliePayment.status
      const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'

      // Update Activity Registration
      await execute(c.env.DB, `
        UPDATE activity_registrations 
        SET status = ? 
        WHERE activity_id = ? AND user_id = ?
      `, [newStatus, activityId, userId])

      return c.json({ success: true, type: 'activity', status: newStatus })
    }

    if (type === 'membership') {
      // === MEMBERSHIP FLOW ===
      const membershipId = molliePayment.metadata.membership_id
      const status = molliePayment.status
      const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'

      await execute(c.env.DB, `
        UPDATE user_memberships
        SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
        WHERE id = ?
      `, [newStatus, newStatus, membershipId])

      // BUG-FIX: bij paid alle openstaande lidgeld-notifs sluiten + bevestiging
      if (newStatus === 'paid') {
        await finalizeLidgeldNotifications(c.env.DB, membershipId)
      }

      await logWebhookCall(c.env.DB, {
        paymentId, paymentType: 'membership', mollieStatus: status,
        localAction: `membership_${membershipId} -> ${newStatus}`,
        httpStatus: 200, rawBody: rawForLog,
      })
      return c.json({ success: true, type: 'membership', status: newStatus })
    }

    if (type === 'membership_donation') {
      // === MEMBERSHIP + DONATION FLOW ===
      const membershipId = molliePayment.metadata.membership_id
      const donationId = molliePayment.metadata.donation_id
      const status = molliePayment.status
      const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'

      // Update Membership
      await execute(c.env.DB, `
        UPDATE user_memberships
        SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
        WHERE id = ?
      `, [newStatus, newStatus, membershipId])

      // Update Donation
      if (donationId) {
        await execute(c.env.DB, `
          UPDATE donations 
          SET status = ? 
          WHERE id = ?
        `, [newStatus, donationId])
      }

      // Send combined email if paid
      if (newStatus === 'paid') {
         // BUG-FIX: bij paid alle openstaande lidgeld-notifs sluiten + bevestiging
         await finalizeLidgeldNotifications(c.env.DB, membershipId)
         const user = molliePayment.metadata.user_id ? await queryOne(c.env.DB, "SELECT email, voornaam FROM users JOIN profiles ON users.id=profiles.user_id WHERE users.id=?", [molliePayment.metadata.user_id]) : null;
         if (user) {
            await sendEmail({
                to: user.email,
                subject: 'Bedankt voor je lidmaatschap en gift!',
                html: `<h1>Bedankt ${user.voornaam}!</h1>
                       <p>We hebben je betaling van €${molliePayment.amount.value} goed ontvangen.</p>
                       <p>Je lidmaatschap is nu actief en bedankt voor je extra steun!</p>
                       <p>Met muzikale groet,<br>Het Bestuur</p>`
            }, c.env.RESEND_API_KEY);
         }
      }

      return c.json({ success: true, type: 'membership_donation', status: newStatus })
    }

    // === TICKET FLOW (Default fallback) ===
    // Find ticket order with this payment ID
    const ticket = await queryOne(c.env.DB,
      `SELECT t.*, e.titel, e.start_at, e.locatie
       FROM tickets t
       JOIN concerts c ON c.id = t.concert_id
       JOIN events e ON e.id = c.event_id
       WHERE t.betaling_id = ?`,
      [paymentId]
    )

    if (!ticket) {
      console.error('Ticket not found for payment:', paymentId)
      return c.json({ error: 'Ticket not found' }, 404)
    }

    // Map Mollie status to our ticket status
    // Simple mapping: paid -> paid, open -> pending, anything else -> cancelled
    const status = molliePayment.status
    const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'
    const oldStatus = ticket.status

    // Only update if status changed
    if (newStatus !== oldStatus) {
      // Update ticket status
      await execute(c.env.DB,
        `UPDATE tickets 
         SET status = ?, 
             betaald_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE betaald_at END
         WHERE id = ?`,
        [newStatus, newStatus, ticket.id]
      )

      // If payment is completed, send ticket email
      if (newStatus === 'paid' && oldStatus !== 'paid') {
        const eventDate = new Date(ticket.start_at)
        
        const emailHtml = ticketEmail({
          orderRef: ticket.order_ref,
          koperNaam: ticket.koper_naam,
          concertTitel: ticket.titel,
          concertDatum: eventDate.toLocaleDateString('nl-NL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          concertTijd: eventDate.toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          concertLocatie: ticket.locatie,
          tickets: ticket.categorie,
          qrCode: ticket.qr_code,
          totaalBedrag: ticket.prijs_totaal
        })

        await sendEmail({
          to: ticket.koper_email,
          subject: `✅ Je Tickets voor ${ticket.titel} - ${ticket.order_ref}`,
          html: emailHtml
        }, c.env.RESEND_API_KEY)

        // Log success
        await execute(c.env.DB,
          `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
           VALUES (NULL, 'payment_completed', 'tickets', ?, ?)`,
          [ticket.id, JSON.stringify({
            payment_id: paymentId,
            order_ref: ticket.order_ref,
            amount: ticket.prijs_totaal
          })]
        )
      }

      // If payment failed, log it
      if (newStatus === 'cancelled') {
        await execute(c.env.DB,
          `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
           VALUES (NULL, 'payment_failed', 'tickets', ?, ?)`,
          [ticket.id, JSON.stringify({
            payment_id: paymentId,
            order_ref: ticket.order_ref,
            mollie_status: molliePayment.status
          })]
        )
      }
    }

    await logWebhookCall(c.env.DB, {
      paymentId, paymentType: 'ticket', mollieStatus: status,
      localAction: `ticket_${ticket.id} -> ${newStatus}`,
      httpStatus: 200, rawBody: rawForLog,
    })
    return c.json({ success: true, status: newStatus })

  } catch (error) {
    console.error('Webhook error:', error)
    // Log de fout zodat admins kunnen zien dat Mollie ons WEL bereikte
    // maar onze code erop crashte. Anders blijft de status onverklaarbaar pending.
    await logWebhookCall(c.env.DB, {
      paymentId,
      errorMessage: ((error as Error).message || 'unknown').slice(0, 500),
      httpStatus: 500,
      rawBody: rawForLog,
    })
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// CHECK PAYMENT STATUS (for confirmation page)
// ==========================================
app.get('/api/tickets/:orderRef/payment-status', async (c) => {
  const orderRef = c.req.param('orderRef')
  
  try {
    const ticket = await queryOne(c.env.DB,
      `SELECT status, betaling_id FROM tickets WHERE order_ref = ?`,
      [orderRef]
    )

    if (!ticket) {
      return c.json({ error: 'Ticket not found' }, 404)
    }

    // If pending, check Mollie for latest status
    if (ticket.status === 'pending' && ticket.betaling_id) {
      const molliePayment = await getMolliePayment(await getMollieApiKey(c.env), ticket.betaling_id)
      
      if (molliePayment) {
        const status = molliePayment.status
        const newStatus = status === 'paid' ? 'paid' : status === 'open' ? 'pending' : 'cancelled'
        
        if (newStatus !== ticket.status) {
          // Update in database
          await execute(c.env.DB,
            `UPDATE tickets SET status = ? WHERE order_ref = ?`,
            [newStatus, orderRef]
          )
          
          return c.json({ status: newStatus, updated: true })
        }
      }
    }

    return c.json({ status: ticket.status, updated: false })
    
  } catch (error) {
    console.error('Payment status check error:', error)
    return c.json({ error: (error as Error).message }, 500)
  }
})

export default app
