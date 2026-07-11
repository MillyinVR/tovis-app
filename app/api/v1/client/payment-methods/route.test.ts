// app/api/v1/client/payment-methods/route.test.ts
//
// Locks the two invariants that matter for the Phase 2 foundation slice:
//  1. Every card-on-file endpoint is DARK (404) while ENABLE_NO_SHOW_PROTECTION
//     is off — the default in prod.
//  2. With the flag on, the routes delegate to the SSOT and shape the DTO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CLIENT_ID = 'client_1'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  noShowProtectionEnabled: vi.fn(),
  createClientSetupIntent: vi.fn(),
  listClientPaymentMethods: vi.fn(),
  persistConfirmedClientCard: vi.fn(),
  removeClientPaymentMethod: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  jsonFail: (status: number, error: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: mocks.noShowProtectionEnabled,
}))

vi.mock('@/lib/clientPayments/cardOnFile', () => ({
  createClientSetupIntent: mocks.createClientSetupIntent,
  listClientPaymentMethods: mocks.listClientPaymentMethods,
  persistConfirmedClientCard: mocks.persistConfirmedClientCard,
  removeClientPaymentMethod: mocks.removeClientPaymentMethod,
}))

import { GET, POST } from '@/app/api/v1/client/payment-methods/route'
import { POST as SETUP_INTENT_POST } from '@/app/api/v1/client/payment-methods/setup-intent/route'
import { DELETE } from '@/app/api/v1/client/payment-methods/[id]/route'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/client/payment-methods', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: CLIENT_ID,
    user: { id: 'u1', email: 'c@example.com' },
  })
})

afterEach(() => vi.clearAllMocks())

describe('card-on-file routes are dark when the flag is off', () => {
  beforeEach(() => mocks.noShowProtectionEnabled.mockReturnValue(false))

  it('GET list → 404', async () => {
    const res = await GET()
    expect(res.status).toBe(404)
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.listClientPaymentMethods).not.toHaveBeenCalled()
  })

  it('POST setup-intent → 404', async () => {
    const res = await SETUP_INTENT_POST()
    expect(res.status).toBe(404)
    expect(mocks.createClientSetupIntent).not.toHaveBeenCalled()
  })

  it('POST confirm → 404', async () => {
    const res = await POST(jsonRequest({ setupIntentId: 'seti_1' }) as never)
    expect(res.status).toBe(404)
    expect(mocks.persistConfirmedClientCard).not.toHaveBeenCalled()
  })

  it('DELETE → 404', async () => {
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: { id: 'row_1' },
    })
    expect(res.status).toBe(404)
    expect(mocks.removeClientPaymentMethod).not.toHaveBeenCalled()
  })
})

describe('card-on-file routes when the flag is on', () => {
  beforeEach(() => mocks.noShowProtectionEnabled.mockReturnValue(true))

  it('GET list returns saved cards', async () => {
    mocks.listClientPaymentMethods.mockResolvedValue([
      { id: 'row_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true, createdAt: '2026-07-03T00:00:00.000Z' },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paymentMethods).toHaveLength(1)
    expect(mocks.listClientPaymentMethods).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('POST setup-intent returns a client secret + publishable key', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_route'
    mocks.createClientSetupIntent.mockResolvedValue({
      clientSecret: 'seti_secret',
      setupIntentId: 'seti_1',
      customerId: 'cus_1',
    })

    const res = await SETUP_INTENT_POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      clientSecret: 'seti_secret',
      setupIntentId: 'seti_1',
      customerId: 'cus_1',
      publishableKey: 'pk_test_route',
    })
    expect(mocks.createClientSetupIntent).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      email: 'c@example.com',
    })
  })

  it('POST confirm rejects a missing setupIntentId with 400', async () => {
    const res = await POST(jsonRequest({}) as never)
    expect(res.status).toBe(400)
    expect(mocks.persistConfirmedClientCard).not.toHaveBeenCalled()
  })

  it('POST confirm persists a card', async () => {
    mocks.persistConfirmedClientCard.mockResolvedValue({
      id: 'row_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true, createdAt: '2026-07-03T00:00:00.000Z',
    })

    const res = await POST(jsonRequest({ setupIntentId: 'seti_1' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paymentMethod.id).toBe('row_1')
    expect(mocks.persistConfirmedClientCard).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      setupIntentId: 'seti_1',
    })
  })

  it('DELETE returns 404 when the card is not owned', async () => {
    mocks.removeClientPaymentMethod.mockResolvedValue(null)
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: { id: 'row_x' },
    })
    expect(res.status).toBe(404)
  })

  it('DELETE removes an owned card', async () => {
    mocks.removeClientPaymentMethod.mockResolvedValue({ removedId: 'row_1' })
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: { id: 'row_1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedId).toBe('row_1')
  })
})
