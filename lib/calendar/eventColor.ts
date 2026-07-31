// lib/calendar/eventColor.ts
//
// The calendar's colour CHANNEL allocation, and the one place a booking's
// service swatch is resolved (K7).
//
// ── The channel budget ───────────────────────────────────────────────────────
// Four things want colour on one event card — status, service, location and
// (from K11) client confirmation. Four hues on one card is unreadable, so each
// meaning owns exactly ONE channel:
//
//   card fill + border  → booking STATUS      (app/pro/calendar/_utils/statusStyles.ts)
//   4px accent stripe   → SERVICE swatch      (this file)
//   text chips          → location (K3) · relationship (K5) · payment (K1)
//                         · unsigned consent (K15)
//   corner glyph        → client confirmation (K11, decision D3 — ✓ / ?, never a fill)
//
// 🔴 Anything new must CLAIM a channel or be refused. B5 added an eighth status
// tone without anyone asking whether there was room; this table is that budget.
//
// K15 claims a TEXT CHIP, not a colour and not a second warning glyph. The
// glyph channel is spoken for (K11), and the conflict triangle already owns the
// "something is wrong here" shape — a second triangle would make both of them
// mean "one of two things". A word needs no legend to decode and survives being
// read by a colour-blind pro (the K3 LocationChip reasoning). It is the FIFTH
// chip a card can carry, so its render is width-checked, not assumed: K13 found
// on iOS that a fourth pill wrapped the row inside words.
//
// ── Why a resolver at all ────────────────────────────────────────────────────
// The swatch lives on `ProfessionalServiceOffering` (the pro↔service join), NOT
// on `Service` — that is a global catalog row with `name @unique`, shared by
// every pro on the platform, so no pro can own a column there. Getting from a
// booking to "the pro's colour for this service" is therefore a chain, not a
// lookup, because `Booking.offeringId` is NULLABLE and a booking can hold many
// services through `BookingServiceItem`.
//
// K7 ships the palette, the channel allocation and this resolver with no source
// of stored swatches — `ProfessionalServiceOffering.calendarSwatch` and the
// picker are K8, and until they exist every booking resolves to `null`
// (neutral) and the stripe keeps its status tone, unchanged.
import type { CalendarSwatchId } from '@/lib/brand/types'

export type { CalendarSwatchId }

/** Every swatch id, in picker order. Derived from nothing else — this IS the list. */
export const CALENDAR_SWATCH_IDS: readonly CalendarSwatchId[] = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
]

/**
 * Narrow an unknown value (a `String?` column, a wire field) to a swatch id.
 *
 * Anything else — a legacy value, a hex a migration smuggled in, an id from a
 * palette that has since shrunk — resolves to `null`, i.e. neutral. A colour
 * the stylesheet does not define must degrade to "no colour", never to a broken
 * `data-swatch` attribute the CSS silently ignores while the code believes it
 * painted something.
 */
export function parseCalendarSwatch(value: unknown): CalendarSwatchId | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()

  // `find` over the twelve, not `Set.has`: a Set lookup cannot NARROW the type,
  // and narrowing without a cast is the whole job here (house rule: no `as`).
  return CALENDAR_SWATCH_IDS.find((id) => id === trimmed) ?? null
}

/** One booking line item, as far as colour is concerned. */
export type CalendarSwatchServiceItem = {
  /**
   * `BookingServiceItemType.BASE` — the service the appointment IS, as opposed
   * to an `ADD_ON` bolted onto it. The base item wins the colour: an add-on
   * gloss must not repaint a colour appointment.
   */
  isBase: boolean
  /** `sortOrder` on the row, so "the base item" is deterministic when there are several. */
  sortOrder: number
  /** The pro's swatch for THIS item's offering, if the item has one. */
  offeringSwatch?: string | null
}

export type CalendarSwatchInput = {
  /** `Booking.serviceItems`, in any order. */
  serviceItems?: readonly CalendarSwatchServiceItem[] | null
  /**
   * The pro's offering for `Booking.serviceId` — the booking-level fallback for
   * rows with no service items, or whose items carry no offering.
   */
  bookingOfferingSwatch?: string | null
  /**
   * The default for the service's CATEGORY. Supplied by the caller rather than
   * derived here: `ServiceCategory` is a table, not an enum, so where a category
   * default comes from is a data decision (K8), not a colour one.
   */
  categorySwatch?: string | null
}

/**
 * Resolve the swatch for one booking, in the documented order:
 *
 *   BASE service item's offering swatch
 *     → the pro's offering for `Booking.serviceId`
 *     → the service category default
 *     → null (neutral — the stripe keeps its status tone)
 *
 * Each step is skipped when it holds no *valid* swatch, so a stale value at one
 * level falls through to the next instead of blanking the chain.
 */
export function resolveCalendarSwatch(
  input: CalendarSwatchInput,
): CalendarSwatchId | null {
  const items = input.serviceItems ?? []

  // A booking can hold several BASE items (two services in one visit). The
  // lowest sortOrder is the one the card already names first, so the stripe
  // agrees with the title rather than picking a different service's colour.
  const baseSwatch = [...items]
    .filter((item) => item.isBase)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => parseCalendarSwatch(item.offeringSwatch))
    .find((swatch) => swatch !== null)

  return (
    baseSwatch ??
    parseCalendarSwatch(input.bookingOfferingSwatch) ??
    parseCalendarSwatch(input.categorySwatch) ??
    null
  )
}
