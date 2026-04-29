import { prisma } from '@/lib/prisma'
import {
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  type ServiceLocationType,
} from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { isRecord } from '@/lib/guards'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { finalizeBookingFromHold } from '@/lib/booking/writeBoundary'
import { resolveAftercareAccessByToken } from '@/lib/aftercare/unclaimedAftercareAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FALLBACK_TIME_ZONE: 'UTC' = 'UTC'

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
  rebookOfBookingId: string | null
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
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

function parseFinalizeBody(rawBody: unknown): ParsedFinalizeBody {
  const body = isRecord(rawBody) ? rawBody : {}

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
}) {
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

    const resolved = await resolveAftercareAccessByToken({
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
    rebookOfBookingId: null,
  }
}

function readFinalizeMeta(request: Request): {
  requestId: string | null
  idempotencyKey: string | null
} {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(request.headers.get('idempotency-key')) ??
    pickString(request.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
}

export async function POST(request: Request) {
  try {
    const { requestId, idempotencyKey } = readFinalizeMeta(request)

    const rawBody: unknown = await request.json().catch(() => ({}))
    const parsedBody = parseFinalizeBody(rawBody)

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

    const result = await finalizeBookingFromHold({
      clientId: ownershipOrFail.clientId,
      holdId: body.holdId,
      openingId: body.openingId,
      addOnIds: body.addOnIds,
      locationType: body.locationType,
      source: body.source,
      initialStatus,
      rebookOfBookingId: ownershipOrFail.rebookOfBookingId,
      offering: toFinalizeOffering(offering),
      fallbackTimeZone: FALLBACK_TIME_ZONE,
      requestId,
      idempotencyKey,
    })

    try {
      await createFinalizeProNotification({
        professionalId: result.booking.professionalId,
        bookingId: result.booking.id,
        actorUserId: ownershipOrFail.actorUserId,
        bookingStatus: result.booking.status,
        source: body.source,
        locationType: body.locationType,
      })
    } catch (notificationError: unknown) {
      console.error(
        'POST /api/bookings/finalize pro notification error:',
        notificationError,
      )
    }

    return jsonOk(
      {
        booking: result.booking,
        meta: result.meta,
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/finalize error:', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Internal server error',
      userMessage: 'Internal server error',
    })
  }
}