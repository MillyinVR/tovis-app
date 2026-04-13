import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  ContactMethod,
  NotificationEventKey,
  Prisma,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  isRecord: vi.fn(),

  prismaTransaction: vi.fn(),
  deliveryBookingFindUnique: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txActiveOfferingsFindMany: vi.fn(),
  txConsultationApprovalUpsert: vi.fn(),

  transitionSessionStepInTransaction: vi.fn(),

  areAuditValuesEqual: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),

  upsertClientNotification: vi.fn(),
  createConsultationActionDelivery: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.deliveryBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  transitionSessionStepInTransaction: mocks.transitionSessionStepInTransaction,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  areAuditValuesEqual: mocks.areAuditValuesEqual,
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/clientActions/createConsultationActionDelivery', () => ({
  createConsultationActionDelivery: mocks.createConsultationActionDelivery,
}))

import { POST } from './route'

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

function makeRequest(args?: {
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/consultation-proposal',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body: args?.body === undefined ? undefined : JSON.stringify(args.body),
    },
  )
}

function makeRawProposalBody(overrides?: {
  items?: Array<Record<string, unknown>>
  proposedTotal?: string
  notes?: string | null
}) {
  return {
    proposedServicesJson: {
      items:
        overrides?.items ??
        [
          {
            bookingServiceItemId: 'bsi_1',
            offeringId: 'off_1',
            serviceId: 'svc_base_1',
            itemType: 'BASE',
            label: 'Silk Press',
            categoryName: 'Hair',
            price: '100.00',
            durationMinutes: 90,
            notes: '  Includes trim  ',
            sortOrder: 0,
            source: 'BOOKING',
          },
          {
            bookingServiceItemId: 'bsi_2',
            offeringId: 'off_1',
            serviceId: 'svc_addon_1',
            itemType: 'ADD_ON',
            label: 'Deep Condition',
            categoryName: 'Treatment',
            price: '25.00',
            durationMinutes: 15,
            notes: '  Add moisture  ',
            sortOrder: 1,
            source: 'PROPOSAL',
          },
        ],
    },
    proposedTotal: overrides?.proposedTotal ?? '125.00',
    notes: overrides?.notes ?? '  Please review the updated plan.  ',
  }
}

function makeExpectedProposalJson(): Prisma.InputJsonObject {
  return {
    currency: 'USD',
    items: [
      {
        bookingServiceItemId: 'bsi_1',
        offeringId: 'off_1',
        serviceId: 'svc_base_1',
        itemType: BookingServiceItemType.BASE,
        label: 'Silk Press',
        categoryName: 'Hair',
        price: '100.00',
        durationMinutes: 90,
        notes: 'Includes trim',
        sortOrder: 0,
        source: 'BOOKING',
      },
      {
        bookingServiceItemId: 'bsi_2',
        offeringId: 'off_1',
        serviceId: 'svc_addon_1',
        itemType: BookingServiceItemType.ADD_ON,
        label: 'Deep Condition',
        categoryName: 'Treatment',
        price: '25.00',
        durationMinutes: 15,
        notes: 'Add moisture',
        sortOrder: 1,
        source: 'PROPOSAL',
      },
    ],
  }
}

function makeTxBooking(overrides?: {
  professionalId?: string
  clientId?: string
  status?: BookingStatus
  startedAt?: Date | null
  finishedAt?: Date | null
  sessionStep?: SessionStep | null
  consultationApproval?: {
    id: string
    status: ConsultationApprovalStatus
    proposedServicesJson: Prisma.InputJsonValue
    proposedTotal: Prisma.Decimal | null
    notes: string | null
    updatedAt: Date
  } | null
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    startedAt:
      overrides && 'startedAt' in overrides
        ? overrides.startedAt
        : new Date('2026-04-13T18:00:00.000Z'),
    finishedAt:
      overrides && 'finishedAt' in overrides ? overrides.finishedAt : null,
    sessionStep: overrides?.sessionStep ?? SessionStep.CONSULTATION,
    serviceItems: [
      {
        id: 'bsi_1',
        serviceId: 'svc_base_1',
        offeringId: 'off_1',
        itemType: BookingServiceItemType.BASE,
      },
      {
        id: 'bsi_2',
        serviceId: 'svc_addon_1',
        offeringId: 'off_1',
        itemType: BookingServiceItemType.ADD_ON,
      },
    ],
    consultationApproval:
      overrides && 'consultationApproval' in overrides
        ? overrides.consultationApproval
        : null,
  }
}

function makeActiveOfferings() {
  return [
    {
      id: 'off_1',
      serviceId: 'svc_base_1',
      addOns: [
        {
          addOnServiceId: 'svc_addon_1',
        },
      ],
    },
  ]
}

