import { BookingStatus, type Prisma, type PrismaClient } from '@prisma/client'

/**
 * Appointment prep — the pro's "Before you go" checklist and the note that sits
 * beside it, resolved for one booking.
 *
 * Two scopes, one table (see `ProPrepItem` in schema.prisma):
 *   · `offeringId = null` — the pro's DEFAULT list.
 *   · `offeringId` set    — that service's OWN list.
 *
 * 🔴 The offering's list REPLACES the default; it does not extend it. Merging
 * would leave a pro unable to remove a default row for a single service —
 * "arrive with clean dry hair" is right for a balayage and wrong for a brow
 * shape, and the only way to say so is for the brow list to stand alone.
 */

export type ResolvedPrepItem = {
  id: string
  text: string
  sortOrder: number
}

export type ResolvedPrep = {
  items: ResolvedPrepItem[]
  /** Which scope the rows came from — surfaced so the pro editor can say so. */
  source: 'OFFERING' | 'PROFESSIONAL' | 'NONE'
  /** The offering's note if it has one, else the pro's default, else null. */
  note: string | null
}

type PrepItemRow = {
  id: string
  text: string
  sortOrder: number
  offeringId: string | null
}

/**
 * Booking states in which a client may still tick a prep row.
 *
 * Ticking is a statement about getting ready, so it stops making sense the
 * moment the appointment cannot happen or has already happened. A terminal
 * booking refuses rather than silently writing a row nobody will read.
 */
const PREP_WRITABLE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
]

export function isPrepWritableStatus(status: BookingStatus): boolean {
  return PREP_WRITABLE_STATUSES.includes(status)
}

/**
 * Pick the rows that apply, given every active row for a pro.
 *
 * Exported separately from the query so callers that already hold the rows
 * (the pro editor, a batch loader) reuse the same rule rather than
 * re-implementing the override.
 */
export function selectPrepItemsForOffering(
  rows: readonly PrepItemRow[],
  offeringId: string | null,
): { items: ResolvedPrepItem[]; source: ResolvedPrep['source'] } {
  const own = offeringId
    ? rows.filter((row) => row.offeringId === offeringId)
    : []

  if (own.length > 0) {
    return { items: own.map(toResolved), source: 'OFFERING' }
  }

  const fallback = rows.filter((row) => row.offeringId === null)
  return {
    items: fallback.map(toResolved),
    source: fallback.length > 0 ? 'PROFESSIONAL' : 'NONE',
  }
}

function toResolved(row: PrepItemRow): ResolvedPrepItem {
  return { id: row.id, text: row.text, sortOrder: row.sortOrder }
}

/**
 * Resolve the checklist + note for one booking's (professional, offering) pair.
 *
 * `offeringId` is nullable because a booking need not have one (a pro-created
 * booking against a bare service). That case simply falls through to the pro's
 * default list, which is the correct behaviour rather than an empty screen.
 */
