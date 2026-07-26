// lib/booking/statusLabel.ts
//
// THE canonical presentation of a BookingStatus — the one label and the one
// tone every surface renders, on both platforms (B10).
//
// Before this was canonical the same state was spelled six ways: "Accepted"
// here, "Confirmed" in the lifecycle view-model, "No show" on the calendar,
// "No-show" here, and the RAW ENUM on the client's own booking detail page and
// the public booking / rebook pages, whose hand-rolled maps had no IN_PROGRESS
// or NO_SHOW arm at all. A client with a live session read "IN_PROGRESS".
//
// Two rules keep it that way:
//   1. `BOOKING_STATUS_LABELS` is a `Record<BookingStatus, string>`, so a new
//      status is a TYPE ERROR here rather than a raw enum leaking to a screen.
//   2. `labelForBookingStatus` never returns the raw value — an unrecognized
//      wire string is humanized, so the worst case is odd wording, never
//      SCREAMING_SNAKE_CASE in front of a user.
//
// iOS mirrors this table in TovisKit `BookingStatusPresentation`; the two are
// tied together by the pro-bookings contract fixture (that list's `statusLabel`
// is computed HERE and sent over the wire).
import { BookingStatus } from '@prisma/client'

import type { BadgeTone } from '@/app/_components/ui'

/**
 * The word for each lifecycle state, sentence case.
 *
 * ACCEPTED reads "Confirmed" (Tori's call, 2026-07-26): it is the word the
 * client is already promised in `COPY.bookings.status.messages.pending.body`
 * ("You'll see it move to Confirmed once accepted"), and it names the state
 * rather than the pro's verb, so one word serves both viewers.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: 'Pending',
  [BookingStatus.ACCEPTED]: 'Confirmed',
  [BookingStatus.IN_PROGRESS]: 'In progress',
  [BookingStatus.COMPLETED]: 'Completed',
  [BookingStatus.CANCELLED]: 'Cancelled',
  [BookingStatus.NO_SHOW]: 'No-show',
}

function normalizeStatus(status: unknown): string {
  return typeof status === 'string' ? status.trim().toUpperCase() : ''
}

function isBookingStatus(value: string): value is BookingStatus {
  return Object.prototype.hasOwnProperty.call(BOOKING_STATUS_LABELS, value)
}

/**
 * Sentence-case an unrecognized wire value ("SOMETHING_ELSE" → "Something
 * else") so no surface can print an enum. Deliberately NOT title case — the
 * canonical labels above are sentence case, and a fallback that shouted
 * "Something Else" would still read as machine output.
 */
function humanizeUnknownStatus(normalized: string): string {
  const words = normalized.toLowerCase().split('_').filter(Boolean)
  const [first, ...rest] = words
  if (!first) return ''
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

export function labelForBookingStatus(status: string): string {
  const normalized = normalizeStatus(status)
  if (isBookingStatus(normalized)) return BOOKING_STATUS_LABELS[normalized]
  return humanizeUnknownStatus(normalized)
}

/**
 * Canonical Badge tone for a booking status pill. Centralized so status chips
 * stay consistent across the pro bookings list and the client Appointments list.
 */
export function badgeToneForBookingStatus(status: string): BadgeTone {
  switch (normalizeStatus(status)) {
    case BookingStatus.ACCEPTED:
    case BookingStatus.IN_PROGRESS:
      return 'accent'
    case BookingStatus.COMPLETED:
      return 'success'
    case BookingStatus.CANCELLED:
    case BookingStatus.NO_SHOW:
      return 'danger'
    case BookingStatus.PENDING:
      return 'pending'
    default:
      return 'neutral'
  }
}

/**
 * The four-way alert/pill variant used by the client booking detail page,
 * derived from the Badge tone above rather than re-branching on status — a
 * third hand-written status map is how NO_SHOW ended up rendering in the
 * "info" tone on the one page a client reads it.
 */
export type BookingStatusVariant = 'danger' | 'success' | 'warn' | 'info'

export function variantForBookingStatus(status: string): BookingStatusVariant {
  switch (badgeToneForBookingStatus(status)) {
    case 'danger':
      return 'danger'
    case 'success':
      return 'success'
    case 'pending':
      return 'warn'
    default:
      return 'info'
  }
}
