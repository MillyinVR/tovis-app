import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  ContactMethod,
  MediaPhase,
  NotificationEventKey,
  Prisma,
  Role,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE =
  'POST /api/v1/pro/bookings/[id]/consultation-proposal'

const OPERATION = 'POST /api/v1/pro/bookings/[id]/consultation-proposal'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  isRecord: vi.fn(),

  // F12 — the propose-time schedule check. The computation itself is covered by
  // lib/consultation/proposalSchedule.test.ts and, against real Postgres, by
  // tests/integration/consultation-proposal-schedule.test.ts; here it is a seam
  // so this file can keep asserting the ROUTE's behaviour.
  resolveConsultationMaterialization: vi.fn(),
  consultationExtensionWindow: vi.fn(),
  resolveConsultationScheduleOutlook: vi.fn(),
  hasCalendarBlockConflict: vi.fn(),

  prismaTransaction: vi.fn(),
  deliveryBookingFindUnique: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txActiveOfferingsFindMany: vi.fn(),
  txConsultationApprovalUpsert: vi.fn(),
  txMediaAssetCount: vi.fn(),

  transitionSessionStepInTransaction: vi.fn(),

  areAuditValuesEqual: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),

  upsertClientNotification: vi.fn(),
  createConsultationActionDelivery: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

// NOT mocked. The route throws a BookingError and the assertions below read the
// resulting envelope off the wire — a hand-rolled stub of the catalog would only
// be asserting on itself, and it silently swallowed the `uiAction` override that
// F2's #701 existed to fix.

vi.mock('@/lib/consultation/proposalSchedule', () => ({
  resolveConsultationMaterialization: mocks.resolveConsultationMaterialization,
  consultationExtensionWindow: mocks.consultationExtensionWindow,
  resolveConsultationScheduleOutlook: mocks.resolveConsultationScheduleOutlook,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  hasCalendarBlockConflict: mocks.hasCalendarBlockConflict,
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
  transitionSessionStepInTransaction:
    mocks.transitionSessionStepInTransaction,
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

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CONSULTATION_PROPOSAL_SEND:
      'POST /api/v1/pro/bookings/[id]/consultation-proposal',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

// Deterministic stand-in for the AEAD dual-write so the assertion does not
// depend on a keyring being present in the test env (CI has none).
vi.mock('@/lib/security/notesPrivacy', () => ({
  encryptedNoteInput: (value: unknown) => ({ encrypted: value }),
}))

import { bookingError } from '@/lib/booking/errors'

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
    'http://localhost/api/v1/pro/bookings/booking_1/consultation-proposal',
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

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): Request {
  return makeRequest({
    body: args?.body,
    headers: {
      'idempotency-key': args?.key ?? 'idem_consultation_proposal_1',
      ...(args?.headers ?? {}),
    },
  })
}

function expectIdempotencyStarted(
  key = 'idem_consultation_proposal_1',
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

function expectIdempotencyHandled(response: Response): void {
  mocks.beginRouteIdempotency.mockReset()
  mocks.isRouteIdempotencyHandled.mockReset()

  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response,
  })

  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)
} 

