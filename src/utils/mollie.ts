// Mollie Payment Wrapper (Stub)
// Future integration point for Mollie API

interface PaymentData {
  amount: number
  description: string
  redirectUrl: string
  webhookUrl: string
  metadata: any
}

export async function createMolliePayment(apiKey: string, data: PaymentData) {
  if (!apiKey) {
    console.warn('Mollie API Key missing. Simulating payment.')
    return {
      id: 'tr_TEST_' + Math.random().toString(36).substr(2, 9),
      status: 'open',
      checkoutUrl: data.redirectUrl + '?payment=simulated_success' // Auto-redirect for testing
    }
  }

  // Real Mollie API call would go here
  // const response = await fetch('https://api.mollie.com/v2/payments', { ... })
  
  return {
    id: 'tr_MOCK_' + Math.random().toString(36).substr(2, 9),
    status: 'open',
    checkoutUrl: data.redirectUrl
  }
}

export async function getMolliePayment(apiKey: string, paymentId: string) {
  if (!apiKey || paymentId.startsWith('tr_MOCK_')) {
    // Mock response
    return {
      id: paymentId,
      status: 'paid', // Always return paid for mock for now
      amount: { value: '10.00', currency: 'EUR' }
    }
  }
  
  // Real API implementation would go here
  return null
}
