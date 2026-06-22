import 'server-only'

import { MediaPhase, MediaType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'

/**
 * The primary "before" and "after" photo for a booking, already resolved to
 * renderable URLs (signed for the private session bucket, public otherwise).
 *
 * This is the single source of truth for the before/after pair shown anywhere
 * that links to a client's aftercare summary (home action card, aftercare
 * inbox, …) — so those surfaces don't each re-implement the media select +
 * phase pick + URL rendering.
 */
export type BookingBeforeAfterThumbs = {
  beforeUrl: string | null
  afterUrl: string | null
}

const EMPTY: BookingBeforeAfterThumbs = { beforeUrl: null, afterUrl: null }

const beforeAfterMediaSelect = {
  bookingId: true,
  phase: true,
  createdAt: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
} satisfies Prisma.MediaAssetSelect

type BeforeAfterMediaRow = Prisma.MediaAssetGetPayload<{
  select: typeof beforeAfterMediaSelect
}>

/**
 * Resolve the primary before + after photo for each of the given bookings.
 *
 * The "primary" shot per phase is the earliest one taken, matching the booking
 * aftercare view (which renders `beforeMedia[0]` / `afterMedia[0]` from an
 * ascending-by-`createdAt` list). Bookings with no before/after image are
 * simply absent from the returned map.
 */
export async function loadBookingBeforeAfterThumbs(
  bookingIds: string[],
): Promise<Map<string, BookingBeforeAfterThumbs>> {
  const result = new Map<string, BookingBeforeAfterThumbs>()

  const ids = Array.from(
    new Set(
      bookingIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id): id is string => Boolean(id)),
    ),
  )
  if (ids.length === 0) return result

  const rows = await prisma.mediaAsset.findMany({
    where: {
      bookingId: { in: ids },
      mediaType: MediaType.IMAGE,
      phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] },
    },
    // Earliest-first so the first BEFORE / first AFTER per booking is the
    // "primary" shot (consistent with the booking aftercare summary).
    orderBy: [{ bookingId: 'asc' }, { createdAt: 'asc' }],
    select: beforeAfterMediaSelect,
  })

  // First row per (booking, phase) wins.
  const primaryByBookingPhase = new Map<string, BeforeAfterMediaRow>()
  for (const row of rows) {
    if (!row.bookingId) continue
    const key = `${row.bookingId}:${row.phase}`
    if (primaryByBookingPhase.has(key)) continue
    primaryByBookingPhase.set(key, row)
  }

  await Promise.all(
    ids.map(async (bookingId) => {
      const before =
        primaryByBookingPhase.get(`${bookingId}:${MediaPhase.BEFORE}`) ?? null
      const after =
        primaryByBookingPhase.get(`${bookingId}:${MediaPhase.AFTER}`) ?? null

      const [beforeRendered, afterRendered] = await Promise.all([
        before ? renderMediaUrls(before) : Promise.resolve(null),
        after ? renderMediaUrls(after) : Promise.resolve(null),
      ])

      const beforeUrl = beforeRendered
        ? beforeRendered.renderThumbUrl ?? beforeRendered.renderUrl
        : null
      const afterUrl = afterRendered
        ? afterRendered.renderThumbUrl ?? afterRendered.renderUrl
        : null

      if (beforeUrl || afterUrl) {
        result.set(bookingId, { beforeUrl, afterUrl })
      }
    }),
  )

  return result
}

/** Single-booking convenience over {@link loadBookingBeforeAfterThumbs}. */
export async function loadBookingBeforeAfterThumbsFor(
  bookingId: string,
): Promise<BookingBeforeAfterThumbs> {
  const map = await loadBookingBeforeAfterThumbs([bookingId])
  return map.get(bookingId) ?? EMPTY
}
