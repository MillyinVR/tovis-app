// lib/looks/personalizationMetrics.ts
//
// §9 personalization-epoch metrics tail — the READER/rollup consumer for the
// funnel + health signals the ranking/re-engagement work has been emitting all
// along (build step 2/§9; personalization spec §9 "instrument the funnel").
// Pure observability: it computes platform-wide metrics over EXISTING tables (no
// new writes, no migration, no cron) so an operator can see whether the
// personalization loop is actually converting saves into bookings and where it
// leaks. It is the companion to the §5.6 velocity-anomaly reader
// (lib/looks/velocityAnomaly.ts) — same admin-route + read-only-page shape.
//
// What it measures (all DB-derivable, over a trailing window unless noted):
//
//   1. save→book funnel + saved-not-booked gap — of the distinct (client, look)
//      pairs SAVED in the window, how many the same client later BOOKED (a
//      look-attributed, non-cancelled booking). The complement is the
//      saved-not-booked gap — literally the §6.8 re-engagement nudge population.
//   2. board-creation→first-booking — of the clients who created a board in the
//      window, how many then placed a booking (and the median days to it). The
//      spec's "high-intent board signal → conversion" loop.
//   3. hide-rate — window "not for me" hides over window FEED impressions (the
//      §2.2 negative-signal health check).
//   4. notification opt-out rate per trigger — per notification category, the
//      share of clients who muted every channel for it (the §8.1 re-engagement
//      "are we annoying people" guardrail). A point-in-time snapshot, not
//      windowed (a preference is current state).
//   5. platform rebook rate — of clients with ≥1 completed booking, the share
//      with ≥2 (lifetime retention; the §6.7 outcome loop's north star).
//
// NOT here (deliberately): feed-freshness % and the per-serve boosted-counts
// live only in the `logLooksFeedServe` structured serve logs
// (lib/observability/looksFeedEvents.ts, console-only — never persisted), so
// they're log-analytics, not a DB rollup. This reader recomputes everything it
// CAN from tables and leaves the ephemeral per-serve ratios to the log drain.

import {
  BookingStatus,
  LookImpressionSource,
  type NotificationEventKey,
  type PrismaClient,
} from '@prisma/client'

import {
  getNotificationCategoriesForAudience,
  type NotificationCategoryKey,
} from '@/lib/notifications/preferenceCategories'

// ---------------------------------------------------------------------------
// Tunables (exported so the tests share the exact constants).
// ---------------------------------------------------------------------------

/** Default trailing window, in whole UTC days. */
export const PERSONALIZATION_METRICS_WINDOW_DAYS = 30
/** Clamp bounds for a caller-supplied window. */
export const PERSONALIZATION_METRICS_MIN_WINDOW_DAYS = 7
export const PERSONALIZATION_METRICS_MAX_WINDOW_DAYS = 90

/**
 * Upper bound on the in-window save/board rows a single rollup will scan. This
 * is an admin, on-demand read over a founder-stage dataset; the cap is a
 * runaway backstop, and `scanCapped` flags the (currently theoretical) case so
 * a reported ratio is never silently based on a truncated scan.
 */
export const PERSONALIZATION_METRICS_SCAN_CAP = 20000

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Booking statuses that count as a real booking OUTCOME for the funnels — the
 * client committed to (or completed) an appointment. CANCELLED and NO_SHOW are
 * excluded: a cancelled/absent booking didn't convert the save. This mirrors
 * the `<> 'CANCELLED'` gate the conversion stat (§4.2) applies, plus NO_SHOW.
 */
const CONVERTING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
]

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

/** Safe ratio: 0 when the denominator is non-positive (never NaN/Infinity). */
export function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

/** Median of a numeric list; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

export type SaveToBookFunnel = {
  /** Distinct (client, look) pairs saved in the window. */
  savedPairs: number
  /** Of those, the same client later placed a look-attributed booking. */
  bookedPairs: number
  conversionRate: number
  /** savedPairs − bookedPairs — the §6.8 saved-not-booked gap. */
  notBookedPairs: number
  notBookedRate: number
  /** BoardItem rows scanned (before de-duping to distinct pairs). */
  savesScanned: number
  scanCapped: boolean
}

