// lib/consult/inChairFinalization.ts
//
// Book the Look, slice B6 — IN-CHAIR FINALIZATION
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 8).
//
// "During the session the pro adjusts prices per their recommendation and sends
// the consultation for client approval; that approved number is the final price
// — no checkout surprise."
//
// Two pure pieces live here, and nothing else. Pure on purpose: the pro's page,
// the client's approval screen and the API twin all have to agree about the
// same numbers, and the only way three surfaces agree is if none of them does
// the arithmetic itself.
//
// 🔴 THE NOTICE TYPE CROSSES TO THE BROWSER; THIS MODULE DOES NOT. Both client
// approval surfaces render a `ConsultRevisionNotice`, but they `import type` it
// — erased at build, which is why `check:no-client-prisma-import` counts this
// module as server-only and `check:client-safe-enum-scope` therefore requires
// the REAL enum below rather than the browser copy. If a client component ever
// takes a VALUE from this file, both of those guards flip and the fix is the
// import chain, not the enum: `@prisma/client`'s browser build is 121 KB of
// column-name maps ([[prisma-client-leaked-into-client-bundles]]).
//
// Every figure below is integer CENTS regardless, and the only money import is
// `lib/money`, whose Prisma import is type-only — so the DTO itself stays
// cheap to hand to a browser.
//
// ── 1. THE SEED ──────────────────────────────────────────────────────────────
// The pro does NOT retype what she already typed. B5 (#1046) wrote her real
// price and duration per line onto `ConsultServiceEstimateLine.proFinal*`;
// `buildInChairConsultationItems` turns exactly those numbers into the line
// items the existing in-chair consultation form opens with. A second place a
// pro types a price is a second answer about money.
//
// 🔴 Why this is load-bearing rather than a convenience. A look-anchored
// booking is finalized with ONE BookingServiceItem — the FLOOR offering at the
// floor's own price (lib/booking/writeBoundary.ts, which says so in a comment
// and names this slice). The beyond-floor lines the client was actually shown
// live ONLY on the `ConsultBookingProposal`. So without this seed the pro's
// in-chair form opens on a single service, and the whole look the client
// committed to at 3 AM silently collapses to its cheapest line.
//
// ── 2. THE REVISION NOTICE ───────────────────────────────────────────────────
// Settled by Tori 2026-08-31, closing the hole B5 wrote down and left open
// ("the revision-notice threshold is an OPEN Tori decision", B5 rule 4): a
// correction that raises the price by MORE than ~10%, or lengthens the
// appointment by 30 minutes or more, is a BIG change — the client is told and
// offered a way out. Anything smaller stays quiet, exactly as B5 shipped.
//
// The thresholds below are product knobs with names, not magic numbers, and
// they are compared against what the CLIENT COMMITTED TO — the proposal's own
// `startingAtPrice` and `totalDurationMinutes` — never against the estimate's
// salon column, which is a different mode's answer to a different question.

import type { ConsultProposalReviewDTO } from '@/lib/dto/consult'
import { asInt, asTrimmedString, isArray, isRecord } from '@/lib/guards'
import { moneyToCentsInt, normalizeMoney2 } from '@/lib/money'
import { BookingServiceItemType } from '@prisma/client'

// Type-only, so this module pulls in none of the client component it names.
import type { ConsultationInitialItem } from '@/app/pro/bookings/[id]/ConsultationForm'

/**
 * A price rise of MORE than this fraction of what the client committed to is a
 * big change. Strictly greater: a correction that lands exactly on the line is
 * not past it.
 */
export const CONSULT_REVISION_PRICE_INCREASE_RATIO = 0.1

/**
 * An appointment that grows by this many minutes OR MORE is a big change. At
 * or above, not past: decision 11 — "a price miss is corrected in the chair, a
 * duration miss breaks the pro's day" — so the duration side is deliberately
 * the less forgiving of the two.
 */
export const CONSULT_REVISION_DURATION_INCREASE_MINUTES = 30

export type ConsultRevisionReason = 'PRICE' | 'DURATION'

export type ConsultRevisionNotice = {
  /** True when at least one threshold is crossed. The only gate a caller needs. */
  bigChange: boolean
  /** Every threshold this correction crossed, in a stable order. */
  reasons: ConsultRevisionReason[]
  /** What the client committed to, in cents. */
  committedPriceCents: number
  /** What the pro's recorded numbers now come to, in cents. */
  finalPriceCents: number
  /** The rise, in cents. Zero when the correction did not raise the price. */
  priceIncreaseCents: number
  /**
   * The rise as a fraction of the committed price, or null when it cannot be
   * expressed as one — a zero committed price has no percentage.
   */
  priceIncreaseRatio: number | null
  committedDurationMinutes: number
  finalDurationMinutes: number
  /** The growth in minutes, floored at zero. */
  durationIncreaseMinutes: number
}

