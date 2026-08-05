// app/api/v1/client/bookings/[id]/confirmation/route.ts
//
// K13: the in-app half of K12's confirmation loop — a signed-in client answers
// "will you be there?" from their own booking detail instead of hunting for the
// reminder SMS. Same answer, same core, same stamps: the write boundary's
// `recordAppointmentConfirmationFromAuthedClient` shares
// `performLockedRecordAppointmentConfirmationAnswer` with the token route, so
// an in-app decline still notifies the pro (D5) and still never touches the
// slot.
//
// No idempotency ledger, deliberately — the same reasoning as the token answer
// route: re-stamping IS the designed behaviour (K11's latest-answer-wins), so a
// double tap or a change of mind is a feature, not a replay hazard. Cancel and
// reschedule keep theirs, because they move money and time.
//
// Behind ENABLE_CLIENT_CONFIRMATION_LOOP like every other writer in the loop:
// with the flag off nothing ever stamps `clientConfirmationRequestedAt`, so
// there is no ask for a client to answer and this route refuses.

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { isBookingError } from '@/lib/booking/errors'
import {
  recordAppointmentConfirmationFromAuthedClient,
  type AppointmentConfirmationAnswer,
} from '@/lib/booking/writeBoundary'
import { broadcastBookingChange } from '@/lib/live/broadcastBooking'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseAnswer(value: unknown): AppointmentConfirmationAnswer | null {
  return value === 'CONFIRM' || value === 'DECLINE' ? value : null
}

export async function POST(req: Request, ctx: RouteContext<{ id: string }>) {
  try {
    if (!clientConfirmationLoopEnabled()) {
      return bookingJsonFail('APPOINTMENT_CONFIRMATION_UNAVAILABLE', {
        message: 'Client confirmation loop is disabled.',
      })
    }

    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId, user } = auth

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:appointment:answer',
      key: clientRateLimitKey({ clientId, userId: user.id, request: req }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await readJsonRecord(req)
    const answer = parseAnswer(body.answer)

    if (!answer) {
      return jsonFail(400, 'answer must be CONFIRM or DECLINE.')
    }

    // Ownership is NOT re-checked here: the boundary locks the booking through
    // `withLockedClientOwnedBookingTransaction`, which answers the same uniform
    // BOOKING_NOT_FOUND for a booking that belongs to someone else — the one
    // refusal that runs inside the same transaction as the write.
    const result = await recordAppointmentConfirmationFromAuthedClient({
      bookingId,
      clientId,
      answer,
    })

    // The DECLINE path enqueued the pro's notification inside the committed
    // transaction — deliver it now.
    if (answer === 'DECLINE') {
      kickNotificationDrain()
    }

    // Live-sync: same ping as the token twin in
    // app/api/v1/public/appointment/[token]/answer — the pro sees the answer
    // wherever the client happened to give it.
    await broadcastBookingChange(result.booking.id, 'bookings')

    return jsonOk({
      state: result.state,
      booking: {
        id: result.booking.id,
        status: result.booking.status,
        scheduledFor: result.booking.scheduledFor.toISOString(),
      },
      meta: result.meta,
    })
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error('POST /api/v1/client/bookings/[id]/confirmation error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/v1/client/bookings/[id]/confirmation',
    })

    return jsonFail(500, 'Failed to record your answer.')
  }
}
