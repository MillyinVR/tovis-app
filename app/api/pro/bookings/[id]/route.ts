// app/api/pro/bookings/[id]/route.ts

import { prisma } from '@/lib/prisma'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import {
  jsonOk,
  pickBool,
  pickInt,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  Role,
} from '@prisma/client'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import { resolveAppointmentSchedulingContext } from '@/lib/booking/timeZoneTruth'
import { moneyToFixed2String } from '@/lib/money'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isRecord } from '@/lib/guards'
import { DEFAULT_DURATION_MINUTES } from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import {
  type RequestedServiceItemInput,
  sumDecimal,
} from '@/lib/booking/serviceItems'
import {
  decimalToNullableNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import {
  bookingError,
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { updateProBooking } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const PATCH_ROUTE_OPERATION = 'PATCH /api/pro/bookings/[id]'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestedStatus =
  | typeof BookingStatus.ACCEPTED
  | typeof BookingStatus.CANCELLED

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

function normalizeRequestedStatus(value: unknown): RequestedStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === BookingStatus.ACCEPTED) return BookingStatus.ACCEPTED
  if (normalized === BookingStatus.CANCELLED) return BookingStatus.CANCELLED

  return null
}

function readRequestId(request: Request): string | null {
  return (
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null
  )
}

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (isRecord(value)) {
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeNestedJsonValue(value[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (!isRecord(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const out: JsonObjectPayload = {}

  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeNestedJsonValue(value[key])
  }

  return out
}

function parseRequestedServiceItems(
  raw: unknown,
): RequestedServiceItemInput[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) throw bookingError('INVALID_SERVICE_ITEMS')
  if (raw.length === 0) throw bookingError('INVALID_SERVICE_ITEMS')

  const parsed = raw.map((entry, index) => {
    if (!isRecord(entry)) throw bookingError('INVALID_SERVICE_ITEMS')

    const serviceId = pickString(entry.serviceId)
    const offeringId = pickString(entry.offeringId)
    const sortOrder = pickInt(entry.sortOrder)

    if (!serviceId || !offeringId) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    return {
      serviceId,
      offeringId,
      sortOrder: sortOrder != null ? sortOrder : index,
    }
  })

  return [...parsed].sort((a, b) => a.sortOrder - b.sortOrder)
}

function normalizeOutputTimeZone(value: string): string {
  return isValidIanaTimeZone(value) ? sanitizeTimeZone(value, 'UTC') : 'UTC'
}

async function resolveBookingSchedulingContext(args: {
  bookingLocationTimeZone?: unknown
  locationId?: string | null
  professionalId: string
  professionalTimeZone?: unknown
  fallback?: string
  requireValid?: boolean
}) {
  const result = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    locationId: args.locationId ?? null,
    professionalId: args.professionalId,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback ?? 'UTC',
    requireValid: args.requireValid,
  })

  if (!result.ok) {
    throw bookingError('TIMEZONE_REQUIRED')
  }

  return {
    ...result.context,
    appointmentTimeZone: normalizeOutputTimeZone(
      result.context.appointmentTimeZone,
    ),
  }
}

function buildProBookingUpdateIdempotencyBody(args: {
  professionalId: string
  actorUserId: string
  bookingId: string
  nextStatus: RequestedStatus | null
  notifyClient: boolean
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  nextStart: Date | null
  nextBuffer: number | null
  nextDuration: number | null
  parsedRequestedItems: RequestedServiceItemInput[] | null
  hasBuffer: boolean
  hasDuration: boolean
  hasServiceItems: boolean
  overrideReason: string | null
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    nextStatus: args.nextStatus,
    notifyClient: args.notifyClient,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    nextStart: args.nextStart ? args.nextStart.toISOString() : null,
    nextBuffer: args.nextBuffer,
    nextDuration: args.nextDuration,
    parsedRequestedItems: args.parsedRequestedItems,
    hasBuffer: args.hasBuffer,
    hasDuration: args.hasDuration,
    hasServiceItems: args.hasServiceItems,
    overrideReason: args.overrideReason,
  })
}

async function failProBookingUpdateIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: PATCH_ROUTE_OPERATION,
  })
}