/**
 * Derive the save→book funnel + saved-not-booked gap from raw pair counts.
 * `bookedPairs` is clamped to `savedPairs` so a data race can never report a
 * conversion above 100% or a negative gap.
 */
export function deriveSaveToBookFunnel(input: {
  savedPairs: number
  bookedPairs: number
  savesScanned: number
  scanCapped: boolean
}): SaveToBookFunnel {
  const savedPairs = Math.max(0, Math.trunc(input.savedPairs))
  const bookedPairs = Math.min(
    savedPairs,
    Math.max(0, Math.trunc(input.bookedPairs)),
  )
  const notBookedPairs = savedPairs - bookedPairs
  return {
    savedPairs,
    bookedPairs,
    conversionRate: safeRate(bookedPairs, savedPairs),
    notBookedPairs,
    notBookedRate: safeRate(notBookedPairs, savedPairs),
    savesScanned: Math.max(0, Math.trunc(input.savesScanned)),
    scanCapped: input.scanCapped,
  }
}

export type RebookMetric = {
  /** Clients with ≥1 completed booking (lifetime). */
  bookedClients: number
  /** Of those, clients with ≥2 completed bookings. */
  repeatClients: number
  rebookRate: number
}

/** Platform rebook rate from a per-client completed-booking count list. */
export function deriveRebookMetric(
  perClientCompletedCounts: number[],
): RebookMetric {
  let bookedClients = 0
  let repeatClients = 0
  for (const raw of perClientCompletedCounts) {
    const count = Math.trunc(raw)
    if (count >= 1) bookedClients += 1
    if (count >= 2) repeatClients += 1
  }
  return {
    bookedClients,
    repeatClients,
    rebookRate: safeRate(repeatClients, bookedClients),
  }
}

export type CategoryOptOut = {
  key: NotificationCategoryKey
  label: string
  /** Clients who muted EVERY channel of EVERY event key in the category. */
  mutedClients: number
  rate: number
}

/**
 * Per-category opt-out rollup. A client counts as opted-out of a category only
 * when its muted-event-key set covers ALL of the category's client-facing event
 * keys (muting = all channels off, the same predicate the re-engagement
 * dispatcher uses). Missing preference rows = defaults = NOT opted-out, so the
 * caller passes only the muted rows and this treats absence as opted-in.
 */
export function summarizeCategoryOptOuts(input: {
  mutedByClient: Map<string, Set<NotificationEventKey>>
  categories: {
    key: NotificationCategoryKey
    label: string
    eventKeys: NotificationEventKey[]
  }[]
  totalClients: number
}): CategoryOptOut[] {
  const totalClients = Math.max(0, Math.trunc(input.totalClients))
  return input.categories.map((category) => {
    // An empty category (no client-facing keys) can't be opted out of.
    let mutedClients = 0
    if (category.eventKeys.length > 0) {
      for (const mutedKeys of input.mutedByClient.values()) {
        if (category.eventKeys.every((key) => mutedKeys.has(key))) {
          mutedClients += 1
        }
      }
    }
    return {
      key: category.key,
      label: category.label,
      mutedClients,
      rate: safeRate(mutedClients, totalClients),
    }
  })
}

// ---------------------------------------------------------------------------
// Impure reader — window scan + aggregate + derive.
// ---------------------------------------------------------------------------

export type BoardToBookingFunnel = {
  /** Boards created in the window. */
  boardsCreated: number
  /** Distinct clients who created ≥1 board in the window. */
  boardCreators: number
  /** Of those, clients who then placed a booking on/after their first board. */
  bookedAfterBoard: number
  conversionRate: number
  /** Median days from first in-window board to that first subsequent booking. */
  medianDaysToFirstBooking: number | null
  scanCapped: boolean
}

export type HideRateMetric = {
  /** "Not for me" hides in the window. */
  hides: number
  /** FEED impressions recorded in the window (the sampled denominator). */
  feedImpressions: number
  rate: number
}

export type NotificationOptOutMetric = {
  /** Denominator: all client profiles. */
  totalClients: number
  categories: CategoryOptOut[]
}