function makeApproval(overrides?: {
  id?: string
  status?: ConsultationApprovalStatus
  proposedTotal?: Prisma.Decimal | null
  updatedAt?: Date
}) {
  return {
    id: overrides?.id ?? 'approval_1',
    status: overrides?.status ?? ConsultationApprovalStatus.PENDING,
    proposedTotal:
      overrides?.proposedTotal ?? new Prisma.Decimal('125.00'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-13T18:30:00.000Z'),
  }
}

function makeDeliveryBooking(overrides?: {
  professionalId?: string
  clientId?: string
  email?: string | null
  phone?: string | null
  preferredContactMethod?: ContactMethod | null
  userId?: string | null
  userEmail?: string | null
  userPhone?: string | null
  clientTimeZoneAtBooking?: string | null
  locationTimeZone?: string | null
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    clientTimeZoneAtBooking:
      overrides?.clientTimeZoneAtBooking ?? 'America/Los_Angeles',
    locationTimeZone: overrides?.locationTimeZone ?? 'America/Los_Angeles',
    client: {
      id: overrides?.clientId ?? 'client_1',
      userId: overrides?.userId ?? null,
      email:
        overrides && 'email' in overrides
          ? overrides.email
          : 'client@example.com',
      phone: overrides?.phone ?? null,
      preferredContactMethod: overrides?.preferredContactMethod ?? null,
      user: {
        email: overrides?.userEmail ?? null,
        phone: overrides?.userPhone ?? null,
      },
    },
  }
}

function makeConsultationActionDeliveryResult() {
  return {
    plan: {
      idempotency: {
        baseKey: 'consult_base_1',
        sendKey: 'consult_send_1',
      },
    },
    token: {
      id: 'token_1',
      rawToken: 'raw_consult_token_1',
      expiresAt: new Date('2026-04-16T18:30:00.000Z'),
    },
    link: {
      target: 'CONSULTATION',
      href: '/client/consultation/raw_consult_token_1',
      tokenIncluded: true,
    },
    dispatch: {
      created: true,
      selectedChannels: [],
      evaluations: [],
      dispatch: {
        id: 'dispatch_1',
      },
    },
  }
}

describe('app/api/pro/bookings/[id]/consultation-proposal/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { id: 'user_1' },
    })

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

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )

    mocks.prismaTransaction.mockImplementation(
      async (
        callback: (tx: {
          booking: { findUnique: typeof mocks.txBookingFindUnique }
          professionalServiceOffering: {
            findMany: typeof mocks.txActiveOfferingsFindMany
          }
          consultationApproval: {
            upsert: typeof mocks.txConsultationApprovalUpsert
          }
        }) => Promise<unknown>,
      ) =>
        callback({
          booking: {
            findUnique: mocks.txBookingFindUnique,
          },
          professionalServiceOffering: {
            findMany: mocks.txActiveOfferingsFindMany,
          },
          consultationApproval: {
            upsert: mocks.txConsultationApprovalUpsert,
          },
        }),
    )

    mocks.txBookingFindUnique.mockResolvedValue(makeTxBooking())
    mocks.txActiveOfferingsFindMany.mockResolvedValue(makeActiveOfferings())
    mocks.txConsultationApprovalUpsert.mockResolvedValue(makeApproval())

    mocks.transitionSessionStepInTransaction.mockResolvedValue({
      ok: true,
      booking: {
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      },
    })

    mocks.areAuditValuesEqual.mockReturnValue(false)
    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
    mocks.upsertClientNotification.mockResolvedValue(undefined)

    mocks.deliveryBookingFindUnique.mockResolvedValue(makeDeliveryBooking())
    mocks.createConsultationActionDelivery.mockResolvedValue(
      makeConsultationActionDeliveryResult(),
    )
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest({ body: {} }), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const result = await POST(
      makeRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx('   '),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid request body', async () => {
    const result = await POST(makeRequest({ body: [] }), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid request body.',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when proposal total does not match the line items', async () => {
    const result = await POST(
      makeRequest({
        body: makeRawProposalBody({
          proposedTotal: '999.00',
        }),
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Proposal total must equal the sum of the line items.',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('sends a consultation proposal, writes notification/audit data, and queues consultation action delivery', async () => {
    const result = await POST(
      makeRequest({
        headers: {
          'x-request-id': 'req_1',
          'idempotency-key': 'idem_1',
        },
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.txBookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.any(Object),
    })

    expect(mocks.txActiveOfferingsFindMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        isActive: true,
        service: { isActive: true },
      },
      select: {
        id: true,
        serviceId: true,
        addOns: {
          where: {
            isActive: true,
            addOnService: { isActive: true, isAddOnEligible: true },
          },
          select: {
            addOnServiceId: true,
          },
        },
      },
      take: 1000,
    })

    expect(mocks.txConsultationApprovalUpsert).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      create: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        proId: 'pro_1',
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: makeExpectedProposalJson(),
        proposedTotal: new Prisma.Decimal('125.00'),
        notes: 'Please review the updated plan.',
        approvedAt: null,
        rejectedAt: null,
      },
      update: {
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: makeExpectedProposalJson(),
        proposedTotal: new Prisma.Decimal('125.00'),
        notes: 'Please review the updated plan.',
        approvedAt: null,
        rejectedAt: null,
      },
      select: {
        id: true,
        status: true,
        proposedTotal: true,
        updatedAt: true,
      },
    })

    expect(mocks.transitionSessionStepInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      },
    )

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx: expect.any(Object),
      clientId: 'client_1',
      eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      title: 'Consultation proposal ready',
      body: 'Your professional sent an updated service total for approval.',
      bookingId: 'booking_1',
      href: '/client/bookings/booking_1?step=consult',
      dedupeKey: 'CONSULTATION_PROPOSAL:booking_1',
      data: {
        bookingId: 'booking_1',
        consultationApprovalId: 'approval_1',
        reason: 'CONSULTATION_PROPOSAL_READY',
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
      tx: expect.any(Object),
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.CONSULTATION_PROPOSAL_SENT,
      route: 'app/api/pro/bookings/[id]/consultation-proposal/route.ts',
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
      oldValue: {
        status: null,
        proposedServicesJson: 'null',
        proposedTotal: null,
        notes: null,
        sessionStep: SessionStep.CONSULTATION,
      },
      newValue: {
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: JSON.stringify(makeExpectedProposalJson()),
        proposedTotal: '125.00',
        notes: 'Please review the updated plan.',
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      },
      metadata: {
        proposalItemCount: 2,
        previousStep: SessionStep.CONSULTATION,
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        replacedExistingProposal: false,
      },
    })

    expect(mocks.deliveryBookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.any(Object),
    })

    expect(mocks.createConsultationActionDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      consultationApprovalId: 'approval_1',
      recipientUserId: null,
      recipientEmail: 'client@example.com',
      recipientPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      recipientTimeZone: 'America/Los_Angeles',
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.PENDING,
        proposedTotal: '125',
        updatedAt: '2026-04-13T18:30:00.000Z',
      },
      sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      proposedCents: 12500,
      consultationActionDelivery: {
        attempted: true,
        queued: true,
        href: '/client/consultation/raw_consult_token_1',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('skips consultation action delivery for true no-op proposal sends', async () => {
    const existingProposalJson = makeExpectedProposalJson()

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTxBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationApproval: {
          id: 'approval_existing_1',
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: existingProposalJson,
          proposedTotal: new Prisma.Decimal('125.00'),
          notes: 'Please review the updated plan.',
          updatedAt: new Date('2026-04-13T18:15:00.000Z'),
        },
      }),
    )

    const result = await POST(
      makeRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStepInTransaction).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      approval: {
        id: 'approval_existing_1',
        status: ConsultationApprovalStatus.PENDING,
        proposedTotal: '125',
        updatedAt: '2026-04-13T18:15:00.000Z',
      },
      sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      proposedCents: 12500,
      consultationActionDelivery: {
        attempted: false,
        queued: false,
        href: null,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('still returns 200 when consultation action delivery enqueue fails', async () => {
    mocks.createConsultationActionDelivery.mockRejectedValueOnce(
      new Error('dispatch enqueue failed'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await POST(
        makeRequest({
          body: makeRawProposalBody(),
        }),
        makeCtx(),
      )

      expect(mocks.createConsultationActionDelivery).toHaveBeenCalledTimes(1)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/pro/bookings/[id]/consultation-proposal action delivery enqueue failed',
        expect.objectContaining({
          bookingId: 'booking_1',
          professionalId: 'pro_1',
          consultationApprovalId: 'approval_1',
          clientId: 'client_1',
          error: expect.any(Error),
        }),
      )

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toEqual({
        ok: true,
        approval: {
          id: 'approval_1',
          status: ConsultationApprovalStatus.PENDING,
          proposedTotal: '125',
          updatedAt: '2026-04-13T18:30:00.000Z',
        },
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        proposedCents: 12500,
        consultationActionDelivery: {
          attempted: true,
          queued: false,
          href: null,
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('returns transaction failure with forcedStep when session transition fails', async () => {
    mocks.transitionSessionStepInTransaction.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'Booking is already in another session step.',
      forcedStep: SessionStep.AFTER_PHOTOS,
    })

    const result = await POST(
      makeRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking is already in another session step.',
      forcedStep: SessionStep.AFTER_PHOTOS,
    })

    expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()
  })

  it('returns 500 for unexpected errors', async () => {
    mocks.prismaTransaction.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})