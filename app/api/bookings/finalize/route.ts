// app/api/bookings/finalize/route.ts

import {
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  Role,
  type ServiceLocationType,
} from '@prisma/client'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonOk } from '@/app/api/_utils/responses'
import {
  markAftercareAccessTokenUsed,
  resolveAftercareAccessTokenForMutation,
} from '@/lib/aftercare/aftercareAccessTokens'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { finalizeBookingFromHold } from '@/lib/booking/writeBoundary'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { type UnknownRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { bookingEntryPointFromBookingSource } from '@/lib/pro/readiness/bookingEntryPoint'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import {
  clientRateLimitKey,
  tokenActorRateLimitKey,
} from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CLIENT_ROLE: Role = 'CLIENT'

const FALLBACK_TIME_ZONE = 'UTC' as const

const FINALIZE_OFFERING_SELECT = {
  id: true,
  isActive: true,
  professionalId: true,
  serviceId: true,
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: true,
  salonDurationMinutes: true,
  mobilePriceStartingAt: true,
  mobileDurationMinutes: true,
  professional: {
    select: {
      autoAcceptBookings: true,
      timeZone: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

type FinalizeOfferingRecord = Prisma.ProfessionalServiceOfferingGetPayload<{
  select: typeof FINALIZE_OFFERING_SELECT
}>

type FinalizeOfferingForBoundary = {
  id: string
  professionalId: string
  serviceId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonPriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: Prisma.Decimal | null
  mobileDurationMinutes: number | null
  professionalTimeZone: string | null
}

type ParsedFinalizeBody = {
  offeringId: string | null
  holdId: string | null
  mediaId: string | null
  lookPostId: string | null
  openingId: string | null
  aftercareToken: string | null
  requestedRebookOfBookingId: string | null
  locationType: ServiceLocationType | null
  addOnIds: string[]
  source: BookingSource
}

type ValidatedFinalizeBody = {
  offeringId: string
  holdId: string
  mediaId: string | null
  lookPostId: string | null
  openingId: string | null
  aftercareToken: string | null
  requestedRebookOfBookingId: string | null
  locationType: ServiceLocationType
  addOnIds: string[]
  source: BookingSource
}

type FinalizeOwnershipContext = {
  clientId: string
  actorUserId: string | null
  idempotencyActor:
    | {
        kind: 'authenticated-client'
        actorUserId: string
      }
    | {
        kind: 'aftercare-token'
        actorKey: string
        tokenId: string
      }
  rebookOfBookingId: string | null
}

type FinalizeSuccessBody = {
  ok: true
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: string
    professionalId: string
  }
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

function discoveryContextMissingFail(): Response {
  return bookingJsonFail('MISSING_MEDIA_ID', {
    userMessage: 'Discovery bookings require a look post id or media id.',
    message: 'Discovery bookings require a lookPostId or mediaId.',
  })
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 25)
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length
}

function hasDiscoveryReference(args: {
  mediaId: string | null
  lookPostId: string | null
}): boolean {
  return Boolean(args.mediaId || args.lookPostId)
}

function normalizeSourceFromRequest(args: {
  sourceRaw: unknown
  mediaId: string | null
  lookPostId: string | null
  aftercareToken: string | null
}): BookingSource {
  if (args.aftercareToken) {
    return BookingSource.AFTERCARE
  }

  const raw =
    typeof args.sourceRaw === 'string' ? args.sourceRaw.trim().toUpperCase() : ''

  if (raw === BookingSource.AFTERCARE) return BookingSource.AFTERCARE
  if (raw === BookingSource.DISCOVERY) return BookingSource.DISCOVERY
  if (raw === BookingSource.REQUESTED) return BookingSource.REQUESTED

  if (raw === 'PROFILE') return BookingSource.REQUESTED
  if (raw === 'UNKNOWN') return BookingSource.REQUESTED

  if (hasDiscoveryReference(args)) return BookingSource.DISCOVERY

  return BookingSource.REQUESTED
}

function parseFinalizeBody(body: UnknownRecord): ParsedFinalizeBody {
  const offeringId = pickString(body.offeringId)
  const holdId = pickString(body.holdId)
  const mediaId = pickString(body.mediaId)
  const lookPostId = pickString(body.lookPostId)
  const openingId = pickString(body.openingId)
  const aftercareToken = pickString(body.aftercareToken)
  const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)
  const locationType = normalizeLocationType(body.locationType)
  const addOnIds = pickStringArray(body.addOnIds)

  const source = normalizeSourceFromRequest({
    sourceRaw: body.source,
    mediaId,
    lookPostId,
    aftercareToken,
  })

  return {
    offeringId,
    holdId,
    mediaId,
    lookPostId,
    openingId,
    aftercareToken,
    requestedRebookOfBookingId,
    locationType,
    addOnIds,
    source,
  }
}

function validateParsedFinalizeBody(
  body: ParsedFinalizeBody,
): { ok: true; body: ValidatedFinalizeBody } | { ok: false; response: Response } {
  if (hasDuplicates(body.addOnIds)) {
    return { ok: false, response: bookingJsonFail('ADDONS_INVALID') }
  }

  if (!body.locationType) {
    return { ok: false, response: bookingJsonFail('LOCATION_TYPE_REQUIRED') }
  }

  if (!body.offeringId) {
    return { ok: false, response: bookingJsonFail('OFFERING_ID_REQUIRED') }
  }

  if (!body.holdId) {
    return { ok: false, response: bookingJsonFail('HOLD_ID_REQUIRED') }
  }

  if (
    body.source === BookingSource.DISCOVERY &&
    !hasDiscoveryReference({
      mediaId: body.mediaId,
      lookPostId: body.lookPostId,
    })
  ) {
    return { ok: false, response: discoveryContextMissingFail() }
  }

  if (body.source === BookingSource.AFTERCARE && !body.aftercareToken) {
    return { ok: false, response: bookingJsonFail('AFTERCARE_TOKEN_MISSING') }
  }

  return {
    ok: true,
    body: {
      offeringId: body.offeringId,
      holdId: body.holdId,
      mediaId: body.mediaId,
      lookPostId: body.lookPostId,
      openingId: body.openingId,
      aftercareToken: body.aftercareToken,
      requestedRebookOfBookingId: body.requestedRebookOfBookingId,
      locationType: body.locationType,
      addOnIds: body.addOnIds,
      source: body.source,
    },
  }
}

function toFinalizeOffering(
  offering: FinalizeOfferingRecord,
): FinalizeOfferingForBoundary {
  return {
    id: offering.id,
    professionalId: offering.professionalId,
    serviceId: offering.serviceId,
    offersInSalon: offering.offersInSalon,
    offersMobile: offering.offersMobile,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    salonDurationMinutes: offering.salonDurationMinutes,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
    mobileDurationMinutes: offering.mobileDurationMinutes,
    professionalTimeZone: offering.professional?.timeZone ?? null,
  }
}

function getFinalizeProNotificationMeta(status: BookingStatus): {
  eventKey: NotificationEventKey
  title: string
} {
  if (status === BookingStatus.PENDING) {
    return {
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
      title: 'New booking request',
    }
  }

  return {
    eventKey: NotificationEventKey.BOOKING_CONFIRMED,
    title: 'New booking confirmed',
  }
}

async function createFinalizeProNotification(args: {
  professionalId: string
  bookingId: string
  actorUserId: string | null
  bookingStatus: BookingStatus
  source: BookingSource
  locationType: ServiceLocationType
}): Promise<void> {
  const meta = getFinalizeProNotificationMeta(args.bookingStatus)

  await createProNotification({
    professionalId: args.professionalId,
    eventKey: meta.eventKey,
    title: meta.title,
    body: '',
    href: `/pro/bookings/${args.bookingId}`,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    dedupeKey: `PRO_NOTIF:${meta.eventKey}:${args.bookingId}`,
    data: {
      bookingId: args.bookingId,
      bookingStatus: args.bookingStatus,
      source: args.source,
      locationType: args.locationType,
    },
  })
}

async function getOfferingOrFail(
  offeringId: string,
): Promise<FinalizeOfferingRecord | Response> {
  const offering = await prisma.professionalServiceOffering.findUnique({
    where: { id: offeringId },
    select: FINALIZE_OFFERING_SELECT,
  })

  if (!offering || !offering.isActive) {
    return bookingJsonFail('OFFERING_NOT_FOUND')
  }

  return offering
}

async function resolveFinalizeOwnershipContext(args: {
  source: BookingSource
  aftercareToken: string | null
  requestedRebookOfBookingId: string | null
  offering: FinalizeOfferingRecord
}): Promise<FinalizeOwnershipContext | Response> {
  if (args.source === BookingSource.AFTERCARE) {
    const aftercareToken = args.aftercareToken

    if (!aftercareToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING')
    }

    const resolved = await resolveAftercareAccessTokenForMutation({
      rawToken: aftercareToken,
    })

    const original = resolved.booking

    if (original.status !== BookingStatus.COMPLETED) {
      return bookingJsonFail('AFTERCARE_NOT_COMPLETED')
    }

    const matchesOffering =
      (original.offeringId && original.offeringId === args.offering.id) ||
      (original.professionalId === args.offering.professionalId &&
        original.serviceId === args.offering.serviceId)

    if (!matchesOffering) {
      return bookingJsonFail('AFTERCARE_OFFERING_MISMATCH')
    }

    return {
      clientId: original.clientId,
      actorUserId: null,
      idempotencyActor: {
        kind: 'aftercare-token',
        actorKey: resolved.idempotencyActorKey,
        tokenId: resolved.token.id,
      },
      rebookOfBookingId:
        args.requestedRebookOfBookingId === original.id
          ? args.requestedRebookOfBookingId
          : original.id,
    }
  }

  const auth = await requireClient()

  if (!auth.ok) {
    return auth.res
  }

  return {
    clientId: auth.clientId,
    actorUserId: auth.user.id,
    idempotencyActor: {
      kind: 'authenticated-client',
      actorUserId: auth.user.id,
    },
    rebookOfBookingId: null,
  }
}

function readRequestId(request: Request): string | null {
  return (
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null
  )
}

function buildFinalizeIdempotencyRequestBody(args: {
  clientId: string
  body: ValidatedFinalizeBody
  bookingEntryPoint: ReturnType<typeof bookingEntryPointFromBookingSource>
  rebookOfBookingId: string | null
}): Prisma.InputJsonObject {
  return {
    clientId: args.clientId,
    offeringId: args.body.offeringId,
    holdId: args.body.holdId,
    openingId: args.body.openingId,
    addOnIds: args.body.addOnIds,
    locationType: args.body.locationType,
    source: args.body.source,
    bookingEntryPoint: args.bookingEntryPoint,
    mediaId: args.body.mediaId,
    lookPostId: args.body.lookPostId,
    aftercareToken: args.body.aftercareToken,
    rebookOfBookingId: args.rebookOfBookingId,
  }
}

function buildFinalizeSuccessBody(args: {
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
    professionalId: string
  }
  meta: {
    mutated: boolean
    noOp: boolean
  }
}): FinalizeSuccessBody {
  return {
    ok: true,
    booking: {
      id: args.booking.id,
      status: args.booking.status,
      scheduledFor: args.booking.scheduledFor.toISOString(),
      professionalId: args.booking.professionalId,
    },
    meta: args.meta,
  }
}

function buildIdempotencyActor(
  context: FinalizeOwnershipContext,
):
  | {
      actorUserId: string
      actorRole: Role
    }
  | {
      actorKey: string
      actorRole: Role
    } {
  if (context.idempotencyActor.kind === 'authenticated-client') {
    return {
      actorUserId: context.idempotencyActor.actorUserId,
      actorRole: CLIENT_ROLE,
    }
  }

  return {
    actorKey: context.idempotencyActor.actorKey,
    actorRole: CLIENT_ROLE,
  }
}

function buildFinalizeRateLimitKey(args: {
  context: FinalizeOwnershipContext
  request: Request
}): string {
  if (args.context.idempotencyActor.kind === 'aftercare-token') {
    return tokenActorRateLimitKey({
      actorKey: args.context.idempotencyActor.actorKey,
      request: args.request,
    })
  }

  return clientRateLimitKey({
    clientId: args.context.clientId,
    userId: args.context.idempotencyActor.actorUserId,
    request: args.request,
  })
}

function getAftercareTokenId(
  context: FinalizeOwnershipContext,
): string | null {
  if (context.idempotencyActor.kind !== 'aftercare-token') {
    return null
  }

  return context.idempotencyActor.tokenId
}

export async function POST(request: Request) {
  let idempotencyRecordId: string | null = null
  const requestId = readRequestId(request)

  try {
    const parsedBody = parseFinalizeBody(await readJsonRecord(request))

    const validated = validateParsedFinalizeBody(parsedBody)

    if (!validated.ok) {
      return validated.response
    }

    const body = validated.body

    const offeringOrFail = await getOfferingOrFail(body.offeringId)

    if (offeringOrFail instanceof Response) {
      return offeringOrFail
    }

    const offering = offeringOrFail

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = getClientSubmittedBookingStatus(autoAccept)

    const ownershipOrFail = await resolveFinalizeOwnershipContext({
      source: body.source,
      aftercareToken: body.aftercareToken,
      requestedRebookOfBookingId: body.requestedRebookOfBookingId,
      offering,
    })

    if (ownershipOrFail instanceof Response) {
      return ownershipOrFail
    }

    const ownership = ownershipOrFail

    const bookingEntryPoint = bookingEntryPointFromBookingSource(body.source)

    const rateLimit = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: buildFinalizeRateLimitKey({
        context: ownership,
        request,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const idempotency = await beginRouteIdempotency<FinalizeSuccessBody>({
      request,
      actor: buildIdempotencyActor(ownership),
      route: IDEMPOTENCY_ROUTES.BOOKING_FINALIZE,
      requestLabel: 'booking finalize',
      requestBody: buildFinalizeIdempotencyRequestBody({
        clientId: ownership.clientId,
        body,
        bookingEntryPoint,
        rebookOfBookingId: ownership.rebookOfBookingId,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching booking request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await finalizeBookingFromHold({
      clientId: ownership.clientId,
      bookingEntryPoint,
      holdId: body.holdId,
      openingId: body.openingId,
      addOnIds: body.addOnIds,
      locationType: body.locationType,
      source: body.source,
      initialStatus,
      rebookOfBookingId: ownership.rebookOfBookingId,
      offering: toFinalizeOffering(offering),
      fallbackTimeZone: FALLBACK_TIME_ZONE,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
    })

    try {
      await createFinalizeProNotification({
        professionalId: result.booking.professionalId,
        bookingId: result.booking.id,
        actorUserId: ownership.actorUserId,
        bookingStatus: result.booking.status,
        source: body.source,
        locationType: body.locationType,
      })
    } catch (notificationError: unknown) {
      console.error('POST /api/bookings/finalize pro notification error', {
        requestId,
        bookingId: result.booking.id,
        professionalId: result.booking.professionalId,
        error: safeError(notificationError),
      })
    }

    const responseBody = buildFinalizeSuccessBody({
      booking: result.booking,
      meta: result.meta,
    })

    const aftercareTokenId = getAftercareTokenId(ownership)

    if (aftercareTokenId) {
      await markAftercareAccessTokenUsed({
        tokenId: aftercareTokenId,
      })
    }

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    return jsonOk(responseBody, 201)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/bookings/finalize',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/finalize error', {
      requestId,
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/bookings/finalize',
    })

    return bookingJsonFail('INTERNAL_ERROR', {
      message: 'Internal server error',
      userMessage: 'Internal server error',
    })
  }
}