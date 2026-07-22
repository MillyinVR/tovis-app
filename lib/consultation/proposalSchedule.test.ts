import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingServiceItemType,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'


import { isBookingError } from '@/lib/booking/errors'
import {
  consultationExtensionWindow,
  resolveConsultationMaterialization,
  resolveConsultationScheduleOutlook,
  type ConsultationLocationRow,
  type ConsultationOfferingRow,
  type ConsultationScheduleDb,
} from './proposalSchedule'

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * A salon offering whose CATALOG duration is 60 minutes. Every duration
 * assertion below is against this number and never against the per-item
 * `durationMinutes` a proposal carries, which the approval discards.
 */
function makeOffering(overrides?: {
  id?: string
  serviceId?: string
  offersInSalon?: boolean
  offersMobile?: boolean
  salonDurationMinutes?: number | null
  mobileDurationMinutes?: number | null
}): ConsultationOfferingRow {
  return {
    id: overrides?.id ?? 'off_1',
    serviceId: overrides?.serviceId ?? 'svc_1',
    offersInSalon: overrides?.offersInSalon ?? true,
    offersMobile: overrides?.offersMobile ?? false,
    salonDurationMinutes:
      overrides && 'salonDurationMinutes' in overrides
        ? overrides.salonDurationMinutes ?? null
        : 60,
    mobileDurationMinutes:
      overrides && 'mobileDurationMinutes' in overrides
        ? overrides.mobileDurationMinutes ?? null
        : null,
    salonPriceStartingAt: new Prisma.Decimal('100.00'),
    mobilePriceStartingAt: new Prisma.Decimal('120.00'),
    service: { defaultDurationMinutes: 45 },
  }
}

function makeProposalJson(overrides?: {
  items?: Array<Record<string, unknown>>
}) {
  return {
    currency: 'USD',
    items: overrides?.items ?? [
      {
        offeringId: 'off_1',
        serviceId: 'svc_1',
        itemType: BookingServiceItemType.BASE,
        // Deliberately NOT 60. If anything reads this instead of the catalog,
        // every duration assertion below moves.
        durationMinutes: 200,
        price: '150.00',
        sortOrder: 0,
      },
    ],
  }
}

function makeTx(args?: {
  offerings?: ConsultationOfferingRow[]
  location?: ConsultationLocationRow | null
  locationFindFirst?: () => Promise<ConsultationLocationRow | null>
}): ConsultationScheduleDb {
  const offerings = args?.offerings ?? [makeOffering()]
  const location: ConsultationLocationRow | null =
    args && 'location' in args
      ? args.location ?? null
      : {
          id: 'loc_1',
          timeZone: 'America/Los_Angeles',
          // 09:00 - 17:00 local, every day.
          workingHours: WORKING_NINE_TO_FIVE,
        }

  // Typed against the module's own narrow DB surface rather than cast through
  // `unknown` at a full Prisma client: a stub that has to type-check cannot
  // quietly drift from the shape the real query returns.
  return {
    professionalServiceOffering: {
      findMany: () => Promise.resolve(offerings),
    },
    professionalLocation: {
      findFirst: args?.locationFindFirst ?? (() => Promise.resolve(location)),
    },
  }
}

// The shape getWorkingWindowForDay actually parses: WEEKDAY_KEYS + a per-day
// { enabled, start, end }. 09:00-17:00 local, every day.
const WORKING_NINE_TO_FIVE = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((key) => [
    key,
    { enabled: true, start: '09:00', end: '17:00' },
  ]),
)

// 2026-04-13 is a Monday. 19:00Z = 12:00 America/Los_Angeles (PDT, UTC-7).
const NOON_PDT = new Date('2026-04-13T19:00:00.000Z')

function outlookArgs(overrides?: {
  previousEnd?: Date
  materializedEnd?: Date
  locationId?: string | null
}) {
  const locationId: string | null =
    overrides && 'locationId' in overrides ? overrides.locationId ?? null : 'loc_1'

  return {
    professionalId: 'pro_1',
    locationId,
    bookingLocationTimeZone: 'America/Los_Angeles',
    professionalTimeZone: 'America/Los_Angeles',
    scheduledFor: NOON_PDT,
    // 13:00 local
    previousEnd:
      overrides?.previousEnd ?? new Date('2026-04-13T20:00:00.000Z'),
    // 14:00 local
    materializedEnd:
      overrides?.materializedEnd ?? new Date('2026-04-13T21:00:00.000Z'),
  }
}

