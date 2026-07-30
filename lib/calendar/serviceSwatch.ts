// lib/calendar/serviceSwatch.ts
//
// K8: the SERVER half of the service-colour channel — how a booking row in the
// database becomes the swatch K7's resolver paints on the accent stripe.
//
// K7 shipped `resolveCalendarSwatch` with a structural input and deliberately
// NO call site, because the column it reads
// (`ProfessionalServiceOffering.calendarSwatch`) did not exist until K8. This
// module is that call site. It does three things and nothing else:
//
//   1. names the shape a booking row must be selected in (so the compiler, not
//      a comment, enforces that the route selected what the resolver reads),
//   2. loads the one fallback a booking row cannot reach by join,
//   3. hands both to `resolveCalendarSwatch`.
//
// 🔴 There is no second resolution chain here. The ORDER lives in
// `lib/calendar/eventColor.ts` and nowhere else — a copy that drifts would give
// the same booking two different colours on two surfaces, which is the whole
// disease the one-helper rule exists to prevent.
import { BookingServiceItemType } from '@prisma/client'

import {
  parseCalendarSwatch,
  resolveCalendarSwatch,
  type CalendarSwatchId,
} from '@/lib/calendar/eventColor'

/** The only column of an offering the colour channel reads. */
export type SwatchOfferingRow = {
  calendarSwatch: string | null
}

/**
 * The single query this module runs, as a type.
 *
 * Deliberately narrower than `Pick<PrismaClient, 'professionalServiceOffering'>`:
 * that would drag in the whole delegate, so a test could only supply one by
 * building a fake with all seventeen of its methods — or by casting, which the
 * house rules forbid. Both the real client and a one-method stub satisfy this.
 */
export type OfferingSwatchReader = {
  professionalServiceOffering: {
    findMany(args: {
      where: {
        professionalId: string
        calendarSwatch: { not: null }
      }
      select: { serviceId: true; calendarSwatch: true }
    }): Promise<{ serviceId: string; calendarSwatch: string | null }[]>
  }
}

/**
 * A booking, as far as the service colour is concerned. Every field here must
 * appear in the caller's Prisma select — that is the point of the type: the
 * route cannot forget one without failing `typecheck`.
 */
export type SwatchBookingRow = {
  /** `Booking.serviceId` — non-null in the schema; the fallback map's key. */
  serviceId: string
  /**
   * `Booking.offering` — the row's OWN link to the pro's offering. Nullable
   * (`Booking.offeringId` is `String?`), which is exactly why the serviceId
   * fallback below exists.
   */
  offering: SwatchOfferingRow | null
  /** `Booking.serviceItems` — a booking can hold several services. */
  serviceItems: readonly {
    itemType: BookingServiceItemType
    sortOrder: number | null
    offering: SwatchOfferingRow | null
  }[]
}

/**
 * Every colour this pro has chosen, keyed by `serviceId`.
 *
 * One query for the whole page of bookings rather than one per row. The key is
 * unambiguous because `ProfessionalServiceOffering` is `@@unique([professionalId,
 * serviceId])` — a pro has at most one offering per service, so there is no tie
 * to break and the answer is deterministic.
 *
 * ⚠️ Keyed on the PRO alone, not on the service ids of the bookings in view.
 * Narrowing it to those ids would look cheaper and would cost more: it could
 * only run *after* the booking query resolved, adding a serial hop to a route
 * whose known performance problem is exactly a fetch waterfall. Keyed this way
 * it is independent, so the caller runs it alongside the booking query for
 * free. The extra rows are the pro's own coloured menu — bounded by how many
 * services one professional offers.
 *
 * ⚠️ Deliberately NOT filtered to `isActive: true`. A pro who retires a service
 * still has bookings for it on the calendar, and those keep the colour the pro
 * chose; filtering here would silently blank the stripe on exactly the history
 * the colour was chosen to organise.
 */
export async function loadOfferingSwatchesByServiceId(args: {
  db: OfferingSwatchReader
  professionalId: string
}): Promise<ReadonlyMap<string, string>> {
  const { db, professionalId } = args

  const rows = await db.professionalServiceOffering.findMany({
    where: {
      professionalId,
      calendarSwatch: { not: null },
    },
    select: { serviceId: true, calendarSwatch: true },
  })

  const map = new Map<string, string>()

  for (const row of rows) {
    if (row.calendarSwatch) {
      map.set(row.serviceId, row.calendarSwatch)
    }
  }

  return map
}

/**
 * Resolve one booking's service swatch, using K7's chain.
 *
 * The `categorySwatch` step of that chain is passed `null` on purpose: a
 * category default has no home in the schema. `ServiceCategory` is a
 * PLATFORM-owned table (admin-managed, shared across every pro), so a default
 * living there would be an admin colour, not the pro's — and there is no
 * surface to set one. K7 left the input caller-supplied precisely so this
 * decision could be made here rather than baked into the resolver.
 */
export function resolveBookingServiceSwatch(
  booking: SwatchBookingRow,
  swatchByServiceId: ReadonlyMap<string, string>,
): CalendarSwatchId | null {
  return resolveCalendarSwatch({
    serviceItems: booking.serviceItems.map((item) => ({
      isBase: item.itemType === BookingServiceItemType.BASE,
      sortOrder: item.sortOrder ?? 0,
      offeringSwatch: item.offering?.calendarSwatch ?? null,
    })),
    // The booking's own offering link first, then the pro's offering for the
    // booking's service. Both are "the pro's offering for this booking" — the
    // first by FK, the second by lookup for the rows where that FK is null —
    // so together they are ONE step of K7's chain, not two.
    //
    // 🔴 `parseCalendarSwatch` here, not a bare `??`: these two sources are
    // collapsed with `??`, and `??` only falls through on null/undefined. A
    // non-null but out-of-palette value (a legacy id, a hex someone smuggled
    // in) would otherwise WIN this step and then resolve to nothing inside the
    // resolver — blanking a colour the fallback could have supplied. Narrowing
    // first restores the fall-through rule the chain is built on.
    bookingOfferingSwatch:
      parseCalendarSwatch(booking.offering?.calendarSwatch) ??
      swatchByServiceId.get(booking.serviceId) ??
      null,
    categorySwatch: null,
  })
}
