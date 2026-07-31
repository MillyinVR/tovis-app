// app/api/v1/public/appointment/[token]/cancel/route.test.ts
//
// K12: the token-cancel route's ACTOR semantics — the structural half of the
// DoD. The integration suite proves the shared refund orchestration produces
// identical outcomes on both paths; this proves THIS route actually hands it
// the client-cancel actor (and the boundary's own priorStatus/mutated), rather
// than re-deriving a policy of its own.

import { BookingStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConfirmationLoopEnabled: vi.fn(),
  resolveAppointmentConfirmationTokenForMutation: vi.fn(),
  markAppointmentConfirmationTokenUsed: vi.fn(),
  cancelBooking: vi.fn(),
  runCancelRefundOrchestration: vi.fn(),
  enforceRateLimit: vi.fn(),
  kickNotificationDrain: vi.fn(),
  withRouteIdempotency: vi.fn(),
}))

// The ledger itself has its own suite (app/api/_utils/idempotency.test.ts);
// here it stands in as a pass-through so the route's own sequencing is what is
// under test rather than Postgres.
vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/lib/booking/clientConfirmationLoop', () => ({
  clientConfirmationLoopEnabled: mocks.clientConfirmationLoopEnabled,
}))

vi.mock('@/lib/booking/appointmentConfirmationTokens', () => ({
  resolveAppointmentConfirmationTokenForMutation:
    mocks.resolveAppointmentConfirmationTokenForMutation,
  markAppointmentConfirmationTokenUsed:
    mocks.markAppointmentConfirmationTokenUsed,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelBooking: mocks.cancelBooking,
}))

vi.mock('@/lib/booking/cancelRefundOrchestration', () => ({
  runCancelRefundOrchestration: mocks.runCancelRefundOrchestration,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

import { POST } from './route'

const REFUND_SUMMARY = {
  status: 'REFUND_ISSUED' as const,
  refundedAmountCents: 4000,
  message: 'Your deposit was refunded.',
}

function makeRequest(key = 'idem_appt_cancel_1'): Request {
  return new Request('http://localhost/api/v1/public/appointment/tok_1/cancel', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify({}),
  })
}

function makeCtx(token = 'tok_1') {
  return { params: Promise.resolve({ token }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.clientConfirmationLoopEnabled.mockReturnValue(true)
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.withRouteIdempotency.mockImplementation(
    async (
      _args: unknown,
      run: () => Promise<{ status: number; body: unknown }>,
    ) => {
      const { status, body } = await run()
      return Response.json(body, { status })
    },
  )
  mocks.resolveAppointmentConfirmationTokenForMutation.mockResolvedValue({
    accessSource: 'clientActionToken',
    token: { id: 'cat_1' },
    idempotencyActorKey: 'public-appointment-token:cat_1',
    booking: { id: 'booking_1', clientId: 'client_1' },
  })
  mocks.cancelBooking.mockResolvedValue({
    booking: { id: 'booking_1', status: BookingStatus.CANCELLED },
    priorStatus: BookingStatus.ACCEPTED,
    meta: { mutated: true, noOp: false },
  })
  mocks.runCancelRefundOrchestration.mockResolvedValue(REFUND_SUMMARY)
  mocks.markAppointmentConfirmationTokenUsed.mockResolvedValue({})
})

describe('POST /api/v1/public/appointment/[token]/cancel', () => {
  it('cancels as the TOKEN’s client and runs the shared refund orchestration with the boundary’s own outcome', async () => {
    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      id: 'booking_1',
      status: BookingStatus.CANCELLED,
      refund: REFUND_SUMMARY,
    })

    // The token supplies the identity — never an ambient session, never a
    // different actor kind (a 'pro' or 'admin' actor would silently change the
    // refund policy).
    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: { kind: 'client', clientId: 'client_1' },
    })

    // The shared policy, fed the cancel's OWN priorStatus + mutated (§18.4),
    // with a null actorUserId because an unclaimed client has no user row.
    expect(mocks.runCancelRefundOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        actorKind: 'client',
        actorUserId: null,
        cancelMutated: true,
        priorStatus: BookingStatus.ACCEPTED,
      }),
    )

    // Usage is recorded, never burned before the write it accounts for.
    expect(mocks.markAppointmentConfirmationTokenUsed).toHaveBeenCalledWith({
      tokenId: 'cat_1',
    })
    expect(mocks.kickNotificationDrain).toHaveBeenCalled()
  })

  it('refuses and writes nothing while the confirmation loop is off (ship-dark)', async () => {
    mocks.clientConfirmationLoopEnabled.mockReturnValue(false)

    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBe(400)
    expect(mocks.resolveAppointmentConfirmationTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.runCancelRefundOrchestration).not.toHaveBeenCalled()
  })

  it('never cancels when the token does not resolve', async () => {
    mocks.resolveAppointmentConfirmationTokenForMutation.mockRejectedValue(
      Object.assign(new Error('bad token'), {
        name: 'BookingError',
        code: 'APPOINTMENT_TOKEN_INVALID',
      }),
    )

    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })
})
