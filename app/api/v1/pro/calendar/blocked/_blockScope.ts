// app/api/v1/pro/calendar/blocked/_blockScope.ts
//
// What a calendar block's LOCATION SCOPE means to the two write paths.
//
// `CalendarBlock.locationId` is nullable and the schema states the contract:
// "null = blocks all locations (rare, but useful)". Every read path already
// implements it — `buildCalendarBlockConflictWhere` folds a null-location block
// into a location-scoped conflict query, `buildCalendarBlockWindowWhere` does the
// same for busy intervals, and the pro calendar feed ORs it in — so an unscoped
// block conflicts everywhere and renders on every location's grid.
//
// The two write paths need one thing the readers don't: a `defaultBufferMinutes`
// for the hold-conflict check. There is exactly one location to read that from
// when the block names a location, and NONE when it doesn't. Both routes resolve
// it here so they cannot drift apart — a promise sized from one rule and a commit
// sized from another is how availability starts offering what the write refuses.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { bufferOrZero } from '@/lib/booking/conflicts'

type DbClient = Prisma.TransactionClient | typeof prisma

/**
 * Which write is asking. The two modes differ on purpose, along one axis:
 *
 * - `create` AUTHORIZES a new block. The location it names must be one of this
 *   pro's bookable locations, and an unscoped block still requires the pro to
 *   have at least one — otherwise a pro with no locations at all could reserve
 *   time "everywhere".
 * - `edit` must NEVER STRAND. The block already exists and already occupies the
 *   pro's time, so the location it points at may since have been archived
 *   (`isBookable: false`) or hard-deleted (`onDelete: SetNull` → `locationId:
 *   null`). Refusing the edit in either case is what left blocks permanently
 *   uneditable, with delete-and-recreate as the pro's only escape.
 */
export type BlockScopeMode = 'create' | 'edit'

export type BlockScopeResolution =
  | {
      ok: true
      /**
       * The `defaultBufferMinutes` the conflict gate should use for this block.
       *
       * Feeds ONE thing: `hasHoldConflict`'s fallback for a hold that carries no
       * buffer of its own. Every `BookingHold` has a required `locationId` (and
       * so a location to read `bufferMinutes` from), which makes this value
       * unreachable in practice today — it is resolved correctly anyway because
       * the fallback exists for rows that predate the snapshot columns, and a
       * silently wrong buffer there would under-reserve rather than fail loudly.
       */
      defaultBufferMinutes: number
    }
  | {
      ok: false
      code: 'BLOCK_LOCATION_NOT_FOUND' | 'NO_BOOKABLE_LOCATION'
    }

/**
 * The buffer an UNSCOPED block uses: the MAX `bufferMinutes` across the pro's
 * bookable locations.
 *
 * A global block is the pro's time everywhere, so the honest reading of "which
 * location's buffer?" is "all of them" — and of the answers that gives, the
 * largest is the only one that cannot UNDER-reserve. Zero was the other
 * defensible choice; it was rejected because a block is the one write whose
 * whole purpose is to take time off the market, and erring small there hands a
 * slot back that the pro said they did not have.
 *
 * Returns null when the pro has no bookable location at all — the caller decides
 * whether that refuses (create) or simply means no buffer (edit).
 */
async function maxBookableBufferMinutes(args: {
  db: DbClient
  professionalId: string
}): Promise<number | null> {
  // `isBookable: true` alone, matching the location lookup a scoped create
  // already does (and every other server-side "bookable location" read): the
  // archive path sets `isBookable: false`, so archived rows are already out.
  const aggregate = await args.db.professionalLocation.aggregate({
    where: {
      professionalId: args.professionalId,
      isBookable: true,
    },
    _count: { _all: true },
    _max: { bufferMinutes: true },
  })

  if (aggregate._count._all < 1) return null

  return bufferOrZero(aggregate._max.bufferMinutes)
}

export async function resolveBlockScope(args: {
  tx?: DbClient
  professionalId: string
  locationId: string | null
  mode: BlockScopeMode
}): Promise<BlockScopeResolution> {
  const { professionalId, locationId, mode } = args
  const db = args.tx ?? prisma

  if (locationId) {
    const location = await db.professionalLocation.findFirst({
      where: {
        id: locationId,
        professionalId,
        // An EDIT deliberately drops this: a block at a location the pro has
        // since archived or made unbookable still needs to be movable.
        ...(mode === 'create' ? { isBookable: true } : {}),
      },
      select: { bufferMinutes: true },
    })

    if (!location) {
      return { ok: false, code: 'BLOCK_LOCATION_NOT_FOUND' }
    }

    return {
      ok: true,
      defaultBufferMinutes: bufferOrZero(location.bufferMinutes),
    }
  }

  const maxBuffer = await maxBookableBufferMinutes({ db, professionalId })

  if (maxBuffer === null) {
    // Create: the existence guard that stands in for "this location is yours and
    // bookable" when no location is named. Edit: never refuse — see BlockScopeMode.
    return mode === 'create'
      ? { ok: false, code: 'NO_BOOKABLE_LOCATION' }
      : { ok: true, defaultBufferMinutes: 0 }
  }

  return { ok: true, defaultBufferMinutes: maxBuffer }
}
