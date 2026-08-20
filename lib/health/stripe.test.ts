// lib/health/stripe.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stripeMocks = vi.hoisted(() => ({
  retrieveBalance: vi.fn(),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ balance: { retrieve: stripeMocks.retrieveBalance } }),
}))

import { checkStripeHealth } from './stripe'

const SECRET = 'STRIPE_SECRET_KEY'
const PUBLISHABLE = 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'

const original: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of [SECRET, PUBLISHABLE]) original[key] = process.env[key]
  stripeMocks.retrieveBalance.mockReset()
})

afterEach(() => {
  for (const key of [SECRET, PUBLISHABLE]) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('checkStripeHealth key modes', () => {
  it('reports both modes when the environment is configured', async () => {
    process.env[SECRET] = 'sk_test_51TTTJabc'
    process.env[PUBLISHABLE] = 'pk_test_51TTTJabc'

    const result = await checkStripeHealth({ liveCheckEnabled: false })

    expect(result.status).toBe('ok')
    expect(result.details).toMatchObject({
      secretKeyMode: 'test',
      publishableKeyMode: 'test',
      keyModesAgree: true,
    })
  })

  it('reports the modes even when Stripe is NOT configured', async () => {
    // The unconfigured branch is exactly when someone is asking "what mode is
    // this environment in?", so it must answer rather than bail early.
    delete process.env[SECRET]
    process.env[PUBLISHABLE] = 'pk_live_51TTTJabc'

    const result = await checkStripeHealth({ liveCheckEnabled: false })

    expect(result.status).toBe('degraded')
    expect(result.details).toMatchObject({
      secretKeyMode: 'missing',
      publishableKeyMode: 'live',
      keyModesAgree: null,
    })
  })

  it('flags a mismatched pair, which no other check would catch', async () => {
    process.env[SECRET] = 'sk_live_51TTTJabc'
    process.env[PUBLISHABLE] = 'pk_test_51TTTJabc'

    const result = await checkStripeHealth({ liveCheckEnabled: false })

    // Status stays ok: the secret key IS present and this probe does not decide
    // policy. The disagreement is reported as a fact for a human to read.
    expect(result.details).toMatchObject({
      secretKeyMode: 'live',
      publishableKeyMode: 'test',
      keyModesAgree: false,
    })
  })

  it('still reports the modes on the live-ping failure branch', async () => {
    process.env[SECRET] = 'sk_test_51TTTJabc'
    process.env[PUBLISHABLE] = 'pk_test_51TTTJabc'
    stripeMocks.retrieveBalance.mockRejectedValue(new Error('stripe is down'))

    const result = await checkStripeHealth({ liveCheckEnabled: true })

    expect(result.status).toBe('degraded')
    expect(result.details).toMatchObject({
      secretKeyMode: 'test',
      publishableKeyMode: 'test',
    })
  })

  it('still reports the modes on the live-ping success branch', async () => {
    process.env[SECRET] = 'sk_test_51TTTJabc'
    process.env[PUBLISHABLE] = 'pk_test_51TTTJabc'
    stripeMocks.retrieveBalance.mockResolvedValue({})

    const result = await checkStripeHealth({ liveCheckEnabled: true })

    expect(result.status).toBe('ok')
    expect(result.details).toMatchObject({
      secretKeyMode: 'test',
      publishableKeyMode: 'test',
    })
  })

  it('never echoes key material into the payload', async () => {
    process.env[SECRET] = 'sk_live_51TTTJsupersecretvalue'
    process.env[PUBLISHABLE] = 'pk_live_51TTTJpublishablevalue'

    const result = await checkStripeHealth({ liveCheckEnabled: false })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('supersecretvalue')
    expect(serialized).not.toContain('publishablevalue')
    expect(serialized).not.toContain('51TTTJ')
  })
})
