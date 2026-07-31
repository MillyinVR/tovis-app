// app/api/v1/client/bookings/[id]/confirmation/route.test.ts
//
// K13: the in-app answer route's own contract — that it is gated by the loop
// flag, that it hands the boundary the SIGNED-IN client's id (never the one in
// the URL path or the body), and that a decline drains the pro's notification.
// The integration suite proves the two answer paths write the same thing; this
// proves this route asks for the right thing.

import { BookingStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConfirmationLoopEnabled: vi.fn(),
  requireClient: vi.fn(),
  recordAppointmentConfirmationFromAuthedClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  kickNotificationDrain: vi.fn(),
}))

vi.mock('@/lib/booking/clientConfirmationLoop', () => ({
  clientConfirmationLoopEnabled: mocks.clientConfirmationLoopEnabled,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  recordAppointmentConfirmationFromAuthedClient:
    mocks.recordAppointmentConfirmationFromAuthedClient,
}))

// Partial mock on purpose: `rateLimitExceededResponse` reaches back into this
// same module for `getRateLimitHeaders`, so replacing the whole module makes a
// 429 throw and surface as a 500 ([[adding-export-to-mocked-module]]).
vi.mock('@/lib/rateLimit/enforce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit/enforce')>()),
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request(
    'http://localhost/api/v1/client/bookings/bkg_1/confirmation',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeCtx(id = 'bkg_1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.clientConfirmationLoopEnabled.mockReturnValue(true)
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'cli_session',
    user: { id: 'usr_session' },
  })
  mocks.recordAppointmentConfirmationFromAuthedClient.mockResolvedValue({
    booking: {
      id: 'bkg_1',
      status: BookingStatus.ACCEPTED,
      scheduledFor: new Date('2026-09-01T17:00:00.000Z'),
    },
    state: 'CLIENT_CONFIRMED',
    meta: { mutated: true },
  })
})

describe('POST /api/v1/client/bookings/[id]/confirmation', () => {
  it('refuses while the confirmation loop is disabled, without touching the boundary', async () => {
    mocks.clientConfirmationLoopEnabled.mockReturnValue(false)

    const res = await POST(makeRequest({ answer: 'CONFIRM' }), makeCtx())

    expect(res.status).toBe(409)
    expect(
      mocks.recordAppointmentConfirmationFromAuthedClient,
    ).not.toHaveBeenCalled()
  })

  it('records the answer for the SIGNED-IN client, not an id supplied by the caller', async () => {
    const res = await POST(
      // A caller trying to answer on someone else's behalf: the body names
      // another client. It must be ignored — the session is the only identity.
      makeRequest({ answer: 'CONFIRM', clientId: 'cli_someone_else' }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
    expect(
      mocks.recordAppointmentConfirmationFromAuthedClient,
    ).toHaveBeenCalledWith({
      bookingId: 'bkg_1',
      clientId: 'cli_session',
      answer: 'CONFIRM',
    })
  })

  it('echoes the derived state so the app renders the server truth, not its own guess', async () => {
    const res = await POST(makeRequest({ answer: 'CONFIRM' }), makeCtx())
    const body = (await res.json()) as { state?: string }

    expect(body.state).toBe('CLIENT_CONFIRMED')
  })

  it('drains the pro notification queue on DECLINE (D5: the pro must hear it)', async () => {
    mocks.recordAppointmentConfirmationFromAuthedClient.mockResolvedValue({
      booking: {
        id: 'bkg_1',
        status: BookingStatus.ACCEPTED,
        scheduledFor: new Date('2026-09-01T17:00:00.000Z'),
      },
      state: 'DECLINED',
      meta: { mutated: true },
    })

    await POST(makeRequest({ answer: 'DECLINE' }), makeCtx())

    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
  })

  it('does not drain on CONFIRM — nothing is enqueued on that path', async () => {
    await POST(makeRequest({ answer: 'CONFIRM' }), makeCtx())

    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  })

  it('rejects an answer outside CONFIRM/DECLINE', async () => {
    const res = await POST(makeRequest({ answer: 'MAYBE' }), makeCtx())

    expect(res.status).toBe(400)
    expect(
      mocks.recordAppointmentConfirmationFromAuthedClient,
    ).not.toHaveBeenCalled()
  })

  it('honours the rate limiter before doing any work', async () => {
    mocks.enforceRateLimit.mockResolvedValue({
      allowed: false,
      bucket: 'client:appointment:answer',
      limit: 20,
      remaining: 0,
      resetAt: new Date('2026-09-01T17:00:30.000Z'),
      retryAfterSeconds: 30,
    })

    const res = await POST(makeRequest({ answer: 'CONFIRM' }), makeCtx())

    expect(res.status).toBe(429)
    expect(
      mocks.recordAppointmentConfirmationFromAuthedClient,
    ).not.toHaveBeenCalled()
  })
})
