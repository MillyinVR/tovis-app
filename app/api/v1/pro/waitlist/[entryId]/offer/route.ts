// app/api/v1/pro/waitlist/[entryId]/offer/route.ts

import { Role, ServiceLocationType } from '@prisma/client'

import { jsonFail, pickString, requirePro } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { bookingErrorJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { createWaitlistOffer } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'
import { loadWaitlistHostability } from '@/lib/waitlist/hostability'
import { isBookingError } from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'
import { isRecord } from '@/lib/guards'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type OfferResponseBody = {
  ok: true
  offer: {
    id: string
    status: string
    startsAt: string
    endsAt: string
    locationType: string
  }
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  return Number.isFinite(date.getTime()) ? date : null
}

/** Human phrasing for the modes a waitlist offer may currently be made in. */
function describeModes(modes: readonly ServiceLocationType[]): string {
  const labels = modes.map((mode) =>
    mode === ServiceLocationType.SALON ? 'in-salon' : 'mobile',
  )
  return labels.length ? labels.join(' or ') : 'nowhere'
}

/**
 * Pro proposes a concrete appointment time to a waitlisted client. Creates a
 * PENDING WaitlistOffer and notifies the client to Confirm/Decline — it does NOT
 * book anything (that's the client's confirm). The slot is chosen from the pro's
 * live availability picker.
 *
 * The mode the pro may offer in is resolved from what they can ACTUALLY host
 * (`loadWaitlistHostability`) — the same resolver the client's join runs — not
 * from a hardcoded `locationType !== SALON` compare, which this route used to
 * do. That compare refused a mobile-only pro with a sentence naming no reason
 * they could act on, and it could disagree with the queue the client had already
 * been allowed to join.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<{ entryId: string }>,
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId, userId: actorUserId } = auth

    const { entryId: rawEntryId } = await resolveRouteParams(ctx)
    const entryId = pickString(rawEntryId)
    if (!entryId) return jsonFail(400, 'Missing waitlist entry id.')

    const body: unknown = await req.json().catch(() => null)
    if (!isRecord(body)) return jsonFail(400, 'Invalid request body.')

    const startsAt = parseIsoDate(body.scheduledFor)
    if (!startsAt) return jsonFail(400, 'Invalid or missing scheduledFor.')

    const endsAt = parseIsoDate(body.endsAt)
    if (!endsAt) return jsonFail(400, 'Invalid or missing endsAt.')

    const locationId = pickString(body.locationId)
    if (!locationId) return jsonFail(400, 'Missing locationId.')

    // The shared parser every other booking route uses — `ServiceLocationType`
    // or null, never a silent fallback to SALON.
    const locationType = normalizeLocationType(body.locationType)
    if (!locationType) {
      return jsonFail(400, 'Invalid or missing locationType.')
    }

    // Fail-fast, to the PRO, with the reason. `createWaitlistOffer` re-validates
    // everything under the professional's schedule lock — this exists so the
    // refusal names what to fix rather than surfacing as a generic 400.
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, professionalId },
      select: { serviceId: true },
    })
    if (!entry) return jsonFail(404, 'Waitlist entry not found.')

    const hostability = await loadWaitlistHostability({
      professionalId,
      serviceId: entry.serviceId,
    })

    if (!hostability.ok) {
      return jsonFail(
        409,
        hostability.refusal.kind === 'NO_ACTIVE_OFFERING'
          ? 'You don’t have an active offering for this service, so there’s no time to offer. Add or activate the service first.'
          : hostability.refusal.advertisesMobileOnly
            ? 'You only offer this service mobile, and waitlist times can only be offered in-salon right now.'
            : 'You don’t have a bookable location for this service yet, so there’s no time to offer. Add one in your locations first.',
      )
    }

    if (!hostability.modes.includes(locationType)) {
      // `modes` already folds together BOTH constraints — what this pro can host
      // and what a waitlist offer can be carried to a booking in — so naming
      // what IS allowed is one always-accurate sentence, and stays accurate on
      // its own when WAITLIST_FULFILLABLE_MODES widens.
      return jsonFail(
        400,
        `Waitlist times for this service can only be offered ${describeModes(hostability.modes)} right now.`,
      )
    }

    const durationMinutes =
      typeof body.durationMinutes === 'number' && body.durationMinutes > 0
        ? body.durationMinutes
        : Math.max(
            15,
            Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
          )

    const response = await withRouteIdempotency<OfferResponseBody>(
      {
        request: req,
        actor: {
          actorUserId,
          actorRole: Role.PRO,
        },
        route: IDEMPOTENCY_ROUTES.PRO_WAITLIST_OFFER,
        requestLabel: 'waitlist offer',
        requestBody: {
          entryId,
          professionalId,
          scheduledFor: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          locationId,
          locationType,
        },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching offer request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: 'POST /api/v1/pro/waitlist/[entryId]/offer',
      },
      async () => {
        const result = await createWaitlistOffer({
          professionalId,
          actorUserId,
          waitlistEntryId: entryId,
          scheduledFor: startsAt,
          endsAt,
          locationId,
          locationType,
          durationMinutes,
        })

        return {
          status: 201,
          body: {
            ok: true,
            offer: {
              id: result.offer.id,
              status: result.offer.status,
              startsAt: result.offer.startsAt.toISOString(),
              endsAt: result.offer.endsAt.toISOString(),
              locationType: result.offer.locationType,
            },
          },
        }
      },
    )

    // Deliver the client's "a time was offered" notification immediately.
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error('POST /api/v1/pro/waitlist/[entryId]/offer error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/v1/pro/waitlist/[entryId]/offer',
    })

    return jsonFail(500, 'Internal server error')
  }
}
