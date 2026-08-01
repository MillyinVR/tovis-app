// app/api/v1/pro/booking-series/route.ts
//
// K18 (Phase 8) — create a recurring appointment.
//
// 🔴 DARK BY DEFAULT. ENABLE_RECURRING_APPOINTMENTS is unset in prod, so this
// route 404s and the write boundary refuses independently
// ([[refuse-the-claim-not-just-the-control]]). K19 builds the pro-facing
// control; when it does, it must gate on `recurringAppointmentsEnabled()` too —
// a button that opens a form this route will refuse is an offered option that
// cannot be accepted.
//
// A 404 rather than a 403 while dark: the feature does not exist yet, and a 403
// would advertise it.
import { Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isBookingError } from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { createBookingSeries } from '@/lib/booking/writeBoundary'
import {
  broadcastLive,
  liveChannelForPro,
} from '@/lib/live/broadcast'
import type { ProBookingSeriesCreateResponseDTO } from '@/lib/dto/proBookingSeries'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { hasDuplicateStrings, pickBool, pickInt, pickStringArray } from '@/lib/pick'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = 'POST /api/v1/pro/booking-series'

function toDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function POST(req: Request) {
  let idempotencyRecordId: string | null = null

  try {
    if (!recurringAppointmentsEnabled()) {
      return jsonFail(404, 'Not found.', { code: 'NOT_FOUND' })
    }

    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to create this appointment.',
      })
    }

    const idempotencyKey = pickString(req.headers.get('idempotency-key'))
    const requestId = pickString(req.headers.get('x-request-id'))

    const body = await readJsonRecord(req)

    const clientId = pickString(body.clientId)
    const offeringId = pickString(body.offeringId)
    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const clientAddressId = pickString(body.clientAddressId)
    const addOnIds = pickStringArray(body.addOnIds)

    const firstOccurrenceAt = toDateOrNull(body.firstOccurrenceAt)
    const intervalWeeks = pickInt(body.intervalWeeks)
    // An ABSENT key means open-ended: the series has no planned end and K20's
    // cron advances it. A key that is PRESENT but unreadable is a different
    // thing and must not quietly become "forever" — `pickInt` answers null for
    // both, so the key's presence is what distinguishes them.
    const occurrenceCountRequested =
      body.occurrenceCount !== undefined && body.occurrenceCount !== null
    const occurrenceCount = occurrenceCountRequested
      ? pickInt(body.occurrenceCount)
      : null

    if (occurrenceCountRequested && occurrenceCount == null) {
      return bookingJsonFail('INVALID_SERIES_RECURRENCE', {
        message: 'occurrenceCount must be a whole number when supplied.',
      })
    }

    const internalNotes = pickString(body.internalNotes)
    const overrideReason = pickString(body.overrideReason)
    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const allowOutsideWorkingHours =
      pickBool(body.allowOutsideWorkingHours) ?? false
    const allowShortNotice = pickBool(body.allowShortNotice) ?? false
    const allowFarFuture = pickBool(body.allowFarFuture) ?? false

    // D7: two independent facts. `depositPerOccurrence` is meaningless without
    // `depositRequested`, and the boundary reads them that way.
    const depositRequested = pickBool(body.depositRequested) ?? false
    const depositPerOccurrence = pickBool(body.depositPerOccurrence) ?? false

    if (!clientId) return bookingJsonFail('CLIENT_ID_REQUIRED')
    if (!offeringId) return bookingJsonFail('OFFERING_ID_REQUIRED')
    if (!locationId) return bookingJsonFail('LOCATION_ID_REQUIRED')
    if (!locationType) return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    if (!firstOccurrenceAt) return bookingJsonFail('INVALID_SCHEDULED_FOR')
    if (intervalWeeks == null) {
      return bookingJsonFail('INVALID_SERIES_RECURRENCE', {
        message: 'intervalWeeks is required.',
      })
    }
    if (hasDuplicateStrings(addOnIds)) return bookingJsonFail('ADDONS_INVALID')

    const idempotency = await beginIdempotency<ProBookingSeriesCreateResponseDTO>(
      {
        actor: { actorUserId, actorRole: Role.PRO },
        route: IDEMPOTENCY_ROUTES.PRO_BOOKING_SERIES_CREATE,
        key: idempotencyKey,
        requestBody: {
          professionalId,
          actorUserId,
          clientId,
          offeringId,
          addOnIds,
          locationId,
          locationType,
          clientAddressId,
          firstOccurrenceAt: firstOccurrenceAt.toISOString(),
          intervalWeeks,
          occurrenceCount,
          depositRequested,
          depositPerOccurrence,
          internalNotes,
          overrideReason,
          requestedBufferMinutes,
          requestedTotalDurationMinutes,
          allowOutsideWorkingHours,
          allowShortNotice,
          allowFarFuture,
        },
      },
    )

    if (idempotency.kind === 'missing_key') {
      return jsonFail(400, 'Idempotency-Key header is required.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      })
    }
    if (idempotency.kind === 'in_progress') {
      return jsonFail(409, 'This request is already being processed.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
      })
    }
    if (idempotency.kind === 'conflict') {
      return jsonFail(409, 'This idempotency key was used with a different request.', {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      })
    }
    if (idempotency.kind === 'replay') {
      return jsonOk(idempotency.responseBody, idempotency.responseStatus)
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await createBookingSeries({
      professionalId,
      actorUserId,
      clientId,
      offeringId,
      addOnIds,
      locationId,
      locationType,
      clientAddressId,
      firstOccurrenceAt,
      intervalWeeks,
      occurrenceCount,
      depositRequested,
      depositPerOccurrence,
      internalNotes,
      overrideReason,
      requestedBufferMinutes,
      requestedTotalDurationMinutes,
      allowOutsideWorkingHours,
      allowShortNotice,
      allowFarFuture,
      requestId,
      idempotencyKey,
    })

    const responseBody = {
      seriesId: result.seriesId,
      timeZone: result.timeZone,
      nextOccurrenceIndex: result.nextOccurrenceIndex,
      occurrences: result.occurrences.map((occurrence) => ({
        index: occurrence.index,
        bookingId: occurrence.bookingId,
        scheduledFor: occurrence.scheduledFor.toISOString(),
      })),
      // Skips ride the SUCCESS body on purpose — see lib/dto/proBookingSeries.
      skipped: result.skipped.map((skip) => ({
        index: skip.index,
        intendedStart: skip.intendedStart?.toISOString() ?? null,
        reason: skip.reason,
        detail: skip.detail,
      })),
    } satisfies ProBookingSeriesCreateResponseDTO

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    kickNotificationDrain()
    await broadcastLive([liveChannelForPro(professionalId)], 'bookings')

    return jsonOk(responseBody, 201)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId }).catch(
        (failError: unknown) => {
          console.error(`${ROUTE} idempotency failure update error`, {
            error: safeError(failError),
            meta: safeLogMeta({ route: ROUTE, idempotencyRecordId }),
          })
        },
      )
    }

    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE} error`, {
      error: safeError(error),
      meta: safeLogMeta({ route: ROUTE, idempotencyRecordId }),
    })

    captureBookingException({ error, route: ROUTE })
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error
          ? error.message
          : 'Failed to create the recurring appointment.',
      userMessage: 'Failed to create the recurring appointment.',
    })
  }
}
