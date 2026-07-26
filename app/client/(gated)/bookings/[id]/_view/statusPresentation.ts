// app/client/(gated)/bookings/[id]/_view/statusPresentation.ts
//
// How the client's own booking page presents a lifecycle state (B10).
//
// Lifted out of `page.tsx` so it can be tested directly — the three defects it
// carried were invisible to every existing test because they lived inline in a
// 1,700-line RSC:
//
//   1. the pill printed the RAW ENUM, uppercased ("ACCEPTED", and for the two
//      newest states "IN_PROGRESS" / "NO_SHOW"), in all three places the page
//      shows a status;
//   2. the tone map had no NO_SHOW arm, so a missed appointment was tinted
//      `info` — the FYI colour;
//   3. the message map had no IN_PROGRESS or NO_SHOW arm, so both fell to
//      "We're tracking this booking. Status updates will show here." — which on
//      a TERMINAL no-show is simply false.
import { COPY } from '@/lib/copy'
import {
  labelForBookingStatus,
  variantForBookingStatus,
  type BookingStatusVariant,
} from '@/lib/booking/statusLabel'

export type ClientStatusVariant = BookingStatusVariant | 'neutral'

export type ClientStatusMessage = {
  title: string
  body: string
  variant: ClientStatusVariant
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

/** The word in the status pill — canonical, never the enum. */
export function clientStatusPillLabel(statusRaw: unknown): string {
  const normalized = upper(statusRaw)
  if (!normalized) return COPY.bookings.status.pillUnknown
  return labelForBookingStatus(normalized)
}

/** Pill tint, derived from the canonical tone rather than re-branched here. */
export function clientStatusPillVariant(
  statusRaw: unknown,
): BookingStatusVariant {
  return variantForBookingStatus(upper(statusRaw))
}

/** The explainer banner under the header. */
export function clientStatusMessage(statusRaw: unknown): ClientStatusMessage {
  const messages = COPY.bookings.status.messages

  switch (upper(statusRaw)) {
    case 'PENDING':
      return { ...messages.pending, variant: 'warn' }
    case 'ACCEPTED':
      return { ...messages.accepted, variant: 'info' }
    case 'IN_PROGRESS':
      return { ...messages.inProgress, variant: 'info' }
    case 'COMPLETED':
      return { ...messages.completed, variant: 'success' }
    case 'CANCELLED':
      return { ...messages.cancelled, variant: 'danger' }
    case 'NO_SHOW':
      return { ...messages.noShow, variant: 'danger' }
    default:
      return { ...messages.fallback, variant: 'neutral' }
  }
}