/* ---------------------------------------------
   GET
--------------------------------------------- */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, professionalId },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,
        clientId: true,
        locationId: true,
        locationTimeZone: true,
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
        serviceItems: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            sortOrder: true,
            itemType: true,
            service: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
        professional: {
          select: { timeZone: true },
        },
      },
    })

    if (!booking) {
      return bookingJsonFail('BOOKING_NOT_FOUND')
    }

    const start = normalizeToMinute(new Date(booking.scheduledFor))
    if (!Number.isFinite(start.getTime())) {
      return bookingJsonFail('INTERNAL_ERROR', {
        message: 'Booking has an invalid scheduled time.',
        userMessage: 'Failed to load booking.',
      })
    }

    const items = booking.serviceItems ?? []
    const computedDuration = items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    )
    const computedSubtotal = sumDecimal(items.map((item) => item.priceSnapshot))

    const totalDurationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : DEFAULT_DURATION_MINUTES

    const bufferMinutes = Math.max(0, Number(booking.bufferMinutes ?? 0))

    const firstName = booking.client?.firstName?.trim() || ''
    const lastName = booking.client?.lastName?.trim() || ''
    const fullName =
      firstName || lastName
        ? `${firstName} ${lastName}`.trim()
        : booking.client?.user?.email || 'Client'

    const schedulingContext = await resolveBookingSchedulingContext({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
      requireValid: false,
    })

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: addMinutes(
            start,
            totalDurationMinutes + bufferMinutes,
          ).toISOString(),
          locationId: booking.locationId ?? null,
          locationType: booking.locationType,
          locationAddressSnapshot: pickFormattedAddressFromSnapshot(
            booking.locationAddressSnapshot,
          ),
          locationLatSnapshot: decimalToNullableNumber(
            booking.locationLatSnapshot,
          ),
          locationLngSnapshot: decimalToNullableNumber(
            booking.locationLngSnapshot,
          ),
          bufferMinutes,
          durationMinutes: totalDurationMinutes,
          totalDurationMinutes,
          subtotalSnapshot: moneyToFixed2String(
            booking.subtotalSnapshot ?? computedSubtotal,
          ),
          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone: schedulingContext.appointmentTimeZone,
          timeZoneSource: schedulingContext.timeZoneSource,
          serviceItems: items.map((item) => ({
            id: item.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId ?? null,
            itemType: item.itemType ?? BookingServiceItemType.ADD_ON,
            serviceName: item.service?.name ?? 'Service',
            priceSnapshot: moneyToFixed2String(item.priceSnapshot),
            durationMinutesSnapshot: Number(item.durationMinutesSnapshot ?? 0),
            sortOrder: item.sortOrder,
          })),
        },
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('GET /api/pro/bookings/[id] error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'GET /api/pro/bookings/[id]',
      }),
    })
    captureBookingException({ error, route: 'GET /api/pro/bookings/[id]' })
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to load booking.',
      userMessage: 'Failed to load booking.',
    })
  }
}

/* ---------------------------------------------
   PATCH
--------------------------------------------- */

