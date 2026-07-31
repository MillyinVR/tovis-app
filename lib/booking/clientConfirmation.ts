// lib/booking/clientConfirmation.ts
//
// THE canonical client-confirmation display state (K11, decision D3) — whether
// the CLIENT has said they're coming, derived in ONE place and rendered by the
// pro calendar card (corner glyph), the pro bookings list and the booking
// detail header (and consumed verbatim by iOS over the wire in K13 — the
// device renders `label`/`description`, it never recomputes them).
//
// This is the OPPOSITE direction from BookingStatus.PENDING, which tracks the
// PRO's acceptance. 🔴 It is deliberately NOT a BookingStatus value: that enum
// sits in the GIST overlap predicate, closeout, refunds and every
// write-boundary guard, and a client failing to confirm must never free the
// slot (an AWAITING_CLIENT or DECLINED booking still occupies its time until
// the pro acts — cancelling stays a human decision, decision D5).
//
// 🔴 Wording: B10 made bare "Confirmed" the canonical label for
// BookingStatus.ACCEPTED (lib/booking/statusLabel.ts). The attendance state
// must never reuse that word alone — D3's words are "Client confirmed" /
// "Awaiting client". A unit test pins every label here against the status
// table.
//
// The state is DERIVED from three orthogonal Booking timestamps (K12 stamps
// them; as of K11 nothing does, so every row reads NOT_REQUESTED):
//   - clientConfirmationRequestedAt — a confirmation ask went out
//   - clientConfirmedAt             — the client said yes
//   - clientConfirmationDeclinedAt  — the client said no
// If a client ever declines and later confirms (or vice versa, via separate
// requests), the LATEST answer wins; a tie breaks to confirmed, since telling
// a pro a client is coming when their most recent action says otherwise is the
// worse failure only when the timestamps genuinely disagree — equal instants
// carry no ordering, and confirmed is the answer K12's idempotent confirm
// re-stamps.

import type { Prisma } from '@prisma/client'

import type { BadgeTone } from '@/app/_components/ui'

/**
 * The exact Booking columns the state derives from. Spread this into any
 * surface's Prisma select. Deliberately ONLY the three loop timestamps — the
 * badge must never grow a dependency on BookingStatus (attendance and
 * lifecycle are orthogonal facts; putting one on the other is the disease B10
 * cured, glyph-shaped).
 */
export const CLIENT_CONFIRMATION_SELECT = {
  clientConfirmationRequestedAt: true,
  clientConfirmedAt: true,
  clientConfirmationDeclinedAt: true,
} satisfies Prisma.BookingSelect

export type ClientConfirmationBookingRow = Prisma.BookingGetPayload<{
  select: typeof CLIENT_CONFIRMATION_SELECT
}>

/**
 * The four display states (the derived axis — no DB enum exists on purpose;
 * the timestamps are the source of truth and this union is their one reading).
 */
export const CLIENT_CONFIRMATION_STATES = [
  'NOT_REQUESTED',
  'AWAITING_CLIENT',
  'CLIENT_CONFIRMED',
  'DECLINED',
] as const

export type ClientConfirmationState = (typeof CLIENT_CONFIRMATION_STATES)[number]

export type ClientConfirmationBadge = {
  kind: ClientConfirmationState
  /** The short display words ("Client confirmed") — what a pill prints. */
  label: string
  /**
   * Plain-words expansion for tooltips and accessibility labels — the calendar
   * card renders this state as a GLYPH (K7's corner channel), and a screen
   * reader must get the words, never a shape (K5's rule).
   */
  description: string
  tone: BadgeTone
  /**
   * false only for NOT_REQUESTED: a booking nobody asked a confirmation for
   * renders NOTHING anywhere — absence is the honest display, and as of K11
   * (no writers yet) that is every booking, which is exactly the ship-dark
   * default. The DECISION lives here so surfaces can't drift on it.
   */
  significant: boolean
}

/**
 * Presentation per state — one table so every surface (and the wire parser)
 * reconstructs identical badges. Tones reuse the app-wide Badge vocabulary; no
 * raw colors.
 *
 * 🔴 No label may be the bare word "Confirmed" — that is BookingStatus
 * ACCEPTED's canonical label (B10). Pinned by clientConfirmation.test.ts.
 */
const CLIENT_CONFIRMATION_PRESENTATION: Record<
  ClientConfirmationState,
  { label: string; description: string; tone: BadgeTone; significant: boolean }
> = {
  NOT_REQUESTED: {
    label: 'Not requested',
    description: 'Confirmation not requested',
    tone: 'neutral',
    significant: false,
  },
  AWAITING_CLIENT: {
    label: 'Awaiting client',
    description: 'Awaiting client confirmation',
    tone: 'pending',
    significant: true,
  },
  CLIENT_CONFIRMED: {
    label: 'Client confirmed',
    description: 'Client confirmed this appointment',
    tone: 'success',
    significant: true,
  },
  DECLINED: {
    label: 'Declined',
    description: 'Client declined this appointment',
    tone: 'danger',
    significant: true,
  },
}

function badgeOf(kind: ClientConfirmationState): ClientConfirmationBadge {
  return { kind, ...CLIENT_CONFIRMATION_PRESENTATION[kind] }
}

/**
 * Timestamps → state. An answer (confirmed/declined) counts even without a
 * requestedAt — if a row ever carries a client's answer with no recorded ask,
 * hiding the answer would be the lie, not the missing request.
 */
export function deriveClientConfirmationState(
  row: ClientConfirmationBookingRow,
): ClientConfirmationState {
  const confirmed = row.clientConfirmedAt
  const declined = row.clientConfirmationDeclinedAt

  if (confirmed && declined) {
    // Latest answer wins; a tie breaks to confirmed (see the module comment).
    return declined.getTime() > confirmed.getTime()
      ? 'DECLINED'
      : 'CLIENT_CONFIRMED'
  }
  if (confirmed) return 'CLIENT_CONFIRMED'
  if (declined) return 'DECLINED'
  if (row.clientConfirmationRequestedAt) return 'AWAITING_CLIENT'
  return 'NOT_REQUESTED'
}

/** READ-time mapping: booking row → badge. */
export function deriveClientConfirmationBadge(
  row: ClientConfirmationBookingRow,
): ClientConfirmationBadge {
  return badgeOf(deriveClientConfirmationState(row))
}

function isClientConfirmationState(
  value: unknown,
): value is ClientConfirmationState {
  return (
    typeof value === 'string' &&
    (CLIENT_CONFIRMATION_STATES as readonly string[]).includes(value)
  )
}

/**
 * Normalize a badge that arrived over the wire (the calendar client re-parses
 * its JSON defensively). The kind must be known; everything else is then
 * reconstructed from the canonical table — like the K5 relationship mark,
 * nothing here is a server-formatted amount, so nothing is trusted as sent and
 * the presentation cannot drift with the payload. An absent or malformed value
 * yields null → the card renders no glyph, never a made-up attendance state.
 */
export function parseClientConfirmationBadgeWire(
  value: unknown,
): ClientConfirmationBadge | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (!isClientConfirmationState(record.kind)) return null

  return badgeOf(record.kind)
}