export type PersonalizationMetrics = {
  generatedAt: string
  windowDays: number
  saveToBook: SaveToBookFunnel
  boardToBooking: BoardToBookingFunnel
  hideRate: HideRateMetric
  rebook: RebookMetric
  notificationOptOut: NotificationOptOutMetric
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** UTC-midnight lower bound covering the last `windowDays` whole days. */
function windowStart(now: Date, windowDays: number): Date {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  return new Date(midnight - (windowDays - 1) * MS_PER_DAY)
}

/**
 * Compute the §9 personalization funnel + health metrics platform-wide over a
 * trailing window. Platform-operator surface — counts across ALL tenants (none
 * of these aggregates is a discovery query, so no tenant filter is required; a
 * cross-tenant look-post read would be the only thing the discovery guard cares
 * about, and this reader never does one). Deterministic in `now` (injected), so
 * it's fully testable.
 *
 * Cost: a handful of bounded aggregates + two bounded in-window scans (saves,
 * boards) whose follow-up booking reads run in one batch. Every reported ratio
 * is honest about truncation via `scanCapped`.
 */
export async function computePersonalizationMetrics(
  db: PrismaClient,
  opts: { now: Date; windowDays?: number },
): Promise<PersonalizationMetrics> {
  const windowDays = clampInt(
    opts.windowDays ?? PERSONALIZATION_METRICS_WINDOW_DAYS,
    PERSONALIZATION_METRICS_MIN_WINDOW_DAYS,
    PERSONALIZATION_METRICS_MAX_WINDOW_DAYS,
  )
  const since = windowStart(opts.now, windowDays)
  const scanTake = PERSONALIZATION_METRICS_SCAN_CAP + 1

  const [
    savedItems,
    boards,
    hides,
    impressionAgg,
    completedGroups,
    totalClients,
    mutedPrefs,
  ] = await Promise.all([
    // Saves (a save = one BoardItem); client identity is on the parent board.
    db.boardItem.findMany({
      where: { createdAt: { gte: since } },
      select: { lookPostId: true, board: { select: { clientId: true } } },
      take: scanTake,
    }),
    // Boards created in the window, for the board→booking funnel.
    db.board.findMany({
      where: { createdAt: { gte: since } },
      select: { clientId: true, createdAt: true },
      take: scanTake,
    }),
    db.lookHide.count({ where: { createdAt: { gte: since } } }),
    db.lookPostImpressionStat.aggregate({
      where: { source: LookImpressionSource.FEED, windowDate: { gte: since } },
      _sum: { count: true },
    }),
    // One row per client that has a completed booking → rebook rate.
    db.booking.groupBy({
      by: ['clientId'],
      where: { status: BookingStatus.COMPLETED },
      _count: { clientId: true },
    }),
    db.clientProfile.count(),
    // Muted rows are sparse (a row exists only when a client changed a setting);
    // absence = defaults = opted-in. All-channels-off = muted (the re-engagement
    // dispatcher's own definition — no SMS on these triggers).
    db.clientNotificationPreference.findMany({
      where: { inAppEnabled: false, emailEnabled: false, pushEnabled: false },
      select: { clientId: true, eventKey: true },
    }),
  ])

  const savesScanCapped = savedItems.length > PERSONALIZATION_METRICS_SCAN_CAP
  const boardsScanCapped = boards.length > PERSONALIZATION_METRICS_SCAN_CAP
  const savedSlice = savesScanCapped
    ? savedItems.slice(0, PERSONALIZATION_METRICS_SCAN_CAP)
    : savedItems
  const boardSlice = boardsScanCapped
    ? boards.slice(0, PERSONALIZATION_METRICS_SCAN_CAP)
    : boards

  // --- Save→book: distinct (client, look) pairs saved in the window.
  const savedPairKeys = new Set<string>()
  const savedClientIds = new Set<string>()
  const savedLookIds = new Set<string>()
  for (const item of savedSlice) {
    const clientId = item.board.clientId
    savedPairKeys.add(`${clientId}::${item.lookPostId}`)
    savedClientIds.add(clientId)
    savedLookIds.add(item.lookPostId)
  }

  // --- Board→booking: earliest in-window board-creation per client.
  const earliestBoardByClient = new Map<string, Date>()
  for (const board of boardSlice) {
    const prev = earliestBoardByClient.get(board.clientId)
    if (!prev || board.createdAt < prev) {
      earliestBoardByClient.set(board.clientId, board.createdAt)
    }
  }
  const boardCreatorIds = [...earliestBoardByClient.keys()]

  // The two follow-up booking reads depend on the scans above but not on each
  // other — run them together.
  const [attributedBookings, boardCreatorBookings] = await Promise.all([
    savedPairKeys.size > 0
      ? db.booking.findMany({
          where: {
            clientId: { in: [...savedClientIds] },
            sourceLookPostId: { in: [...savedLookIds] },
            status: { in: CONVERTING_BOOKING_STATUSES },
          },
          select: { clientId: true, sourceLookPostId: true },
        })
      : Promise.resolve([]),
    boardCreatorIds.length > 0
      ? db.booking.findMany({
          where: {
            clientId: { in: boardCreatorIds },
            status: { in: CONVERTING_BOOKING_STATUSES },
          },
          select: { clientId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ])

  // Count the distinct saved pairs that converted to a booking.
  const bookedPairKeys = new Set<string>()
  for (const booking of attributedBookings) {
    if (!booking.sourceLookPostId) continue
    const key = `${booking.clientId}::${booking.sourceLookPostId}`
    if (savedPairKeys.has(key)) bookedPairKeys.add(key)
  }

  const saveToBook = deriveSaveToBookFunnel({
    savedPairs: savedPairKeys.size,
    bookedPairs: bookedPairKeys.size,
    savesScanned: savedSlice.length,
    scanCapped: savesScanCapped,
  })

  // First booking on/after each client's first in-window board.
  const firstBookingAfterBoard = new Map<string, Date>()
  for (const booking of boardCreatorBookings) {
    const boardAt = earliestBoardByClient.get(booking.clientId)
    if (!boardAt || booking.createdAt < boardAt) continue
    const prev = firstBookingAfterBoard.get(booking.clientId)
    if (!prev || booking.createdAt < prev) {
      firstBookingAfterBoard.set(booking.clientId, booking.createdAt)
    }
  }
  const daysToBook: number[] = []
  for (const [clientId, boardAt] of earliestBoardByClient) {
    const bookedAt = firstBookingAfterBoard.get(clientId)
    if (bookedAt) {
      daysToBook.push((bookedAt.getTime() - boardAt.getTime()) / MS_PER_DAY)
    }
  }
  const boardToBooking: BoardToBookingFunnel = {
    boardsCreated: boardSlice.length,
    boardCreators: earliestBoardByClient.size,
    bookedAfterBoard: daysToBook.length,
    conversionRate: safeRate(daysToBook.length, earliestBoardByClient.size),
    medianDaysToFirstBooking: median(daysToBook),
    scanCapped: boardsScanCapped,
  }

  const feedImpressions = impressionAgg._sum.count ?? 0
  const hideRate: HideRateMetric = {
    hides,
    feedImpressions,
    rate: safeRate(hides, feedImpressions),
  }

  const rebook = deriveRebookMetric(
    completedGroups.map((group) => group._count.clientId),
  )

  // Opt-out: fold muted rows into per-client key sets, then roll up per category.
  const mutedByClient = new Map<string, Set<NotificationEventKey>>()
  for (const pref of mutedPrefs) {
    let keys = mutedByClient.get(pref.clientId)
    if (!keys) {
      keys = new Set<NotificationEventKey>()
      mutedByClient.set(pref.clientId, keys)
    }
    keys.add(pref.eventKey)
  }
  const clientCategories = getNotificationCategoriesForAudience('client').map(
    (category) => ({
      key: category.key,
      label: category.label,
      eventKeys: category.events.map((event) => event.eventKey),
    }),
  )
  const notificationOptOut: NotificationOptOutMetric = {
    totalClients,
    categories: summarizeCategoryOptOuts({
      mutedByClient,
      categories: clientCategories,
      totalClients,
    }),
  }

  return {
    generatedAt: opts.now.toISOString(),
    windowDays,
    saveToBook,
    boardToBooking,
    hideRate,
    rebook,
    notificationOptOut,
  }
}
