// app/api/v1/public/appointment/[token]/reschedule-hold/route.ts
//
// K12: step 1 of reschedule-from-the-reminder-link — place a reschedule HOLD
// on the picked slot, exactly as the authed flow does (POST /api/v1/holds with
// rescheduleBookingId), with the token supplying the clientId. The commit is
// step 2 (../reschedule), which runs the same rescheduleBookingFromHold path
// as the authed route — never a direct scheduledFor update.
//
// Deliberately narrower than the authed holds route: the slot keeps the
// booking's own location (type, location id, mobile address). Changing WHERE
// an appointment happens involves address entry and travel policy the token
// page does not carry — a client who needs that uses the in-app flow (or
// calls). Same time-only rule the calendar drag enforces on the pro side.

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { resolveAppointmentConfirmationTokenForMutation } from '@/lib/booking/appointmentConfirmationTokens'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { normalizeToMinute } from '@/lib/booking/conflicts'
import { isBookingError } from '@/lib/booking/errors'
import {
  HOLD_CREATE_OFFERING_SELECT,
  toCreateHoldOffering,
} from '@/lib/booking/holdCreateOffering'
import { resolveRescheduleCommitDurationMinutes } from '@/lib/booking/rescheduleWidth'
import { createHold } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'
import { bookingEntryPointFromHoldContext } from '@/lib/pro/readiness/bookingEntryPoint'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION =
  'POST /api/v1/public/appointment/[token]/reschedule-hold'

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
    const scheduledForRaw = pickString(body.scheduledFor)

    if (!scheduledForRaw) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR', {
        message: 'Scheduled time is required.',
        userMessage: 'Missing scheduled time.',
      })
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (Number.isNaN(scheduledForParsed.getTime())) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < Date.now() + 60_000) {
      return bookingJsonFail('TIME_IN_PAST')
    }

    const resolved = await resolveAppointmentConfirmationTokenForMutation({
      rawToken,
    })
    const booking = resolved.booking

    // The same guard + offering the COMMIT will use (B3: promise-site runs the
    // commit-site gate) — also refuses started/finished/terminal bookings.
    const { offeringId } = resolveRescheduleCommitDurationMinutes(booking)

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: HOLD_CREATE_OFFERING_SELECT,
    })

    if (!offering || !offering.isActive) {
      return bookingJsonFail('OFFERING_NOT_FOUND')
    }

    const result = await createHold({
      clientId: booking.clientId,
      // Server-validated: the token proves this client's direct relationship
      // to this pro's existing booking.
      bookingEntryPoint: bookingEntryPointFromHoldContext({
        requestedEntryPoint: null,
        hasDirectProfileContext: true,
      }),
      addOnIds: [],
      rescheduleBookingId: booking.id,
      offering: toCreateHoldOffering(offering),
      requestedStart,
      requestedLocationId: booking.locationId,
      locationType: booking.locationType,
      clientAddressId: booking.clientAddressId,
    })

    return jsonOk(
      {
        hold: {
          id: result.hold.id,
          expiresAt: result.hold.expiresAt.toISOString(),
          scheduledFor: result.hold.scheduledFor.toISOString(),
          locationType: result.hold.locationType,
          durationMinutes: result.hold.durationMinutes,
        },
        meta: result.meta,
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE_OPERATION} error`, safeError(error))

    return jsonFail(500, 'Failed to reserve that time.')
  }
}