// ── resolveConsultationMaterialization ──────────────────────────────────────

describe('resolveConsultationMaterialization', () => {
  it('takes the duration from the offering catalog, not from the proposal', async () => {
    const result = await resolveConsultationMaterialization({
      tx: makeTx(),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      proposedServicesJson: makeProposalJson(),
    })

    // The proposal said 200. The catalog says 60, and the catalog is what the
    // booking will actually become — which is the whole reason F12 shares this
    // function with the approval instead of adding up the typed minutes.
    expect(result.computedDurationMinutes).toBe(60)
  })

  it('keeps the price the pro and client agreed on', async () => {
    const result = await resolveConsultationMaterialization({
      tx: makeTx(),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      proposedServicesJson: makeProposalJson(),
    })

    // 150 (agreed) beats 100 (catalog "starting at").
    expect(result.computedSubtotal.toFixed(2)).toBe('150.00')
  })

  it('sums every line item', async () => {
    const result = await resolveConsultationMaterialization({
      tx: makeTx({
        offerings: [
          makeOffering(),
          makeOffering({
            id: 'off_2',
            serviceId: 'svc_2',
            salonDurationMinutes: 30,
          }),
        ],
      }),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      proposedServicesJson: makeProposalJson({
        items: [
          {
            offeringId: 'off_1',
            serviceId: 'svc_1',
            itemType: BookingServiceItemType.BASE,
            price: '100.00',
            sortOrder: 0,
          },
          {
            offeringId: 'off_2',
            serviceId: 'svc_2',
            itemType: BookingServiceItemType.ADD_ON,
            price: '40.00',
            sortOrder: 1,
          },
        ],
      }),
    })

    expect(result.computedDurationMinutes).toBe(90)
  })

  it('refuses an offering that does not serve this appointment’s location mode', async () => {
    // The propose route's own validation never asks this question, so before
    // F12 a salon-only service on a MOBILE appointment sailed through and blew
    // up on the CLIENT at approve.
    const call = resolveConsultationMaterialization({
      tx: makeTx({ offerings: [makeOffering({ offersMobile: false })] }),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.MOBILE,
      proposedServicesJson: makeProposalJson(),
    })

    await expect(call).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERVICE_ITEMS',
    )
  })

  it('refuses an offering that is no longer active', async () => {
    // An inactive offering simply is not returned by the query.
    const call = resolveConsultationMaterialization({
      tx: makeTx({ offerings: [] }),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      proposedServicesJson: makeProposalJson(),
    })

    await expect(call).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERVICE_ITEMS',
    )
  })

  it('refuses an add-on carrying no offeringId', async () => {
    // The propose route treats offeringId as optional on add-ons; the approval
    // requires it. This is the side that decides.
    const call = resolveConsultationMaterialization({
      tx: makeTx(),
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      proposedServicesJson: makeProposalJson({
        items: [
          {
            serviceId: 'svc_1',
            itemType: BookingServiceItemType.ADD_ON,
            price: '40.00',
            sortOrder: 0,
          },
        ],
      }),
    })

    await expect(call).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERVICE_ITEMS',
    )
  })
})

// ── consultationExtensionWindow ─────────────────────────────────────────────

describe('consultationExtensionWindow', () => {
  const scheduledFor = new Date('2026-04-13T18:00:00.000Z')

  it('starts the probe at the OLD end, never at the appointment start', () => {
    const window = consultationExtensionWindow({
      scheduledFor,
      previousDurationMinutes: 60,
      bufferMinutes: 10,
      materializedDurationMinutes: 120,
    })

    // 18:00 + 60 + 10 buffer
    expect(window.previousEnd.toISOString()).toBe('2026-04-13T19:10:00.000Z')
    expect(window.extensionStart.toISOString()).toBe('2026-04-13T19:10:00.000Z')
    // 18:00 + 120 + 10 buffer
    expect(window.materializedEnd.toISOString()).toBe(
      '2026-04-13T20:10:00.000Z',
    )
    expect(window.extendsAppointment).toBe(true)
  })

  it('reports no extension when the proposal shortens the appointment', () => {
    const window = consultationExtensionWindow({
      scheduledFor,
      previousDurationMinutes: 120,
      bufferMinutes: 0,
      materializedDurationMinutes: 60,
    })

    expect(window.extendsAppointment).toBe(false)
  })

  it('reports no extension when the duration is unchanged', () => {
    const window = consultationExtensionWindow({
      scheduledFor,
      previousDurationMinutes: 90,
      bufferMinutes: 15,
      materializedDurationMinutes: 90,
    })

    expect(window.extendsAppointment).toBe(false)
  })

  it('treats a booking with no duration yet as starting from its start time', () => {
    const window = consultationExtensionWindow({
      scheduledFor,
      previousDurationMinutes: null,
      bufferMinutes: 0,
      materializedDurationMinutes: 60,
    })

    expect(window.extensionStart.toISOString()).toBe(scheduledFor.toISOString())
    expect(window.extendsAppointment).toBe(true)
  })
})