function expectRouteIdempotencyStartedWith(
  requestBody: Record<string, unknown>,
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(Request),
    actor: {
      actorUserId: 'user_1',
      actorRole: Role.PRO,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'consultation proposal',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress:
        'A matching consultation proposal request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
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

function makeExpectedIdempotencyRequestBody() {
  return {
    professionalId: 'pro_1',
    actorUserId: 'user_1',
    bookingId: 'booking_1',
    proposedServicesJson: makeExpectedProposalJson(),
    proposedTotal: '125.00',
    proposedCents: 12500,
    notes: 'Please review the updated plan.',
  }
}

function makeSuccessResponseBody(overrides?: {
  approvalId?: string
  proposedTotal?: string
  updatedAt?: string
  consultationActionDelivery?: {
    attempted: boolean
    queued: boolean
    href: string | null
  }
  meta?: {
    mutated: boolean
    noOp: boolean
  }
}) {
  return {
    approval: {
      id: overrides?.approvalId ?? 'approval_1',
      status: ConsultationApprovalStatus.PENDING,
      proposedTotal: overrides?.proposedTotal ?? '125',
      updatedAt: overrides?.updatedAt ?? '2026-04-13T18:30:00.000Z',
    },
    sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
    proposedCents: 12500,
    schedule: makeExpectedSchedule(),
    consultationActionDelivery:
      overrides?.consultationActionDelivery ?? {
        attempted: true,
        queued: true,
        href: '/client/consultation/raw_consult_token_1',
      },
    meta:
      overrides?.meta ?? {
        mutated: true,
        noOp: false,
      },
  }
}

function makeTxBooking(overrides?: {
  professionalId?: string
  clientId?: string
  locationId?: string | null
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
    // F12 — what the propose-time schedule check reads off the booking.
    scheduledFor: new Date('2026-04-13T18:00:00.000Z'),
    totalDurationMinutes: 80,
    bufferMinutes: 10,
    locationId: overrides && 'locationId' in overrides ? overrides.locationId : 'loc_1',
    locationType: ServiceLocationType.SALON,
    locationTimeZone: 'America/Los_Angeles',
    // §12 NC1 #10: proposal notif is personalized with the pro's display name.
    professional: {
      businessName: 'Glow Studio',
      firstName: null,
      lastName: null,
      handle: null,
      nameDisplay: null,
      timeZone: 'America/Los_Angeles',
    },
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

function makeMaterialization(overrides?: { durationMinutes?: number }) {
  return {
    proposedItems: [],
    normalizedItems: [],
    primaryServiceId: 'svc_base_1',
    primaryOfferingId: 'off_1',
    // Note this is NOT 105 (the 90 + 15 the pro typed): the approval rebuilds
    // durations from the offering catalog, and F12 exists so both sides use the
    // same number. 120 here makes an accidental read of the typed value visible.
    computedDurationMinutes: overrides?.durationMinutes ?? 120,
    computedSubtotal: new Prisma.Decimal('125.00'),
  }
}

function makeExtensionWindow(overrides?: { extendsAppointment?: boolean }) {
  return {
    previousEnd: new Date('2026-04-13T19:30:00.000Z'),
    materializedEnd: new Date('2026-04-13T20:00:00.000Z'),
    extensionStart: new Date('2026-04-13T19:30:00.000Z'),
    extendsAppointment: overrides?.extendsAppointment ?? true,
  }
}

function makeExpectedSchedule(overrides?: {
  outlook?: string
  timeZone?: string | null
}) {
  return {
    endsAt: '2026-04-13T20:00:00.000Z',
    durationMinutes: 120,
    bufferMinutes: 10,
    timeZone:
      overrides && 'timeZone' in overrides
        ? overrides.timeZone
        : 'America/Los_Angeles',
    outlook: overrides?.outlook ?? 'WITHIN_WORKING_HOURS',
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
    // §12 NC1 #10: SMS body personalizes with the pro's display name.
    professional: {
      businessName: 'Glow Studio',
      firstName: null,
      lastName: null,
      handle: null,
      nameDisplay: null,
    },
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

describe('app/api/v1/pro/bookings/[id]/consultation-proposal/route.ts', () => {
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
          mediaAsset: { count: typeof mocks.txMediaAssetCount }
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
          mediaAsset: {
            count: mocks.txMediaAssetCount,
          },
        }),
    )

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.txBookingFindUnique.mockResolvedValue(makeTxBooking())
    mocks.txActiveOfferingsFindMany.mockResolvedValue(makeActiveOfferings())
    mocks.txConsultationApprovalUpsert.mockResolvedValue(makeApproval())
    // Default: no session photos captured (the §22 MS1 pre-capture guard reads
    // this only on the post-consultation reopen path).
    mocks.txMediaAssetCount.mockResolvedValue(0)

    // F12 defaults: a proposal that materializes cleanly, extends the
    // appointment, hits no block, and lands inside the pro's working hours.
    mocks.resolveConsultationMaterialization.mockResolvedValue(
      makeMaterialization(),
    )
    mocks.consultationExtensionWindow.mockReturnValue(makeExtensionWindow())
    mocks.hasCalendarBlockConflict.mockResolvedValue(false)
    mocks.resolveConsultationScheduleOutlook.mockResolvedValue({
      outlook: 'WITHIN_WORKING_HOURS',
      timeZone: 'America/Los_Angeles',
    })

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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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
      code: 'BOOKING_ID_REQUIRED',
      retryable: false,
      uiAction: 'NONE',
      message: 'Booking id is required.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid request body', async () => {
    const result = await POST(makeRequest({ body: [] }), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid request body.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith(makeExpectedIdempotencyRequestBody())

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'A matching consultation proposal request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without running the transaction or delivery again', async () => {
    const replayBody = makeSuccessResponseBody({
      approvalId: 'approval_replay_1',
    })

    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...replayBody,
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('sends a consultation proposal, writes notification/audit data, queues delivery, and completes idempotency', async () => {
    expectIdempotencyStarted('idem_1')

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_1',
        headers: {
          'x-request-id': 'req_1',
        },
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(makeExpectedIdempotencyRequestBody())

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
            addOnService: {
              isActive: true,
              isAddOnEligible: true,
            },
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
        notesEncrypted: { encrypted: 'Please review the updated plan.' },
        approvedAt: null,
        rejectedAt: null,
      },
      update: {
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: makeExpectedProposalJson(),
        proposedTotal: new Prisma.Decimal('125.00'),
        notes: 'Please review the updated plan.',
        notesEncrypted: { encrypted: 'Please review the updated plan.' },
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
      body: 'Glow Studio sent an updated proposal for your visit. Approve or decline to continue.',
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
      route: 'app/api/v1/pro/bookings/[id]/consultation-proposal/route.ts',
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
      professionalName: 'Glow Studio',
      clientId: 'client_1',
      bookingId: 'booking_1',
      consultationApprovalId: 'approval_1',
      recipientUserId: null,
      recipientEmail: 'client@example.com',
      recipientPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      recipientTimeZone: 'America/Los_Angeles',
    })

    const responseBody = makeSuccessResponseBody()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('skips consultation action delivery for true no-op proposal sends and completes idempotency', async () => {
    expectIdempotencyStarted('idem_noop_1')

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
      makeIdempotentRequest({
        key: 'idem_noop_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStepInTransaction).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()

    const responseBody = makeSuccessResponseBody({
      approvalId: 'approval_existing_1',
      updatedAt: '2026-04-13T18:15:00.000Z',
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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('still returns 200 when consultation action delivery enqueue fails and completes idempotency', async () => {
    expectIdempotencyStarted('idem_delivery_fail_1')

    mocks.createConsultationActionDelivery.mockRejectedValueOnce(
      new Error('dispatch enqueue failed'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await POST(
        makeIdempotentRequest({
          key: 'idem_delivery_fail_1',
          body: makeRawProposalBody(),
        }),
        makeCtx(),
      )

      expect(mocks.createConsultationActionDelivery).toHaveBeenCalledTimes(1)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/bookings/[id]/consultation-proposal action delivery enqueue failed',
        expect.objectContaining({
          bookingId: 'booking_1',
          professionalId: 'pro_1',
          consultationApprovalId: 'approval_1',
          clientId: 'client_1',
          error: expect.any(Error),
        }),
      )

      const responseBody = makeSuccessResponseBody({
        consultationActionDelivery: {
          attempted: true,
          queued: false,
          href: null,
        },
      })

      expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        responseStatus: 200,
        responseBody,
      })

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toEqual({
        ok: true,
        ...responseBody,
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('returns transaction failure with forcedStep and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_forced_step_1')

    mocks.transitionSessionStepInTransaction.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'Booking is already in another session step.',
      forcedStep: SessionStep.AFTER_PHOTOS,
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_forced_step_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking is already in another session step.',
      forcedStep: SessionStep.AFTER_PHOTOS,
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()
  })

  it('a refused step transition writes NO proposal — the upsert must not have run', async () => {
    // The $transaction callback RETURNS this refusal, and a return COMMITS
    // whatever ran before it. So the step gate has to come before the first
    // write: with the old order (upsert, then transition) a NO_SHOW or PENDING
    // booking got a 409 while a PENDING proposal sat committed on the booking —
    // clobbering an APPROVED one's status/approvedAt if it existed.
    expectIdempotencyStarted('idem_forced_step_2')

    mocks.transitionSessionStepInTransaction.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'Pending bookings are consultation-only.',
      forcedStep: SessionStep.CONSULTATION,
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_forced_step_2',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result.status).toBe(409)
    expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
  })

  // §22 MS1 — a pro re-opening the consultation to change the service from a
  // post-consultation step, gated on "no session photos captured yet".
  it('re-opens the consultation from BEFORE_PHOTOS when no photos are captured', async () => {
    expectIdempotencyStarted('idem_reopen_before_1')

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTxBooking({ sessionStep: SessionStep.BEFORE_PHOTOS }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(0)

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_reopen_before_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    // The pre-capture guard reads only PRO before/after photos on this booking.
    expect(mocks.txMediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        uploadedByRole: Role.PRO,
        phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] },
      },
    })

    // The re-sent proposal drops the step back to waiting-on-client for
    // re-approval (never a bare serviceId write — that happens on approval).
    expect(mocks.transitionSessionStepInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      }),
    )
    expect(mocks.txConsultationApprovalUpsert).toHaveBeenCalled()
    expect(result.status).toBe(200)
  })

  it('re-opens the consultation from SERVICE_IN_PROGRESS when no photos are captured', async () => {
    expectIdempotencyStarted('idem_reopen_service_1')

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTxBooking({ sessionStep: SessionStep.SERVICE_IN_PROGRESS }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(0)

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_reopen_service_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.transitionSessionStepInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      }),
    )
    expect(result.status).toBe(200)
  })

  it('blocks the service change once a session photo is captured (409)', async () => {
    expectIdempotencyStarted('idem_reopen_blocked_1')

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTxBooking({ sessionStep: SessionStep.BEFORE_PHOTOS }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(1)

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_reopen_blocked_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can’t change the service once session photos are captured.',
    })

    // The proposal never lands and the step never moves.
    expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStepInTransaction).not.toHaveBeenCalled()
  })

  it('maps BookingError through bookingErrorJsonFail and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_forbidden_1')

    mocks.prismaTransaction.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message: 'Not allowed.',
        userMessage: 'Not allowed.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_forbidden_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Not allowed.',
      code: 'FORBIDDEN',
      retryable: false,
      uiAction: 'NONE',
      message: 'Not allowed.',
    })
  })

  it('marks idempotency failed when the transaction throws unexpectedly', async () => {
    expectIdempotencyStarted('idem_boom_1')

    mocks.prismaTransaction.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: makeRawProposalBody(),
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: OPERATION,
    })

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })

  // ── F12 — the propose-time schedule check ────────────────────────────────
  //
  // The route's job here is narrow: ask the shared computation, refuse a block
  // BEFORE it writes anything, and carry the working-hours answer out on the
  // 200. The computation itself is proven in lib/consultation/
  // proposalSchedule.test.ts and against real Postgres in
  // tests/integration/consultation-proposal-schedule.test.ts.

  describe('F12 propose-time schedule check', () => {
    it('refuses a proposal whose extension runs into blocked time', async () => {
      mocks.hasCalendarBlockConflict.mockResolvedValueOnce(true)

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      expect(result.status).toBe(409)
      const body: unknown = await result.json()
      expect(body).toMatchObject({
        ok: false,
        code: 'TIME_BLOCKED',
        // PICK_NEW_SLOT is the catalog default and is meaningless mid-session.
        uiAction: 'NONE',
        error:
          'These services run past this appointment into time you\u2019ve blocked off. Clear the block or trim the proposal, then send again.',
      })

      // Nothing was written, and the client was never told about a proposal
      // that does not exist.
      expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
      expect(mocks.transitionSessionStepInTransaction).not.toHaveBeenCalled()
      expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
      expect(mocks.createConsultationActionDelivery).not.toHaveBeenCalled()
      expect(mocks.failStartedRouteIdempotency).toHaveBeenCalled()
    })

    it('probes only the extension window, using the catalog duration', async () => {
      await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      // The window is derived from the booking's CURRENT duration and the
      // duration the catalog rebuild returned (120) - never from the 90 + 15
      // the pro typed into the form, which the approval discards.
      expect(mocks.consultationExtensionWindow).toHaveBeenCalledWith({
        scheduledFor: new Date('2026-04-13T18:00:00.000Z'),
        previousDurationMinutes: 80,
        bufferMinutes: 10,
        materializedDurationMinutes: 120,
      })

      // extensionStart, not scheduledFor: a block already overlapping the
      // booked time is a pre-existing condition nobody in the room caused.
      expect(mocks.hasCalendarBlockConflict).toHaveBeenCalledWith({
        tx: expect.anything(),
        professionalId: 'pro_1',
        locationId: 'loc_1',
        requestedStart: new Date('2026-04-13T19:30:00.000Z'),
        requestedEnd: new Date('2026-04-13T20:00:00.000Z'),
      })
    })

    it('ALLOWS a proposal that does not grow the appointment, without probing', async () => {
      mocks.consultationExtensionWindow.mockReturnValueOnce(
        makeExtensionWindow({ extendsAppointment: false }),
      )

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      expect(mocks.hasCalendarBlockConflict).not.toHaveBeenCalled()
      expect(result.status).toBe(200)
      expect(mocks.txConsultationApprovalUpsert).toHaveBeenCalled()
    })

    it('ALLOWS a proposal that runs past working hours, and says so on the 200', async () => {
      mocks.resolveConsultationScheduleOutlook.mockResolvedValueOnce({
        outlook: 'PAST_WORKING_HOURS',
        timeZone: 'America/Los_Angeles',
      })

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      // Running late is the pro's call, and no later write consults the rule -
      // so this INFORMS. A refusal here would be a rule Tovis does not have.
      expect(result.status).toBe(200)
      expect(mocks.txConsultationApprovalUpsert).toHaveBeenCalled()
      await expect(result.json()).resolves.toMatchObject({
        schedule: makeExpectedSchedule({ outlook: 'PAST_WORKING_HOURS' }),
      })
    })

    it('still sends when the outlook cannot be resolved', async () => {
      mocks.resolveConsultationScheduleOutlook.mockResolvedValueOnce({
        outlook: 'NOT_CHECKED',
        timeZone: null,
      })

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toMatchObject({
        schedule: makeExpectedSchedule({
          outlook: 'NOT_CHECKED',
          timeZone: null,
        }),
      })
    })

    it('translates an un-materializable proposal into pro-facing copy', async () => {
      mocks.resolveConsultationMaterialization.mockRejectedValueOnce(
        bookingError('INVALID_SERVICE_ITEMS'),
      )

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      expect(result.status).toBe(400)
      // The catalog copy ("Invalid service items.") is written for a client
      // approving a proposal. This is the pro who built it.
      await expect(result.json()).resolves.toMatchObject({
        code: 'INVALID_SERVICE_ITEMS',
        error:
          'One of these services can\u2019t be added to this appointment \u2014 it\u2019s no longer active, or it isn\u2019t offered at this appointment\u2019s location. Remove it and send again.',
      })
      expect(mocks.txConsultationApprovalUpsert).not.toHaveBeenCalled()
    })

    it('reports the schedule on a no-op re-send too', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce(
        makeTxBooking({
          sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
          consultationApproval: {
            id: 'approval_1',
            status: ConsultationApprovalStatus.PENDING,
            proposedServicesJson: makeExpectedProposalJson(),
            proposedTotal: new Prisma.Decimal('125.00'),
            notes: 'Please review the updated plan.',
            updatedAt: new Date('2026-04-13T18:30:00.000Z'),
          },
        }),
      )

      const result = await POST(
        makeIdempotentRequest({ body: makeRawProposalBody() }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toMatchObject({
        meta: { mutated: false, noOp: true },
        schedule: makeExpectedSchedule(),
      })
    })
  })
})