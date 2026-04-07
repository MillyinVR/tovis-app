// app/api/bookings/finalize/route.ts
import { prisma } from '@/lib/prisma'
import {
  BookingSource,
  BookingStatus,
  NotificationType,
  Prisma,
  ProNotificationReason,
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

export const dynamic = 'force-dynamic'

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

function normalizeSourceLoose(args: {
  sourceRaw: unknown
  mediaId: string | null
  aftercareToken: string | null
}): BookingSource {
  const raw =
    typeof args.sourceRaw === 'string' ? args.sourceRaw.trim().toUpperCase() : ''

  if (raw === BookingSource.AFTERCARE) return BookingSource.AFTERCARE
  if (raw === BookingSource.DISCOVERY) return BookingSource.DISCOVERY
  if (raw === BookingSource.REQUESTED) return BookingSource.REQUESTED

  if (raw === 'PROFILE') return BookingSource.REQUESTED
  if (raw === 'UNKNOWN') return BookingSource.REQUESTED

  if (args.aftercareToken) return BookingSource.AFTERCARE
  if (args.mediaId) return BookingSource.DISCOVERY
  return BookingSource.REQUESTED
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

function toFinalizeOffering(
  offering: FinalizeOfferingRecord,
): {
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
} {
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
  type: NotificationType
  reason: ProNotificationReason
  title: string
} {
  if (status === BookingStatus.PENDING) {
    return {
      type: NotificationType.BOOKING_REQUEST,
      reason: ProNotificationReason.BOOKING_REQUEST_CREATED,
      title: 'New booking request',
    }
  }

  if (status === BookingStatus.ACCEPTED) {
    return {
      type: NotificationType.BOOKING_UPDATE,
      reason: ProNotificationReason.BOOKING_CONFIRMED,
      title: 'New booking confirmed',
    }
  }

  return {
    type: NotificationType.BOOKING_UPDATE,
    reason: ProNotificationReason.BOOKING_CONFIRMED,
    title: 'New booking confirmed',
  }
}

async function createFinalizeProNotification(args: {
  professionalId: string
  bookingId: string
  actorUserId: string
  bookingStatus: BookingStatus
  source: BookingSource
  locationType: ServiceLocationType
}) {
  const meta = getFinalizeProNotificationMeta(args.bookingStatus)

  await createProNotification({
    professionalId: args.professionalId,
    type: meta.type,
    reason: meta.reason,
    title: meta.title,
    body: '',
    href: `/pro/bookings/${args.bookingId}`,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    dedupeKey: `PRO_NOTIF:${meta.reason}:${args.bookingId}`,
    data: {
      bookingId: args.bookingId,
      bookingStatus: args.bookingStatus,
      source: args.source,
      locationType: args.locationType,
    },
  })
}

export async function POST(request: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId, user } = auth

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)
    const mediaId = pickString(body.mediaId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)
    const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)
    const locationType = normalizeLocationType(body.locationType)

    const addOnIds = pickStringArray(body.addOnIds)
    if (hasDuplicates(addOnIds)) {
      return bookingJsonFail('ADDONS_INVALID')
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (!holdId) {
      return bookingJsonFail('HOLD_ID_REQUIRED')
    }

    const source = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    if (source === BookingSource.DISCOVERY && !mediaId) {
      return bookingJsonFail('MISSING_MEDIA_ID')
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: FINALIZE_OFFERING_SELECT,
    })

    if (!offering || !offering.isActive) {
      return bookingJsonFail('OFFERING_NOT_FOUND')
    }

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = getClientSubmittedBookingStatus(autoAccept)

    let rebookOfBookingId: string | null = null

    if (source === BookingSource.AFTERCARE) {
      if (!aftercareToken) {
        return bookingJsonFail('AFTERCARE_TOKEN_MISSING')
      }

      const aftercare = await prisma.aftercareSummary.findUnique({
        where: { publicToken: aftercareToken },
        select: {
          booking: {
            select: {
              id: true,
              status: true,
              clientId: true,
              professionalId: true,
              serviceId: true,
              offeringId: true,
            },
          },
        },
      })

      if (!aftercare?.booking) {
        return bookingJsonFail('AFTERCARE_TOKEN_INVALID')
      }

      const original = aftercare.booking

      if (original.status !== BookingStatus.COMPLETED) {
        return bookingJsonFail('AFTERCARE_NOT_COMPLETED')
      }

      if (original.clientId !== clientId) {
        return bookingJsonFail('AFTERCARE_CLIENT_MISMATCH')
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId &&
          original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return bookingJsonFail('AFTERCARE_OFFERING_MISMATCH')
      }

      rebookOfBookingId =
        requestedRebookOfBookingId && requestedRebookOfBookingId === original.id
          ? requestedRebookOfBookingId
          : original.id
    }

    const result = await finalizeBookingFromHold({
      clientId,
      holdId,
      openingId,
      addOnIds,
      locationType,
      source,
      initialStatus,
      rebookOfBookingId,
      offering: toFinalizeOffering(offering),
      fallbackTimeZone: 'UTC',
    })

    try {
      await createFinalizeProNotification({
        professionalId: result.booking.professionalId,
        bookingId: result.booking.id,
        actorUserId: user.id,
        bookingStatus: result.booking.status,
        source,
        locationType,
      })
    } catch (notificationError: unknown) {
      console.error('POST /api/bookings/finalize pro notification error:', notificationError)
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