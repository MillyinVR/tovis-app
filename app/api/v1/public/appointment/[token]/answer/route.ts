// app/api/v1/public/appointment/[token]/answer/route.ts
//
// K12: the one-tap confirmation answer behind the reminder link — CONFIRM or
// DECLINE — authenticated by the APPOINTMENT_CONFIRMATION ClientActionToken
// (anyone holding the message holds the token, the card's accepted premise).
//
// Both answers are idempotent by design: the boundary re-stamps the answered
// timestamp and K11's derivation takes the latest answer, so a double tap or a
// change of mind is a feature, not a replay hazard — no idempotency ledger
// needed here (unlike the cancel/reschedule routes, which move money/time).
// D5: DECLINE stamps + notifies the pro and NEVER touches the slot.

import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

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
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { isBookingError } from '@/lib/booking/errors'
import {
  recordAppointmentConfirmationFromClientToken,
  type AppointmentConfirmationAnswer,
} from '@/lib/booking/writeBoundary'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseAnswer(value: unknown): AppointmentConfirmationAnswer | null {
  return value === 'CONFIRM' || value === 'DECLINE' ? value : null
}

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
    const answer = parseAnswer(body.answer)

    if (!answer) {
      return jsonFail(400, 'answer must be CONFIRM or DECLINE.')
    }

    const result = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer,
    })

    // The DECLINE path enqueued the pro's notification inside the committed
    // transaction — deliver it now.
    if (answer === 'DECLINE') {
      kickNotificationDrain()
    }

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

    console.error(
      'POST /api/v1/public/appointment/[token]/answer error',
      safeError(error),
    )

    return jsonFail(500, 'Failed to record your answer.')
  }
}
