// lib/consultation/proposalSchedule.ts
//
// F12: what a consultation proposal does to the appointment's END TIME, worked
// out at PROPOSAL time — where the pro is authenticated, present, and the only
// person who can act on the answer.
//
// F2 fixed the APPROVE side: the extension is now probed against calendar
// blocks before the booking grows. It deliberately left PROPOSE alone, so a pro
// could still author a time nothing had validated and the CLIENT was the one who
// discovered it, mid-appointment, on a link that dead-ends.
//
// The two sides have to answer with the SAME number or the earlier answer is
// worthless, and the number is not the one the pro typed:
//
//   `performLockedApproveConsultationMaterialization` rebuilds every line item
//   from the OFFERING CATALOG (`buildNormalizedBookingItemsFromRequestedOfferings`,
//   snapped to 15-minute steps) and keeps only the proposal's agreed PRICE. The
//   per-item `durationMinutes` the pro edits in the consultation form is stored
//   in the proposal JSON, shown to the client, and then discarded.
//
// So computing the end from the typed durations would produce a figure that
// disagrees with what actually materializes. `resolveConsultationMaterialization`
// is that catalog computation, extracted verbatim from the approve path and now
// called by both — propose and approve cannot drift, because there is one
// function.
//
// Working hours are the other half of F12 and they INFORM rather than refuse —
// see `resolveConsultationScheduleOutlook` for why.

