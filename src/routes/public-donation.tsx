import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { createMolliePayment } from '../utils/mollie'
import { execute } from '../utils/db'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/steun-ons', (c) => {
  return c.html(
    <Layout title="Steun Animato" currentPath="/steun-ons">
      <div class="py-12 bg-gray-50 min-h-screen">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="text-center mb-12">
            <h1 class="text-4xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
              Steun Gemengd Koor Animato
            </h1>
            <p class="text-xl text-gray-600 max-w-2xl mx-auto">
              Help ons om prachtige muziek te blijven maken. Uw gift ondersteunt onze concerten, educatieve projecten en de muzikale groei van ons koor.
            </p>
          </div>

          <div class="bg-white rounded-xl shadow-lg overflow-hidden md:flex">
            <div class="md:w-1/2 bg-animato-primary p-12 text-white flex flex-col justify-center relative overflow-hidden">
              <div class="absolute inset-0 opacity-10 bg-repeat" style="background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=');"></div>
              <h3 class="text-2xl font-bold mb-6 relative z-10">Waarom doneren?</h3>
              <ul class="space-y-4 relative z-10">
                <li class="flex items-start">
                  <i class="fas fa-music mt-1 mr-3 text-pink-300"></i>
                  <span>Aankoop van nieuwe partituren</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-microphone mt-1 mr-3 text-pink-300"></i>
                  <span>Onderhoud van audio-apparatuur</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-home mt-1 mr-3 text-pink-300"></i>
                  <span>Huur van repetitieruimtes en concertzalen</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-graduation-cap mt-1 mr-3 text-pink-300"></i>
                  <span>Workshops en stemvorming</span>
                </li>
              </ul>
              <div class="mt-8 pt-8 border-t border-white/20 relative z-10">
                <p class="italic">"Muziek verbindt mensen. Met uw steun bouwen we verder aan die verbinding."</p>
              </div>
            </div>

            <div class="md:w-1/2 p-8 md:p-12 bg-white">
              <form action="/api/public/donatie" method="POST">
                <h3 class="text-xl font-bold text-gray-900 mb-6">Doe een gift</h3>
                
                <div class="mb-6">
                  <label class="block text-sm font-medium text-gray-700 mb-2">Ik wil graag doneren:</label>
                  <div class="grid grid-cols-3 gap-3 mb-3">
                    <button type="button" onclick="setAmount(10)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition text-gray-700">€ 10</button>
                    <button type="button" onclick="setAmount(25)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition text-gray-700">€ 25</button>
                    <button type="button" onclick="setAmount(50)" class="donation-btn py-2 border rounded-lg hover:bg-pink-50 hover:border-pink-300 transition text-gray-700">€ 50</button>
                  </div>
                  <div class="relative rounded-md shadow-sm">
                    <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span class="text-gray-500 sm:text-sm">€</span>
                    </div>
                    <input type="number" name="amount" id="customAmount" step="0.01" min="1" class="block w-full rounded-md border-gray-300 pl-7 pr-12 focus:border-pink-500 focus:ring-pink-500 py-3 text-lg" placeholder="Eigen bedrag" required />
                  </div>
                </div>

                <div class="space-y-4 mb-6">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Naam (optioneel)</label>
                    <input type="text" name="name" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-pink-500 focus:ring-pink-500 sm:text-sm px-4 py-2 border" placeholder="Uw naam" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Email (optioneel)</label>
                    <input type="email" name="email" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-pink-500 focus:ring-pink-500 sm:text-sm px-4 py-2 border" placeholder="voor bedankje" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Bericht (optioneel)</label>
                    <textarea name="message" rows={2} class="block w-full rounded-md border-gray-300 shadow-sm focus:border-pink-500 focus:ring-pink-500 sm:text-sm px-4 py-2 border" placeholder="Een boodschap voor het koor..."></textarea>
                  </div>
                </div>

                <button type="submit" class="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-3 px-4 rounded-lg transition shadow flex items-center justify-center transform hover:-translate-y-0.5">
                  <i class="fas fa-heart mr-2"></i>
                  Nu Doneren
                </button>
                <p class="text-xs text-center text-gray-500 mt-4">
                  Veilig betalen via Mollie (Bancontact, Payconiq, etc.)
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{__html: `
        function setAmount(val) {
            document.getElementById('customAmount').value = val;
        }
      `}} />
    </Layout>
  )
})

app.post('/api/public/donatie', async (c) => {
    const body = await c.req.parseBody()
    const amount = parseFloat(String(body.amount))
    const name = String(body.name || 'Anoniem')
    const email = String(body.email || '')
    
    if (!amount || amount < 1) return c.redirect('/steun-ons?error=invalid_amount')

    const siteUrl = c.env.SITE_URL || 'https://animato.be'
    
    // 1. Create Donation Record (User ID is NULL for public)
    // We store name/email in the message or a JSON field if we had one, 
    // for now let's prepend to message
    const publicMessage = `[Publiek: ${name} <${email}>] ${body.message || ''}`

    const insertRes = await execute(c.env.DB, `
        INSERT INTO donations (user_id, amount, message, is_anonymous, status)
        VALUES (NULL, ?, ?, 0, 'pending')
    `, [amount, publicMessage])
    
    const donationId = insertRes.meta.last_row_id

    // 2. Create Payment
    const payment = await createMolliePayment(c.env.MOLLIE_API_KEY, {
        amount: amount,
        description: `Gift Animato - ${name}`,
        redirectUrl: `${siteUrl}/steun-ons?success=true`,
        webhookUrl: `${siteUrl}/api/webhooks/mollie`,
        metadata: {
            type: 'donation',
            donation_id: donationId,
            is_public: true
        }
    })

    // 3. Update DB
    await execute(c.env.DB, `UPDATE donations SET payment_id = ?, status = 'pending' WHERE id = ?`, [payment.id, donationId])

    return c.redirect(payment.checkoutUrl)
})

export default app