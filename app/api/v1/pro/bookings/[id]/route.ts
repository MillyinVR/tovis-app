// app/api/v1/pro/bookings/[id]/route.ts

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
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  BookingServiceItemType,
  BookingStatus,
  Role,
} from '@prisma/client'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import { resolveAppointmentSchedulingContext } from '@/lib/booking/timeZoneTruth'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
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
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { updateProBooking } from '@/lib/booking/writeBoundary'
import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
  summarizeCancelRefund,
  type CancelRefundSummary,
} from '@/lib/booking/cancelRefund'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { clientCanBeMessaged } from '@/lib/messages/clientThreadEligibility'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const PATCH_ROUTE_OPERATION = 'PATCH /api/v1/pro/bookings/[id]'

type RequestedStatus =
  | typeof BookingStatus.ACCEPTED
  | typeof BookingStatus.CANCELLED

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

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await resolveRouteParams(ctx)
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
        // MOBILE bookings: the client's saved service address, so the native
        // aftercare rebook slot picker can query mobile availability.
        clientAddressId: true,
        // Session lifecycle timestamps + step (drive the native Timing timeline).
        sessionStep: true,
        startedAt: true,
        finishedAt: true,
        // Payment breakdown (native Payment card). All Decimal? except the Stripe
        // amount, which is minor units (Int).
        totalAmount: true,
        serviceSubtotalSnapshot: true,
        taxAmount: true,
        tipAmount: true,
        discountAmount: true,
        paymentCollectedAt: true,
        selectedPaymentMethod: true,
        // Checkout lifecycle: AWAITING_CONFIRMATION drives the pro booking-detail
        // "Confirm payment received" action (native parity with the session
        // wrap-up control). rebookOfBookingId links a coupled aftercare rebook
        // back to the appointment whose payment gates its approval.
        checkoutStatus: true,
        rebookOfBookingId: true,
        stripePaymentStatus: true,
        stripeAmountTotal: true,
        // Stripe's authoritative cumulative refund total — lets the native
        // Payment card show "Refunded"/"Partially refunded" instead of a green
        // "Paid" once money has gone back (M11 display-truth).
        stripeAmountRefunded: true,
        stripeCurrency: true,
        // Aftercare snapshot card.
        aftercareSummary: {
          select: {
            notes: true,
            sentToClientAt: true,
            draftSavedAt: true,
            version: true,
          },
        },
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
            // Presence-only: feeds `client.canMessage`. The id itself never
            // leaves the server — an unclaimed profile has none, which is
            // exactly what makes a thread impossible.
            userId: true,
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
          // Phase 2 revenue protection master switch, echoed onto the payload the
          // booking-detail action row consumes. Web resolves this server-side in
          // the RSC page and passes it to BookingActions as a prop
          // (`app/pro/bookings/[id]/page.tsx` → `noShowFeatureEnabled`), so no DTO
          // ever carried it — a native client had no way to know whether to draw
          // "Mark no-show". There is no safe probe either: the only endpoint is a
          // POST that marks the booking and may charge a card. Same helper as web,
          // never a re-derivation, so the two can't drift.
          noShowFeatureEnabled: noShowProtectionEnabled(),
          scheduledFor: start.toISOString(),
          endsAt: addMinutes(
            start,
            totalDurationMinutes + bufferMinutes,
          ).toISOString(),
          locationId: booking.locationId ?? null,
          locationType: booking.locationType,
          clientAddressId: booking.clientAddressId ?? null,
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
          // Session lifecycle (Timing timeline).
          sessionStep: booking.sessionStep,
          startedAt: booking.startedAt ? booking.startedAt.toISOString() : null,
          finishedAt: booking.finishedAt
            ? booking.finishedAt.toISOString()
            : null,
          // Payment breakdown (Payment card). Decimal? → "0.00"|null; Stripe total
          // is minor units (Int).
          totalAmount:
            booking.totalAmount != null
              ? moneyToFixed2String(booking.totalAmount)
              : null,
          serviceSubtotalSnapshot:
            booking.serviceSubtotalSnapshot != null
              ? moneyToFixed2String(booking.serviceSubtotalSnapshot)
              : null,
          taxAmount:
            booking.taxAmount != null
              ? moneyToFixed2String(booking.taxAmount)
              : null,
          tipAmount:
            booking.tipAmount != null
              ? moneyToFixed2String(booking.tipAmount)
              : null,
          discountAmount:
            booking.discountAmount != null
              ? moneyToFixed2String(booking.discountAmount)
              : null,
          paymentCollectedAt: booking.paymentCollectedAt
            ? booking.paymentCollectedAt.toISOString()
            : null,
          selectedPaymentMethod: booking.selectedPaymentMethod ?? null,
          // Checkout lifecycle + rebook coupling (native booking-detail parity).
          checkoutStatus: booking.checkoutStatus,
          rebookOfBookingId: booking.rebookOfBookingId ?? null,
          stripePaymentStatus: booking.stripePaymentStatus ?? null,
          stripeAmountTotal: booking.stripeAmountTotal ?? null,
          stripeAmountRefunded: booking.stripeAmountRefunded ?? 0,
          stripeCurrency: booking.stripeCurrency ?? null,
          // Aftercare snapshot (null until an aftercare summary exists).
          aftercareSummary: booking.aftercareSummary
            ? {
                notes: booking.aftercareSummary.notes ?? null,
                sentToClientAt: booking.aftercareSummary.sentToClientAt
                  ? booking.aftercareSummary.sentToClientAt.toISOString()
                  : null,
                draftSavedAt: booking.aftercareSummary.draftSavedAt
                  ? booking.aftercareSummary.draftSavedAt.toISOString()
                  : null,
                version: booking.aftercareSummary.version,
              }
            : null,
          client: {
            // The ClientProfile id — lets native callers reach client-scoped
            // reads (e.g. GET /pro/clients/{id}/service-addresses for the
            // aftercare rebook address picker).
            id: booking.clientId,
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
            // Whether a message thread can be opened with this client. A
            // pro-created / imported profile stays unclaimed until the client
            // signs up, and `POST /messages/resolve` answers 409
            // CLIENT_UNCLAIMED for it — so without this the native "Message
            // client" button was offered and then failed silently. Same
            // predicate the resolve route refuses on, never a re-derivation.
            canMessage: clientCanBeMessaged(booking.client),
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
      return bookingErrorJsonFail(error)
    }

    console.error('GET /api/v1/pro/bookings/[id] error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'GET /api/v1/pro/bookings/[id]',
      }),
    })
    captureBookingException({ error, route: 'GET /api/v1/pro/bookings/[id]' })
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

