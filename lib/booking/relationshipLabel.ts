// lib/booking/relationshipLabel.ts
//
// THE canonical NR / NNR / RR / RNR client-relationship mark (K5, decision D1)
// — the classic salon-book shorthand for "did this client ask for me, and have
// I seen them before?", derived in ONE place and rendered by the pro calendar
// card, the pro bookings list and the client chart (and consumed verbatim by
// iOS over the wire — the device renders `label`/`description`, it never
// recomputes them).
//
// Two axes, both of which already exist and are NOT re-derived here:
//   - request vs discovery → BookingSource (REQUESTED | DISCOVERY), a
//     server-validated trust boundary (lib/booking/resolveDiscoveryFinalize) —
//     never taken from client input.
//   - new vs return → the pro↔client established-booking history, the same
//     count the discovery fee uses (lib/booking/discoveryFee.ts), including its
//     refund-reset nuance.
//
// 🔴 SNAPSHOT semantics: deriveClientRelationshipLabel runs at WRITE time only,
// inside the booking write boundary, and the result is stamped onto
// Booking.clientRelationshipLabel — exactly the pattern discoveryProvenance
// follows. Read surfaces map the STORED value to a badge and nothing else. If
// the label were derived at read time, a client's third booking would
// retroactively rewrite their first booking's label from NR to RR, and the
// historical NR count — the number that says whether marketing works — would
// silently drift every time anyone rebooks.
//
// UNKNOWN is a first-class value, not an error: imported rows, pro-created
// rows and legacy history are never guessed (BookingSource defaults to
// DISCOVERY, which was never a real signal for those paths — a pro importing a
// book of loyal regulars must not open the app to a wall of NNR).

import { BookingSource, ClientRelationshipLabel } from '@/lib/prismaEnums'
import type { Prisma } from '@prisma/client'

import type { BadgeTone } from '@/app/_components/ui'

/**
 * The exact Booking columns the badge derives from. Spread this into any
 * surface's Prisma select. Deliberately ONLY the snapshot column — the badge
 * must never grow a dependency on live history (that would be read-time
 * derivation by the back door).
 */
export const RELATIONSHIP_BADGE_SELECT = {
  clientRelationshipLabel: true,
} satisfies Prisma.BookingSelect

export type RelationshipBadgeBookingRow = Prisma.BookingGetPayload<{
  select: typeof RELATIONSHIP_BADGE_SELECT
}>

/** Every mark, derived from the Prisma enum — the schema is the SSOT. */
export const CLIENT_RELATIONSHIP_LABELS = Object.values(
  ClientRelationshipLabel,
) as readonly ClientRelationshipLabel[]

export type RelationshipBadge = {
  kind: ClientRelationshipLabel
  /** The salon-book mark itself ("NR") — what the chip prints. */
  label: string
  /**
   * Plain-words expansion ("New client · requested you") for tooltips and
   * accessibility labels — the marks are shorthand and screen readers should
   * not spell out bare letters.
   */
  description: string
  tone: BadgeTone
  /**
   * false only for UNKNOWN: an unclassified row renders NO chip anywhere —
   * absence is the honest display for "nobody recorded this", and a wall of
   * "Unknown" on imported history is noise. The DECISION lives here so
   * surfaces can't drift on it.
   */
  significant: boolean
}

/**
 * Presentation per mark — one table so every surface (and the wire parser)
 * reconstructs identical badges. Tones reuse the app-wide Badge vocabulary;
 * no raw colors. NR gets the accent — a brand-new client who asked for this
 * pro by name is the mark that says marketing works.
 */
const RELATIONSHIP_BADGE_PRESENTATION: Record<
  ClientRelationshipLabel,
  { label: string; description: string; tone: BadgeTone; significant: boolean }
