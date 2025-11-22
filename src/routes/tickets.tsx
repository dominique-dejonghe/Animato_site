import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { queryAll, queryOne, execute } from '../utils/db'
import type { Bindings, SessionUser } from '../types'
import { optionalAuth } from '../middleware/auth'
import { formatLineBreaks } from '../utils/text'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optionalAuth middleware to all routes
app.use('*', optionalAuth)

// ==========================================
// PUBLIC TICKET ORDERING PAGE
// ==========================================
app.get('/concerten/:eventId/tickets', async (c) => {
  const eventId = parseInt(c.req.param('eventId'))
  const user = c.get('user') as SessionUser | null
  
  // Get event and concert info
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.beschrijving, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.event_id = ? AND c.ticketing_enabled = 1
  `, [eventId])
  
  if (!concert) {
    return c.html(
      <Layout title="Tickets niet beschikbaar" user={user}>
        <div class="max-w-4xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-ticket-alt text-6xl text-gray-300 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Tickets niet beschikbaar</h1>
          <p class="text-gray-600 mb-8">
            Voor dit evenement is online ticketing niet ingeschakeld.
          </p>
          <a href="/concerten" class="text-animato-primary hover:underline">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar concerten
          </a>
        </div>
      </Layout>
    )
  }

  // Check if sold out
  const isSoldOut = concert.uitverkocht || 
    (concert.capaciteit > 0 && concert.verkocht >= concert.capaciteit)

  // Parse prijsstructuur (JSON format expected: [{"categorie": "Volwassenen", "prijs": 15}, ...])
  let prijzen: any[] = []
  try {
    if (concert.prijsstructuur) {
      prijzen = JSON.parse(concert.prijsstructuur)
    }
  } catch (e) {
    // Fallback to simple structure
    prijzen = [{ categorie: 'Standaard', prijs: 15 }]
  }

  const eventDate = new Date(concert.start_at)
  const isPast = eventDate < new Date()

  return c.html(
    <Layout title={`Tickets - ${concert.titel}`} user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div class="mb-8">
            <a href={`/concerten/${eventId}`} class="text-animato-primary hover:underline inline-flex items-center mb-4">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar concert details
            </a>
            <h1 class="text-4xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Tickets Bestellen
            </h1>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Concert Info Sidebar */}
            <div class="lg:col-span-1">
              <div class="bg-white rounded-lg shadow-md overflow-hidden sticky top-8">
                {concert.poster_url && (
                  <img src={concert.poster_url} alt={concert.titel} class="w-full h-48 object-cover" />
                )}
                <div class="p-6">
                  <h2 class="text-xl font-bold text-gray-900 mb-4">{concert.titel}</h2>
                  
                  <div class="space-y-3 text-sm">
                    <div class="flex items-start">
                      <i class="fas fa-calendar-alt text-animato-primary mr-3 mt-1"></i>
                      <div>
                        <div class="font-semibold">
                          {eventDate.toLocaleDateString('nl-NL', { 
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}
                        </div>
                        <div class="text-gray-600">
                          {eventDate.toLocaleTimeString('nl-NL', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })} uur
                        </div>
                      </div>
                    </div>

                    <div class="flex items-start">
                      <i class="fas fa-map-marker-alt text-animato-primary mr-3 mt-1"></i>
                      <div class="text-gray-700">{concert.locatie}</div>
                    </div>

                    {concert.capaciteit > 0 && (
                      <div class="flex items-start">
                        <i class="fas fa-users text-animato-primary mr-3 mt-1"></i>
                        <div>
                          <div class="text-gray-700">
                            {concert.capaciteit - concert.verkocht} tickets beschikbaar
                          </div>
                          <div class="text-xs text-gray-500">
                            {concert.verkocht} / {concert.capaciteit} verkocht
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {concert.programma && (
                    <div class="mt-6 pt-6 border-t border-gray-200">
                      <h3 class="font-semibold text-gray-900 mb-2">Programma</h3>
                      <div class="text-sm text-gray-600 whitespace-pre-line">
                        {formatLineBreaks(concert.programma)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Order Form */}
            <div class="lg:col-span-2">
              {isSoldOut ? (
                <div class="bg-white rounded-lg shadow-md p-12 text-center">
                  <i class="fas fa-times-circle text-6xl text-red-500 mb-4"></i>
                  <h2 class="text-2xl font-bold text-gray-900 mb-2">Uitverkocht</h2>
                  <p class="text-gray-600">
                    Helaas zijn alle tickets voor dit concert uitverkocht.
                  </p>
                </div>
              ) : isPast ? (
                <div class="bg-white rounded-lg shadow-md p-12 text-center">
                  <i class="fas fa-clock text-6xl text-gray-400 mb-4"></i>
                  <h2 class="text-2xl font-bold text-gray-900 mb-2">Concert is afgelopen</h2>
                  <p class="text-gray-600">
                    Je kunt geen tickets meer bestellen voor dit concert.
                  </p>
                </div>
              ) : (
                <form method="POST" action="/api/tickets/order" class="bg-white rounded-lg shadow-md p-8">
                  <input type="hidden" name="concert_id" value={concert.id} />
                  
                  <h2 class="text-2xl font-bold text-gray-900 mb-6">Selecteer je tickets</h2>

                  {/* Ticket Categories */}
                  <div class="space-y-4 mb-8">
                    {prijzen.map((prijs: any, index: number) => (
                      <div class="border border-gray-200 rounded-lg p-4 hover:border-animato-primary transition">
                        <div class="flex items-center justify-between mb-3">
                          <div>
                            <div class="font-semibold text-gray-900 text-lg">
                              {prijs.categorie}
                            </div>
                            <div class="text-2xl font-bold text-animato-primary">
                              €{prijs.prijs.toFixed(2)}
                            </div>
                            {prijs.beschrijving && (
                              <div class="text-sm text-gray-600 mt-1">
                                {prijs.beschrijving}
                              </div>
                            )}
                          </div>
                          <div class="flex items-center space-x-3">
                            <button
                              type="button"
                              onclick={`decrementTicket(${index})`}
                              class="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition"
                            >
                              <i class="fas fa-minus text-gray-600"></i>
                            </button>
                            <input
                              type="number"
                              name={`tickets[${index}][aantal]`}
                              id={`ticket-${index}`}
                              value="0"
                              min="0"
                              max="10"
                              class="w-16 text-center border border-gray-300 rounded-lg py-2 text-lg font-semibold"
                              onchange="updateTotal()"
                              readonly
                            />
                            <input type="hidden" name={`tickets[${index}][categorie]`} value={prijs.categorie} />
                            <input type="hidden" name={`tickets[${index}][prijs]`} value={prijs.prijs} />
                            <button
                              type="button"
                              onclick={`incrementTicket(${index})`}
                              class="w-10 h-10 bg-animato-primary hover:bg-opacity-90 text-white rounded-lg flex items-center justify-center transition"
                            >
                              <i class="fas fa-plus"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div class="bg-gray-50 rounded-lg p-6 mb-8">
                    <div class="flex items-center justify-between text-lg">
                      <span class="font-semibold text-gray-900">Totaal aantal tickets:</span>
                      <span id="total-tickets" class="font-bold text-gray-900">0</span>
                    </div>
                    <div class="flex items-center justify-between text-2xl mt-2">
                      <span class="font-bold text-gray-900">Totaal bedrag:</span>
                      <span id="total-price" class="font-bold text-animato-primary">€0.00</span>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div class="space-y-4 mb-8">
                    <div class="flex items-center justify-between mb-4">
                      <h3 class="text-xl font-bold text-gray-900">Je gegevens</h3>
                      {user && (
                        <span class="inline-flex items-center text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full">
                          <i class="fas fa-check-circle mr-2"></i>
                          Ingelogd als lid
                        </span>
                      )}
                    </div>

                    {!user && (
                      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                        <div class="flex items-start gap-3">
                          <i class="fas fa-info-circle text-blue-600 text-xl mt-0.5"></i>
                          <div class="flex-1">
                            <p class="text-sm text-gray-700 mb-3">
                              <strong>Ben je al lid?</strong> Log in om je gegevens automatisch in te vullen en sneller te bestellen.
                            </p>
                            <div class="flex gap-3">
                              <a 
                                href="/login?redirect=/concerten/{eventId}/tickets" 
                                class="inline-flex items-center bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 transition text-sm font-semibold"
                              >
                                <i class="fas fa-sign-in-alt mr-2"></i>
                                Inloggen
                              </a>
                              <a 
                                href="/registreren?redirect=/concerten/{eventId}/tickets" 
                                class="inline-flex items-center bg-white text-animato-primary border border-animato-primary px-4 py-2 rounded-lg hover:bg-gray-50 transition text-sm font-semibold"
                              >
                                <i class="fas fa-user-plus mr-2"></i>
                                Registreren
                              </a>
                            </div>
                            <p class="text-xs text-gray-600 mt-3">
                              Of vul hieronder je gegevens in om als gast te bestellen
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">
                        Naam *
                      </label>
                      <input
                        type="text"
                        name="koper_naam"
                        required
                        value={user ? `${user.voornaam} ${user.achternaam}` : ''}
                        readonly={!!user}
                        class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                        placeholder="Volledige naam"
                      />
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="koper_email"
                        required
                        value={user?.email || ''}
                        readonly={!!user}
                        class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                        placeholder="je@email.com"
                      />
                      <p class="text-sm text-gray-500 mt-1">
                        Je ontvangt de tickets op dit emailadres
                      </p>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">
                        Telefoon {user ? '(optioneel)' : '*'}
                      </label>
                      <input
                        type="tel"
                        name="koper_telefoon"
                        value={user?.telefoon || ''}
                        readonly={!!user}
                        required={!user}
                        class={`w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-animato-primary ${user ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                        placeholder="06-12345678"
                      />
                    </div>
                  </div>

                  {/* Terms */}
                  <div class="mb-6">
                    <label class="flex items-start">
                      <input
                        type="checkbox"
                        name="accept_terms"
                        required
                        class="mt-1 mr-3"
                      />
                      <span class="text-sm text-gray-600">
                        Ik ga akkoord met de <a href="/algemene-voorwaarden" class="text-animato-primary hover:underline">algemene voorwaarden</a> en het <a href="/privacybeleid" class="text-animato-primary hover:underline">privacybeleid</a>
                      </span>
                    </label>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    id="submit-btn"
                    disabled
                    class="w-full bg-animato-primary text-white py-4 rounded-lg font-semibold text-lg hover:bg-opacity-90 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <i class="fas fa-shopping-cart mr-2"></i>
                    Bestelling Plaatsen
                  </button>
                  <p class="text-sm text-gray-500 text-center mt-3">
                    Je ontvangt de tickets direct per email na betaling
                  </p>
                </form>
              )}
            </div>
          </div>

          {/* JavaScript for form logic */}
          <script dangerouslySetInnerHTML={{ __html: `
            const prijzen = ${JSON.stringify(prijzen)};
            
            function incrementTicket(index) {
              const input = document.getElementById('ticket-' + index);
              const max = parseInt(input.getAttribute('max'));
              const current = parseInt(input.value);
              if (current < max) {
                input.value = current + 1;
                updateTotal();
              }
            }

            function decrementTicket(index) {
              const input = document.getElementById('ticket-' + index);
              const current = parseInt(input.value);
              if (current > 0) {
                input.value = current - 1;
                updateTotal();
              }
            }

            function updateTotal() {
              let totalTickets = 0;
              let totalPrice = 0;

              prijzen.forEach((prijs, index) => {
                const aantal = parseInt(document.getElementById('ticket-' + index).value) || 0;
                totalTickets += aantal;
                totalPrice += aantal * prijs.prijs;
              });

              document.getElementById('total-tickets').textContent = totalTickets;
              document.getElementById('total-price').textContent = '€' + totalPrice.toFixed(2);
              
              // Enable/disable submit button
              const submitBtn = document.getElementById('submit-btn');
              if (totalTickets > 0) {
                submitBtn.disabled = false;
              } else {
                submitBtn.disabled = true;
              }
            }

            // Initialize
            updateTotal();
          ` }} />
        </div>
      </div>
    </Layout>
  )
})