/**
 * Judge one correction against what the client agreed to. Pure and total.
 *
 * Only INCREASES count. A pro who corrects a price DOWN or shortens the
 * appointment has not moved anything the client needs a way out of, and
 * notifying her about it would train her to ignore the notice that matters.
 *
 * ⚠️ The zero case is deliberate, not an oversight: a committed price of zero
 * has no meaningful percentage — and nothing in the database constrains an
 * offering's price column to be positive
 * ([[an-offering-price-column-can-be-zero-or-negative]]) — so any rise off it
 * counts as big and `priceIncreaseRatio` stays null rather than being reported
 * as Infinity. A client shown $0 and then charged $60 has certainly had her
 * price moved.
 */
export function deriveConsultRevisionNotice(args: {
  committedPriceCents: number
  committedDurationMinutes: number
  finalPriceCents: number
  finalDurationMinutes: number
}): ConsultRevisionNotice {
  const priceIncreaseCents = Math.max(
    0,
    args.finalPriceCents - args.committedPriceCents,
  )
  const hasBaseline = args.committedPriceCents > 0

  const priceIncreaseRatio =
    priceIncreaseCents > 0 && hasBaseline
      ? priceIncreaseCents / args.committedPriceCents
      : null

  const pricePastThreshold =
    priceIncreaseCents > 0 &&
    (!hasBaseline ||
      (priceIncreaseRatio !== null &&
        priceIncreaseRatio > CONSULT_REVISION_PRICE_INCREASE_RATIO))

  const durationIncreaseMinutes = Math.max(
    0,
    args.finalDurationMinutes - args.committedDurationMinutes,
  )
  const durationPastThreshold =
    durationIncreaseMinutes >= CONSULT_REVISION_DURATION_INCREASE_MINUTES

  const reasons: ConsultRevisionReason[] = []
  if (pricePastThreshold) reasons.push('PRICE')
  if (durationPastThreshold) reasons.push('DURATION')

  return {
    bigChange: reasons.length > 0,
    reasons,
    committedPriceCents: args.committedPriceCents,
    finalPriceCents: args.finalPriceCents,
    priceIncreaseCents,
    priceIncreaseRatio,
    committedDurationMinutes: args.committedDurationMinutes,
    finalDurationMinutes: args.finalDurationMinutes,
    durationIncreaseMinutes,
  }
}

/**
 * The same judgement, asked of a whole review DTO.
 *
 * Returns null in the two states where there is nothing to judge, and callers
 * must treat null as "no notice" rather than "no big change" — a comparison
 * nobody could make must never render as a reassuring sentence:
 *
 *   • the pro has recorded no correction at all (B5 leaves both pro-final
 *     totals null in that case), or
 *   • a money string did not parse, which cannot happen from the DTO's own
 *     server-composed figures but is refused rather than defaulted to zero.
 */
export function deriveConsultRevisionNoticeFromReview(
  review: ConsultProposalReviewDTO,
): ConsultRevisionNotice | null {
  if (
    review.proFinalTotalPrice === null ||
    review.proFinalTotalDurationMinutes === null
  ) {
    return null
  }

  const committedPriceCents = moneyToCentsInt(review.startingAtPrice)
  const finalPriceCents = moneyToCentsInt(review.proFinalTotalPrice)
  if (committedPriceCents === null || finalPriceCents === null) return null

  return deriveConsultRevisionNotice({
    committedPriceCents,
    committedDurationMinutes: review.totalDurationMinutes,
    finalPriceCents,
    finalDurationMinutes: review.proFinalTotalDurationMinutes,
  })
}

/**
 * The pro's in-chair consultation form, opened on the numbers she already gave.
 *
 * Every proposal line becomes a co-equal BASE item: each one carries its own
 * `offeringId` (the proposal line stores it, B4), and the consultation route
 * has accepted several co-equal BASE services since well before this slice
 * ("a booking carries one or more co-equal BASE services (e.g. cut + color)").
 * Nothing here is an ADD_ON — an add-on is something the client chose on top,
 * and none of these were.
 *
 * ⚠️ `notes` is deliberately left EMPTY rather than seeded from `proFinalNote`.
 * B5's note is the pro's own private flag about a line ("may need a second
 * session"), written on a surface that promises her the client is not told. The
 * consultation form's per-line notes go TO the client on the approval screen.
 * Carrying one into the other would publish a private sentence she wrote under
 * the opposite promise.
 */
