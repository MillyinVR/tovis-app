// app/api/client/bookings/[id]/consultation/_decision.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/client/bookings/[id]/consultation'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  prismaTransaction: vi.fn(),

  txConsultationApprovalFindUnique: vi.fn(),
  txConsultationApprovalUpdateMany: vi.fn(),

  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  requireClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),

  approveConsultationAndMaterializeBooking: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),
  createProNotification: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
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
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_CONSULTATION_DECISION:
      'POST /api/client/bookings/[id]/consultation',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { handleConsultationDecision } from './_decision'

const tx = {
  consultationApproval: {
    findUnique: mocks.txConsultationApprovalFindUnique,
    updateMany: mocks.txConsultationApprovalUpdateMany,
  },
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makePendingApproval(overrides?: {
  id?: string
  status?: ConsultationApprovalStatus
  approvedAt?: Date | null
  rejectedAt?: Date | null
  proposedTotal?: Prisma.Decimal | null
}) {
  return {
    id: overrides?.id ?? 'approval_1',
    status: overrides?.status ?? ConsultationApprovalStatus.PENDING,
    approvedAt:
      overrides && 'approvedAt' in overrides ? overrides.approvedAt : null,
    rejectedAt:
      overrides && 'rejectedAt' in overrides ? overrides.rejectedAt : null,
    proposedServicesJson: [
      {
        serviceId: 'service_1',
        name: 'Haircut',
      },
    ],
    proposedTotal:
      overrides && 'proposedTotal' in overrides
        ? overrides.proposedTotal
        : new Prisma.Decimal('125.00'),
    notes: 'Client consultation proposal notes.',
    bookingId: 'booking_1',
    clientId: 'client_1',
    proId: 'pro_1',
    createdAt: new Date('2026-04-12T17:00:00.000Z'),
    updatedAt: new Date('2026-04-12T17:15:00.000Z'),
  }
}

function makeBooking(overrides?: {
  clientId?: string
  professionalId?: string
  approval?: ReturnType<typeof makePendingApproval> | null
}) {
  return {
    id: 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    consultationApproval:
      overrides && 'approval' in overrides
        ? overrides.approval
        : makePendingApproval(),
  }
}

function expectedApprovalJson(
  approval: ReturnType<typeof makePendingApproval>,
) {
  return {
    id: approval.id,
    status: approval.status,
    approvedAt: approval.approvedAt?.toISOString() ?? null,
    rejectedAt: approval.rejectedAt?.toISOString() ?? null,
    proposedServicesJson: approval.proposedServicesJson,
    proposedTotal: approval.proposedTotal?.toString() ?? null,
    notes: approval.notes,
    bookingId: approval.bookingId,
    clientId: approval.clientId,
    proId: approval.proId,
    createdAt: approval.createdAt.toISOString(),
    updatedAt: approval.updatedAt.toISOString(),
  }
}

function expectedDecisionBody(args?: {
  action?: 'APPROVE' | 'REJECT'
  approval?: ReturnType<typeof makePendingApproval>
  alreadyDecided?: boolean
}) {
  const approval = args?.approval ?? makePendingApproval()

  return {
    bookingId: 'booking_1',
    action: args?.action ?? 'APPROVE',
    ...(args?.alreadyDecided ? { alreadyDecided: true } : {}),
    approval: expectedApprovalJson(approval),
  }
}

function expectedIdempotencyRequestBody(action: 'APPROVE' | 'REJECT') {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    professionalId: 'pro_1',
    approvalId: 'approval_1',
    action,
  }
}

