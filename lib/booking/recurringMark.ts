// lib/booking/recurringMark.ts
//
// K19-C / K20 — "this appointment repeats", as ONE derivation.
//
// K19 refused to put a recurring marker on the calendar tile, and was right to:
// K7's channel budget is spoken for (fill/border = status, stripe = service,
// text chips = location / relationship / payment / consent, corner glyph =
// client confirmation, triangle = overlap), so a new mark has to CLAIM a
// channel, and doing that on web alone would have left the phone without it.
// K20 does iOS parity anyway, so the call lands here.
//
// ## 🔴 The channel call: the TIME ROW, beside the location chip.
//
// Not a sixth chip in the top row. That row already carries up to five marks
// and is where a card runs out of width first — on the phone the last chip
// renders off-tile, and only driving the device shows it
// ([[web-row-order-is-not-phone-priority-order]]). Adding the least urgent fact
// to the most contended row is the wrong trade in both directions.
//
// Not a glyph in the corner: that channel is K11's confirmation family, and the
// conflict triangle already owns "something is wrong". A repeat mark is neither.
//
// The bottom row — "when, and where" — is the uncontended one: it holds the time
// and, only for a multi-location pro, one location chip. And "this repeats" is a
// fact of exactly that family: it is about the appointment's PLACEMENT, not its
// state, its money or its risk. It sits where it belongs rather than where there
// happened to be room.
//
// ## No `significant` gate, unlike the badge helpers next door
//
// `paymentBadge`, `relationshipBadge`, `clientConfirmation` and
// `consentRequirement` all carry one, because each can be true-but-not-worth-
// saying (a settled bill, an UNKNOWN import, a warning about an appointment that
// already happened). Recurrence is not a warning that goes stale: an occurrence
// that has been and gone was still part of a standing appointment, and saying so
// on a completed tile costs nothing and misleads nobody. A gate here would be
// ceremony copied from a helper that needed it.

/**
 * The recurring mark for one booking. Absent (null) for every booking that is
 * not part of a series, which is all of them until a pro creates one.
 */
export type RecurringMark = {
  seriesId: string
  /**
   * 1-based for humans. `Booking.seriesOccurrenceIndex` is 0-based and stays
   * that way everywhere it is a KEY (the unique constraint, the cancel scope,
   * the exception rows); this is the only place it becomes an ordinal, because
   * "appointment 0 of 12" is not a thing anyone says.
   */
  occurrenceNumber: number
  /**
   * Plain words for the accessible name and the iOS label. The mark itself is a
   * shape; screen readers do not get shapes (K5's rule), and iOS renders this
   * verbatim rather than rebuilding the sentence (K6's rule).
   */
  description: string
}

/** The only columns the mark reads. */
export const RECURRING_MARK_SELECT = {
  seriesId: true,
  seriesOccurrenceIndex: true,
} as const

export function deriveRecurringMark(booking: {
  seriesId: string | null
  seriesOccurrenceIndex: number | null
}): RecurringMark | null {
  const { seriesId, seriesOccurrenceIndex } = booking
  if (!seriesId) return null

  // The column pair is written together by the materializer, so a series
  // booking always has both. A row with an id and no index is not a shape this
  // should invent an ordinal for — it drops to the series without a number
  // rather than claiming to be appointment 1.
  const occurrenceNumber =
    seriesOccurrenceIndex != null && seriesOccurrenceIndex >= 0
      ? seriesOccurrenceIndex + 1
      : 0

  return {
    seriesId,
    occurrenceNumber,
    description: occurrenceNumber
      ? `Repeating appointment ${occurrenceNumber}`
      : 'Repeating appointment',
  }
}

/**
 * Read the mark back off the wire, the way every other calendar badge is read:
 * a malformed value drops the mark rather than rendering an invented one. The
 * seriesId is the load-bearing field — without it there is nothing to link to,
 * so a record missing it is not a partial mark, it is not a mark.
 */
export function parseRecurringMarkWire(value: unknown): RecurringMark | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>

  const seriesId =
    typeof record.seriesId === 'string' && record.seriesId.trim()
      ? record.seriesId.trim()
      : null
  if (!seriesId) return null

  const rawNumber = record.occurrenceNumber
  const occurrenceNumber =
    typeof rawNumber === 'number' &&
    Number.isInteger(rawNumber) &&
    rawNumber > 0
      ? rawNumber
      : 0

  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : occurrenceNumber
        ? `Repeating appointment ${occurrenceNumber}`
        : 'Repeating appointment'

  return { seriesId, occurrenceNumber, description }
}
