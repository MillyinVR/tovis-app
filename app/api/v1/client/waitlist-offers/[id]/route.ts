// app/api/v1/client/waitlist-offers/[id]/route.ts

import { Role } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
  upper,
} from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  confirmClientWaitlistOffer,
  declineClientWaitlistOffer,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { broadcastBookingChange } from '@/lib/live/broadcastBooking'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ConfirmResponseBody = {
  ok: true
  booking: {
    id: string
    status: string
    scheduledFor: string
  }
}

function readRequestId(req: Request): string | null {
  return (
    pickString(req.headers.get('x-request-id')) ??
    pickString(req.headers.get('request-id')) ??
    null
  )
}

/**
 * Client Confirm/Decline of a pro-proposed waitlist time. CONFIRM materializes an
 * ACCEPTED booking at the offered slot (idempotent); DECLINE returns the entry to
 * the pro's active waitlist so they can re-offer.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const offerId = pickString(rawId)
    if (!offerId) return jsonFail(400, 'Missing offer id.')

    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const action = upper(body?.action)

    if (action !== 'CONFIRM' && action !== 'DECLINE') {
      return jsonFail(400, 'Invalid action.')
    }

    if (action === 'DECLINE') {
      await declineClientWaitlistOffer({ offerId, clientId })
      kickNotificationDrain()
      return jsonOk({ ok: true })
    }

    const requestId = readRequestId(req)
    let createdBookingId: string | null = null

    const response = await withRouteIdempotency<ConfirmResponseBody>(
      {
        request: req,
        actor: {
          actorKey: clientId,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.CLIENT_WAITLIST_OFFER,
        requestLabel: 'waitlist offer confirm',
        requestBody: { action: 'CONFIRM', offerId, clientId },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching confirm request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: 'POST /api/v1/client/waitlist-offers/[id]',
      },
      async (idem) => {
        const result = await confirmClientWaitlistOffer({
          offerId,
          clientId,
          requestId,
          idempotencyKey: idem.idempotencyKey,
        })

        createdBookingId = result.booking.id

        return {
          status: 201,
          body: {
            ok: true,
            booking: {
              id: result.booking.id,
              status: result.booking.status,
              scheduledFor: result.booking.scheduledFor.toISOString(),
            },
          },
        }
      },
    )

    // Offer confirmed (new booking created) — deliver its confirmation and nudge
    // any live booking views. Skipped on an idempotent replay (handler not run).
    kickNotificationDrain()
    if (createdBookingId) {
      await broadcastBookingChange(createdBookingId, 'bookings')
    }

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/v1/client/waitlist-offers/[id] error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/v1/client/waitlist-offers/[id]',
    })

    return jsonFail(500, 'Internal server error')
  }
}
