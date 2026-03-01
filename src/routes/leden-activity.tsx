import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth } from '../middleware/auth'
import { queryOne, queryAll, execute } from '../utils/db'
import { createMolliePayment } from '../utils/mollie'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', requireAuth)

// === ACTIVITY INDEX PAGE ===
app.get('/leden/activiteiten', async (c) => {
  const user = c.get('user') as SessionUser

  // Get upcoming activities
  const activities = await queryAll(c.env.DB, `
    SELECT a.*, e.titel, e.start_at, e.locatie, e.beschrijving,
           (SELECT COUNT(*) FROM activity_registrations ar WHERE ar.activity_id = a.id AND ar.user_id = ?) as is_registered
    FROM activities a
    JOIN events e ON a.event_id = e.id
    WHERE e.start_at >= datetime('now')
    ORDER BY e.start_at ASC
  `, [user.id])

  return c.html(
    <Layout title="Activiteiten" user={user}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
                Activiteiten & Inschrijvingen
              </h1>
              <p class="text-gray-600">
                Schrijf je in voor aankomende evenementen, feesten en speciale activiteiten.
              </p>
            </div>
            <a href="/leden" class="text-animato-primary hover:underline">
              <i class="fas fa-arrow-left mr-2"></i>
              Terug naar dashboard
            </a>
          </div>

          <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {activities.map((act: any) => (
              <div class="bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-full hover:shadow-lg transition-shadow duration-300">
                <div class="relative h-48 bg-gray-200">
                  {act.image_url ? (
                    <img src={act.image_url} alt={act.titel} class="w-full h-full object-cover" />
                  ) : (
                    <div class="flex items-center justify-center h-full bg-animato-primary bg-opacity-10 text-animato-primary">
                      <i class="fas fa-calendar-alt text-4xl"></i>
                    </div>
                  )}
                  {act.is_registered > 0 && (
                    <div class="absolute top-4 right-4 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                      <i class="fas fa-check mr-1"></i> Ingeschreven
                    </div>
                  )}
                </div>
                <div class="p-6 flex-1 flex flex-col">
                  <div class="flex items-center text-sm text-gray-500 mb-2">
                    <i class="far fa-calendar mr-2"></i>
                    {new Date(act.start_at).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <h3 class="text-xl font-bold text-gray-900 mb-2 line-clamp-2">
                    {act.titel}
                  </h3>
                  <p class="text-gray-600 text-sm mb-4 line-clamp-3 flex-1">
                    {act.intro_text || act.beschrijving || 'Geen beschrijving beschikbaar.'}
                  </p>
                  
                  <div class="mt-auto border-t border-gray-100 pt-4 flex items-center justify-between">
                    <div class="text-sm font-medium">
                      <span class="text-animato-primary">€{act.price_member > 0 ? act.price_member.toFixed(2) : 'Gratis'}</span>
                      {act.price_guest > 0 && <span class="text-gray-400 text-xs ml-1">(Gasten: €{act.price_guest})</span>}
                    </div>
                    <a href={`/leden/activiteiten/${act.id}`} class={`px-4 py-2 rounded text-sm font-medium transition-colors ${act.is_registered > 0 ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200' : 'bg-animato-primary text-white hover:bg-opacity-90'}`}>
                      {act.is_registered > 0 ? 'Bekijk Inschrijving' : 'Inschrijven'}
                    </a>
                  </div>
                </div>
              </div>
            ))}
            
            {activities.length === 0 && (
              <div class="col-span-full text-center py-12 bg-white rounded-lg shadow-sm border border-dashed border-gray-300">
                <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                  <i class="far fa-calendar-times text-2xl"></i>
                </div>
                <h3 class="text-lg font-medium text-gray-900 mb-1">Geen activiteiten gevonden</h3>
                <p class="text-gray-500">Er zijn momenteel geen openstaande inschrijvingen.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

// === DETAIL / RSVP PAGE ===
app.get('/leden/activiteiten/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const id = c.req.param('id')

  // Get activity details
  const activity = await queryOne<any>(c.env.DB, `
    SELECT a.*, e.titel, e.start_at, e.locatie, e.beschrijving, e.doelgroep
    FROM activities a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `, [id])

  if (!activity) return c.redirect('/leden')

  // Get custom fields
  const customFields = await queryAll(c.env.DB, `
    SELECT * FROM activity_custom_fields WHERE activity_id = ? ORDER BY sort_order
  `, [id])

  // Get existing registration
  const registration = await queryOne<any>(c.env.DB, `
    SELECT * FROM activity_registrations WHERE activity_id = ? AND user_id = ?
  `, [id, user.id])

  // Enhance existing registration with custom answers if needed for edit
  if (registration) {
    registration.answers = await queryAll(c.env.DB, `
      SELECT field_id, value FROM activity_custom_answers WHERE registration_id = ?
    `, [registration.id])
  }

  // Track "seen" status if invitation exists
  await execute(c.env.DB, `
    UPDATE activity_invitations SET status = 'seen', seen_at = CURRENT_TIMESTAMP 
    WHERE activity_id = ? AND user_id = ? AND status = 'sent'
  `, [id, user.id])

  const isEditing = c.req.query('edit') === '1';

  return c.html(
    <Layout title={activity.titel} user={user}>
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="mb-6">
            <a href="/leden" class="text-animato-primary hover:underline"><i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard</a>
          </div>

          <div class="bg-white rounded-lg shadow-lg overflow-hidden">
            <div class="bg-animato-primary p-8 text-white">
              <h1 class="text-3xl font-bold mb-2" style="font-family: 'Playfair Display', serif;">{activity.titel}</h1>
              <div class="flex gap-6 text-sm opacity-90">
                <span><i class="far fa-calendar mr-2"></i> {new Date(activity.start_at).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                <span><i class="fas fa-map-marker-alt mr-2"></i> {activity.locatie}</span>
              </div>
            </div>

            <div class="p-8">
              <div class="prose max-w-none mb-8 text-gray-600">
                {activity.intro_text || activity.beschrijving}
              </div>

              {registration && !isEditing ? (
                // === ALREADY REGISTERED STATE ===
                <div class={`border-l-4 p-6 rounded-r-lg ${registration.status === 'paid' ? 'bg-green-50 border-green-500' : 'bg-yellow-50 border-yellow-500'}`}>
                  <div class="flex justify-between items-start">
                    <div>
                      <h3 class={`text-lg font-bold mb-2 ${registration.status === 'paid' ? 'text-green-800' : 'text-yellow-800'}`}>
                        {registration.status === 'paid' ? 'Je bent ingeschreven! 🎉' : 'Inschrijving ontvangen (Nog te betalen)'}
                      </h3>
                      <p class="text-gray-700">
                        Je komt met <strong>{1 + registration.guest_count} personen</strong>.
                        {registration.dietary_requirements && <br/>}
                        {registration.dietary_requirements && <span class="italic text-sm">Dieetwensen: {registration.dietary_requirements}</span>}
                      </p>
                      
                      {registration.answers && registration.answers.length > 0 && (
                        <div class={`mt-3 pt-2 border-t ${registration.status === 'paid' ? 'border-green-200' : 'border-yellow-200'}`}>
                          {registration.answers.map((ans: any) => (
                            <div class="text-sm mb-1">
                              <span class="font-semibold opacity-80">{ans.label}:</span> <span>{ans.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {registration.status !== 'paid' && registration.mollie_payment_id && (
                         <div class="mt-4">
                           <p class="text-sm text-yellow-700 mb-2">De betaling is nog niet afgerond.</p>
                           {/* Ideally link to Mollie checkout URL here if stored, or allow re-payment */}
                         </div>
                      )}
                    </div>
                    <a href={`?edit=1`} class="text-sm bg-white border border-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-50 transition">
                      <i class="fas fa-edit mr-1"></i> Wijzig
                    </a>
                  </div>
                </div>
              ) : (
                // === RSVP FORM (New or Edit) ===
                <form action="/api/leden/activiteiten/rsvp" method="POST" class="bg-gray-50 p-6 rounded-lg border border-gray-200">
                  <h3 class="text-xl font-bold text-gray-900 mb-4">{isEditing ? 'Inschrijving Wijzigen' : 'Schrijf je in'}</h3>
                  <input type="hidden" name="activity_id" value={activity.id} />
                  
                  <div class="space-y-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">
                        Kom je naar dit event?
                      </label>
                      <div class="flex gap-4">
                        <label class="flex items-center">
                          <input type="radio" name="attending" value="yes" checked class="text-animato-primary focus:ring-animato-primary" />
                          <span class="ml-2">Ja, ik ben erbij!</span>
                        </label>
                        {/* 'No' option could be implemented to track refusals */}
                      </div>
                    </div>

                    {activity.max_guests > 0 && (
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                          Aantal gasten/partners (exclusief jezelf)
                        </label>
                        <select name="guest_count" id="guest_count" class="w-full border rounded px-3 py-2" onchange="calculateTotal()">
                          <option value="0" selected={registration?.guest_count === 0}>Alleen ikzelf</option>
                          {[...Array(activity.max_guests).keys()].map(i => (
                            <option value={i+1} selected={registration?.guest_count === i+1}>{i+1} gast(en)</option>
                          ))}
                        </select>
                        <p class="text-xs text-gray-500 mt-1">Prijs per gast: €{activity.price_guest}</p>
                      </div>
                    )}

                    {/* Custom Fields */}
                    {customFields.map((field: any) => {
                      // Find existing answer if editing
                      const answer = registration?.answers?.find((a: any) => a.field_id === field.id)?.value;
                      
                      return (
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                          {field.label} {field.is_required ? '*' : ''}
                        </label>
                        {field.field_type === 'text' && (
                          <input type="text" name={`custom_field_${field.id}`} value={answer || ''} required={field.is_required} class="w-full border rounded px-3 py-2" />
                        )}
                        {field.field_type === 'textarea' && (
                          <textarea name={`custom_field_${field.id}`} required={field.is_required} rows={3} class="w-full border rounded px-3 py-2">{answer || ''}</textarea>
                        )}
                        {field.field_type === 'select' && (
                          <select name={`custom_field_${field.id}`} required={field.is_required} class="w-full border rounded px-3 py-2">
                            <option value="">-- Maak een keuze --</option>
                            {field.options?.split(',').map((opt: string) => (
                              <option value={opt.trim()} selected={answer === opt.trim()}>{opt.trim()}</option>
                            ))}
                          </select>
                        )}
                        {field.field_type === 'radio' && (
                          <div class="space-y-2">
                            {field.options?.split(',').map((opt: string) => (
                              <label class="flex items-center">
                                <input type="radio" name={`custom_field_${field.id}`} value={opt.trim()} checked={answer === opt.trim()} required={field.is_required} class="text-animato-primary focus:ring-animato-primary" />
                                <span class="ml-2 text-sm text-gray-700">{opt.trim()}</span>
                              </label>
                            ))}
                          </div>
                        )}
                        {field.field_type === 'checkbox' && (
                          <label class="flex items-center">
                            <input type="checkbox" name={`custom_field_${field.id}`} value="yes" checked={answer === 'yes'} required={field.is_required} class="text-animato-primary focus:ring-animato-primary" />
                            <span class="ml-2 text-sm text-gray-700">Ja</span>
                          </label>
                        )}
                      </div>
                    )})}

                    <div class="pt-4 border-t border-gray-200">
                      <div id="price-container" class="flex justify-between items-center mb-4 hidden">
                        <div>
                          <p class="text-sm text-gray-600">Totaal te betalen:</p>
                          <p class="text-2xl font-bold text-animato-primary" id="total_price">€{activity.price_member}</p>
                        </div>
                        <button type="submit" class="bg-animato-primary text-white px-8 py-3 rounded-lg hover:opacity-90 font-semibold shadow-md">
                          Inschrijven
                        </button>
                      </div>
                      
                      {/* Button when price is 0 or hidden */}
                      <div id="free-button-container" class="flex justify-end mb-4">
                         <button type="submit" class="bg-animato-primary text-white px-8 py-3 rounded-lg hover:opacity-90 font-semibold shadow-md">
                          {isEditing ? 'Wijziging Opslaan' : 'Inschrijven'}
                        </button>
                      </div>
                      
                      {/* Payment Instructions if price > 0 */}
                      <div id="payment_info" class="hidden">
                         <div class="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
                           <strong><i class="fas fa-info-circle mr-1"></i> Betaling:</strong>
                           {activity.payment_instruction ? (
                             <div class="mt-1 whitespace-pre-wrap">{activity.payment_instruction}</div>
                           ) : (
                             <div class="mt-1">Betaalinstructies volgen na inschrijving.</div>
                           )}
                         </div>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>

          <script dangerouslySetInnerHTML={{ __html: `
            const priceMember = ${activity.price_member};
            const priceGuest = ${activity.price_guest};

            function calculateTotal() {
              const guests = parseInt(document.getElementById('guest_count')?.value || 0);
              const total = parseFloat(priceMember) + (guests * parseFloat(priceGuest));
              document.getElementById('total_price').textContent = '€' + total.toFixed(2);
              
              // Toggle visibility
              const priceContainer = document.getElementById('price-container');
              const freeButtonContainer = document.getElementById('free-button-container');
              const paymentInfo = document.getElementById('payment_info');
              
              if (total > 0) {
                if (priceContainer) priceContainer.classList.remove('hidden');
                if (freeButtonContainer) freeButtonContainer.classList.add('hidden');
                if (paymentInfo) paymentInfo.classList.remove('hidden');
              } else {
                if (priceContainer) priceContainer.classList.add('hidden');
                if (freeButtonContainer) freeButtonContainer.classList.remove('hidden');
                if (paymentInfo) paymentInfo.classList.add('hidden');
              }
            }
            
            // Run once on load
            calculateTotal();
          ` }} />
        </div>
      </div>
    </Layout>
  )
})

// === RSVP HANDLER ===
app.post('/api/leden/activiteiten/rsvp', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.parseBody()
  const db = c.env.DB

  const activityId = parseInt(String(body.activity_id))
  const guestCount = parseInt(String(body.guest_count || '0'))
  // const dietary = String(body.dietary || '') // Removed hardcoded dietary

  // Get prices
  const activity = await queryOne<any>(db, `SELECT * FROM activities WHERE id = ?`, [activityId])
  if (!activity) return c.redirect('/leden')

  const totalAmount = parseFloat(activity.price_member) + (guestCount * parseFloat(activity.price_guest))

  // Determine status (if free, immediately paid)
  let status = totalAmount > 0 ? 'pending' : 'paid'
  let mollieId = null
  let checkoutUrl = null

  // Setup Payment
  if (totalAmount > 0) {
    const siteUrl = c.env.SITE_URL || 'https://animato.be'
    const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
      amount: totalAmount,
      description: `Inschrijving ${activity.intro_text ? 'Activiteit' : 'Event'} - ${user.voornaam}`, // Fallback title
      redirectUrl: `${siteUrl}/leden/activiteiten/${activityId}?payment=success`,
      webhookUrl: `${siteUrl}/api/webhooks/mollie`,
      metadata: {
        type: 'activity',
        activity_id: activityId,
        user_id: user.id
      }
    })
    mollieId = payment.id
    checkoutUrl = payment.checkoutUrl
  }

  // Check if registration exists
  const existingRegistration = await queryOne<any>(db, `SELECT id FROM activity_registrations WHERE activity_id = ? AND user_id = ?`, [activityId, user.id])

  if (existingRegistration) {
    // UPDATE
    await execute(db, `
      UPDATE activity_registrations 
      SET guest_count = ?, amount = ?, status = ?, mollie_payment_id = ?
      WHERE id = ?
    `, [guestCount, totalAmount, status, mollieId, existingRegistration.id])
    
    const registrationId = existingRegistration.id
    
    // Clear old answers to overwrite
    await execute(db, `DELETE FROM activity_custom_answers WHERE registration_id = ?`, [registrationId])
    
    // Save Custom Answers (re-insert)
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('custom_field_')) {
        const fieldId = parseInt(key.replace('custom_field_', ''))
        await execute(db, `
          INSERT INTO activity_custom_answers (registration_id, field_id, value)
          VALUES (?, ?, ?)
        `, [registrationId, fieldId, String(value)])
      }
    }
  } else {
    // INSERT
    const regResult = await execute(db, `
      INSERT INTO activity_registrations (activity_id, user_id, guest_count, amount, status, mollie_payment_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [activityId, user.id, guestCount, totalAmount, status, mollieId])

    const registrationId = regResult.meta.last_row_id

    // Save Custom Answers
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('custom_field_')) {
        const fieldId = parseInt(key.replace('custom_field_', ''))
        await execute(db, `
          INSERT INTO activity_custom_answers (registration_id, field_id, value)
          VALUES (?, ?, ?)
        `, [registrationId, fieldId, String(value)])
      }
    }
  }

  if (checkoutUrl) {
    return c.redirect(checkoutUrl)
  }

  return c.redirect(`/leden/activiteiten/${activityId}?success=1`)
})

export default app
