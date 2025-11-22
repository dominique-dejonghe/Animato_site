// Mollie Payment Integration
// Handles payment creation, status checks, and webhooks

export interface MolliePayment {
  id: string
  status: string
  amount: {
    value: string
    currency: string
  }
  description: string
  redirectUrl: string
  webhookUrl: string
  metadata?: any
  _links: {
    checkout: {
      href: string
    }
  }
}

// Create a new Mollie payment
export async function createMolliePayment(
  apiKey: string,
  data: {
    amount: number
    description: string
    redirectUrl: string
    webhookUrl: string
    metadata?: any
  }
): Promise<MolliePayment | null> {
  try {
    const response = await fetch('https://api.mollie.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: {
          currency: 'EUR',
          value: data.amount.toFixed(2)
        },
        description: data.description,
        redirectUrl: data.redirectUrl,
        webhookUrl: data.webhookUrl,
        metadata: data.metadata || {}
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Mollie payment creation failed:', error)
      return null
    }

    const payment = await response.json() as MolliePayment
    return payment
  } catch (error) {
    console.error('Mollie API error:', error)
    return null
  }
}

// Get payment status
export async function getMolliePayment(
  apiKey: string,
  paymentId: string
): Promise<MolliePayment | null> {
  try {
    const response = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Mollie payment fetch failed:', error)
      return null
    }

    const payment = await response.json() as MolliePayment
    return payment
  } catch (error) {
    console.error('Mollie API error:', error)
    return null
  }
}

// Check if payment is paid
export function isPaymentPaid(payment: MolliePayment): boolean {
  return payment.status === 'paid'
}

// Check if payment is pending
export function isPaymentPending(payment: MolliePayment): boolean {
  return ['open', 'pending'].includes(payment.status)
}

// Check if payment is failed
export function isPaymentFailed(payment: MolliePayment): boolean {
  return ['failed', 'expired', 'canceled'].includes(payment.status)
}

// Map Mollie status to our ticket status
export function mapMollieStatusToTicketStatus(mollieStatus: string): string {
  const statusMap: Record<string, string> = {
    'paid': 'paid',
    'open': 'pending',
    'pending': 'pending',
    'failed': 'cancelled',
    'expired': 'cancelled',
    'canceled': 'cancelled'
  }
  
  return statusMap[mollieStatus] || 'pending'
}