import { sendEmail, orderConfirmationEmail, ticketEmail } from '../utils/email'
import { createMolliePayment } from '../utils/mollie'

// ==========================================
// ORDER PROCESSING API
// ==========================================
app.post('/api/tickets/order', async (c) => {
  const body = await c.req.parseBody()
  
  try {
    const concertId = parseInt(String(body.concert_id))
    const koperNaam = String(body.koper_naam)
    const koperEmail = String(body.koper_email)
    const koperTelefoon = String(body.koper_telefoon || '')

    // Parse tickets from form data
    const tickets: any[] = []
    let totalAmount = 0
    let totalTickets = 0

    // Extract ticket data from form
    for (const [key, value] of Object.entries(body)) {
      const match = key.match(/tickets\[(\d+)\]\[aantal\]/)
      if (match) {
        const index = parseInt(match[1])
        const aantal = parseInt(String(value))
        
        if (aantal > 0) {
          const categorie = String(body[`tickets[${index}][categorie]`])
          const prijs = parseFloat(String(body[`tickets[${index}][prijs]`]))
          
          tickets.push({ categorie, aantal, prijs })
          totalTickets += aantal
          totalAmount += aantal * prijs
        }
      }
    }

    if (tickets.length === 0) {
      throw new Error('Geen tickets geselecteerd')
    }

    // Get concert info
    const concert = await queryOne(c.env.DB,
      `SELECT * FROM concerts WHERE id = ?`,
      [concertId]
    )

    if (!concert) {
      throw new Error('Concert niet gevonden')
    }

    // Check capacity
    if (concert.capaciteit > 0 && (concert.verkocht + totalTickets) > concert.capaciteit) {
      throw new Error('Niet genoeg tickets beschikbaar')
    }

    // Generate order reference
    const orderRef = 'TIX-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 7).toUpperCase()
    
    // Generate QR code (simple unique string for now)
    const qrCode = crypto.randomUUID()

    // Get event details for email
    const event = await queryOne(c.env.DB,
      `SELECT e.titel, e.start_at, e.locatie 
       FROM events e 
       JOIN concerts c ON c.event_id = e.id 
       WHERE c.id = ?`,
      [concertId]
    )

    // Create Mollie payment or use mock mode for development
    const siteUrl = c.env.SITE_URL || 'https://animato.be'
    const isDevelopment = !c.env.MOLLIE_API_KEY || c.env.MOLLIE_API_KEY.includes('test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM')
    
    let molliePayment: any
    
    if (isDevelopment) {
      // DEVELOPMENT MODE: Mock payment for testing
      console.log('🧪 Development mode: Using mock payment')
      molliePayment = {
        id: 'mock_' + crypto.randomUUID(),
        status: 'open',
        _links: {
          checkout: {
            href: `${siteUrl}/tickets/bevestiging/${orderRef}?mock=true`
          }
        }
      }
    } else {
      // PRODUCTION MODE: Real Mollie payment
      molliePayment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: totalAmount,
        description: `Tickets ${event.titel} - ${orderRef}`,
        redirectUrl: `${siteUrl}/tickets/bevestiging/${orderRef}`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
          order_ref: orderRef,
          concert_id: concertId
        }
      })

      if (!molliePayment) {
        throw new Error('Kon geen betaling aanmaken')
      }
    }

    // Insert ticket order
    const result = await execute(c.env.DB, `
      INSERT INTO tickets (
        concert_id, order_ref, koper_email, koper_naam, koper_telefoon,
        aantal, categorie, prijs_totaal, status, qr_code, betaling_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `, [
      concertId,
      orderRef,
      koperEmail,
      koperNaam,
      koperTelefoon,
      totalTickets,
      tickets.map((t: any) => `${t.aantal}x ${t.categorie}`).join(', '),
      totalAmount,
      qrCode,
      molliePayment.id
    ])

    // Update concert verkocht count
    await execute(c.env.DB,
      `UPDATE concerts SET verkocht = verkocht + ? WHERE id = ?`,
      [totalTickets, concertId]
    )

    // Send order confirmation email
    const eventDate = new Date(event.start_at)
    const emailHtml = orderConfirmationEmail({
      orderRef,
      koperNaam,
      concertTitel: event.titel,
      concertDatum: eventDate.toLocaleDateString('nl-NL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      concertLocatie: event.locatie,
      tickets: tickets.map((t: any) => `${t.aantal}x ${t.categorie} (€${t.prijs.toFixed(2)})`).join(', '),
      totaalBedrag: totalAmount,
      betaalUrl: molliePayment._links.checkout.href
    })

    await sendEmail({
      to: koperEmail,
      subject: `Bestelbevestiging ${orderRef} - ${event.titel}`,
      html: emailHtml
    }, c.env.RESEND_API_KEY)

    // Redirect to Mollie payment page
    return c.redirect(molliePayment._links.checkout.href)
    
  } catch (error) {
    console.error('Order processing error:', error)
    return c.html(
      <Layout title="Fout bij bestelling">
        <div class="max-w-2xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-exclamation-triangle text-6xl text-red-500 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-4">Er ging iets mis</h1>
          <p class="text-gray-600 mb-8">
            {(error as Error).message}
          </p>
          <a href="/" class="text-animato-primary hover:underline">
            Terug naar homepage
          </a>
        </div>
      </Layout>
    )
  }
})

