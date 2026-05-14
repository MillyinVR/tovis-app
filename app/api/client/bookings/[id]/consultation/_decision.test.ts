import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE =
  'POST /api/client/bookings/[id]/consultation/decision'

const OPERATION = 'POST /api/client/bookings/[id]/consultation'

const approvedAt = new Date('2026-04-12T18:00:00.000Z')
const rejectedAt = new Date('2026-04-12T18:30:00.000Z')

type MockConsultationApproval = {
  id: string
  status: ConsultationApprovalStatus
  approvedAt: Date | null
  rejectedAt: Date | null
  proposedServicesJson: Prisma.InputJsonValue
  proposedTotal: Prisma.Decimal | null
  notes: string | null
  bookingId: string
  clientId: string
  proId: string
  createdAt: Date
  updatedAt: Date
}

function makeConsultationApproval(
  overrides?: Partial<MockConsultationApproval>,
): MockConsultationApproval {
  return {
    id: 'approval_1',
    status: ConsultationApprovalStatus.PENDING,
    approvedAt: null,
    rejectedAt: null,
    proposedServicesJson: {
      currency: 'USD',
      items: [],
    },
    proposedTotal: new Prisma.Decimal('125.00'),
    notes: 'Please review.',
    bookingId: 'booking_1',
    clientId: 'client_1',
    proId: 'pro_1',
    createdAt: new Date('2026-04-12T17:00:00.000Z'),
    updatedAt: new Date('2026-04-12T17:30:00.000Z'),
    ...overrides,
  }
}

const pendingApproval = makeConsultationApproval()

const approvedApproval = makeConsultationApproval({
  status: ConsultationApprovalStatus.APPROVED,
  approvedAt,
  rejectedAt: null,
  updatedAt: approvedAt,
})

const rejectedApproval = makeConsultationApproval({
  status: ConsultationApprovalStatus.REJECTED,
  approvedAt: null,
  rejectedAt,
  updatedAt: rejectedAt,
})

const approvedResponseBody = {
  action: 'APPROVE',
  approval: {
    ...approvedApproval,
    approvedAt: '2026-04-12T18:00:00.000Z',
    rejectedAt: null,
    createdAt: '2026-04-12T17:00:00.000Z',
    updatedAt: '2026-04-12T18:00:00.000Z',
    proposedTotal: '125',
  },
  bookingId: 'booking_1',
}

const rejectedResponseBody = {
  action: 'REJECT',
  approval: {
    ...rejectedApproval,
    approvedAt: null,
    rejectedAt: '2026-04-12T18:30:00.000Z',
    createdAt: '2026-04-12T17:00:00.000Z',
    updatedAt: '2026-04-12T18:30:00.000Z',
    proposedTotal: '125',
  },
  bookingId: 'booking_1',
}

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),

  bookingFindUnique: vi.fn(),
  prismaTransaction: vi.fn(),

  txConsultationApprovalFindUnique: vi.fn(),
  txConsultationApprovalUpdateMany: vi.fn(),

  approveConsultationAndMaterializeBooking: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),
  createProNotification: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  approveConsultationAndMaterializeBooking:
    mocks.approveConsultationAndMaterializeBooking,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_CONSULTATION_DECISION:
      'POST /api/client/bookings/[id]/consultation/decision',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { handleConsultationDecision } from './_decision'

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeBooking(overrides?: {
  id?: string
  clientId?: string
  professionalId?: string
  consultationApproval?: MockConsultationApproval | null
}) {
  return {
    id: overrides?.id ?? 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    consultationApproval:
      overrides && 'consultationApproval' in overrides
        ? overrides.consultationApproval
        : pendingApproval,
  }
}

function normalizeForJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Prisma.Decimal) return value.toString()

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item))
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForJson((value as Record<string, unknown>)[key])
    }

    return out
  }

  return value
}

function makeExpectedIdempotencyRequestBody(action: 'APPROVE' | 'REJECT') {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    professionalId: 'pro_1',
    approvalId: 'approval_1',
    action,
  }
}

