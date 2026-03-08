// Mollie Payment Wrapper (Stub)
// Future integration point for Mollie API

interface PaymentData {
  amount: number
  description: string
  redirectUrl: string
  webhookUrl: string
  metadata: any
}

// In-memory store for mock payments (works in persistent Node process)
const mockPayments = new Map<string, any>();

export async function createMolliePayment(apiKey: string, data: PaymentData) {
  if (!apiKey || apiKey === 'mock') {
    console.warn('Mollie API Key missing or mock. Simulating payment.')
    const id = 'tr_MOCK_' + Math.random().toString(36).substr(2, 9)
    
    // Store metadata for retrieval
    mockPayments.set(id, {
        id,
        status: 'paid', // Auto-set to paid for convenience in dev
        amount: { value: data.amount.toFixed(2), currency: 'EUR' },
        metadata: data.metadata,
        createdAt: new Date().toISOString()
    })

    return {
      id,
      status: 'open',
      checkoutUrl: data.redirectUrl + '?payment_id=' + id // Pass ID for tracking
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
    // Return stored mock payment if available
    if (mockPayments.has(paymentId)) {
        return mockPayments.get(paymentId);
    }
    
    // Fallback for untracked mocks
    return {
      id: paymentId,
      status: 'paid', 
      amount: { value: '10.00', currency: 'EUR' }
    }
  }
  
  // Real API implementation would go here
  return null
}