> = {
  UNKNOWN: {
    label: 'Unknown',
    description: 'Not classified',
    tone: 'neutral',
    significant: false,
  },
  NR: {
    label: 'NR',
    description: 'New client · requested you',
    tone: 'accent',
    significant: true,
  },
  NNR: {
    label: 'NNR',
    description: 'New client · via discovery',
    tone: 'info',
    significant: true,
  },
  RR: {
    label: 'RR',
    description: 'Returning client · requested you',
    tone: 'neutral',
    significant: true,
  },
  RNR: {
    label: 'RNR',
    description: 'Returning client · via discovery',
    tone: 'info',
    significant: true,
  },
}

function badgeOf(kind: ClientRelationshipLabel): RelationshipBadge {
  return { kind, ...RELATIONSHIP_BADGE_PRESENTATION[kind] }
}

/**
 * THE new-vs-returning axis, on its own.
 *
 * Extracted because a second pro-facing surface now needs the same answer
 * without the request-vs-discovery half: the live-hold decision (B5 follow-up)
 * tells the pro whether the client mid-checkout is new to THEM, and must say
 * nothing about how that client found them — the four-mark label would leak
 * exactly that. One predicate, so the popup and the chip cannot drift on where
 * the line between new and returning falls.
 *
 * The COUNT must be the canonical pair-history one
 * (`lib/booking/establishedBookingCount.ts`); this only decides what to do with
 * it.
 */
export function isReturningClient(establishedBookingCount: number): boolean {
  return establishedBookingCount > 0
}

/**
 * WRITE-time derivation — call this ONLY from the booking write boundary (and
 * the finalize resolver that feeds it), never from a read surface.
 *
 * `establishedBookingCount` must be the canonical pair-history count the
 * discovery fee already computes (lib/booking/resolveDiscoveryFinalize) — do
 * not re-count with different where-terms, or the label and the fee would
 * disagree about whether a client is "new".
 */
export function deriveClientRelationshipLabel(args: {
  source: BookingSource
  establishedBookingCount: number
  /**
   * True for bookings the PRO created (dashboard create, waitlist-offer and
   * consultation materialization ride the same path). Those carry
   * source=DISCOVERY only because the column defaults there — it was never a
   * real signal, so the honest mark is UNKNOWN, not NNR.
   */
  proCreated: boolean
}): ClientRelationshipLabel {
  if (args.proCreated) return ClientRelationshipLabel.UNKNOWN
  if (args.source === BookingSource.IMPORTED) {
    return ClientRelationshipLabel.UNKNOWN
  }

  // An aftercare rebook is definitionally both axes at once: it rebooks a
  // completed booking with this pro (returning) via a link that names this pro
  // (request) — no history count needed.
  if (args.source === BookingSource.AFTERCARE) return ClientRelationshipLabel.RR

  const returning = isReturningClient(args.establishedBookingCount)

  if (args.source === BookingSource.REQUESTED) {
    return returning ? ClientRelationshipLabel.RR : ClientRelationshipLabel.NR
  }

  return returning ? ClientRelationshipLabel.RNR : ClientRelationshipLabel.NNR
}

/**
 * READ-time mapping: stored snapshot → badge. Takes ONLY the booking row's
 * snapshot column by design — see the module comment for why it must never
 * look at live history.
 */
export function deriveRelationshipBadge(
  row: RelationshipBadgeBookingRow,
): RelationshipBadge {
  return badgeOf(row.clientRelationshipLabel)
}

function isClientRelationshipLabel(
  value: unknown,
): value is ClientRelationshipLabel {
  return (
    typeof value === 'string' &&
    (CLIENT_RELATIONSHIP_LABELS as readonly string[]).includes(value)
  )
}

/**
 * Normalize a badge that arrived over the wire (the calendar client re-parses
 * its JSON defensively). The kind must be known; everything else is then
 * reconstructed from the canonical table — unlike the payment badge there is
 * no server-formatted amount to preserve, so nothing is trusted as sent and
 * the presentation cannot drift with the payload.
 */
export function parseRelationshipBadgeWire(
  value: unknown,
): RelationshipBadge | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (!isClientRelationshipLabel(record.kind)) return null

  return badgeOf(record.kind)
}