import {
  BookingServiceItemType,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { isRecord } from '@/lib/guards'
import {
  type RequestedServiceItemInput,
  buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals,
} from '@/lib/booking/serviceItems'
import {
  ensureWithinWorkingHours,
  makeWorkingHoursGuardMessage,
  parseWorkingHoursGuardMessage,
} from '@/lib/booking/workingHoursGuard'
import { resolveAppointmentSchedulingContext } from '@/lib/booking/timeZoneTruth'

/** The offering columns the catalog rebuild reads. */
const CONSULTATION_OFFERING_SELECT = {
  id: true,
  serviceId: true,
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: true,
  mobileDurationMinutes: true,
  salonPriceStartingAt: true,
  mobilePriceStartingAt: true,
  service: {
    select: {
      defaultDurationMinutes: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

const CONSULTATION_LOCATION_SELECT = {
  id: true,
  timeZone: true,
  workingHours: true,
} satisfies Prisma.ProfessionalLocationSelect

export type ConsultationOfferingRow = Prisma.ProfessionalServiceOfferingGetPayload<{
  select: typeof CONSULTATION_OFFERING_SELECT
}>

export type ConsultationLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof CONSULTATION_LOCATION_SELECT
}>

/**
 * The two reads this module makes, and nothing else.
 *
 * Narrower than `Prisma.TransactionClient` on purpose: the real client (and a
 * real transaction) satisfies it structurally, and a test can build a stub that
 * TYPE-CHECKS instead of one cast through `unknown` — which is both a house-rule
 * violation and the reason a mock can drift from the wire without anyone
 * noticing.
 */
export type ConsultationScheduleDb = {
  professionalServiceOffering: {
    findMany(args: {
      where: {
        id: { in: string[] }
        professionalId: string
        isActive: boolean
      }
      select: typeof CONSULTATION_OFFERING_SELECT
      take: number
    }): Promise<ConsultationOfferingRow[]>
  }
  professionalLocation: {
    findFirst(args: {
      where: { id: string; professionalId: string }
      select: typeof CONSULTATION_LOCATION_SELECT
    }): Promise<ConsultationLocationRow | null>
  }
}

export type ConsultationProposedServiceItem = {
  offeringId: string
  serviceId: string
  // Each proposed line item carries its own type. Multiple BASE items are
  // co-equal services (e.g. cut + color); ADD_ON items hang off a base.
  itemType: BookingServiceItemType
  sortOrder: number
  // The price the pro and client agreed on during the consultation, in dollars.
  // Stored on the proposal as a decimal string (e.g. "120.00"); null when the
  // proposal carried no usable price, in which case we fall back to the
  // offering's catalog price during materialization.
  agreedPrice: Prisma.Decimal | null
}

function parseProposedItemType(value: unknown): BookingServiceItemType {
  return value === BookingServiceItemType.ADD_ON
    ? BookingServiceItemType.ADD_ON
    : BookingServiceItemType.BASE
}

// The consultation proposal stores each line item's agreed price as a decimal
// dollars string (see buildProposalJson in the consultation-proposal route).
// Parse it back into a Decimal so the approved booking snapshots reflect what
// was actually quoted, not the offering's catalog "starting at" price.
function parseConsultationAgreedPrice(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  try {
    const decimal = new Prisma.Decimal(trimmed)
    if (!decimal.isFinite() || decimal.isNegative()) return null
    return decimal
  } catch {
    return null
  }
}

/**
 * Takes `unknown` rather than `Prisma.JsonValue` because it is fed from both
 * ends: the APPROVE side reads a stored `JsonValue` off the row, the PROPOSE
 * side passes the `InputJsonValue` it just built and has not written yet. Those
 * two Prisma types are not assignable to each other, and every field here is
 * narrowed at runtime anyway.
 */
export function parseConsultationProposedItems(
  value: unknown,
): ConsultationProposedServiceItem[] {
  if (!isRecord(value)) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  const rawItems = value.items

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  return rawItems.map((row: unknown, index) => {
    if (!isRecord(row)) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    const offeringId =
      typeof row.offeringId === 'string' ? row.offeringId.trim() : ''

    if (!offeringId) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    const serviceId =
      typeof row.serviceId === 'string' ? row.serviceId.trim() : ''

    return {
      offeringId,
      serviceId,
      itemType: parseProposedItemType(row.itemType ?? null),
      sortOrder:
        typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder)
          ? row.sortOrder
          : index,
      agreedPrice: parseConsultationAgreedPrice(row.price ?? null),
    }
  })
}

export type ConsultationMaterialization = {
  proposedItems: ConsultationProposedServiceItem[]
  normalizedItems: ReturnType<
    typeof buildNormalizedBookingItemsFromRequestedOfferings
  >
  primaryServiceId: string
  primaryOfferingId: string | null
  computedDurationMinutes: number
  computedSubtotal: Prisma.Decimal
}

/**
 * Rebuild the booking's service items from a stored proposal exactly as the
 * approval will. Throws `INVALID_SERVICE_ITEMS` for anything the approval would
 * also reject — an offering that is no longer active, one that does not serve
 * this booking's location mode, a malformed item.
 *
 * Called from BOTH sides of the consultation on purpose. The propose route's own
 * validation is looser than this (it never checks `offersInSalon`/`offersMobile`
 * against the booking, and treats `offeringId` as optional on add-ons), so
 * before F12 a proposal could be accepted and then be un-approvable — the client
 * hit `INVALID_SERVICE_ITEMS` with no way forward. Running the real computation
 * at proposal time moves that refusal to the person who can fix it.
 */
export async function resolveConsultationMaterialization(args: {
  tx: ConsultationScheduleDb
  professionalId: string
  locationType: ServiceLocationType
  proposedServicesJson: unknown
}): Promise<ConsultationMaterialization> {
  const proposedItems = parseConsultationProposedItems(
    args.proposedServicesJson,
  )

  const offeringIds = Array.from(
    new Set(proposedItems.map((item) => item.offeringId)),
  ).slice(0, 50)

  const offerings = await args.tx.professionalServiceOffering.findMany({
    where: {
      id: { in: offeringIds },
      professionalId: args.professionalId,
      isActive: true,
    },
    select: CONSULTATION_OFFERING_SELECT,
    take: 100,
  })

  const offeringById = new Map(
    offerings.map((offering) => [offering.id, offering]),
  )

  // Preserve each proposed line item's type so co-equal BASE services (e.g.
  // cut + color) materialize as independent services rather than being demoted
  // to add-ons. ADD_ON items still hang off a base.
  const requestedItems: RequestedServiceItemInput[] = proposedItems.map(
    (item) => {
      const offering = offeringById.get(item.offeringId)

      if (!offering) {
        throw bookingError('INVALID_SERVICE_ITEMS')
      }

      return {
        serviceId: offering.serviceId,
        offeringId: offering.id,
        sortOrder: item.sortOrder,
        itemType: item.itemType,
      }
    },
  )

  const normalizedItemsFromCatalog =
    buildNormalizedBookingItemsFromRequestedOfferings({
      requestedItems,
      locationType: args.locationType,
      stepMinutes: 15,
      offeringById,
      badItemsCode: 'INVALID_SERVICE_ITEMS',
    })

  // Honor the price the pro and client agreed on during the consultation.
  // requestedItems/normalizedItems are built in the same order as proposedItems,
  // so index alignment holds. Where the proposal carried an agreed price, it is
  // the source of truth for the booking snapshot; otherwise we keep the
  // offering's catalog price.
  const normalizedItems = normalizedItemsFromCatalog.map((item, index) => {
    const agreedPrice = proposedItems[index]?.agreedPrice ?? null
    if (!agreedPrice) return item
    return { ...item, priceSnapshot: agreedPrice }
  })

  const {
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  } = computeBookingItemLikeTotals(
    normalizedItems.map((item) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      priceSnapshot: item.priceSnapshot,
      itemType: item.itemType,
    })),
    'INVALID_SERVICE_ITEMS',
  )

  return {
    proposedItems,
    normalizedItems,
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  }
}