export async function PATCH(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = pickString(auth.user.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this booking.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rec = await readJsonRecord(req)

    const hasStatus = Object.prototype.hasOwnProperty.call(rec, 'status')
    const hasNotifyClient = Object.prototype.hasOwnProperty.call(
      rec,
      'notifyClient',
    )
    const hasAllowOutside = Object.prototype.hasOwnProperty.call(
      rec,
      'allowOutsideWorkingHours',
    )
    const hasAllowShortNotice = Object.prototype.hasOwnProperty.call(
      rec,
      'allowShortNotice',
    )
    const hasAllowFarFuture = Object.prototype.hasOwnProperty.call(
      rec,
      'allowFarFuture',
    )
    const hasScheduledFor = Object.prototype.hasOwnProperty.call(
      rec,
      'scheduledFor',
    )
    const hasBuffer = Object.prototype.hasOwnProperty.call(rec, 'bufferMinutes')
    const hasDuration =
      Object.prototype.hasOwnProperty.call(rec, 'durationMinutes') ||
      Object.prototype.hasOwnProperty.call(rec, 'totalDurationMinutes')
    const hasServiceItems = Object.prototype.hasOwnProperty.call(
      rec,
      'serviceItems',
    )
    const hasOverrideReason = Object.prototype.hasOwnProperty.call(
      rec,
      'overrideReason',
    )

    const nextStatus = normalizeRequestedStatus(rec.status)
    if (hasStatus && nextStatus == null) {
      return bookingJsonFail('INVALID_STATUS', {
        userMessage: 'Invalid status. Use ACCEPTED or CANCELLED.',
      })
    }

    const notifyClient = pickBool(rec.notifyClient)
    if (hasNotifyClient && notifyClient == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'notifyClient must be boolean.',
        userMessage: 'notifyClient must be boolean.',
      })
    }

    const allowOutsideWorkingHours = pickBool(rec.allowOutsideWorkingHours)
    if (hasAllowOutside && allowOutsideWorkingHours == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowOutsideWorkingHours must be boolean.',
        userMessage: 'allowOutsideWorkingHours must be boolean.',
      })
    }

    const allowShortNotice = pickBool(rec.allowShortNotice)
    if (hasAllowShortNotice && allowShortNotice == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowShortNotice must be boolean.',
        userMessage: 'allowShortNotice must be boolean.',
      })
    }

    const allowFarFuture = pickBool(rec.allowFarFuture)
    if (hasAllowFarFuture && allowFarFuture == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowFarFuture must be boolean.',
        userMessage: 'allowFarFuture must be boolean.',
      })
    }

    const nextStart = pickIsoDate(rec.scheduledFor)
    if (hasScheduledFor && !nextStart) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    const nextBuffer =
      rec.bufferMinutes != null ? pickInt(rec.bufferMinutes) : null
    if (hasBuffer && nextBuffer == null) {
      return bookingJsonFail('INVALID_BUFFER_MINUTES')
    }

    const rawDurationValue = rec.durationMinutes ?? rec.totalDurationMinutes
    const nextDuration =
      rawDurationValue != null ? pickInt(rawDurationValue) : null
    if (hasDuration && nextDuration == null) {
      return bookingJsonFail('INVALID_DURATION_MINUTES')
    }

    const overrideReason = hasOverrideReason
      ? pickString(rec.overrideReason)
      : null
    if (
      hasOverrideReason &&
      rec.overrideReason != null &&
      overrideReason == null
    ) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'overrideReason must be a string when provided.',
        userMessage: 'Override reason must be text.',
      })
    }

    let parsedRequestedItems: RequestedServiceItemInput[] | null
    try {
      parsedRequestedItems = parseRequestedServiceItems(rec.serviceItems)
    } catch (error: unknown) {
      if (isBookingError(error)) {
        return bookingJsonFail(error.code, {
          message: error.message,
          userMessage: error.userMessage,
        })
      }

      throw error
    }

    const requestId = readRequestId(req)

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_UPDATE,
      requestLabel: 'pro booking update',
      requestBody: buildProBookingUpdateIdempotencyBody({
        professionalId,
        actorUserId,
        bookingId,
        nextStatus,
        notifyClient: notifyClient === true,
        allowOutsideWorkingHours: allowOutsideWorkingHours === true,
        allowShortNotice: allowShortNotice === true,
        allowFarFuture: allowFarFuture === true,
        nextStart,
        nextBuffer,
        nextDuration,
        parsedRequestedItems,
        hasBuffer,
        hasDuration,
        hasServiceItems,
        overrideReason,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching booking update is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await updateProBooking({
      professionalId,
      actorUserId,
      overrideReason,
      bookingId,
      nextStatus,
      notifyClient: notifyClient === true,
      allowOutsideWorkingHours: allowOutsideWorkingHours === true,
      allowShortNotice: allowShortNotice === true,
      allowFarFuture: allowFarFuture === true,
      nextStart,
      nextBuffer,
      nextDuration,
      parsedRequestedItems,
      hasBuffer,
      hasDuration,
      hasServiceItems,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
    })

    const responseBody = normalizeJsonObjectPayload(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failProBookingUpdateIdempotency(idempotencyRecordId).catch(
      (failError: unknown) => {
        console.error('PATCH /api/pro/bookings/[id] idempotency failure update error', {
          error: safeError(failError),
          meta: safeLogMeta({
            route: PATCH_ROUTE_OPERATION,
            idempotencyRecordId,
          }),
        })
      },
    )

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('PATCH /api/pro/bookings/[id] error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: PATCH_ROUTE_OPERATION,
        idempotencyRecordId,
      }),
    })
    captureBookingException({ error, route: PATCH_ROUTE_OPERATION })
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to update booking.',
      userMessage: 'Failed to update booking.',
    })
  }
}