export function buildInChairConsultationItems(
  review: ConsultProposalReviewDTO,
): ConsultationInitialItem[] {
  return review.lines.map((line, index) => ({
    key: line.estimateLineId,
    // These lines come from the PROPOSAL, not from the booking's own service
    // items — a look-anchored booking has exactly one of those and it is the
    // floor. Claiming a booking-item id they do not have would be a lie the
    // proposal route validates against anyway.
    bookingServiceItemId: null,
    serviceId: line.serviceId,
    offeringId: line.offeringId,
    itemType: BookingServiceItemType.BASE,
    label: line.serviceName,
    categoryName: null,
    // Her correction where she has made one, and what the client was sold
    // where she has not. Never the estimate's salon figure (B5, rule 3).
    price: line.proFinalPrice ?? line.proposedPrice,
    durationMinutes: String(
      line.proFinalDurationMinutes ?? line.proposedDurationMinutes,
    ),
    notes: '',
    sortOrder: index,
    source: 'PROPOSAL',
  }))
}

/**
 * The total the form opens with: her own recorded total once she has recorded
 * one, and the figure the client agreed to before that. Same rule as the lines,
 * kept here so the page cannot answer it differently.
 */
export function inChairConsultationInitialPrice(
  review: ConsultProposalReviewDTO,
): string {
  return review.proFinalTotalPrice ?? review.startingAtPrice
}

/**
 * The line items of a consultation proposal the pro has ALREADY sent, read back
 * off `ConsultationApproval.proposedServicesJson`.
 *
 * Why this exists at all. Before B6 the in-chair form always re-opened on
 * `Booking.serviceItems`, which the approval only rewrites once the client
 * APPROVES — so between sending a proposal and its approval, the pro's own
 * screen showed her the booking's old lines while quoting the sent proposal's
 * TOTAL beside them (`initialPrice` has always preferred
 * `consultationApproval.proposedTotal`). Harmless enough when the two were the
 * same services; not harmless once B6 seeds the form from a look, because a
 * reload would then throw her sent numbers away and re-seed from the consult.
 *
 * The shape is not guessed: it is exactly what `buildProposalJson` in
 * app/api/v1/pro/bookings/[id]/consultation-proposal/route.ts writes. Every
 * field is still narrowed, and one unusable row refuses the WHOLE seed — a
 * half-read proposal is worse than falling back to the booking, because the
 * missing half is a service somebody agreed to pay for.
 */
export function buildConsultationItemsFromProposalJson(
  value: unknown,
): ConsultationInitialItem[] | null {
  if (!isRecord(value) || !isArray(value.items) || value.items.length === 0) {
    return null
  }

  const items: ConsultationInitialItem[] = []

  for (const [index, entry] of value.items.entries()) {
    if (!isRecord(entry)) return null

    const serviceId = asTrimmedString(entry.serviceId)
    const price = typeof entry.price === 'string' ? normalizeMoney2(entry.price) : null
    const durationMinutes = asInt(entry.durationMinutes)

    if (!serviceId || price === null || durationMinutes === null) return null
    if (durationMinutes <= 0) return null

    const offeringId = asTrimmedString(entry.offeringId)
    const itemType =
      entry.itemType === BookingServiceItemType.ADD_ON
        ? BookingServiceItemType.ADD_ON
        : BookingServiceItemType.BASE

    // A BASE line with no offering cannot be re-sent — the proposal route
    // refuses it — so refusing the seed here puts the pro back on a form she
    // can actually submit rather than one that 400s when she presses send.
    if (itemType === BookingServiceItemType.BASE && !offeringId) return null

    const sortOrder = asInt(entry.sortOrder) ?? index

    items.push({
      key: `sent:${index}`,
      bookingServiceItemId: asTrimmedString(entry.bookingServiceItemId),
      serviceId,
      offeringId,
      itemType,
      label: asTrimmedString(entry.label) ?? 'Service',
      categoryName: asTrimmedString(entry.categoryName),
      price,
      durationMinutes: String(durationMinutes),
      notes: asTrimmedString(entry.notes) ?? '',
      sortOrder,
      source: entry.source === 'BOOKING' ? 'BOOKING' : 'PROPOSAL',
    })
  }

  return items
}
