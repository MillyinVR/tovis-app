// app/api/v1/availability/day/route.ts

import { createHash } from 'node:crypto'

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, requireClient, requirePro } from '@/app/api/_utils'
import type { AvailabilityDayOk, AvailabilityOffering } from '@/app/(main)/booking/AvailabilityDrawer/types'
import {
  resolveAvailabilityDurationMinutes,
  type ConsultProposalAvailabilityContext,
  type RescheduleAvailabilityContext,
} from '@/lib/availability/data/durationContext'
import { loadBusyIntervals } from '@/lib/availability/data/busyIntervals'
import { buildDayCacheKey } from '@/lib/availability/data/cache'
import {
  loadAvailabilityOfferingContext,
  toAvailabilityOfferingDto,
} from '@/lib/availability/data/offeringContext'
import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
  localSlotToUtcOrNull,
} from '@/lib/availability/core/dayComputation'
import {
  parseYYYYMMDD,
  ymdSerial,
} from '@/lib/availability/core/summaryWindow'
import { parseAvailabilityRequest } from '@/lib/availability/http/parseAvailabilityRequest'
import { resolveWaitlistOfferDestinationIdForPro } from '@/lib/waitlist/offerDestination'
import {
  getScheduleConfigVersion,
  getScheduleVersion,
} from '@/lib/booking/cacheVersion'
import {
  MAX_LEAD_MINUTES,
  OCCUPANCY_WINDOW_PADDING_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes } from '@/lib/booking/conflicts'
import { utcDateToLocalParts } from '@/lib/booking/dateTime'
import {
  getBookingFailPayload,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import { withVersionedCache } from '@/lib/cache/versionedCache'
import { prismaRead } from '@/lib/prisma'
import { clampInt } from '@/lib/pick'
import { toIntParam as toInt } from '@/lib/queryParams'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const TTL_DAY_SECONDS = 120

type AvailabilityRequestBasePayload = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
}

type AvailabilityDayRequestPayload = AvailabilityRequestBasePayload & {
  date: string
}

function resolveDebugClientAddressId(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}): string | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.clientAddressId
    : null
}