describe('handleConsultationDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.rateLimitIdentity.mockResolvedValue('user:user_1')
    mocks.enforceRateLimit.mockResolvedValue(null)

    mocks.bookingFindUnique.mockResolvedValue(makeBooking())

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue(undefined)

    mocks.approveConsultationAndMaterializeBooking.mockResolvedValue({
      approval: makePendingApproval({
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: new Date('2026-04-12T18:00:00.000Z'),
      }),
    })
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_1',
    })

    expect(response).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid action before idempotency starts', async () => {
    const response = await handleConsultationDecision(
      'BANANA' as 'APPROVE',
      makeCtx(),
      {
        idempotencyKey: 'idem_1',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid consultation decision action.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing before idempotency starts', async () => {
    const response = await handleConsultationDecision('APPROVE', makeCtx('  '), {
      idempotencyKey: 'idem_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns 404 when booking is not found before idempotency starts', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_1',
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Booking not found.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns 403 when booking belongs to another client before idempotency starts', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        clientId: 'client_other',
      }),
    )

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_1',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns 409 when no consultation approval exists before idempotency starts', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        approval: null,
      }),
    )

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'No consultation proposal found for this booking yet.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key for valid pending consultation decision without key', async () => {
    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      requestId: 'req_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: expectedIdempotencyRequestBody('APPROVE'),
    })

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns in-progress when matching idempotency request is already active', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_active_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'A matching consultation decision request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key is reused with different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const response = await handleConsultationDecision('REJECT', makeCtx(), {
      idempotencyKey: 'idem_conflict_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without writing again', async () => {
    const replayBody = expectedDecisionBody({
      action: 'APPROVE',
      approval: makePendingApproval({
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: new Date('2026-04-12T18:00:00.000Z'),
      }),
    })

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: replayBody,
    })

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_replay_1',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...replayBody,
    })

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('marks idempotency failed and returns rate-limit response when limiter blocks', async () => {
    const rateLimitResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests.',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(rateLimitResponse)

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_limited_1',
    })

    expect(response).toBe(rateLimitResponse)
    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('completes idempotency for already-decided approval without writing again', async () => {
    const approvedApproval = makePendingApproval({
      status: ConsultationApprovalStatus.APPROVED,
      approvedAt: new Date('2026-04-12T18:00:00.000Z'),
    })

    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        approval: approvedApproval,
      }),
    )

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_already_1',
    })

    const responseBody = expectedDecisionBody({
      action: 'APPROVE',
      approval: approvedApproval,
      alreadyDecided: true,
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(mocks.approveConsultationAndMaterializeBooking).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('approves consultation, completes idempotency, and notifies pro', async () => {
    const approvedApproval = makePendingApproval({
      status: ConsultationApprovalStatus.APPROVED,
      approvedAt: new Date('2026-04-12T18:00:00.000Z'),
    })

    mocks.approveConsultationAndMaterializeBooking.mockResolvedValueOnce({
      approval: approvedApproval,
    })

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_approve_1',
      requestBody: expectedIdempotencyRequestBody('APPROVE'),
    })

    expect(mocks.approveConsultationAndMaterializeBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
    })

    const responseBody = expectedDecisionBody({
      action: 'APPROVE',
      approval: approvedApproval,
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.CONSULTATION_APPROVED,
      title: 'Consultation approved',
      body: 'Client approved your consultation proposal.',
      href: '/pro/bookings/booking_1?step=consult',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: `PRO_NOTIF:${NotificationEventKey.CONSULTATION_APPROVED}:booking_1`,
      data: {
        bookingId: 'booking_1',
        action: 'APPROVE',
        step: 'consult',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('rejects consultation, writes audit, completes idempotency, and notifies pro', async () => {
    const currentApproval = makePendingApproval()
    const rejectedApproval = makePendingApproval({
      status: ConsultationApprovalStatus.REJECTED,
      rejectedAt: new Date('2026-04-12T18:30:00.000Z'),
    })

    mocks.txConsultationApprovalFindUnique
      .mockResolvedValueOnce(currentApproval)
      .mockResolvedValueOnce(rejectedApproval)
    mocks.txConsultationApprovalUpdateMany.mockResolvedValueOnce({ count: 1 })

    const response = await handleConsultationDecision('REJECT', makeCtx(), {
      requestId: 'req_reject_1',
      idempotencyKey: 'idem_reject_1',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_reject_1',
      requestBody: expectedIdempotencyRequestBody('REJECT'),
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

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
      tx,
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
          notes: 'Client consultation proposal notes.',
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
          notes: 'Client consultation proposal notes.',
          clientId: 'client_1',
          proId: 'pro_1',
        },
      },
    })

    const responseBody = expectedDecisionBody({
      action: 'REJECT',
      approval: rejectedApproval,
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.CONSULTATION_REJECTED,
      title: 'Consultation rejected',
      body: 'Client rejected your consultation proposal.',
      href: '/pro/bookings/booking_1?step=consult',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: `PRO_NOTIF:${NotificationEventKey.CONSULTATION_REJECTED}:booking_1`,
      data: {
        bookingId: 'booking_1',
        action: 'REJECT',
        step: 'consult',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('completes idempotency as already-decided when rejection transaction sees non-pending approval', async () => {
    const approvedApproval = makePendingApproval({
      status: ConsultationApprovalStatus.APPROVED,
      approvedAt: new Date('2026-04-12T18:00:00.000Z'),
    })

    mocks.txConsultationApprovalFindUnique.mockResolvedValueOnce(
      approvedApproval,
    )

    const response = await handleConsultationDecision('REJECT', makeCtx(), {
      idempotencyKey: 'idem_reject_race_1',
    })

    const responseBody = expectedDecisionBody({
      action: 'REJECT',
      approval: approvedApproval,
      alreadyDecided: true,
    })

    expect(mocks.txConsultationApprovalUpdateMany).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('returns 500 and marks idempotency failed when approve write throws', async () => {
    mocks.approveConsultationAndMaterializeBooking.mockRejectedValueOnce(
      new Error('approve boom'),
    )

    const response = await handleConsultationDecision('APPROVE', makeCtx(), {
      idempotencyKey: 'idem_approve_boom_1',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/client/bookings/[id]/consultation',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })

  it('returns 500 and marks idempotency failed when reject transaction throws', async () => {
    mocks.prismaTransaction.mockRejectedValueOnce(new Error('reject boom'))

    const response = await handleConsultationDecision('REJECT', makeCtx(), {
      idempotencyKey: 'idem_reject_boom_1',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/client/bookings/[id]/consultation',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})