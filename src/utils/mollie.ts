// ============================================================
// Mollie Payment Wrapper
// ============================================================
//
// Production-ready Mollie integration.
// - Gebruikt https://api.mollie.com/v2/payments (Bearer-auth)
// - Valt terug op mock-modus wanneer de API-key begint met 'mock'
//   of volledig ontbreekt (handig voor lokale dev zonder Mollie-account)
// - Alle functies zijn puur; ze raken géén database. De aanroeper
//   geeft de key door (of gebruikt getMollieApiKey() uit mollie-config.ts)
//
// Documentatie:
//   https://docs.mollie.com/reference/v2/payments-api/create-payment
//   https://docs.mollie.com/overview/webhook
// ============================================================

interface PaymentData {
  amount: number           // in EUR, wordt intern geformatteerd als "12.34"
  description: string
  redirectUrl: string
  webhookUrl: string
  metadata: any
  // Optioneel: beperk betaalmethodes (bv. ['bancontact'] of ['ideal','creditcard'])
  methods?: string[]
}

export interface MolliePayment {
  id: string
  status: 'open' | 'pending' | 'paid' | 'authorized' | 'canceled' | 'expired' | 'failed'
  amount: { value: string; currency: string }
  description?: string
  metadata?: any
  createdAt?: string
  paidAt?: string
  canceledAt?: string
  expiresAt?: string
  _links?: {
    checkout?: { href: string; type: string }
    self?: { href: string; type: string }
  }
  // Compat alias voor bestaande code
  checkoutUrl?: string
}

// ----- In-memory mock store (alleen dev) ---------------------
// NB: in een Cloudflare Worker leeft dit per-isolaat; prima voor dev-tests
const mockPayments = new Map<string, any>()

function isMockKey(apiKey: string | undefined): boolean {
  if (!apiKey) return true
  const trimmed = apiKey.trim()
  if (!trimmed) return true
  return trimmed === 'mock' || trimmed.startsWith('mock_')
}

/**
 * Herkent of een key in live- of test-modus draait.
 * Test-keys beginnen bij Mollie altijd met "test_"; live met "live_".
 */
export function getMollieMode(apiKey: string | undefined): 'test' | 'live' | 'mock' | 'invalid' {
  if (isMockKey(apiKey)) return 'mock'
  const k = (apiKey || '').trim()
  if (k.startsWith('test_')) return 'test'
  if (k.startsWith('live_')) return 'live'
  return 'invalid'
}

/**
 * Maak een nieuwe Mollie betaling aan.
 * Retourneert object met id + checkoutUrl (ook in mock-modus).
 */
export async function createMolliePayment(
  apiKey: string | undefined,
  data: PaymentData
): Promise<MolliePayment> {
  // --- Mock-modus: geen echte API-call ---
  if (isMockKey(apiKey)) {
    console.warn('[Mollie] Mock-modus actief — geen echte betaling aangemaakt')
    const id = 'tr_MOCK_' + Math.random().toString(36).substr(2, 9)
    const payment: MolliePayment = {
      id,
      status: 'paid', // auto-paid zodat dev-flow door kan
      amount: { value: data.amount.toFixed(2), currency: 'EUR' },
      description: data.description,
      metadata: data.metadata,
      createdAt: new Date().toISOString(),
      checkoutUrl: data.redirectUrl + (data.redirectUrl.includes('?') ? '&' : '?') + 'payment_id=' + id,
      _links: {
        checkout: {
          href: data.redirectUrl + (data.redirectUrl.includes('?') ? '&' : '?') + 'payment_id=' + id,
          type: 'text/html'
        }
      }
    }
    mockPayments.set(id, payment)
    return payment
  }

  // --- Validatie ---
  const mode = getMollieMode(apiKey)
  if (mode === 'invalid') {
    throw new Error('Ongeldige Mollie API-key (moet beginnen met test_ of live_)')
  }

  // --- Echte Mollie API call ---
  const body = {
    amount: {
      currency: 'EUR',
      value: data.amount.toFixed(2),
    },
    description: data.description.substring(0, 255), // Mollie limit
    redirectUrl: data.redirectUrl,
    webhookUrl: data.webhookUrl,
    metadata: data.metadata,
    ...(data.methods && data.methods.length > 0 ? { method: data.methods } : {}),
  }

  const response = await fetch('https://api.mollie.com/v2/payments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Mollie] API error:', response.status, errorText)
    throw new Error(`Mollie API error (${response.status}): ${errorText.substring(0, 200)}`)
  }

  const payment = await response.json() as any

  // Compat-veld voor bestaande code die `.checkoutUrl` verwacht
  payment.checkoutUrl = payment._links?.checkout?.href

  return payment as MolliePayment
}

/**
 * Haal een bestaande Mollie betaling op (voor webhook-handlers).
 */
export async function getMolliePayment(
  apiKey: string | undefined,
  paymentId: string
): Promise<MolliePayment | null> {
  // --- Mock-modus ---
  if (isMockKey(apiKey) || paymentId.startsWith('tr_MOCK_')) {
    if (mockPayments.has(paymentId)) {
      return mockPayments.get(paymentId)
    }
    // Fallback voor onbekende mock-IDs
    return {
      id: paymentId,
      status: 'paid',
      amount: { value: '10.00', currency: 'EUR' },
    }
  }

  // --- Echte API-call ---
  const response = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Mollie] API error bij ophalen betaling:', response.status, errorText)
    throw new Error(`Mollie API error (${response.status}): ${errorText.substring(0, 200)}`)
  }

  const payment = await response.json() as any
  payment.checkoutUrl = payment._links?.checkout?.href
  return payment as MolliePayment
}

/**
 * Test of een API-key geldig is door een simpel methods-call te doen.
 * Handig voor de admin-instellingenpagina.
 */
export async function validateMollieApiKey(apiKey: string | undefined): Promise<{
  valid: boolean
  mode: 'test' | 'live' | 'mock' | 'invalid'
  error?: string
  profileName?: string
}> {
  const mode = getMollieMode(apiKey)

  if (mode === 'mock') return { valid: true, mode: 'mock' }
  if (mode === 'invalid') return { valid: false, mode: 'invalid', error: 'Key moet beginnen met test_ of live_' }

  try {
    // GET /v2/methods is een lichte call die direct valideert of de key werkt
    const response = await fetch('https://api.mollie.com/v2/methods', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    })

    if (response.status === 401) {
      return { valid: false, mode, error: 'API-key ongeldig of ingetrokken' }
    }
    if (!response.ok) {
      const errorText = await response.text()
      return { valid: false, mode, error: `HTTP ${response.status}: ${errorText.substring(0, 200)}` }
    }

    return { valid: true, mode }
  } catch (err: any) {
    return { valid: false, mode, error: err?.message || 'Onbekende fout' }
  }
}
