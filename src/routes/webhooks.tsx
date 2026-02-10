import { Hono } from 'hono'
import { queryOne, execute } from '../utils/db'
import { getMolliePayment } from '../utils/mollie'
import { sendEmail, ticketEmail } from '../utils/email'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// ==========================================
// MOLLIE WEBHOOK
// ==========================================
app.post('/api/webhooks/mollie', async (c) => {
  try {
    const body = await c.req.parseBody()
    const paymentId = String(body.id)

    if (!paymentId) {
      return c.json({ error: 'No payment ID' }, 400)
    }

    // 1. Get payment status from Mollie
    const molliePayment = await getMolliePayment(c.env.MOLLIE_API_KEY, paymentId)
    if (!molliePayment) return c.json({ error: 'Payment not found' }, 404)

    // 2. Check metadata to route properly
    const type = molliePayment.metadata?.type

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

      // If paid, maybe send confirmation email? (Optional for now)
      if (newStatus === 'paid') {
        // ... send email logic ...
      }

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

      return c.json({ success: true, type: 'membership', status: newStatus })
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
          `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
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
          `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
           VALUES (NULL, 'payment_failed', 'tickets', ?, ?)`,
          [ticket.id, JSON.stringify({
            payment_id: paymentId,
            order_ref: ticket.order_ref,
            mollie_status: molliePayment.status
          })]
        )
      }
    }

    return c.json({ success: true, status: newStatus })
    
  } catch (error) {
    console.error('Webhook error:', error)
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
      const molliePayment = await getMolliePayment(c.env.MOLLIE_API_KEY, ticket.betaling_id)
      
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
