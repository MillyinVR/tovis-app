// app/api/v1/pro/waitlist/[entryId]/offer/route.ts

import { Role, ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { bookingErrorJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { createWaitlistOffer } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'
import {
  loadWaitlistHostability,
  type WaitlistHostabilityRefusal,
} from '@/lib/waitlist/hostability'
import { isBookingError } from '@/lib/booking/errors'
import {
  getModeDurationMinutesOrNull,
  normalizeLocationType,
} from '@/lib/booking/locationContext'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import { isValidIanaTimeZone } from '@/lib/time'
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

/** One mode this pro may offer this entry a time in, and where it is anchored. */
type OfferOption = {
  locationType: ServiceLocationType
  locationId: string
  locationName: string | null
  timeZone: string
  durationMinutes: number
}

type OfferOptionsBody = {
  /** The pro's active offering for the entry's service, or null when blocked. */
  offeringId: string | null
  options: OfferOption[]
  /** A sentence for the picker's empty state; null when `options` is non-empty. */
  blockedReason: string | null
}

/**
 * The pro-facing sentence for "nothing to offer here". A sibling of
 * `waitlistRefusalMessage`, which words the same refusals for the CLIENT — the
 * two audiences need different sentences (one can fix it, one cannot), so they
 * are deliberately not shared.
 */
function describeOfferBlock(refusal: WaitlistHostabilityRefusal): string {
  if (refusal.kind === 'NO_ACTIVE_OFFERING') {
    return 'You don’t have an active offering for this service, so there’s no time to offer. Add or activate the service first.'
  }
  return 'You don’t have a bookable location for this service yet, so there’s no time to offer. Add one in your locations first.'
}

/**
 * The zone an offered slot is read in: the location's own, else the pro's, else
 * UTC. Same precedence `resolveValidatedBookingContext` applies, so the picker
 * displays the times the offer will actually be stamped in.
 */
function resolveOptionTimeZone(
  locationTimeZone: string | null,
  professionalTimeZone: string | null,
): string {
  for (const candidate of [locationTimeZone, professionalTimeZone]) {
    if (candidate && isValidIanaTimeZone(candidate)) return candidate
  }
  return 'UTC'
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
 * What this pro may actually offer this waitlisted client, answered by the
 * SERVER: which modes, anchored to which location, at what length.
 *
 * It exists because both offer surfaces were deriving that answer themselves and
 * getting it wrong the same way — web's calendar page picked a bookable
 * SALON/SUITE and passed `locationType: 'SALON'` as a literal, and iOS's sheet
 * re-implemented the same search in Swift. A mobile-only pro therefore never saw
 * an "Offer a time" action at all, on either platform, and neither client could
 * have learned otherwise because neither was asking.
 *
 * `loadWaitlistHostability` is the one rule for the mode list (what the pro can
 * host ∩ what an offer can be fulfilled in) and `pickBookableLocation` is the
 * one rule for which location serves a mode. Both are the same resolvers the
 * POST below re-runs under the professional's lock, so an option offered here is
 * one the POST accepts — a picker that could offer an unacceptable choice is the
 * same broken promise, moved one screen earlier.
 *
 * 🔴 Nothing about the CLIENT is in this response. A mobile option carries the
 * pro's own base, never the destination: the destination is resolved server-side
 * inside `createWaitlistOffer` precisely so it never has to travel to the pro's
 * device.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<{ entryId: string }>,
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId } = auth

    const { entryId: rawEntryId } = await resolveRouteParams(ctx)
    const entryId = pickString(rawEntryId)
    if (!entryId) return jsonFail(400, 'Missing waitlist entry id.')

    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, professionalId },
      select: { id: true, serviceId: true },
    })
    if (!entry) return jsonFail(404, 'Waitlist entry not found.')

    const hostability = await loadWaitlistHostability({
      professionalId,
      serviceId: entry.serviceId,
    })

    if (!hostability.ok) {
      // Not an error: "there is nothing you can offer, and here is why" is the
      // answer the picker needs in order to render its own empty state rather
      // than an empty list with no explanation.
      return jsonOk(
        {
          offeringId: null,
          options: [],
          blockedReason: describeOfferBlock(hostability.refusal),
        } satisfies OfferOptionsBody,
        200,
      )
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: hostability.offeringId },
      select: {
        id: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        professional: { select: { timeZone: true } },
      },
    })
    if (!offering) return jsonFail(404, 'Offering not found.')

    const options: OfferOption[] = []

    for (const locationType of hostability.modes) {
      // The same picker `resolveValidatedBookingContext` runs, so the location
      // named here is the one the POST would resolve to.
      const location = await pickBookableLocation({
        professionalId,
        locationType,
        allowFallback: true,
      })
      if (!location) continue

      const durationMinutes = getModeDurationMinutesOrNull({
        locationType,
        salonDurationMinutes: offering.salonDurationMinutes,
        mobileDurationMinutes: offering.mobileDurationMinutes,
      })
      // A mode with no configured length cannot be offered — the POST refuses it
      // as DURATION_REQUIRED, so it must not appear as a choice.
      if (durationMinutes == null) continue

      options.push({
        locationType,
        locationId: location.id,
        locationName: location.name ?? null,
        timeZone: resolveOptionTimeZone(
          location.timeZone,
          offering.professional?.timeZone ?? null,
        ),
        durationMinutes,
      })
    }

    return jsonOk(
      {
        offeringId: offering.id,
        options,
        blockedReason:
          options.length > 0
            ? null
            : 'You don’t have a bookable location set up for this service yet, so there’s no time to offer. Add one in your locations first.',
      } satisfies OfferOptionsBody,
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/waitlist/[entryId]/offer error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
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
      // The same two sentences the GET above hands the picker for its empty
      // state, from the same helper — one refusal, worded once.
      return jsonFail(409, describeOfferBlock(hostability.refusal))
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
