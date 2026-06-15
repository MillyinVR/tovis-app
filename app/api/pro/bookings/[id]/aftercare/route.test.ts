// app/api/pro/bookings/[id]/aftercare/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingStatus,
  Role,
  SessionStep,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/aftercare'
const OPERATION = 'POST /api/pro/bookings/[id]/aftercare'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  isRecord: vi.fn(),
  isValidIanaTimeZone: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  bookingFindUnique: vi.fn(),
  upsertBookingAftercare: vi.fn(),

  withRouteIdempotency: vi.fn(),
  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),

  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: mocks.proRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mocks.isValidIanaTimeZone,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  upsertBookingAftercare: mocks.upsertBookingAftercare,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_AFTERCARE_SEND: 'POST /api/pro/bookings/[id]/aftercare',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'

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
  return new Request('http://localhost/api/pro/bookings/booking_1/aftercare', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(args?.headers ?? {}),
    },
    body: args?.body === undefined ? undefined : JSON.stringify(args.body),
  })
}

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): Request {
  return makeRequest({
    body: args?.body,
    headers: {
      'idempotency-key': args?.key ?? 'idem_aftercare_1',
      ...(args?.headers ?? {}),
    },
  })
}

function expectIdempotencyStarted(key = 'idem_aftercare_1'): void {
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
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.anything(),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      requestLabel: 'aftercare',
      requestBody,
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching aftercare request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    }),
  )
}

function makeGetBooking(overrides?: {
  professionalId?: string
  aftercareSummary?: Record<string, unknown> | null
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: BookingStatus.COMPLETED,
    sessionStep: SessionStep.AFTER_PHOTOS,
    scheduledFor: new Date('2026-04-12T18:00:00.000Z'),
    finishedAt: new Date('2026-04-12T20:00:00.000Z'),
    locationTimeZone: 'America/Los_Angeles',
    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            notes: 'Use a sulfate-free shampoo.',
            rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
            rebookedFor: null,
            rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
            rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
            rebookSlot: null,
            draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
            sentToClientAt: new Date('2026-04-12T20:10:00.000Z'),
            lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
            version: 3,
            recommendedProducts: [
              {
                id: 'rp_1',
                note: 'Use twice weekly',
                productId: 'prod_1',
                externalName: null,
                externalUrl: null,
                product: {
                  id: 'prod_1',
                  name: 'Repair Mask',
                  brand: 'TOVIS',
                  retailPrice: {
                    toString: () => '19.99',
                  },
                },
              },
              {
                id: 'rp_2',
                note: 'Nightly',
                productId: null,
                externalName: 'Silk Pillowcase',
                externalUrl: 'https://example.com/pillowcase',
                product: null,
              },
            ],
          },
  }
}

function makeAftercareAccessDeliverySummary(overrides?: {
  attempted?: boolean
  queued?: boolean
  href?: string | null
}): {
  attempted: boolean
  queued: boolean
  href: string | null
} {
  return {
    attempted: overrides?.attempted ?? true,
    queued: overrides?.queued ?? true,
    href:
      overrides && 'href' in overrides
        ? overrides.href ?? null
        : '/client/rebook/raw_aftercare_token_1',
  }
}

