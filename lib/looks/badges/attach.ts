// lib/looks/badges/attach.ts
//
// Serve-time badge attachment for GET /api/v1/looks: batch-load every signal
// the engine needs for one page of feed rows (one bounded query per signal
// family, all in parallel), run the pure engine per look, and hand back a
// lookPostId → badge map plus the §9 serve-log counts.
//
// Cost profile per page: at most 5 queries, each bounded by the page's pro /
// look id lists — no per-row queries, no unbounded scans, and no
// pro-ENUMERATING reads (account age rides along on the feed select; the id
// lists come from an already-tenant-scoped feed query). Signals whose
// precondition is absent (no viewer coords → no location query; no client →
// no boards query) are skipped entirely, so an anonymous chronological serve
// pays three small IN-list queries (badge stats, availability, look-booked).

import { Prisma, type BoardType } from '@prisma/client'

import { boardEventDateToYmd } from '@/lib/boards/context'
import { haversineMiles } from '@/lib/discovery/nearby'
import type { LookBadgeDto } from '@/lib/looks/types'
import {
  selectLookBadge,
  type LookBadgeEngineContext,
  type ProAvailabilityBadgeSignal,
  type ProBadgeSignals,
  type ViewerEventSignal,
} from '@/lib/looks/badges/engine'

/**
 * The exact capabilities attachment needs, expressed structurally so both
 * PrismaClient and a plain test mock satisfy them without type escapes (the
 * LookCategoryRankStatReader / EmbeddingSqlDb pattern).
 */
export type LookBadgeAttachDb = {
  professionalBadgeStat: {
    findMany(args: {
      where: { professionalId: { in: string[] } }
      select: {
        professionalId: true
        recentBookingCount: true
        completedBookingCount30d: true
        servedClientCount: true
        rebookedClientCount: true
        computedAt: true
      }
    }): PromiseLike<
      Array<{
        professionalId: string
        recentBookingCount: number
        completedBookingCount30d: number
        servedClientCount: number
        rebookedClientCount: number
        computedAt: Date
      }>
    >
  }
  professionalLocation: {
    findMany(args: {
      where: {
        professionalId: { in: string[] }
        isPrimary: true
        archivedAt: null
      }
      select: { professionalId: true; lat: true; lng: true }
    }): PromiseLike<
      Array<{ professionalId: string; lat: unknown; lng: unknown }>
    >
  }
  professionalAvailabilityStat: {
    findMany(args: {
      where: { professionalId: { in: string[] } }
      select: {
        professionalId: true
        nextOpeningDate: true
        fullness14d: true
        computedAt: true
      }
    }): PromiseLike<
      Array<{
        professionalId: string
        nextOpeningDate: Date | null
        fullness14d: number
        computedAt: Date
      }>
    >
  }
  board: {
    findMany(args: {
      where: {
        clientId: string
        type: { not: BoardType }
        eventDate: { not: null }
      }
      select: { type: true; eventDate: true }
      take: number
    }): PromiseLike<Array<{ type: BoardType; eventDate: Date | null }>>
  }
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ): PromiseLike<T>
}

/**
 * The slice of a LooksFeedRow the badge engine reads (structural). The pro's
 * account age rides along on the feed select (looksFeedProProfileSelect), so
 * hydrating it never needs a pro-enumerating query here.
 */
export type LookBadgeSourceRow = {
  id: string
  professionalId: string | null
  professional: { user: { createdAt: Date } } | null
  service: { category: { slug: string } | null } | null
  tags: readonly { slug: string }[]
}

export type LookBadgeViewer = {
  userId: string | null
  clientId: string | null
  lat: number | null
  lng: number | null
}

export type LookBadgeAttachMeta = {
  /** Looks on this page that earned >=1 badge (pre-holdout). */
  eligibleCount: number
  /** Badges actually attached. */
  shownCount: number
  /** Earned badges suppressed by the §9 measurement holdout. */
  holdoutCount: number
  /** Shown badges by kind — the per-kind exposure half of the §9 metrics. */
  kindCounts: Record<string, number>
}

export type AttachLookBadgesResult = {
  badges: Map<string, LookBadgeDto | null>
  meta: LookBadgeAttachMeta
}

/** Same bounded sample the affinity loader uses for viewer boards. */
const VIEWER_EVENT_BOARD_CAP = 24

const LOOK_BOOKED_WINDOW_DAYS = 7