// ==========================================
// ORDER CONFIRMATION PAGE
// ==========================================
app.get('/tickets/bevestiging/:orderRef', async (c) => {
  const orderRef = c.req.param('orderRef')
  const user = c.get('user') as SessionUser | null
  const isMockPayment = c.req.query('mock') === 'true'
  
  // Get ticket order
  const ticket = await queryOne(c.env.DB, `
    SELECT t.*, c.programma, e.titel, e.start_at, e.locatie
    FROM tickets t
    JOIN concerts c ON c.id = t.concert_id
    JOIN events e ON e.id = c.event_id
    WHERE t.order_ref = ?
  `, [orderRef])
  
  if (!ticket) {
    return c.html(
      <Layout title="Bestelling niet gevonden" user={user}>
        <div class="max-w-2xl mx-auto px-4 py-16 text-center">
          <i class="fas fa-search text-6xl text-gray-300 mb-4"></i>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Bestelling niet gevonden</h1>
          <p class="text-gray-600">
            We konden geen bestelling vinden met deze referentie.
          </p>
        </div>
      </Layout>
    )
  }

  // Auto-mark mock payments as paid for development testing
  if (isMockPayment && ticket.status === 'pending') {
    await execute(c.env.DB, `
      UPDATE tickets 
      SET status = 'paid' 
      WHERE order_ref = ?
    `, [orderRef])
    ticket.status = 'paid'
  }

  const eventDate = new Date(ticket.start_at)

  return c.html(
    <Layout title="Bestelbevestiging" user={user}>
      <div class="py-12 bg-gray-50">
        <div class="max-w-3xl mx-auto px-4">
          {/* Success Message */}
          <div class="bg-green-50 border border-green-200 rounded-lg p-8 mb-8 text-center">
            <i class="fas fa-check-circle text-6xl text-green-500 mb-4"></i>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              Bestelling Ontvangen!
            </h1>
            <p class="text-gray-700 text-lg mb-4">
              Je bestelling is succesvol geplaatst.
            </p>
            {isMockPayment && (
              <div class="inline-block bg-yellow-100 border border-yellow-300 rounded-lg px-4 py-2 mb-4">
                <div class="flex items-center gap-2 text-sm text-yellow-800">
                  <i class="fas fa-flask"></i>
                  <span><strong>Development Mode:</strong> Mock betaling (automatisch geaccepteerd)</span>
                </div>
              </div>
            )}
            <div class="inline-block bg-white rounded-lg px-6 py-3 shadow-md">
              <div class="text-sm text-gray-600 mb-1">Bestel referentie</div>
              <div class="text-2xl font-mono font-bold text-gray-900">
                {ticket.order_ref}
              </div>
            </div>
          </div>

          {/* Order Details */}
          <div class="bg-white rounded-lg shadow-md overflow-hidden mb-8">
            <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white p-6">
              <h2 class="text-2xl font-bold mb-2">{ticket.titel}</h2>
              <div class="flex flex-wrap gap-4 text-sm">
                <span>
                  <i class="fas fa-calendar mr-2"></i>
                  {eventDate.toLocaleDateString('nl-NL', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                  })}
                </span>
                <span>
                  <i class="fas fa-clock mr-2"></i>
                  {eventDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} uur
                </span>
                <span>
                  <i class="fas fa-map-marker-alt mr-2"></i>
                  {ticket.locatie}
                </span>
              </div>
            </div>

            <div class="p-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 class="font-semibold text-gray-900 mb-2">Klantgegevens</h3>
                  <div class="text-sm space-y-1">
                    <div class="text-gray-700">{ticket.koper_naam}</div>
                    <div class="text-gray-600">{ticket.koper_email}</div>
                    {ticket.koper_telefoon && (
                      <div class="text-gray-600">{ticket.koper_telefoon}</div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 class="font-semibold text-gray-900 mb-2">Bestelling</h3>
                  <div class="text-sm space-y-1">
                    <div class="text-gray-700">{ticket.categorie}</div>
                    <div class="text-gray-600">{ticket.aantal} ticket(s)</div>
                    <div class="text-2xl font-bold text-animato-primary mt-2">
                      €{ticket.prijs_totaal.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Status */}
              <div class={`p-4 rounded-lg ${
                ticket.status === 'paid' 
                  ? 'bg-green-50 border border-green-200' 
                  : 'bg-yellow-50 border border-yellow-200'
              }`}>
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-semibold text-gray-900 mb-1">
                      Betalingsstatus
                    </div>
                    <div class="text-sm text-gray-600">
                      {ticket.status === 'paid' 
                        ? 'Betaling ontvangen - je tickets zijn geldig' 
                        : 'Wacht op betaling - betaalinstructies zijn verstuurd per email'}
                    </div>
                  </div>
                  <div class={`px-4 py-2 rounded-full font-semibold ${
                    ticket.status === 'paid'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {ticket.status === 'paid' ? 'BETAALD' : 'PENDING'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Next Steps */}
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 class="font-bold text-gray-900 mb-3 flex items-center">
              <i class="fas fa-info-circle text-blue-600 mr-2"></i>
              Wat gebeurt er nu?
            </h3>
            <ul class="space-y-2 text-sm text-gray-700">
              <li class="flex items-start">
                <i class="fas fa-check text-blue-600 mr-3 mt-1"></i>
                <span>Je ontvangt een bevestigingsmail op <strong>{ticket.koper_email}</strong></span>
              </li>
              <li class="flex items-start">
                <i class="fas fa-check text-blue-600 mr-3 mt-1"></i>
                <span>Na betaling ontvang je je tickets met QR-code per email</span>
              </li>
              <li class="flex items-start">
                <i class="fas fa-check text-blue-600 mr-3 mt-1"></i>
                <span>Toon de QR-code bij de ingang van het concert</span>
              </li>
              <li class="flex items-start">
                <i class="fas fa-check text-blue-600 mr-3 mt-1"></i>
                <span>Bewaar je bestelreferentie: <strong>{ticket.order_ref}</strong></span>
              </li>
            </ul>
          </div>

          {/* Payment Link (if pending) */}
          {ticket.status === 'pending' && ticket.betaling_id && (
            <div class="mt-8 text-center">
              <a
                href={`https://www.mollie.com/checkout/${ticket.betaling_id}`}
                class="inline-flex items-center bg-animato-primary text-white px-8 py-3 rounded-lg hover:bg-opacity-90 transition text-lg font-semibold"
              >
                <i class="fas fa-credit-card mr-2"></i>
                Betaling Voltooien
              </a>
              <p class="text-sm text-gray-600 mt-3">
                Voltooi je betaling om je tickets te ontvangen
              </p>
            </div>
          )}

          {/* Actions */}
          <div class="mt-8 text-center">
            <a
              href="/concerten"
              class="inline-flex items-center bg-gray-100 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-200 transition mr-4"
            >
              <i class="fas fa-calendar mr-2"></i>
              Bekijk meer concerten
            </a>
            <a
              href="/"
              class="inline-flex items-center text-animato-primary hover:underline"
            >
              Terug naar homepage
            </a>
          </div>

          {/* Auto-refresh for payment status */}
          {ticket.status === 'pending' && (
            <script dangerouslySetInnerHTML={{ __html: `
              // Check payment status every 5 seconds
              let checkCount = 0;
              const maxChecks = 60; // Stop after 5 minutes
              
              async function checkPaymentStatus() {
                if (checkCount >= maxChecks) return;
                checkCount++;
                
                try {
                  const response = await fetch('/api/tickets/${ticket.order_ref}/payment-status');
                  const data = await response.json();
                  
                  if (data.status === 'paid') {
                    // Payment completed! Reload page to show success
                    window.location.reload();
                  } else if (data.status === 'cancelled') {
                    // Payment failed, show message
                    window.location.reload();
                  }
                } catch (error) {
                  console.error('Status check failed:', error);
                }
              }
              
              // Check every 5 seconds
              setInterval(checkPaymentStatus, 5000);
              
              // Also check immediately
              setTimeout(checkPaymentStatus, 2000);
            ` }} />
          )}
        </div>
      </div>
    </Layout>
  )
})

export default app