function makeUpsertResult(overrides?: {
  rebookMode?: AftercareRebookMode
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  sentToClientAt?: Date | null
  aftercareAccessDelivery?: {
    attempted: boolean
    queued: boolean
    href: string | null
  }
  clientNotified?: boolean
  bookingFinished?: boolean
  completionBlockers?: string[]
  booking?: {
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: Date | null
  } | null
  meta?: {
    mutated: boolean
    noOp: boolean
  }
}) {
  const rebookMode =
    overrides?.rebookMode ?? AftercareRebookMode.RECOMMENDED_WINDOW

  const isNone = rebookMode === AftercareRebookMode.NONE

  return {
    aftercare: {
      id: 'aftercare_1',
      publicAccess: {
        accessMode: 'NONE',
        hasPublicAccess: false,
        clientAftercareHref: null,
      },
      rebookMode,
      rebookedFor:
        overrides && 'rebookedFor' in overrides
          ? overrides.rebookedFor
          : null,
      rebookWindowStart:
        overrides && 'rebookWindowStart' in overrides
          ? overrides.rebookWindowStart
          : isNone
            ? null
            : new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowEnd:
        overrides && 'rebookWindowEnd' in overrides
          ? overrides.rebookWindowEnd
          : isNone
            ? null
            : new Date('2026-05-15T18:00:00.000Z'),
      rebookSlot:
        overrides && 'rebookSlot' in overrides ? overrides.rebookSlot : null,
      draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
      sentToClientAt:
        overrides && 'sentToClientAt' in overrides
          ? overrides.sentToClientAt
          : new Date('2026-04-12T20:10:00.000Z'),
      lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
      version: 4,
    },
    remindersTouched: 1,
    clientNotified: overrides?.clientNotified ?? true,
    aftercareAccessDelivery:
      overrides?.aftercareAccessDelivery ?? makeAftercareAccessDeliverySummary(),
    timeZoneUsed: 'America/Los_Angeles',
    bookingFinished: overrides?.bookingFinished ?? true,
    completionBlockers: overrides?.completionBlockers ?? [],
    booking:
      overrides && 'booking' in overrides
        ? overrides.booking
        : {
            status: BookingStatus.COMPLETED,
            sessionStep: SessionStep.DONE,
            finishedAt: new Date('2026-04-12T20:00:00.000Z'),
          },
    meta:
      overrides?.meta ?? {
        mutated: true,
        noOp: false,
      },
  }
}

function makeValidPostBody() {
  return {
    notes: '  Use cool water.  ',
    sendToClient: true,
    rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
    rebookWindowStart: '2026-05-01T18:00:00.000Z',
    rebookWindowEnd: '2026-05-15T18:00:00.000Z',
    createRebookReminder: true,
    rebookReminderDaysBefore: 99,
    createProductReminder: 'true',
    productReminderDaysAfter: 0,
    recommendedProducts: [
      {
        productId: 'prod_1',
        note: '  Use twice weekly  ',
      },
      {
        externalName: 'Silk Pillowcase',
        externalUrl: 'https://example.com/pillowcase',
        note: '  Nightly  ',
      },
    ],
    timeZone: 'America/Los_Angeles',
    version: 2,
  }
}

function makeExpectedRecommendedProducts() {
  return [
    {
      productId: 'prod_1',
      externalName: null,
      externalUrl: null,
      note: 'Use twice weekly',
    },
    {
      productId: null,
      externalName: 'Silk Pillowcase',
      externalUrl: 'https://example.com/pillowcase',
      note: 'Nightly',
    },
  ]
}

function makeExpectedIdempotencyRequestBody(overrides?: {
  notes?: string | null
  sendToClient?: boolean
  recommendedProducts?: Array<Record<string, unknown>>
  rebookMode?: AftercareRebookMode
  rebookedFor?: string | null
  rebookWindowStart?: string | null
  rebookWindowEnd?: string | null
  createRebookReminder?: boolean
  rebookReminderDaysBefore?: number
  createProductReminder?: boolean
  productReminderDaysAfter?: number
  clientTimeZoneReceived?: string | null
  version?: number | null
}) {
  return {
    bookingId: 'booking_1',
    professionalId: 'pro_1',
    actorUserId: 'user_1',
    notes:
      overrides && 'notes' in overrides ? overrides.notes : 'Use cool water.',
    sendToClient:
      overrides && 'sendToClient' in overrides ? overrides.sendToClient : true,
    recommendedProducts:
      overrides && 'recommendedProducts' in overrides
        ? overrides.recommendedProducts
        : makeExpectedRecommendedProducts(),
    rebookMode:
      overrides && 'rebookMode' in overrides
        ? overrides.rebookMode
        : AftercareRebookMode.RECOMMENDED_WINDOW,
    rebookedFor:
      overrides && 'rebookedFor' in overrides ? overrides.rebookedFor : null,
    rebookWindowStart:
      overrides && 'rebookWindowStart' in overrides
        ? overrides.rebookWindowStart
        : '2026-05-01T18:00:00.000Z',
    rebookWindowEnd:
      overrides && 'rebookWindowEnd' in overrides
        ? overrides.rebookWindowEnd
        : '2026-05-15T18:00:00.000Z',
    rebookSlot:
      overrides && 'rebookSlot' in overrides ? overrides.rebookSlot : null,
    createRebookReminder:
      overrides && 'createRebookReminder' in overrides
        ? overrides.createRebookReminder
        : true,
    rebookReminderDaysBefore:
      overrides && 'rebookReminderDaysBefore' in overrides
        ? overrides.rebookReminderDaysBefore
        : 30,
    createProductReminder:
      overrides && 'createProductReminder' in overrides
        ? overrides.createProductReminder
        : true,
    productReminderDaysAfter:
      overrides && 'productReminderDaysAfter' in overrides
        ? overrides.productReminderDaysAfter
        : 1,
    clientTimeZoneReceived:
      overrides && 'clientTimeZoneReceived' in overrides
        ? overrides.clientTimeZoneReceived
        : 'America/Los_Angeles',
    version: overrides && 'version' in overrides ? overrides.version : 2,
  }
}