/** Prisma Decimal (or anything decimal-shaped) → finite number, else null. */
function coerceCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Number(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export async function attachLookBadges(args: {
  db: LookBadgeAttachDb
  rows: readonly LookBadgeSourceRow[]
  viewer: LookBadgeViewer
  brandName: string
  now: Date
}): Promise<AttachLookBadgesResult> {
  const { db, rows, viewer, brandName, now } = args

  const emptyMeta: LookBadgeAttachMeta = {
    eligibleCount: 0,
    shownCount: 0,
    holdoutCount: 0,
    kindCounts: {},
  }

  if (rows.length === 0) {
    return { badges: new Map(), meta: emptyMeta }
  }

  const lookIds = rows.map((row) => row.id)
  const professionalIds = Array.from(
    new Set(
      rows
        .map((row) => row.professionalId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )

  const hasViewerCoords =
    typeof viewer.lat === 'number' && typeof viewer.lng === 'number'

  const bookedSince = new Date(
    now.getTime() - LOOK_BOOKED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  const [statRows, locationRows, availabilityRows, boardRows, bookedRows] =
    await Promise.all([
      professionalIds.length > 0
        ? db.professionalBadgeStat.findMany({
            where: { professionalId: { in: professionalIds } },
            select: {
              professionalId: true,
              recentBookingCount: true,
              completedBookingCount30d: true,
              servedClientCount: true,
              rebookedClientCount: true,
              computedAt: true,
            },
          })
        : Promise.resolve([]),
      hasViewerCoords && professionalIds.length > 0
        ? db.professionalLocation.findMany({
            where: {
              professionalId: { in: professionalIds },
              isPrimary: true,
              archivedAt: null,
            },
            select: { professionalId: true, lat: true, lng: true },
          })
        : Promise.resolve([]),
      professionalIds.length > 0
        ? db.professionalAvailabilityStat.findMany({
            where: { professionalId: { in: professionalIds } },
            select: {
              professionalId: true,
              nextOpeningDate: true,
              fullness14d: true,
              computedAt: true,
            },
          })
        : Promise.resolve([]),
      viewer.clientId
        ? db.board.findMany({
            where: {
              clientId: viewer.clientId,
              type: { not: 'GENERAL' },
              eventDate: { not: null },
            },
            select: { type: true, eventDate: true },
            take: VIEWER_EVENT_BOARD_CAP,
          })
        : Promise.resolve([]),
      db.$queryRaw<Array<{ lookPostId: string; count: number }>>`
        SELECT
          b."sourceLookPostId" AS "lookPostId",
          COUNT(*)::int AS "count"
        FROM "Booking" b
        WHERE b."sourceLookPostId" IN (${Prisma.join(lookIds)})
          AND b."createdAt" >= ${bookedSince}
          AND b."status" <> 'CANCELLED'::"BookingStatus"
        GROUP BY b."sourceLookPostId"
      `,
    ])

  const accountCreatedAtByPro = new Map<string, Date>()
  for (const row of rows) {
    if (!row.professionalId || !row.professional) continue
    if (accountCreatedAtByPro.has(row.professionalId)) continue
    accountCreatedAtByPro.set(row.professionalId, row.professional.user.createdAt)
  }

  const distanceByPro = new Map<string, number>()
  if (hasViewerCoords && viewer.lat !== null && viewer.lng !== null) {
    for (const row of locationRows) {
      if (distanceByPro.has(row.professionalId)) continue
      const lat = coerceCoordinate(row.lat)
      const lng = coerceCoordinate(row.lng)
      if (lat === null || lng === null) continue
      const miles = haversineMiles(
        { lat: viewer.lat, lng: viewer.lng },
        { lat, lng },
      )
      if (Number.isFinite(miles)) {
        distanceByPro.set(row.professionalId, miles)
      }
    }
  }

  const availabilityByPro = new Map<string, ProAvailabilityBadgeSignal>()
  for (const row of availabilityRows) {
    if (availabilityByPro.has(row.professionalId)) continue
    availabilityByPro.set(row.professionalId, {
      nextOpeningDate: row.nextOpeningDate,
      fullness14d: row.fullness14d,
      computedAt: row.computedAt,
    })
  }

  const proSignals = new Map<string, ProBadgeSignals>()
  for (const professionalId of professionalIds) {
    const stat = statRows.find((row) => row.professionalId === professionalId)
    proSignals.set(professionalId, {
      recentBookingCount: stat?.recentBookingCount ?? 0,
      completedBookingCount30d: stat?.completedBookingCount30d ?? 0,
      servedClientCount: stat?.servedClientCount ?? 0,
      rebookedClientCount: stat?.rebookedClientCount ?? 0,
      statComputedAt: stat?.computedAt ?? null,
      accountCreatedAt: accountCreatedAtByPro.get(professionalId) ?? null,
      distanceMiles: distanceByPro.get(professionalId) ?? null,
      availability: availabilityByPro.get(professionalId) ?? null,
    })
  }

  const viewerEvents: ViewerEventSignal[] = []
  for (const board of boardRows) {
    if (!board.eventDate) continue
    viewerEvents.push({
      boardType: board.type,
      eventYmd: boardEventDateToYmd(board.eventDate),
    })
  }

  const bookedLast7dByLookId = new Map<string, number>(
    bookedRows.map((row) => [row.lookPostId, row.count]),
  )

  const engineContext: LookBadgeEngineContext = {
    viewerKey: viewer.userId ?? 'anon',
    now,
    brandName,
    viewerEvents,
    bookedLast7dByLookId,
    proSignals,
  }

  const badges = new Map<string, LookBadgeDto | null>()
  const meta: LookBadgeAttachMeta = { ...emptyMeta, kindCounts: {} }

  for (const row of rows) {
    const decision = selectLookBadge(
      {
        lookPostId: row.id,
        professionalId: row.professionalId,
        categorySlug: row.service?.category?.slug ?? null,
        tagSlugs: row.tags.map((tag) => tag.slug),
      },
      engineContext,
    )

    badges.set(row.id, decision.badge)
    if (decision.eligible) meta.eligibleCount += 1
    if (decision.holdout) meta.holdoutCount += 1
    if (decision.badge) {
      meta.shownCount += 1
      meta.kindCounts[decision.badge.kind] =
        (meta.kindCounts[decision.badge.kind] ?? 0) + 1
    }
  }

  return { badges, meta }
}