function expectRouteIdempotencyStartedWith(
  action: 'APPROVE' | 'REJECT',
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(Request),
    actor: {
      actorUserId: 'user_1',
      actorRole: Role.CLIENT,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'client consultation decision',
    requestBody: makeExpectedIdempotencyRequestBody(action),
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress:
        'A matching consultation decision request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

function expectIdempotencyHandled(response: unknown): void {
  mocks.beginRouteIdempotency.mockReset()
  mocks.isRouteIdempotencyHandled.mockReset()

  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response,
  })

  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)
}

function expectIdempotencyStarted(
  key = 'idem_client_consultation_1',
): void {
  mocks.beginRouteIdempotency.mockReset()
  mocks.isRouteIdempotencyHandled.mockReset()

  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
}

describe('handleConsultationDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        ...(extra ?? {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.bookingFindUnique.mockResolvedValue(makeBooking())

    mocks.prismaTransaction.mockImplementation(
      async (
        callback: (tx: {
          consultationApproval: {
            findUnique: typeof mocks.txConsultationApprovalFindUnique
            updateMany: typeof mocks.txConsultationApprovalUpdateMany
          }
        }) => Promise<unknown>,
      ) =>
        callback({
          consultationApproval: {
            findUnique: mocks.txConsultationApprovalFindUnique,
            updateMany: mocks.txConsultationApprovalUpdateMany,
          },
        }),
    )

    mocks.txConsultationApprovalFindUnique
      .mockResolvedValueOnce(pendingApproval)
      .mockResolvedValueOnce(rejectedApproval)

    mocks.txConsultationApprovalUpdateMany.mockResolvedValue({
      count: 1,
    })

    mocks.approveConsultationAndMaterializeBooking.mockResolvedValue({
      approval: approvedApproval,
    })

    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue(undefined)

    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.rateLimitIdentity.mockResolvedValue({
      kind: 'user',
      id: 'user_1',
    })

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
  })

  it('returns 400 for invalid action before auth', async () => {
    const result = await handleConsultationDecision(
      'BANANA' as 'APPROVE',
      makeCtx(),
      {
        idempotencyKey: 'idem_invalid_1',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid consultation decision action.',
    })

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    }

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_auth_1',
    })

    expect(result).toBe(authRes)
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const result = await handleConsultationDecision('APPROVE', makeCtx('   '), {
      idempotencyKey: 'idem_missing_booking_1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing booking id.',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns 404 when booking is not found', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_not_found_1',
    })

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns 403 when booking belongs to a different client', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        clientId: 'client_other',
      }),
    )

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_forbidden_1',
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns 409 when no consultation proposal exists', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        consultationApproval: null,
      }),
    )

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_no_proposal_1',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'No consultation proposal found for this booking yet.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = {
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    }

    mocks.beginRouteIdempotency.mockReset()
    mocks.isRouteIdempotencyHandled.mockReset()

    expectIdempotencyHandled(handledResponse)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      requestId: 'req_1',
    })

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith('APPROVE')

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'A matching consultation decision request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    }

    mocks.beginRouteIdempotency.mockReset()
    mocks.isRouteIdempotencyHandled.mockReset()

    expectIdempotencyHandled(handledResponse)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_in_progress_1',
    })

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith('APPROVE')

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    }

    mocks.beginRouteIdempotency.mockReset()
    mocks.isRouteIdempotencyHandled.mockReset()

    expectIdempotencyHandled(handledResponse)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_conflict_1',
    })

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith('APPROVE')

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without mutating again', async () => {
    const handledResponse = {
      ok: true,
      status: 200,
      data: approvedResponseBody,
    }

    mocks.beginRouteIdempotency.mockReset()
    mocks.isRouteIdempotencyHandled.mockReset()

    expectIdempotencyHandled(handledResponse)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_replay_1',
    })

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith('APPROVE')

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('fails started idempotency and returns rate-limit response when limiter blocks', async () => {
    expectIdempotencyStarted('idem_rate_limited_1')

    const rateLimitResponse = {
      ok: false,
      status: 429,
      error: 'Too many requests.',
    }

    mocks.enforceRateLimit.mockResolvedValueOnce(rateLimitResponse)

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_rate_limited_1',
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'consultation:decision',
      identity: {
        kind: 'user',
        id: 'user_1',
      },
      keySuffix: 'booking:booking_1',
    })

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(result).toBe(rateLimitResponse)

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('continues when rate limiter throws', async () => {
    expectIdempotencyStarted('idem_limiter_error_1')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mocks.enforceRateLimit.mockRejectedValueOnce(new Error('limiter down'))

    try {
      const result = await handleConsultationDecision('APPROVE', makeCtx(), {
        requestId: 'req_limiter_error_1',
        idempotencyKey: 'idem_limiter_error_1',
      })

      expect(warnSpy).toHaveBeenCalledWith(
        'Rate limit skipped (limiter error):',
        expect.any(Error),
      )

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: approvedResponseBody,
      })

      expect(mocks.approveConsultationAndMaterializeBooking).toHaveBeenCalled()
      expect(mocks.completeRouteIdempotency).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('returns alreadyDecided when approval is not pending before mutation', async () => {
    expectIdempotencyStarted('idem_already_approved_1')

    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        consultationApproval: approvedApproval,
      }),
    )

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_already_approved_1',
    })

    const responseBody = normalizeForJson({
      bookingId: 'booking_1',
      action: 'APPROVE',
      alreadyDecided: true,
      approval: approvedApproval,
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: responseBody,
    })

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('approves consultation, completes idempotency, notifies pro, and returns approval', async () => {
    expectIdempotencyStarted('idem_approve_1')

    const result = await handleConsultationDecision('APPROVE', makeCtx(), {
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
    })

    expectRouteIdempotencyStartedWith('APPROVE')

    expect(mocks.approveConsultationAndMaterializeBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: approvedResponseBody,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.CONSULTATION_APPROVED,
      title: 'Consultation approved',
      body: 'Client approved your consultation proposal.',
      href: '/pro/bookings/booking_1?step=consult',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:CONSULTATION_APPROVED:booking_1',
      data: {
        bookingId: 'booking_1',
        action: 'APPROVE',
        step: 'consult',
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: approvedResponseBody,
    })
  })

  it('rejects consultation in a transaction, writes audit log, completes idempotency, notifies pro, and returns approval', async () => {
    expectIdempotencyStarted('idem_reject_1')

    const result = await handleConsultationDecision('REJECT', makeCtx(), {
      requestId: 'req_reject_1',
      idempotencyKey: 'idem_reject_1',
    })

    expectRouteIdempotencyStartedWith('REJECT')

    expect(mocks.prismaTransaction).toHaveBeenCalledTimes(1)

    expect(mocks.txConsultationApprovalFindUnique).toHaveBeenNthCalledWith(1, {
      where: { bookingId: 'booking_1' },
      select: expect.any(Object),
    })

    expect(mocks.txConsultationApprovalUpdateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        status: ConsultationApprovalStatus.PENDING,
      },
      data: {
        status: ConsultationApprovalStatus.REJECTED,
        clientId: 'client_1',
        proId: 'pro_1',
        approvedAt: null,
        rejectedAt: expect.any(Date),
      },
    })

    expect(mocks.txConsultationApprovalFindUnique).toHaveBeenNthCalledWith(2, {
      where: { bookingId: 'booking_1' },
      select: expect.any(Object),
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
      tx: expect.any(Object),
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.CONSULTATION_REJECTED,
      route:
        'app/api/client/bookings/[id]/consultation/_decision.ts:handleConsultationDecision',
      requestId: 'req_reject_1',
      idempotencyKey: 'idem_reject_1',
      oldValue: {
        consultationApproval: {
          status: ConsultationApprovalStatus.PENDING,
          approvedAt: null,
          rejectedAt: null,
          proposedTotal: '125.00',
          notes: 'Please review.',
          clientId: 'client_1',
          proId: 'pro_1',
        },
      },
      newValue: {
        consultationApproval: {
          status: ConsultationApprovalStatus.REJECTED,
          approvedAt: null,
          rejectedAt: '2026-04-12T18:30:00.000Z',
          proposedTotal: '125.00',
          notes: 'Please review.',
          clientId: 'client_1',
          proId: 'pro_1',
        },
      },
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: rejectedResponseBody,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.CONSULTATION_REJECTED,
      title: 'Consultation rejected',
      body: 'Client rejected your consultation proposal.',
      href: '/pro/bookings/booking_1?step=consult',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:CONSULTATION_REJECTED:booking_1',
      data: {
        bookingId: 'booking_1',
        action: 'REJECT',
        step: 'consult',
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: rejectedResponseBody,
    })
  })

  it('returns alreadyDecided when rejection transaction sees non-pending approval', async () => {
    expectIdempotencyStarted('idem_reject_race_1')

    mocks.txConsultationApprovalFindUnique.mockReset()
    mocks.txConsultationApprovalFindUnique.mockResolvedValueOnce(
      rejectedApproval,
    )

    const result = await handleConsultationDecision('REJECT', makeCtx(), {
      idempotencyKey: 'idem_reject_race_1',
    })

    const responseBody = normalizeForJson({
      bookingId: 'booking_1',
      action: 'REJECT',
      alreadyDecided: true,
      approval: rejectedApproval,
    })

    expect(mocks.txConsultationApprovalUpdateMany).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: responseBody,
    })
  })

  it('returns alreadyDecided when rejection update loses the pending race', async () => {
    expectIdempotencyStarted('idem_reject_update_race_1')

    mocks.txConsultationApprovalFindUnique.mockReset()
    mocks.txConsultationApprovalFindUnique
      .mockResolvedValueOnce(pendingApproval)
      .mockResolvedValueOnce(rejectedApproval)

    mocks.txConsultationApprovalUpdateMany.mockResolvedValueOnce({
      count: 0,
    })

    const result = await handleConsultationDecision('REJECT', makeCtx(), {
      idempotencyKey: 'idem_reject_update_race_1',
    })

    const responseBody = normalizeForJson({
      bookingId: 'booking_1',
      action: 'REJECT',
      alreadyDecided: true,
      approval: rejectedApproval,
    })

    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: responseBody,
    })
  })

  it('does not fail decision when pro notification throws', async () => {
    expectIdempotencyStarted('idem_notif_fail_1')

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.createProNotification.mockRejectedValueOnce(
      new Error('notification failed'),
    )

    try {
      const result = await handleConsultationDecision('APPROVE', makeCtx(), {
        idempotencyKey: 'idem_notif_fail_1',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Pro notification failed (consultation decision):',
        expect.any(Error),
      )

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: approvedResponseBody,
      })

      expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        responseStatus: 200,
        responseBody: approvedResponseBody,
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('marks idempotency failed and returns 500 when approval write throws', async () => {
    expectIdempotencyStarted('idem_boom_approve_1')

    mocks.approveConsultationAndMaterializeBooking.mockRejectedValueOnce(
      new Error('boom'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await handleConsultationDecision('APPROVE', makeCtx(), {
        idempotencyKey: 'idem_boom_approve_1',
      })

      expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        operation: OPERATION,
      })

      expect(mocks.captureBookingException).toHaveBeenCalledWith({
        error: expect.any(Error),
        route: OPERATION,
      })

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('marks idempotency failed and returns 500 when rejection transaction throws', async () => {
    expectIdempotencyStarted('idem_boom_reject_1')

    mocks.prismaTransaction.mockRejectedValueOnce(new Error('boom'))

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await handleConsultationDecision('REJECT', makeCtx(), {
        idempotencyKey: 'idem_boom_reject_1',
      })

      expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        operation: OPERATION,
      })

      expect(mocks.captureBookingException).toHaveBeenCalledWith({
        error: expect.any(Error),
        route: OPERATION,
      })

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})