function makeExpectedPostResponse(overrides?: {
  rebookMode?: AftercareRebookMode
  rebookedFor?: string | null
  rebookWindowStart?: string | null
  rebookWindowEnd?: string | null
  sentToClientAt?: string | null
  aftercareAccessDelivery?: {
    attempted: boolean
    queued: boolean
    href: string | null
  }
  clientNotified?: boolean
  clientTimeZoneReceived?: string | null
  bookingFinished?: boolean
  completionBlockers?: string[]
  booking?: {
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: string | null
  } | null
  redirectTo?: string | null
  meta?: {
    mutated: boolean
    noOp: boolean
  }
}) {
  const sentToClientAt =
    overrides && 'sentToClientAt' in overrides
      ? overrides.sentToClientAt
      : '2026-04-12T20:10:00.000Z'

  const bookingFinished =
    overrides && 'bookingFinished' in overrides
      ? overrides.bookingFinished
      : true

  return {
    aftercare: {
      id: 'aftercare_1',
      rebookMode:
        overrides?.rebookMode ?? AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor:
        overrides && 'rebookedFor' in overrides ? overrides.rebookedFor : null,
      rebookWindowStart:
        overrides && 'rebookWindowStart' in overrides
          ? overrides.rebookWindowStart
          : '2026-05-01T18:00:00.000Z',
      rebookWindowEnd:
        overrides && 'rebookWindowEnd' in overrides
          ? overrides.rebookWindowEnd
          : '2026-05-15T18:00:00.000Z',
      rebookSlot:
        overrides && 'rebookSlot' in overrides ? overrides.rebookSlot : null,
      draftSavedAt: '2026-04-12T20:05:00.000Z',
      sentToClientAt,
      lastEditedAt: '2026-04-12T20:08:00.000Z',
      version: 4,
      isFinalized: Boolean(sentToClientAt),
      publicAccess: sentToClientAt
        ? {
            accessMode: 'SECURE_LINK',
            hasPublicAccess: true,
            clientAftercareHref: null,
          }
        : {
            accessMode: 'NONE',
            hasPublicAccess: false,
            clientAftercareHref: null,
          },
    },
    remindersTouched: 1,
    clientNotified: overrides?.clientNotified ?? true,
    aftercareAccessDelivery:
      overrides?.aftercareAccessDelivery ?? makeAftercareAccessDeliverySummary(),
    timeZoneUsed: 'America/Los_Angeles',
    clientTimeZoneReceived:
      overrides && 'clientTimeZoneReceived' in overrides
        ? overrides.clientTimeZoneReceived
        : 'America/Los_Angeles',
    bookingFinished,
    completionBlockers: overrides?.completionBlockers ?? [],
    booking:
      overrides && 'booking' in overrides
        ? overrides.booking
        : {
            status: BookingStatus.COMPLETED,
            sessionStep: SessionStep.DONE,
            finishedAt: '2026-04-12T20:00:00.000Z',
          },
    redirectTo:
      overrides && 'redirectTo' in overrides
        ? overrides.redirectTo
        : '/pro/calendar',
    meta:
      overrides?.meta ?? {
        mutated: true,
        noOp: false,
      },
  }
}