export type ConsultationExtensionWindow = {
  /** Where the appointment ended before these services were proposed. */
  previousEnd: Date
  /** Where it ends once the proposal materializes. */
  materializedEnd: Date
  /** Start of the window a schedule probe may look at — never before `previousEnd`. */
  extensionStart: Date
  /** False when the proposal does not grow the appointment; nothing to probe. */
  extendsAppointment: boolean
}

/**
 * The window a proposal ADDS to the appointment.
 *
 * Only `[previousEnd, materializedEnd)` is ever probed, never the original
 * booking window. A block may legitimately already overlap the booked time: the
 * ICS importer's `createBlockIfAbsent` writes calendar blocks with no
 * booking-conflict check, so a migrated pro can have a block laid straight over
 * a live appointment. Probing the full window would refuse over a pre-existing
 * condition nobody in the room caused. (F2 established this; F12 reuses it so
 * the two sides cannot disagree about which minutes are new.)
 */
export function consultationExtensionWindow(args: {
  scheduledFor: Date
  previousDurationMinutes: number | null
  bufferMinutes: number
  materializedDurationMinutes: number
}): ConsultationExtensionWindow {
  const previousEnd = new Date(
    args.scheduledFor.getTime() +
      ((args.previousDurationMinutes ?? 0) + args.bufferMinutes) * 60_000,
  )

  const materializedEnd = new Date(
    args.scheduledFor.getTime() +
      (args.materializedDurationMinutes + args.bufferMinutes) * 60_000,
  )

  const extensionStart =
    previousEnd > args.scheduledFor ? previousEnd : args.scheduledFor

  return {
    previousEnd,
    materializedEnd,
    extensionStart,
    extendsAppointment: materializedEnd > extensionStart,
  }
}

/**
 * What the proposal's new end time does to the pro's working hours.
 *
 * **This INFORMS; it never refuses.** The card that opened F12 asked for a 409
 * carrying the `allowOutsideWorkingHours` override flag, matching pro create /
 * reschedule. Three things say otherwise:
 *
 *  1. **The override would authorize nothing.** `OUTSIDE_WORKING_HOURS` is an
 *     override-gated refusal on paths where the pro is CHOOSING a time. Here the
 *     time was chosen and validated when the appointment was booked; the pro is
 *     choosing SERVICES, and the appointment is already underway (the route
 *     requires `startedAt`). Approval does not check working hours either, by
 *     F2's explicit decision — so a `BookingOverrideAuditLog` entry written here
 *     would record consent for a rule no later write consults.
 *  2. **Running late is not a scheduling error.** A pro who agrees to add a
 *     service to a client sitting in their chair has decided to run past
 *     closing. The product has no rule against that, and inventing one,
 *     mid-session, behind a modal that asks for a written reason, is friction
 *     for its own sake.
 *  3. **A refusal here has no safe exit.** Blocks have one — clear the block.
 *     Closing time does not; the pro cannot make it earlier in the day.
 *
 * So the pro is TOLD, in the same breath as the end time itself, and decides.
 * Calendar blocks are the opposite case and are refused outright by the caller:
 * approval refuses them too, so letting a proposal through would only move the
 * dead end onto the client.
 *
 * Shaped after `lib/lastMinute/proOpeningVisibility.ts` (F16): total by
 * contract, silent by default, and an unanswered question is never reported as
 * "fine".
 */
export type ConsultationScheduleOutlook =
  /** The whole appointment, extension included, still sits inside the pro's hours. */
  | 'WITHIN_WORKING_HOURS'
  /** These services are what push the end past the pro's hours. Worth saying. */
  | 'PAST_WORKING_HOURS'
  /**
   * The appointment was ALREADY outside the pro's hours before this proposal.
   * Silent: blaming the proposal for a pre-existing condition is the mistake F2
   * caught itself making with calendar blocks.
   */
  | 'ALREADY_OUTSIDE_WORKING_HOURS'
  /** This location has no usable working hours, so there is nothing to judge against. */
  | 'WORKING_HOURS_MISSING'
  /**
   * Not asked, or asked and the answer did not arrive: no location on the
   * booking, no resolvable time zone, or the lookup failed. A distinct state
   * rather than `WITHIN_WORKING_HOURS` so "we did not ask" can never be read as
   * "you are fine".
   */
  | 'NOT_CHECKED'

