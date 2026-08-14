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

  return normalizeNote(offering?.prepNote) ?? normalizeNote(professional?.prepNote)
}

/** An all-whitespace note is not a note — treat it as absent, not as a blank card. */
function normalizeNote(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