// ── resolveConsultationScheduleOutlook ──────────────────────────────────────

describe('resolveConsultationScheduleOutlook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('is silent when the extension still lands inside working hours', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx(),
      ...outlookArgs(),
    })

    expect(result).toEqual({
      outlook: 'WITHIN_WORKING_HOURS',
      timeZone: 'America/Los_Angeles',
    })
  })

  it('speaks up when THESE services are what push the end past closing', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx(),
      ...outlookArgs({
        // 16:00 local — inside
        previousEnd: new Date('2026-04-13T23:00:00.000Z'),
        // 18:00 local — past the 17:00 close
        materializedEnd: new Date('2026-04-14T01:00:00.000Z'),
      }),
    })

    expect(result.outlook).toBe('PAST_WORKING_HOURS')
  })

  it('stays silent when the appointment was ALREADY outside working hours', async () => {
    // A deliberate after-hours appointment: 19:00 local start, already past the
    // 17:00 close before anything was proposed. Blaming the proposal for that
    // is the mistake F2 caught itself making with calendar blocks.
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx(),
      professionalId: 'pro_1',
      locationId: 'loc_1',
      bookingLocationTimeZone: 'America/Los_Angeles',
      professionalTimeZone: 'America/Los_Angeles',
      // 19:00 local
      scheduledFor: new Date('2026-04-14T02:00:00.000Z'),
      // 20:00 local
      previousEnd: new Date('2026-04-14T03:00:00.000Z'),
      // 21:00 local
      materializedEnd: new Date('2026-04-14T04:00:00.000Z'),
    })

    expect(result.outlook).toBe('ALREADY_OUTSIDE_WORKING_HOURS')
  })

  it('tells "no hours configured" apart from "ran past them"', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx({
        location: {
          id: 'loc_1',
          timeZone: 'America/Los_Angeles',
          workingHours: null,
        },
      }),
      ...outlookArgs(),
    })

    expect(result.outlook).toBe('WORKING_HOURS_MISSING')
  })

  // `Booking.locationId` is non-nullable, so this pins the HELPER's contract
  // rather than a state the propose route can reach — it takes `string | null`
  // and must not treat "nothing to ask about" as "all clear".
  it('does not ask when it is given no location', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx(),
      ...outlookArgs({ locationId: null }),
    })

    // NOT `WITHIN_WORKING_HOURS`: an unasked question must never read as "fine".
    expect(result).toEqual({ outlook: 'NOT_CHECKED', timeZone: null })
  })

  it('does not ask when the location has gone away', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx({ location: null }),
      ...outlookArgs(),
    })

    expect(result).toEqual({ outlook: 'NOT_CHECKED', timeZone: null })
  })

  it('does not ask when there is no usable time zone', async () => {
    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx({
        location: {
          id: 'loc_1',
          timeZone: null,
          workingHours: WORKING_NINE_TO_FIVE,
        },
      }),
      professionalId: 'pro_1',
      locationId: 'loc_1',
      bookingLocationTimeZone: null,
      professionalTimeZone: null,
      scheduledFor: NOON_PDT,
      previousEnd: new Date('2026-04-13T20:00:00.000Z'),
      materializedEnd: new Date('2026-04-13T21:00:00.000Z'),
    })

    expect(result).toEqual({ outlook: 'NOT_CHECKED', timeZone: null })
  })

  it('NEVER throws — a display concern must not take down the write', async () => {
    // F16: this runs on a route that goes on to create the proposal. A schedule
    // query that errors used to mean a 500 for work that would have succeeded.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const result = await resolveConsultationScheduleOutlook({
      tx: makeTx({
        locationFindFirst: () => Promise.reject(new Error('db is down')),
      }),
      ...outlookArgs(),
    })

    expect(result).toEqual({ outlook: 'NOT_CHECKED', timeZone: null })
    expect(consoleError).toHaveBeenCalled()
  })
})