export async function resolvePrepForBooking(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    professionalId: string
    offeringId: string | null
  },
): Promise<ResolvedPrep> {
  const [rows, note] = await Promise.all([
    db.proPrepItem.findMany({
      where: {
        professionalId: input.professionalId,
        isActive: true,
        // Only the two scopes that can apply to THIS booking — never another
        // service's list.
        OR: [
          { offeringId: null },
          ...(input.offeringId ? [{ offeringId: input.offeringId }] : []),
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, text: true, sortOrder: true, offeringId: true },
    }),
    resolvePrepNote(db, input),
  ])

  const { items, source } = selectPrepItemsForOffering(rows, input.offeringId)
  return { items, source, note }
}

async function resolvePrepNote(
  db: PrismaClient | Prisma.TransactionClient,
  input: { professionalId: string; offeringId: string | null },
): Promise<string | null> {
  const [offering, professional] = await Promise.all([
    input.offeringId
      ? db.professionalServiceOffering.findUnique({
          where: { id: input.offeringId },
          select: { prepNote: true },
        })
      : Promise.resolve(null),
    db.professionalProfile.findUnique({
      where: { id: input.professionalId },
      select: { prepNote: true },
    }),
  ])

  return pickPrepNote(offering?.prepNote, professional?.prepNote)
}

/**
 * The note rule: the offering's own note wins, else the pro's default, else
 * none. Exported shape-free so the batch resolver below applies the SAME rule
 * rather than re-deriving it from its own rows.
 */
export function pickPrepNote(
  offeringNote: string | null | undefined,
  professionalNote: string | null | undefined,
): string | null {
  return normalizeNote(offeringNote) ?? normalizeNote(professionalNote)
}

/**
 * One booking's identity, as the batch resolver needs it.
 *
 * The two notes come in RATHER THAN being queried here. Both hang off relations
 * the caller is already loading (`booking.professional.prepNote` and
 * `booking.offering.prepNote`), so taking them as inputs costs zero queries —
 * and it keeps this module from enumerating ProfessionalProfile rows, which
 * `check:tenant-aware-discovery` rightly refuses outside a discovery surface
 * that composes the tenant visibility helpers.
 *
 * ⚠️ That guard is a SUBSTRING match, so even naming the call pattern in a
 * comment here trips it. Describe the shape, don't spell it.
 */
export type PrepBookingRef = {
  bookingId: string
  professionalId: string
  offeringId: string | null
  /** `booking.offering.prepNote` — wins when set. */
  offeringPrepNote?: string | null
  /** `booking.professional.prepNote` — the pro's default. */
  professionalPrepNote?: string | null
}

/**
 * The narrow slice of the Prisma client `resolvePrepForBookings` actually
 * reads — ONE `findMany`, and nothing else.
 *
 * Declared STRUCTURALLY rather than as `PrismaClient` so a test can hand it a
 * one-method stub without a type escape, and so a second query cannot be added
 * here without widening this type on purpose. `PrismaClient` and a transaction
 * client both satisfy it.
 */
export type PrepBatchReader = {
  proPrepItem: {
    findMany(args: {
      where: Prisma.ProPrepItemWhereInput
      orderBy: Prisma.ProPrepItemOrderByWithRelationInput[]
      select: {
        id: true
        text: true
        sortOrder: true
        offeringId: true
        professionalId: true
      }
    }): Promise<
      {
        id: string
        text: string
        sortOrder: number
        offeringId: string | null
        professionalId: string
      }[]
    >
  }
}

/**
 * Resolve the checklist + note for MANY bookings in a fixed number of queries.
 *
 * The single-booking resolver above is ~4 queries; the client's bookings list
 * carries up to 300 rows, and calling it per booking would turn one page load
 * into a thousand round trips. This batches by (pro, offering) and then applies
 * the exact same two rules — `selectPrepItemsForOffering` and `pickPrepNote` —
 * so the batched answer cannot drift from the single one.
 *
 * Returns a map keyed by `bookingId`; a booking whose pro has no rows at all
 * still gets an entry (empty items, source NONE), so a caller never has to
 * distinguish "not loaded" from "nothing to prep".
 */
export async function resolvePrepForBookings(
  db: PrepBatchReader,
  bookings: readonly PrepBookingRef[],
): Promise<Map<string, ResolvedPrep>> {
  const byBooking = new Map<string, ResolvedPrep>()
  if (bookings.length === 0) return byBooking

  const professionalIds = Array.from(
    new Set(bookings.map((b) => b.professionalId)),
  )
  const offeringIds = Array.from(
    new Set(
      bookings
        .map((b) => b.offeringId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )

  const rows = await db.proPrepItem.findMany({
    where: {
      professionalId: { in: professionalIds },
      isActive: true,
      // Only the scopes that can apply to one of THESE bookings — never
      // another service's list.
      OR: [
        { offeringId: null },
        ...(offeringIds.length > 0 ? [{ offeringId: { in: offeringIds } }] : []),
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      text: true,
      sortOrder: true,
      offeringId: true,
      professionalId: true,
    },
  })

  const rowsByPro = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = rowsByPro.get(row.professionalId)
    if (list) list.push(row)
    else rowsByPro.set(row.professionalId, [row])
  }

  for (const booking of bookings) {
    const { items, source } = selectPrepItemsForOffering(
      rowsByPro.get(booking.professionalId) ?? [],
      booking.offeringId,
    )

    byBooking.set(booking.bookingId, {
      items,
      source,
      // Same rule as the single-booking resolver, applied to notes the caller
      // already had in hand.
      note: pickPrepNote(
        booking.offeringId ? booking.offeringPrepNote : null,
        booking.professionalPrepNote,
      ),
    })
  }

  return byBooking
}

/** An all-whitespace note is not a note — treat it as absent, not as a blank card. */
function normalizeNote(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
