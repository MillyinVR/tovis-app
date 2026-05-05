import Stripe from 'stripe'

let stripeClient: Stripe | null = null

export function mustGetEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(mustGetEnv('STRIPE_SECRET_KEY'), {
      apiVersion: '2026-04-22.dahlia',
    })
  }

  return stripeClient
}

export function getStripeWebhookSecret(): string {
  return mustGetEnv('STRIPE_WEBHOOK_SECRET')
}