describe('app/api/pro/bookings/[id]/aftercare/route.ts', () => {
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

    mocks.isValidIanaTimeZone.mockImplementation(
      (value: string) => value === 'America/Los_Angeles' || value === 'UTC',
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: { message?: string; userMessage?: string },
      ) => {
        const statusByCode: Record<string, number> = {
          BOOKING_ID_REQUIRED: 400,
          BOOKING_NOT_FOUND: 404,
          FORBIDDEN: 403,
        }

        const messageByCode: Record<string, string> = {
          BOOKING_ID_REQUIRED: 'Missing booking id.',
          BOOKING_NOT_FOUND: 'Booking not found.',
          FORBIDDEN: 'Forbidden.',
        }

        return {
          httpStatus: statusByCode[code] ?? 409,
          userMessage: overrides?.userMessage ?? messageByCode[code] ?? code,
          extra: {
            code,
            ...(overrides?.message ? { message: overrides.message } : {}),
          },
        }
      },
    )

    mocks.proRateLimitKey.mockReturnValue('user:user_1|pro:pro_1|ip:unknown-ip')

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 29,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    mocks.bookingFindUnique.mockResolvedValue(makeGetBooking())

    expectIdempotencyStarted()

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

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
    mocks.upsertBookingAftercare.mockResolvedValue(makeUpsertResult())
  })

  it('GET returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('GET returns 400 when booking id is missing', async () => {
    const result = await GET(
      new Request('http://localhost/test'),
      makeCtx('   '),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('GET maps BOOKING_NOT_FOUND through bookingJsonFail', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'BOOKING_NOT_FOUND',
      undefined,
    )

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking not found.',
      code: 'BOOKING_NOT_FOUND',
    })
  })

  it('GET maps FORBIDDEN through bookingJsonFail when booking belongs to another professional', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeGetBooking({ professionalId: 'pro_other' }),
    )

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'FORBIDDEN',
      undefined,
    )

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
      code: 'FORBIDDEN',
    })
  })

  it('GET returns null aftercareSummary when the booking has no aftercare yet', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeGetBooking({ aftercareSummary: null }),
    )

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.AFTER_PHOTOS,
        scheduledFor: '2026-04-12T18:00:00.000Z',
        finishedAt: '2026-04-12T20:00:00.000Z',
        locationTimeZone: 'America/Los_Angeles',
        aftercareSummary: null,
      },
    })
  })

  it('GET returns normalized aftercare payload with secure-link public access after send', async () => {
    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.any(Object),
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.AFTER_PHOTOS,
        scheduledFor: '2026-04-12T18:00:00.000Z',
        finishedAt: '2026-04-12T20:00:00.000Z',
        locationTimeZone: 'America/Los_Angeles',
        aftercareSummary: {
          id: 'aftercare_1',
          notes: 'Use a sulfate-free shampoo.',
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookedFor: null,
          rebookWindowStart: '2026-05-01T18:00:00.000Z',
          rebookWindowEnd: '2026-05-15T18:00:00.000Z',
          rebookSlot: null,
          draftSavedAt: '2026-04-12T20:05:00.000Z',
          sentToClientAt: '2026-04-12T20:10:00.000Z',
          lastEditedAt: '2026-04-12T20:08:00.000Z',
          version: 3,
          isFinalized: true,
          publicAccess: {
            accessMode: 'SECURE_LINK',
            hasPublicAccess: true,
            clientAftercareHref: null,
          },
          recommendedProducts: [
            {
              id: 'rp_1',
              note: 'Use twice weekly',
              productId: 'prod_1',
              externalName: null,
              externalUrl: null,
              product: {
                id: 'prod_1',
                name: 'Repair Mask',
                brand: 'TOVIS',
                retailPrice: '19.99',
              },
            },
            {
              id: 'rp_2',
              note: 'Nightly',
              productId: null,
              externalName: 'Silk Pillowcase',
              externalUrl: 'https://example.com/pillowcase',
              product: null,
            },
          ],
        },
      },
    })
  })

  it('GET returns no public access when aftercare has not been sent', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeGetBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          notes: 'Draft notes.',
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
          sentToClientAt: null,
          lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
          version: 2,
          recommendedProducts: [],
        },
      }),
    )

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.AFTER_PHOTOS,
        scheduledFor: '2026-04-12T18:00:00.000Z',
        finishedAt: '2026-04-12T20:00:00.000Z',
        locationTimeZone: 'America/Los_Angeles',
        aftercareSummary: {
          id: 'aftercare_1',
          notes: 'Draft notes.',
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          rebookSlot: null,
          draftSavedAt: '2026-04-12T20:05:00.000Z',
          sentToClientAt: null,
          lastEditedAt: '2026-04-12T20:08:00.000Z',
          version: 2,
          isFinalized: false,
          publicAccess: {
            accessMode: 'NONE',
            hasPublicAccess: false,
            clientAftercareHref: null,
          },
          recommendedProducts: [],
        }
      },
    })
  })

  it('POST returns auth response when requirePro fails', async () => {
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
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 when booking id is missing', async () => {
    const result = await POST(
      makeRequest({
        body: { rebookMode: AftercareRebookMode.NONE },
      }),
      makeCtx('   '),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns rate-limit response before parsing body or starting idempotency', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeRequest({
        body: [],
        headers: {
          'idempotency-key': 'idem_aftercare_limited_1',
        },
      }),
      makeCtx(),
    )

    expect(result).toBe(limitedResponse)

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid request body', async () => {
    const result = await POST(makeRequest({ body: [] }), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid request body.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid recommendedProducts payload', async () => {
    const result = await POST(
      makeRequest({
        body: {
          notes: 'hello',
          recommendedProducts: [
            {
              productId: 'prod_1',
              externalName: 'Also external',
            },
          ],
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'Each recommended product must be either an internal product or an external link, not both.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid rebookMode', async () => {
    const result = await POST(
      makeRequest({
        body: {
          rebookMode: 'SOMETHING_WILD',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid rebookMode.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid rebook date combination', async () => {
    const result = await POST(
      makeRequest({
        body: {
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: '2026-05-15T18:00:00.000Z',
          rebookWindowEnd: '2026-05-01T18:00:00.000Z',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'rebookWindowEnd must be after rebookWindowStart.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeRequest({
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith(makeExpectedIdempotencyRequestBody())
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns handled in-progress idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error: 'A matching aftercare request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns handled conflict idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST replays completed idempotency response without upsert', async () => {
    const replayBody = makeExpectedPostResponse()
    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...replayBody,
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST calls upsertBookingAftercare with normalized values and completes idempotency', async () => {
    expectIdempotencyStarted('idem_1')

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_1',
        headers: {
          'x-request-id': 'req_1',
        },
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(makeExpectedIdempotencyRequestBody())

    expect(mocks.upsertBookingAftercare).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      notes: 'Use cool water.',
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: null,
      rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
      rebookSlot: null,
      createRebookReminder: true,
      rebookReminderDaysBefore: 30,
      createProductReminder: true,
      productReminderDaysAfter: 1,
      recommendedProducts: makeExpectedRecommendedProducts(),
      sendToClient: true,
      version: 2,
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
    })

    const responseBody = makeExpectedPostResponse()

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

  it('POST returns bookingFinished false with completion blockers when aftercare sends but closeout is blocked', async () => {
    expectIdempotencyStarted('idem_blocked_closeout_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        bookingFinished: false,
        completionBlockers: [
          'AFTER_PHOTOS_REQUIRED',
          'PAYMENT_NOT_COLLECTED',
          'CHECKOUT_NOT_COMPLETE',
        ],
        booking: {
          status: BookingStatus.IN_PROGRESS,
          sessionStep: SessionStep.AFTER_PHOTOS,
          finishedAt: new Date('2026-04-12T20:00:00.000Z'),
        },
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_blocked_closeout_1',
        headers: {
          'x-request-id': 'req_blocked_closeout_1',
        },
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    const responseBody = makeExpectedPostResponse({
      bookingFinished: false,
      completionBlockers: [
        'AFTER_PHOTOS_REQUIRED',
        'PAYMENT_NOT_COLLECTED',
        'CHECKOUT_NOT_COMPLETE',
      ],
      booking: {
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.AFTER_PHOTOS,
        finishedAt: '2026-04-12T20:00:00.000Z',
      },
      redirectTo: null,
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

  it('POST returns bookingFinished true with completed booking and calendar redirect when closeout completes', async () => {
    expectIdempotencyStarted('idem_completed_closeout_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        bookingFinished: true,
        completionBlockers: [],
        booking: {
          status: BookingStatus.COMPLETED,
          sessionStep: SessionStep.DONE,
          finishedAt: new Date('2026-04-12T20:00:00.000Z'),
        },
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_completed_closeout_1',
        headers: {
          'x-request-id': 'req_completed_closeout_1',
        },
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    const responseBody = makeExpectedPostResponse({
      bookingFinished: true,
      completionBlockers: [],
      booking: {
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: '2026-04-12T20:00:00.000Z',
      },
      redirectTo: '/pro/calendar',
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

  it('POST returns draft response when sendToClient is false', async () => {
    expectIdempotencyStarted('idem_draft_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        sentToClientAt: null,
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        aftercareAccessDelivery: makeAftercareAccessDeliverySummary({
          attempted: false,
          queued: false,
          href: null,
        }),
        clientNotified: false,
        bookingFinished: false,
        booking: null,
      }),
    )

    const idempotencyBody = makeExpectedIdempotencyRequestBody({
      notes: null,
      sendToClient: false,
      recommendedProducts: [],
      rebookMode: AftercareRebookMode.NONE,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      createRebookReminder: false,
      rebookReminderDaysBefore: 2,
      createProductReminder: false,
      productReminderDaysAfter: 7,
      clientTimeZoneReceived: null,
      version: null,
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_draft_1',
        body: {
          rebookMode: AftercareRebookMode.NONE,
          sendToClient: false,
        },
      }),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(idempotencyBody)

    const responseBody = makeExpectedPostResponse({
      rebookMode: AftercareRebookMode.NONE,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      sentToClientAt: null,
      aftercareAccessDelivery: {
        attempted: false,
        queued: false,
        href: null,
      },
      clientNotified: false,
      clientTimeZoneReceived: null,
      bookingFinished: false,
      booking: null,
      redirectTo: null,
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

  it('POST returns access delivery summary from write boundary when aftercare was not actually sent', async () => {
    expectIdempotencyStarted('idem_not_sent_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        sentToClientAt: null,
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        aftercareAccessDelivery: makeAftercareAccessDeliverySummary({
          attempted: false,
          queued: false,
          href: null,
        }),
        clientNotified: false,
        bookingFinished: false,
        booking: null,
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_not_sent_1',
        body: {
          rebookMode: AftercareRebookMode.NONE,
          sendToClient: true,
        },
      }),
      makeCtx(),
    )

    const responseBody = makeExpectedPostResponse({
      rebookMode: AftercareRebookMode.NONE,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      sentToClientAt: null,
      aftercareAccessDelivery: {
        attempted: false,
        queued: false,
        href: null,
      },
      clientNotified: false,
      clientTimeZoneReceived: null,
      bookingFinished: false,
      booking: null,
      redirectTo: null,
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

  it('POST returns null clientTimeZoneReceived when the submitted time zone is invalid', async () => {
    expectIdempotencyStarted('idem_bad_timezone_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        sentToClientAt: null,
        aftercareAccessDelivery: makeAftercareAccessDeliverySummary({
          attempted: false,
          queued: false,
          href: null,
        }),
        clientNotified: false,
        bookingFinished: false,
        booking: null,
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_bad_timezone_1',
        body: {
          rebookMode: AftercareRebookMode.NONE,
          timeZone: 'Mars/Olympus_Mons',
        },
      }),
      makeCtx(),
    )

    expect(mocks.upsertBookingAftercare).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      notes: null,
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookSlot: null,
      createRebookReminder: false,
      rebookReminderDaysBefore: 2,
      createProductReminder: false,
      productReminderDaysAfter: 7,
      recommendedProducts: [],
      sendToClient: false,
      version: null,
      requestId: null,
      idempotencyKey: 'idem_bad_timezone_1',
    })

    const responseBody = makeExpectedPostResponse({
      rebookMode: AftercareRebookMode.NONE,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      sentToClientAt: null,
      aftercareAccessDelivery: {
        attempted: false,
        queued: false,
        href: null,
      },
      clientNotified: false,
      clientTimeZoneReceived: null,
      bookingFinished: false,
      booking: null,
      redirectTo: null,
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

  it('POST maps BookingError through bookingJsonFail and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_forbidden_1')

    mocks.upsertBookingAftercare.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Not allowed.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Not allowed.',
      },
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_forbidden_1',
        body: {
          rebookMode: AftercareRebookMode.NONE,
        },
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Not allowed.',
      code: 'FORBIDDEN',
      message: 'Not allowed.',
    })
  })

  it('POST completes booking when aftercare sends and closeout requirements are satisfied', async () => {
    expectIdempotencyStarted('idem_closeout_success_1')

    mocks.upsertBookingAftercare.mockResolvedValueOnce(
      makeUpsertResult({
        bookingFinished: true,
        completionBlockers: [],
        booking: {
          status: BookingStatus.COMPLETED,
          sessionStep: SessionStep.DONE,
          finishedAt: new Date('2026-04-12T20:00:00.000Z'),
        },
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_closeout_success_1',
        headers: {
          'x-request-id': 'req_closeout_success_1',
        },
        body: makeValidPostBody(),
      }),
      makeCtx(),
    )

    const responseBody = makeExpectedPostResponse({
      bookingFinished: true,
      completionBlockers: [],
      booking: {
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: '2026-04-12T20:00:00.000Z',
      },
      redirectTo: '/pro/calendar',
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

  it.each([
    ['AFTER_PHOTOS_REQUIRED'],
    ['AFTERCARE_REQUIRED'],
    ['AFTERCARE_NOT_SENT'],
    ['PAYMENT_NOT_COLLECTED'],
    ['CHECKOUT_NOT_COMPLETE'],
    ['CONSULTATION_NOT_APPROVED'],
  ])(
    'POST keeps booking incomplete when closeout blocker exists: %s',
    async (blocker) => {
      expectIdempotencyStarted(`idem_blocker_${blocker}`)

      mocks.upsertBookingAftercare.mockResolvedValueOnce(
        makeUpsertResult({
          bookingFinished: false,
          completionBlockers: [blocker],
          booking: {
            status: BookingStatus.IN_PROGRESS,
            sessionStep: SessionStep.AFTER_PHOTOS,
            finishedAt: null,
          },
        }),
      )

      const result = await POST(
        makeIdempotentRequest({
          key: `idem_blocker_${blocker}`,
          headers: {
            'x-request-id': `req_blocker_${blocker}`,
          },
          body: makeValidPostBody(),
        }),
        makeCtx(),
      )

      const responseBody = makeExpectedPostResponse({
        bookingFinished: false,
        completionBlockers: [blocker],
        booking: {
          status: BookingStatus.IN_PROGRESS,
          sessionStep: SessionStep.AFTER_PHOTOS,
          finishedAt: null,
        },
        redirectTo: null,
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
    },
  )

  it('POST returns 500 for unexpected errors, logs safely, captures exception, and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_boom_1')

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'boom for https://example.com/aftercare?token=raw_secret',
    )

    mocks.upsertBookingAftercare.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: {
          rebookMode: AftercareRebookMode.NONE,
        },
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/aftercare error',
      {
        error: {
          name: 'Error',
          message:
            'boom for https://example.com/aftercare?token=raw_secret',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: OPERATION,
    })

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    consoleErrorSpy.mockRestore()
  })
})