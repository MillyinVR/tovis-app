// app/api/v1/public/appointment/[token]/reschedule/route.ts
//
// K12: step 2 of reschedule-from-the-reminder-link — commit the held slot
// through the SAME rescheduleBookingFromHold boundary path the authed route
// uses (never a direct scheduledFor update). The token supplies the clientId;
// requestedLocationType stays null because the hold was created at the
// booking's own location (../reschedule-hold), matching the authed route's
// "no locationType in body" branch.
//
// The boundary clears the K11 confirmation state on a real time move, so the
// re-synced reminder re-asks for the new time — a confirmed Tuesday never
// silently reads as a confirmed Friday.

import { Role, type Prisma } from '@prisma/client'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

import { jsonFail, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  markAppointmentConfirmationTokenUsed,
  resolveAppointmentConfirmationTokenForMutation,
} from '@/lib/booking/appointmentConfirmationTokens'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { isBookingError } from '@/lib/booking/errors'
import { rescheduleBookingFromHold } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'
import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/public/appointment/[token]/reschedule'

type RescheduleResponseBody = Prisma.InputJsonObject

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    if (!clientConfirmationLoopEnabled()) {
      return bookingJsonFail('APPOINTMENT_TOKEN_INVALID', {
        message: 'Client confirmation loop is disabled.',
        userMessage: 'That appointment link is invalid or expired.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('APPOINTMENT_TOKEN_MISSING')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:appointment:token',
      key: tokenActorRateLimitKey({
        actorKey: rawToken,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await readJsonRecord(req)
    const holdId = pickString(body.holdId)

    if (!holdId) {
      return bookingJsonFail('HOLD_ID_REQUIRED')
    }

    const resolved = await resolveAppointmentConfirmationTokenForMutation({
      rawToken,
    })

    const bookingId = resolved.booking.id
    const clientId = resolved.booking.clientId

    const response = await withRouteIdempotency<RescheduleResponseBody>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.PUBLIC_APPOINTMENT_RESCHEDULE,
        requestLabel: 'booking reschedule',
        requestBody: {
          appointmentTokenId: resolved.token.id,
          bookingId,
          clientId,
          holdId,
        } satisfies Prisma.InputJsonObject,
        messages: {
          missingKey: 'Missing idempotency key for booking reschedule.',
          inProgress:
            'A matching booking reschedule request is already in progress.',
          conflict:
            'This idempotency key was already used with different reschedule details.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        const result = await rescheduleBookingFromHold({
          bookingId,
          clientId,
          holdId,
          requestedLocationType: null,
          fallbackTimeZone: DEFAULT_TIME_ZONE,
        })

        await markAppointmentConfirmationTokenUsed({
          tokenId: resolved.token.id,
        })

        return {
          status: 200,
          body: {
            ok: true,
            booking: {
              id: result.booking.id,
              status: result.booking.status,
              scheduledFor: result.booking.scheduledFor.toISOString(),
              locationType: result.booking.locationType,
              totalDurationMinutes: result.booking.totalDurationMinutes,
              locationTimeZone: result.booking.locationTimeZone,
            },
            meta: result.meta,
          },
        }
      },
    )

    // Booking rescheduled — deliver the new-time notification now.
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE_OPERATION} error`, safeError(error))

    return jsonFail(500, 'Failed to reschedule booking.')
  }
}
