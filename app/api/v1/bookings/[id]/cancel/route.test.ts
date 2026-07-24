// app/api/v1/bookings/[id]/cancel/route.test.ts

import { BookingStatus, NoShowFeeStatus, Role, SessionStep } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  cancelBooking: vi.fn(),
  applyAutoCancelRefund: vi.fn(),
  applyDiscoveryDepositCancelRefund: vi.fn(),
  summarizeCancelRefund: vi.fn(),
  assessAndChargeNoShowFee: vi.fn(),
  noShowProtectionEnabled: vi.fn(),

  withRouteIdempotency: vi.fn(),
  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  enforceRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  safeError: vi.fn(),
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelBooking: mocks.cancelBooking,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyAutoCancelRefund: mocks.applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund: mocks.applyDiscoveryDepositCancelRefund,
  summarizeCancelRefund: mocks.summarizeCancelRefund,
}))

vi.mock('@/lib/noShowProtection/charge', () => ({
  assessAndChargeNoShowFee: mocks.assessAndChargeNoShowFee,
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: mocks.noShowProtectionEnabled,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: mocks.clientRateLimitKey,
  proRateLimitKey: mocks.proRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { POST } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeCtx(id: string): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(headers?: HeadersInit): Request {
  return new Request('http://localhost/api/v1/bookings/booking_1/cancel', {
    method: 'POST',
    headers,
  })
}

function setStartedIdempotencyDefault(): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: 'idem_key_1',
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)

  // The route now calls withRouteIdempotency; this mock reproduces the real
  // wrapper by driving the same begin/complete/failStarted helpers, so the
  // existing lifecycle assertions still apply.
  mocks.withRouteIdempotency.mockImplementation(
    async (
      args: { operation: string },
      run: (ctx: {
        idempotencyKey: string
        idempotencyRecordId: string
        requestHash: string
      }) => Promise<{ status: number; body: Record<string, unknown> }>,
    ) => {
      const begin = await mocks.beginRouteIdempotency(args)

      if (mocks.isRouteIdempotencyHandled(begin)) {
        return begin.response
      }

      try {
        const { status, body } = await run({
          idempotencyKey: begin.idempotencyKey,
          idempotencyRecordId: begin.idempotencyRecordId,
          requestHash: begin.requestHash,
        })

        await mocks.completeRouteIdempotency({
          idempotencyRecordId: begin.idempotencyRecordId,
          responseStatus: status,
          responseBody: body,
        })

        return mocks.jsonOk(body, status)
      } catch (error) {
        await mocks.failStartedRouteIdempotency({
          idempotencyRecordId: begin.idempotencyRecordId,
          operation: args.operation,
        })

        throw error
      }
    },
  )
}

describe('app/api/v1/bookings/[id]/cancel/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_1',
        role: Role.CLIENT,
        clientProfile: { id: 'client_1' },
        professionalProfile: null,
      },
    })

    mocks.clientRateLimitKey.mockImplementation(
      (args: { clientId?: string | null; userId?: string | null }) =>
        `user:${args.userId}|client:${args.clientId}|ip:unknown-ip`,
    )

    mocks.proRateLimitKey.mockImplementation(
      (args: { professionalId?: string | null; userId?: string | null }) =>
        args.professionalId
          ? `user:${args.userId}|pro:${args.professionalId}|ip:unknown-ip`
          : `user:${args.userId}|ip:unknown-ip`,
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'bookings:cancel',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 8,
      remaining: 7,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 300,
      source: 'redis',
    })

    mocks.cancelBooking.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
      },
      // §18.4: the pre-transition status now rides the cancel result (read under
      // the lock), so the late-cancel fee gate no longer needs a separate read.
      priorStatus: BookingStatus.ACCEPTED,
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
    mocks.applyAutoCancelRefund.mockResolvedValue({ outcome: 'NOT_ATTEMPTED' })
    mocks.applyDiscoveryDepositCancelRefund.mockResolvedValue({
      outcome: 'NOT_ATTEMPTED',
    })
    mocks.summarizeCancelRefund.mockReturnValue({
      status: 'NONE',
      message: 'Your booking is cancelled.',
    })
    // No-show protection defaults OFF (prod is dark): the late-cancel fee block is
    // skipped, matching production. Suppression/fee-flow tests flip it on.
    mocks.noShowProtectionEnabled.mockReturnValue(false)
    mocks.assessAndChargeNoShowFee.mockResolvedValue({
      kind: 'NOT_CHARGEABLE',
      reason: 'flag_off',
    })

    setStartedIdempotencyDefault()
  })

  it('returns auth response when auth fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requireUser.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(authRes)

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is missing before starting idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    const result = await POST(
      new Request('http://localhost/api/v1/bookings//cancel', {
        method: 'POST',
      }),
      makeCtx(''),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when a client user is missing a client profile', async () => {
    const descriptor = getBookingErrorDescriptor('FORBIDDEN')

    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_without_profile',
        role: Role.CLIENT,
        clientProfile: null,
        professionalProfile: null,
      },
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      'You are not allowed to cancel this booking.',
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: 'Authenticated user is missing the required booking profile.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: 'You are not allowed to cancel this booking.',
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: 'Authenticated user is missing the required booking profile.',
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when a pro user is missing a professional profile', async () => {
    const descriptor = getBookingErrorDescriptor('FORBIDDEN')

    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'pro_without_profile',
        role: Role.PRO,
        clientProfile: null,
        professionalProfile: null,
      },
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      'You are not allowed to cancel this booking.',
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: 'Authenticated user is missing the required booking profile.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: 'You are not allowed to cancel this booking.',
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: 'Authenticated user is missing the required booking profile.',
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or cancelBooking for client cancel', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'bookings:cancel',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 8,
      remaining: 0,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 300,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = {
      ok: false,
      status: 429,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    }

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_cancel_1',
      }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(limitedResponse)

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:cancel',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns a handled idempotency response without calling cancelBooking', async () => {
    const handledResponse = {
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(handledResponse)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('starts idempotency with client actor details', async () => {
    await POST(
      makeRequest({
        'idempotency-key': 'idem_key_1',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:cancel',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_CANCEL,
      requestLabel: 'booking cancellation',
      requestBody: {
        bookingId: 'booking_1',
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
        clientId: 'client_1',
        professionalId: null,
        cancelActorKind: 'client',
      },
      messages: {
        missingKey: 'Missing idempotency key for booking cancellation.',
        inProgress:
          'A matching booking cancellation request is already in progress.',
        conflict:
          'This idempotency key was already used with different cancellation details.',
      },
      operation: 'POST /api/v1/bookings/[id]/cancel',
    })
  })

  it('calls cancelBooking with a client actor for client users', async () => {
    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.CLIENT, Role.PRO, Role.ADMIN],
    })

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:cancel',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'client',
        clientId: 'client_1',
      },
    })

    const expectedBody = {
      ok: true,
      id: 'booking_1',
      status: BookingStatus.CANCELLED,
      sessionStep: SessionStep.NONE,
      meta: {
        mutated: true,
        noOp: false,
      },
      // Honest refund summary rides the response (M6).
      refund: {
        status: 'NONE',
        message: 'Your booking is cancelled.',
      },
    }

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: expectedBody,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(expectedBody, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: expectedBody,
    })
  })

  it('summarizes both refund outcomes and returns them in the response (M6)', async () => {
    const serviceOutcome = { outcome: 'NOT_ATTEMPTED' }
    const depositOutcome = {
      outcome: 'REFUNDED',
      refundAmountCents: 4000,
      feeRefunded: true,
    }
    mocks.applyAutoCancelRefund.mockResolvedValueOnce(serviceOutcome)
    mocks.applyDiscoveryDepositCancelRefund.mockResolvedValueOnce(depositOutcome)
    mocks.summarizeCancelRefund.mockReturnValueOnce({
      status: 'REFUND_ISSUED',
      refundedAmountCents: 4000,
      message: 'Your booking is cancelled. A refund of $40.00 is on its way.',
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    // The summary is computed from BOTH helper outcomes (no fee while dark) …
    expect(mocks.summarizeCancelRefund).toHaveBeenCalledWith({
      service: serviceOutcome,
      deposit: depositOutcome,
      lateCancelFeeChargedCents: 0,
    })
    // … and rides the response for the client UI to render honestly.
    expect(result).toMatchObject({
      data: {
        refund: { status: 'REFUND_ISSUED', refundedAmountCents: 4000 },
      },
    })
  })

  // ─── M15 POLICY: deposit-forfeit suppresses the late-cancel fee ─────────────

  it('does NOT assess a late-cancel fee when the deposit was FORFEITED (Tori 2026-07-24)', async () => {
    mocks.noShowProtectionEnabled.mockReturnValue(true)
    mocks.applyDiscoveryDepositCancelRefund.mockResolvedValueOnce({
      outcome: 'FORFEITED',
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    // A forfeited deposit IS the <24h penalty — the fee is suppressed, so the
    // charge path is never even reached.
    expect(mocks.assessAndChargeNoShowFee).not.toHaveBeenCalled()
    expect(mocks.summarizeCancelRefund).toHaveBeenCalledWith(
      expect.objectContaining({ lateCancelFeeChargedCents: 0 }),
    )
  })

  it('charges the late-cancel fee (no forfeiture) and folds it into the honest summary', async () => {
    mocks.noShowProtectionEnabled.mockReturnValue(true)
    mocks.applyDiscoveryDepositCancelRefund.mockResolvedValueOnce({
      outcome: 'NOT_ATTEMPTED',
    })
    mocks.assessAndChargeNoShowFee.mockResolvedValueOnce({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: '15.00',
      stripePaymentIntentId: 'pi_fee_1',
      alreadyCharged: false,
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    // §18.4: priorStatus comes from the cancel result (read under the lock), not
    // a separate pre-read.
    expect(mocks.assessAndChargeNoShowFee).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      reason: 'LATE_CANCEL',
      priorStatus: BookingStatus.ACCEPTED,
    })
    // The freshly-charged fee is surfaced in the summary (cents = $15.00 → 1500).
    expect(mocks.summarizeCancelRefund).toHaveBeenCalledWith(
      expect.objectContaining({ lateCancelFeeChargedCents: 1500 }),
    )
  })

  it('a FAILED late-cancel fee moves no money → not surfaced in the summary', async () => {
    mocks.noShowProtectionEnabled.mockReturnValue(true)
    mocks.assessAndChargeNoShowFee.mockResolvedValueOnce({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.FAILED,
      amount: '15.00',
      stripePaymentIntentId: 'pi_fee_1',
      alreadyCharged: false,
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.assessAndChargeNoShowFee).toHaveBeenCalled()
    expect(mocks.summarizeCancelRefund).toHaveBeenCalledWith(
      expect.objectContaining({ lateCancelFeeChargedCents: 0 }),
    )
  })

  it('never assesses a late-cancel fee for a pro cancel (only clients incur one)', async () => {
    mocks.noShowProtectionEnabled.mockReturnValue(true)
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_2',
        role: Role.PRO,
        clientProfile: null,
        professionalProfile: { id: 'pro_1' },
      },
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.assessAndChargeNoShowFee).not.toHaveBeenCalled()
  })

  it('calls cancelBooking with a pro actor for pro users', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_2',
        role: Role.PRO,
        clientProfile: null,
        professionalProfile: { id: 'pro_1' },
      },
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_2',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:cancel',
      key: 'user:user_2|pro:pro_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorUserId: 'user_2',
          actorRole: Role.PRO,
        },
        requestBody: expect.objectContaining({
          actorUserId: 'user_2',
          actorRole: Role.PRO,
          clientId: null,
          professionalId: 'pro_1',
          cancelActorKind: 'pro',
        }),
      }),
    )

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
    })
  })

  it('calls cancelBooking with an admin actor for admin users', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_admin',
        role: Role.ADMIN,
        clientProfile: null,
        professionalProfile: null,
      },
    })

    await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: null,
      userId: 'user_admin',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:cancel',
      key: 'user:user_admin|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorUserId: 'user_admin',
          actorRole: Role.ADMIN,
        },
        requestBody: expect.objectContaining({
          actorUserId: 'user_admin',
          actorRole: Role.ADMIN,
          clientId: null,
          professionalId: null,
          cancelActorKind: 'admin',
        }),
      }),
    )

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'admin',
        professionalId: null,
      },
    })

    // Admin cancellation triggers the auto-refund hook with the admin actor.
    expect(mocks.applyAutoCancelRefund).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actorKind: 'admin',
      actorUserId: 'user_admin',
      cancelMutated: true,
    })
  })

  it('fails idempotency and maps BookingError from cancelBooking', async () => {
    const descriptor = getBookingErrorDescriptor('FORBIDDEN')

    mocks.cancelBooking.mockRejectedValueOnce(new BookingError('FORBIDDEN'))

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/bookings/[id]/cancel',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })
  })

  it('fails idempotency, logs a sanitized error, and returns 500 when cancelBooking throws a non-booking error', async () => {
    const thrown = new Error('boom')

    mocks.cancelBooking.mockRejectedValueOnce(thrown)
    mocks.safeError.mockReturnValueOnce({
      name: 'Error',
      message: 'boom',
    })

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/bookings/[id]/cancel',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/v1/bookings/[id]/cancel error',
      {
        name: 'Error',
        message: 'boom',
      },
    )

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      'POST /api/v1/bookings/[id]/cancel error',
      thrown,
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Failed to cancel booking.',
    )

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to cancel booking.',
    })

    consoleErrorSpy.mockRestore()
  })

  it('does not fail idempotency when an error happens before the ledger starts', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    await POST(makeRequest(), makeCtx(''))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })
})