function buildAvailabilityVersion(args: {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  scheduleVersion: string | number
  scheduleConfigVersion: string | number
  date: string
}): string {
  const raw = JSON.stringify({
    v: 1,
    scope: 'DAY',
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `av:${digest.slice(0, 24)}`
}

function buildDayRequestPayload(args: {
  professionalId: string
  serviceId: string
  offeringId: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  date: string
}): AvailabilityDayRequestPayload {
  return {
    professionalId: args.professionalId,
    serviceId: args.serviceId,
    offeringId: args.offeringId,
    locationType: args.locationType,
    locationId: args.locationId,
    clientAddressId: args.clientAddressId,
    addOnIds: args.addOnIds.slice(),
    durationMinutes: args.durationMinutes,
    date: args.date,
  }
}

export async function GET(req: Request) {
  try {
    const {
      professionalId,
      serviceId,
      clientAddressId,
      requestedLocationType,
      requestedLocationId,
      dateStr,
      addOnIds,
      rescheduleBookingId,
      rebookOfBookingId,
      waitlistEntryId,
      consultId,
      debug,
      stepRaw,
      leadRaw,
    } = parseAvailabilityRequest(req)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    // A reschedule is offered its BOOKING's committed width, which is that
    // client's data — so this branch, and only this branch, authenticates.
    // Without `rescheduleBookingId` the route keeps its public shape and reads
    // no session at all (B3-A). Resolved before any query so an anonymous
    // caller cannot spend the day computation on a booking id.
    let reschedule: RescheduleAvailabilityContext | null = null
    if (rescheduleBookingId) {
      const auth = await requireClient()
      if (!auth.ok) return auth.res
      reschedule = {
        bookingId: rescheduleBookingId,
        owner: { kind: 'CLIENT', clientId: auth.clientId },
      }
    }

    // Book the Look, B4b — a consult's booking proposal is offered the width of
    // its WHOLE estimate, the same width the hold reserves and the finalize
    // commits. Per-client data, so this branch authenticates exactly as the
    // reschedule one above does.
    let consult: ConsultProposalAvailabilityContext | null = null
    if (consultId) {
      const auth = await requireClient()
      if (!auth.ok) return auth.res
      consult = {
        consultId,
        clientId: auth.clientId,
        actorUserId: auth.user.id,
      }
    }

    // An aftercare rebook is offered its source BOOKING's clone width (base +
    // add-ons at snapshot durations) — the pro's own data, so this branch
    // authenticates the PRO the same way the reschedule branch authenticates
    // the client. Only the aftercare authoring surfaces send this.
    let rebookOf: RescheduleAvailabilityContext | null = null
    if (rebookOfBookingId) {
      const auth = await requirePro()
      if (!auth.ok) return auth.res
      rebookOf = {
        bookingId: rebookOfBookingId,
        owner: { kind: 'PRO', professionalId: auth.professionalId },
      }
    }

    // A pro picking a time to OFFER a waitlisted client. MOBILE placement needs
    // the client's service address, and the pro is not entitled to it at offer
    // time — so it is resolved here, server-side, from an entry this pro owns,
    // and only its effect (which slots exist) ever reaches them. Same shape as
    // the two branches above: pro-scoped input, authenticated before use.
    //
    // A null result — foreign entry, missing entry, or a client with no saved
    // address — deliberately falls through to "no client address", which for
    // MOBILE surfaces as CLIENT_SERVICE_ADDRESS_REQUIRED. That is the same
    // answer `createWaitlistOffer` would give, and it tells a probing caller
    // nothing about whose entry id they guessed.
    let waitlistDestinationAddressId: string | null = null
    if (waitlistEntryId) {
      const auth = await requirePro()
      if (!auth.ok) return auth.res
      waitlistDestinationAddressId =
        await resolveWaitlistOfferDestinationIdForPro({
          professionalId: auth.professionalId,
          waitlistEntryId,
        })
    }

    // The server-resolved destination WINS over anything the caller sent: a pro
    // on the waitlist path has no legitimate `clientAddressId` to supply, so
    // honouring theirs would be honouring a guess.
    const effectiveClientAddressId = waitlistEntryId
      ? waitlistDestinationAddressId
      : clientAddressId

    if (!dateStr) {
      return jsonFail(
        400,
        'Missing date. Use /api/v1/availability/bootstrap for drawer bootstrap and /api/v1/availability/day for a specific day.',
      )
    }

    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return jsonFail(400, 'Invalid date. Use YYYY-MM-DD.')
    }

    const [scheduleVersion, scheduleConfigVersion] = await Promise.all([
      getScheduleVersion(professionalId),
      getScheduleConfigVersion(professionalId),
    ])

    const baseContext = await loadAvailabilityOfferingContext({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      clientAddressId: effectiveClientAddressId,
      scheduleConfigVersion,
      cacheEnabled: !debug,
      client: prismaRead,
    })

    if (!baseContext.ok) {
      if (baseContext.kind === 'NOT_FOUND') {
        return jsonFail(
          404,
          baseContext.entity === 'PROFESSIONAL'
            ? 'Professional not found'
            : 'Service not found',
        )
      }

      return bookingJsonFail(baseContext.code)
    }

    const {
      locationId,
      effectiveLocationType,
      timeZone,
      timeZoneSource,
      workingHours,
      defaultStepMinutes,
      defaultLead,
      locationBufferMinutes,
      maxAdvanceDays,
      durationMinutes: baseDurationMinutes,
      offeringDbId,
      offeringPayload,
    } = baseContext.value

    const resolvedClientAddressId = resolveDebugClientAddressId({
      locationType: effectiveLocationType,
      clientAddressId: effectiveClientAddressId,
    })

    const stepMinutes =
      debug && stepRaw
        ? normalizeStepMinutes(stepRaw, defaultStepMinutes)
        : defaultStepMinutes

    const leadTimeMinutes =
      debug && leadRaw
        ? clampInt(toInt(leadRaw, defaultLead), 0, MAX_LEAD_MINUTES)
        : defaultLead

    const nowUtc = new Date()
    const nowParts = utcDateToLocalParts(nowUtc, timeZone)
    const todayYMD = {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
    }

    const dayDiff = ymdSerial(ymd) - ymdSerial(todayYMD)
    if (dayDiff < 0) {
      return jsonFail(400, 'Date is in the past.')
    }

    if (dayDiff > maxAdvanceDays) {
      return jsonFail(
        400,
        `You can book up to ${maxAdvanceDays} days in advance.`,
      )
    }

    const durationResult = await resolveAvailabilityDurationMinutes({
      professionalId,
      offeringId: offeringDbId,
      addOnIds,
      locationType: effectiveLocationType,
      baseDurationMinutes,
      reschedule,
      rebookOf,
      consult,
      client: prismaRead,
    })

    if (!durationResult.ok) {
      return bookingJsonFail(durationResult.code, {
        ...(durationResult.userMessage
          ? { userMessage: durationResult.userMessage }
          : {}),
      })
    }

    // From here the answer is a pure function of this width — which is exactly
    // why the reschedule variant can keep sharing the public cache. The key
    // already hashes `durationMinutes` (`buildDayCacheKey`), the payload carries
    // no booking id, and two callers who resolve to the same width are owed the
    // same slots. So no per-client key, no cache split, and cardinality stays
    // bounded by the width's own clamp rather than by how many bookings exist
    // ([[cache-is-a-third-query]] — the booking is an INPUT to the width, never
    // part of the answer).
    const durationMinutes = durationResult.durationMinutes

    const request = buildDayRequestPayload({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      date: dateStr,
    })

    const generatedAt = new Date().toISOString()
    const availabilityVersion = buildAvailabilityVersion({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      scheduleVersion,
      scheduleConfigVersion,
      date: dateStr,
    })

    const dayKeyExtra = debug
      ? null
      : buildDayCacheKey({
          professionalId,
          serviceId,
          locationId,
          locationType: effectiveLocationType,
          dateStr,
          timeZone,
          stepMinutes,
          leadTimeMinutes,
          locationBufferMinutes,
          scheduleVersion,
          scheduleConfigVersion,
          addOnIds,
          durationMinutes,
          clientAddressId: resolvedClientAddressId,
          excludeBookingId: reschedule?.bookingId ?? null,
        })

    type DaySuccessPayload = {
      ok: true
      mode: 'DAY'
      availabilityVersion: string
      generatedAt: string
      request: AvailabilityDayRequestPayload
      professionalId: string
      serviceId: string
      locationType: ServiceLocationType
      date: string
      locationId: string
      timeZone: string
      timeZoneSource: typeof timeZoneSource
      stepMinutes: number
      leadTimeMinutes: number
      locationBufferMinutes: number
      adjacencyBufferMinutes: number
      maxDaysAhead: number
      durationMinutes: number
      dayStartUtc: string
      dayEndExclusiveUtc: string
      slots: string[]
      offering: AvailabilityOffering
      debug?: unknown
    }

    type DayLoaderResult =
      | { kind: 'ok'; payload: DaySuccessPayload }
      | {
          kind: 'fail'
          code: BookingErrorCode
          debug?: unknown
        }

    const computeDayPayload = async (): Promise<DayLoaderResult> => {
      const bounds = computeDayBoundsUtc(ymd, timeZone)

      const dayAnchorUtc =
        localSlotToUtcOrNull({
          year: ymd.year,
          month: ymd.month,
          day: ymd.day,
          hour: 12,
          minute: 0,
          timeZone,
        }) ?? new Date(bounds.dayStartUtc.getTime() + 12 * 60 * 60 * 1000)

      const windowForLoad = getWorkingWindowForDay(
        dayAnchorUtc,
        workingHours,
        timeZone,
      )

      const windowStartUtc = addMinutes(
        bounds.dayStartUtc,
        -OCCUPANCY_WINDOW_PADDING_MINUTES,
      )

      const windowEndUtc = addMinutes(
        bounds.dayStartUtc,
        (windowForLoad.ok ? windowForLoad.endMinutes : 1440) +
          OCCUPANCY_WINDOW_PADDING_MINUTES,
      )

      const busy = await loadBusyIntervals({
        professionalId,
        locationId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        fallbackDurationMinutes: durationMinutes,
        locationBufferMinutes,
        scheduleVersion,
        // The booking being moved is not an obstacle to itself: the reschedule
        // commit excludes it, so the offer must too or a 3pm–5pm appointment
        // cannot be nudged to 4pm (B3-B).
        excludeBookingId: reschedule?.bookingId ?? null,
        cache: { enabled: !debug },
        client: prismaRead,
      })

      const result = await computeDaySlotsFast({
        dateYMD: ymd,
        durationMinutes,
        stepMinutes,
        timeZone,
        workingHours,
        leadTimeMinutes,
        locationBufferMinutes,
        maxAdvanceDays,
        busy,
        debug,
      })

      if (!result.ok) {
        return {
          kind: 'fail',
          code: result.code,
          debug: result.debug,
        }
      }

      return {
        kind: 'ok',
        payload: {
          ok: true,
          mode: 'DAY',
          availabilityVersion,
          generatedAt,
          request,

          professionalId,
          serviceId,
          locationType: effectiveLocationType,
          date: dateStr,

          locationId,
          timeZone,
          timeZoneSource,
          stepMinutes,
          leadTimeMinutes,
          locationBufferMinutes,
          adjacencyBufferMinutes: locationBufferMinutes,
          maxDaysAhead: maxAdvanceDays,

          durationMinutes,
          dayStartUtc: result.dayStartUtc.toISOString(),
          dayEndExclusiveUtc: result.dayEndExclusiveUtc.toISOString(),
          slots: result.slots,

          offering: toAvailabilityOfferingDto(offeringPayload),
          ...(debug ? { debug: result.debug } : {}),
        },
      }
    }

    const loaderResult: DayLoaderResult = dayKeyExtra
      ? (
          await withVersionedCache(
            {
              scope: 'availability:day',
              scopeId: professionalId,
              version: scheduleConfigVersion,
              extra: dayKeyExtra,
            },
            computeDayPayload,
            TTL_DAY_SECONDS,
          )
        ).value
      : await computeDayPayload()

    if (loaderResult.kind === 'fail') {
      const fail = getBookingFailPayload(loaderResult.code)
      return jsonFail(fail.httpStatus, fail.userMessage, {
        ...fail.extra,
        locationId,
        timeZone,
        timeZoneSource,
        stepMinutes,
        leadTimeMinutes,
        locationBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        ...(debug ? { debug: loaderResult.debug } : {}),
      })
    }

    return jsonOk(loaderResult.payload satisfies AvailabilityDayOk)
  } catch (err: unknown) {
    console.error('GET /api/v1/availability/day error', err)

    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load availability.',
      userMessage: 'Failed to load availability.',
    })
  }
}