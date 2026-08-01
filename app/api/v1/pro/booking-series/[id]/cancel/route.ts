// app/api/v1/pro/booking-series/[id]/cancel/route.ts
//
// K19 (Phase 8) — stop a standing appointment at a chosen scope.
//
// Two of the plan's three scopes live here. *This one* is deliberately absent:
// it is `PATCH /api/v1/pro/bookings/{id}` and always was, and giving it a second
// series-shaped implementation would fork one behaviour into two.
//
// 🔴 Ungated by `recurringAppointmentsEnabled()` on purpose — see the write
// boundary's `cancelBookingSeriesOccurrences` header. Turning the feature off
// must not strand live appointments with no way to end them.
//
// The refund appliers run per cancelled occurrence, exactly as the per-booking
// cancel route runs them for one: a series does not get its own money
// semantics, it gets the same ones N times.
import { Role } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
} from '@/lib/booking/cancelRefund'
import { isBookingError } from '@/lib/booking/errors'
import { cancelBookingSeriesOccurrences } from '@/lib/booking/writeBoundary'
import type {
  ProBookingSeriesCancelResponseDTO,
  ProBookingSeriesCancelScope,
} from '@/lib/dto/proBookingSeries'
import { asTrimmedString } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import {
  broadcastLive,
  liveChannelForPro,
} from '@/lib/live/broadcast'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { pickInt, pickString } from '@/lib/pick'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = 'POST /api/v1/pro/booking-series/[id]/cancel'

const DEFAULT_REASON = 'Recurring appointment cancelled by professional'

function normalizeScope(value: unknown): ProBookingSeriesCancelScope | null {
  const raw = pickString(value)?.toUpperCase()
  if (raw === 'THIS_AND_FUTURE') return 'THIS_AND_FUTURE'
  if (raw === 'ALL') return 'ALL'
  return null
}

export async function POST(req: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const actorUserId = auth.userId

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to cancel this recurring appointment.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const seriesId = asTrimmedString(params.id)

    if (!seriesId) {
      return jsonFail(404, 'Not found.', { code: 'NOT_FOUND' })
    }

    const body = await readJsonRecord(req)

    const scope = normalizeScope(body.scope)
    if (!scope) {
      return bookingJsonFail('INVALID_SERIES_RECURRENCE', {
        message: 'scope must be THIS_AND_FUTURE or ALL.',
        userMessage: 'Choose which appointments to cancel.',
      })
    }

    // Only meaningful for THIS_AND_FUTURE; the boundary refuses a missing one
    // there rather than quietly widening the scope to ALL.
    const fromOccurrenceIndex =
      scope === 'THIS_AND_FUTURE' ? pickInt(body.fromOccurrenceIndex) : null

    const reason = pickString(body.reason) ?? DEFAULT_REASON

    const idempotency =
      await beginRouteIdempotency<ProBookingSeriesCancelResponseDTO>({
        request: req,
        actor: { actorUserId, actorRole: Role.PRO },
        route: IDEMPOTENCY_ROUTES.PRO_BOOKING_SERIES_CANCEL,
        requestLabel: 'pro recurring appointment cancellation',
        requestBody: {
          seriesId,
          professionalId: auth.professionalId,
          actorUserId,
          scope,
          fromOccurrenceIndex,
          reason,
        },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching cancel request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
      })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await cancelBookingSeriesOccurrences({
      professionalId: auth.professionalId,
      actorUserId,
      seriesId,
      scope,
      fromOccurrenceIndex,
      reason,
    })

    // Per-occurrence refund handling, identical to the single-booking cancel
    // route. Best-effort there, best-effort here — a refund that cannot be
    // applied must not un-cancel an appointment the client has been told about.
    for (const occurrence of result.cancelled) {
      await applyAutoCancelRefund({
        bookingId: occurrence.bookingId,
        actorKind: 'pro',
        actorUserId,
        cancelMutated: true,
        reason,
      })

      await applyDiscoveryDepositCancelRefund({
        bookingId: occurrence.bookingId,
        actorKind: 'pro',
        actorUserId,
        cancelMutated: true,
        reason,
      })
    }

    const responseBody = {
      seriesId: result.seriesId,
      scope: result.scope,
      seriesStatus: result.seriesStatus,
      cancelled: result.cancelled.map((occurrence) => ({
        index: occurrence.index,
        bookingId: occurrence.bookingId,
        scheduledFor: occurrence.scheduledFor.toISOString(),
        depositHeldCents: occurrence.depositHeldCents,
      })),
      // `untouched` rides the SUCCESS body for the same reason the create
      // route's `skipped` does — see lib/dto/proBookingSeries.
      untouched: result.untouched.map((occurrence) => ({
        index: occurrence.index,
        bookingId: occurrence.bookingId,
        scheduledFor: occurrence.scheduledFor.toISOString(),
        status: occurrence.status,
        reason: occurrence.reason,
      })),
    } satisfies ProBookingSeriesCancelResponseDTO

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    kickNotificationDrain()
    await broadcastLive([liveChannelForPro(auth.professionalId)], 'bookings')

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: ROUTE,
    }).catch((failError: unknown) => {
      console.error(`${ROUTE} idempotency failure update error`, {
        error: safeError(failError),
        meta: safeLogMeta({ route: ROUTE, idempotencyRecordId }),
      })
    })

    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE} error`, {
      error: safeError(error),
      meta: safeLogMeta({ route: ROUTE, idempotencyRecordId }),
    })

    return jsonFail(500, 'Internal server error')
  }
}