export async function PATCH(req: Request, ctx: RouteContext) {
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

    const params = await resolveRouteParams(ctx)
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
        return bookingErrorJsonFail(error)
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

    // A pro cancel via this general-update route (the path EVERY web pro
    // cancel/deny takes — the dedicated /cancel route has no web caller) skipped
    // both cancel-refund helpers, so a PAID-deposit booking's deposit+fee refund
    // that pro-cancel policy promises never ran. Run them post-commit here,
    // mirroring the dedicated /cancel routes (the write boundary stays DB-only, so
    // Stripe I/O can't live inside updateProBooking's transaction). Best-effort:
    // neither helper throws, so a refund failure can't fail the committed cancel.
    let refund: CancelRefundSummary | null = null
    if (
      nextStatus === BookingStatus.CANCELLED &&
      result.meta.mutated &&
      result.booking.status === BookingStatus.CANCELLED
    ) {
      const serviceRefund = await applyAutoCancelRefund({
        bookingId,
        actorKind: 'pro',
        actorUserId,
        cancelMutated: true,
      })
      const depositRefund = await applyDiscoveryDepositCancelRefund({
        bookingId,
        actorKind: 'pro',
        actorUserId,
        cancelMutated: true,
      })
      refund = summarizeCancelRefund({
        service: serviceRefund,
        deposit: depositRefund,
      })
    }

    const responseBody = normalizeJsonObjectPayload(
      refund ? { ...result, refund } : result,
    )

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    // Deliver now if the client was notified of the change, or if a cancel refund
    // ran (a successful deposit refund emits a client + pro receipt).
    if (notifyClient === true || refund !== null) {
      kickNotificationDrain()
    }

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failProBookingUpdateIdempotency(idempotencyRecordId).catch(
      (failError: unknown) => {
        console.error('PATCH /api/v1/pro/bookings/[id] idempotency failure update error', {
          error: safeError(failError),
          meta: safeLogMeta({
            route: PATCH_ROUTE_OPERATION,
            idempotencyRecordId,
          }),
        })
      },
    )

    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error('PATCH /api/v1/pro/bookings/[id] error', {
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