export type ConsultationScheduleOutlookResult = {
  outlook: ConsultationScheduleOutlook
  /**
   * The appointment's time zone, resolved through the booking → location →
   * professional truth chain. Null when it could not be resolved, in which case
   * a caller must not render the end time as a wall clock — there is no zone to
   * render it in.
   */
  timeZone: string | null
}

const OUTLOOK_UNKNOWN: ConsultationScheduleOutlookResult = {
  outlook: 'NOT_CHECKED',
  timeZone: null,
}

/**
 * Never throws. This is a DISPLAY concern on a route that goes on to write, and
 * F16 established what happens when one of those is allowed to fail: a schedule
 * query that errors turns into a 500 for work that succeeded. Any failure lands
 * on `NOT_CHECKED`, which every consumer already has to render silently.
 */
export async function resolveConsultationScheduleOutlook(args: {
  tx: ConsultationScheduleDb
  professionalId: string
  locationId: string | null
  bookingLocationTimeZone: string | null
  professionalTimeZone: string | null
  scheduledFor: Date
  previousEnd: Date
  materializedEnd: Date
}): Promise<ConsultationScheduleOutlookResult> {
  try {
    if (!args.locationId) return OUTLOOK_UNKNOWN

    const location = await args.tx.professionalLocation.findFirst({
      where: {
        id: args.locationId,
        professionalId: args.professionalId,
      },
      select: CONSULTATION_LOCATION_SELECT,
    })

    if (!location) return OUTLOOK_UNKNOWN

    const context = await resolveAppointmentSchedulingContext({
      bookingLocationTimeZone: args.bookingLocationTimeZone,
      location: { id: location.id, timeZone: location.timeZone },
      professionalId: args.professionalId,
      professionalTimeZone: args.professionalTimeZone,
      fallback: 'UTC',
      requireValid: true,
    })

    if (!context.ok) return OUTLOOK_UNKNOWN

    const timeZone = context.context.appointmentTimeZone

    const judge = (endUtc: Date) =>
      ensureWithinWorkingHours({
        scheduledStartUtc: args.scheduledFor,
        scheduledEndUtc: endUtc,
        workingHours: location.workingHours,
        timeZone,
        fallbackTimeZone: 'UTC',
        // The sentinel protocol in workingHoursGuard.ts — the guard returns a
        // plain string, so this is how a caller recovers WHICH rule failed.
        messages: {
          missing: makeWorkingHoursGuardMessage('WORKING_HOURS_REQUIRED'),
          misconfigured: makeWorkingHoursGuardMessage('WORKING_HOURS_INVALID'),
          outside: makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
        },
      })

    const after = judge(args.materializedEnd)

    if (after.ok) {
      return { outlook: 'WITHIN_WORKING_HOURS', timeZone }
    }

    const afterCode = parseWorkingHoursGuardMessage(after.error)

    if (
      afterCode === 'WORKING_HOURS_REQUIRED' ||
      afterCode === 'WORKING_HOURS_INVALID'
    ) {
      // Two codes, one situation for the pro: there are no hours here to run
      // past. Nothing this proposal did.
      return { outlook: 'WORKING_HOURS_MISSING', timeZone }
    }

    // The end is outside the hours — but was it already, before these services?
    // Judging only the new end would tell a pro working a deliberate after-hours
    // appointment that the proposal broke something, which it did not.
    //
    // A booking with no duration yet has no prior window to judge: an empty
    // range is `!ok` on a length check, not on the hours, and reading that as
    // "already outside" would silence the one state that has something to say.
    if (args.previousEnd <= args.scheduledFor) {
      return { outlook: 'PAST_WORKING_HOURS', timeZone }
    }

    const before = judge(args.previousEnd)

    return {
      outlook: before.ok
        ? 'PAST_WORKING_HOURS'
        : 'ALREADY_OUTSIDE_WORKING_HOURS',
      timeZone,
    }
  } catch (error: unknown) {
    console.error('resolveConsultationScheduleOutlook failed', {
      professionalId: args.professionalId,
      locationId: args.locationId,
      error,
    })
    return OUTLOOK_UNKNOWN
  }
}
