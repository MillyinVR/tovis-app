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
  // Full-size render URLs (for tap-to-open); fall back to the thumb URL.
  beforeFullUrl: string | null
  afterFullUrl: string | null
}

const EMPTY: BookingBeforeAfterThumbs = {
  beforeUrl: null,
  afterUrl: null,
  beforeFullUrl: null,
  afterFullUrl: null,
}

const beforeAfterMediaSelect = {
  id: true,
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
 * The "primary" shot per phase is the pro-chosen featured photo
 * (`AftercareSummary.featuredBeforeAssetId` / `featuredAfterAssetId`) when set,
 * otherwise the earliest one taken — matching the booking aftercare view
 * (which renders `beforeMedia[0]` / `afterMedia[0]` from an ascending-by-
 * `createdAt` list). Bookings with no before/after image are simply absent from
 * the returned map.
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

  const [rows, featuredSummaries] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: {
        bookingId: { in: ids },
        mediaType: MediaType.IMAGE,
        phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] },
      },
      // Earliest-first so the first BEFORE / first AFTER per booking is the
      // "primary" shot (consistent with the booking aftercare summary).
      orderBy: [{ bookingId: 'asc' }, { createdAt: 'asc' }],
      select: beforeAfterMediaSelect,
    }),
    // Pro-chosen featured pair per booking (one AftercareSummary per booking).
    prisma.aftercareSummary.findMany({
      where: { bookingId: { in: ids } },
      select: {
        bookingId: true,
        featuredBeforeAssetId: true,
        featuredAfterAssetId: true,
      },
    }),
  ])

  // First row per (booking, phase) wins (the earliest = default primary).
  const primaryByBookingPhase = new Map<string, BeforeAfterMediaRow>()
  const rowsById = new Map<string, BeforeAfterMediaRow>()
  for (const row of rows) {
    if (!row.bookingId) continue
    rowsById.set(row.id, row)
    const key = `${row.bookingId}:${row.phase}`
    if (primaryByBookingPhase.has(key)) continue
    primaryByBookingPhase.set(key, row)
  }

  const featuredByBooking = new Map(
    featuredSummaries.map((s) => [s.bookingId, s] as const),
  )

  // The featured photo when it's a valid same-booking, same-phase row; else the
  // earliest (pre-feature behavior). Guards against a stale/foreign id.
  const pickPrimary = (
    bookingId: string,
    phase: typeof MediaPhase.BEFORE | typeof MediaPhase.AFTER,
    featuredId: string | null | undefined,
  ): BeforeAfterMediaRow | null => {
    if (featuredId) {
      const featured = rowsById.get(featuredId)
      if (featured && featured.bookingId === bookingId && featured.phase === phase) {
        return featured
      }
    }
    return primaryByBookingPhase.get(`${bookingId}:${phase}`) ?? null
  }

  await Promise.all(
    ids.map(async (bookingId) => {
      const featured = featuredByBooking.get(bookingId)
      const before = pickPrimary(
        bookingId,
        MediaPhase.BEFORE,
        featured?.featuredBeforeAssetId,
      )
      const after = pickPrimary(
        bookingId,
        MediaPhase.AFTER,
        featured?.featuredAfterAssetId,
      )

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
      const beforeFullUrl = beforeRendered
        ? beforeRendered.renderUrl ?? beforeRendered.renderThumbUrl
        : null
      const afterFullUrl = afterRendered
        ? afterRendered.renderUrl ?? afterRendered.renderThumbUrl
        : null

      if (beforeUrl || afterUrl) {
        result.set(bookingId, { beforeUrl, afterUrl, beforeFullUrl, afterFullUrl })
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

/**
 * Reorder a single-phase media list so the pro-chosen featured asset is first —
 * the "primary" the client sees as the before/after comparison; every other
 * photo trails it as a flat thumbnail. Relative order is otherwise preserved.
 * A null / non-matching `featuredId` returns the list unchanged (falls back to
 * the existing primary = first element). Pure (no I/O).
 */
export function orderMediaByFeatured<T extends { id: string }>(
  items: T[],
  featuredId: string | null | undefined,
): T[] {
  if (!featuredId) return items
  const index = items.findIndex((item) => item.id === featuredId)
  if (index <= 0) return items
  const featured = items[index]
  if (featured === undefined) return items
  return [featured, ...items.slice(0, index), ...items.slice(index + 1)]
}

/**
 * The asset id of a booking's primary "before" photo — the earliest BEFORE-phase
 * IMAGE — for auto-pairing an "after" with its before (opt-in before/after
 * pairing). Chooses the same "primary before" that
 * {@link loadBookingBeforeAfterThumbs} would render. Returns null when the
 * booking has no before image (or only the `excludeAssetId` one, so an asset is
 * never paired with itself).
 */
export async function loadPrimaryBeforeAssetId(
  bookingId: string,
  excludeAssetId?: string,
): Promise<string | null> {
  const trimmed = typeof bookingId === 'string' ? bookingId.trim() : ''
  if (!trimmed) return null

  const before = await prisma.mediaAsset.findFirst({
    where: {
      bookingId: trimmed,
      mediaType: MediaType.IMAGE,
      phase: MediaPhase.BEFORE,
      ...(excludeAssetId ? { id: { not: excludeAssetId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  return before?.id ?? null
}
