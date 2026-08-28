// The pro chart's VISITS view: the filter axes that belong to the web page, and
// the migration off the two that no longer do.
//
// The view used to offer ONE seven-way `bookingFilter` select, applied as a JS
// pass over the already-loaded booking set. Two of those seven — "only with me"
// and a status — are now the shared `?withMe=` / `?status=` params that
// `chartBookingWhere` turns into a real Prisma `where`, so they are gone from
// here. What is left has no `chartBookingWhere` equivalent: two axes are
// relative to `now`, and the third needs the viewing pro's offering list.

import { BookingStatus, type Prisma } from '@prisma/client'

import { CHART_BOOKING_SELECT } from './chartBookingSelect'
import type { ChartBookingFilter } from './chartBookingSelect'

// The chart history rows PLUS `serviceId`, which backs the MATCHES_MY_SERVICES
// axis. The native chart doesn't offer that axis, which is why the column is
// here rather than in the shared `CHART_BOOKING_SELECT`.
export const CHART_VISIT_SELECT = {
  ...CHART_BOOKING_SELECT,
  serviceId: true,
} satisfies Prisma.BookingSelect

export type ChartVisitRow = Prisma.BookingGetPayload<{
  select: typeof CHART_VISIT_SELECT
}>

/** The axes the visits view still resolves in memory. */
export type VisitFilter = 'ALL' | 'MATCHES_MY_SERVICES' | 'UPCOMING' | 'PAST'

export const VISIT_FILTERS: readonly VisitFilter[] = [
  'ALL',
  'MATCHES_MY_SERVICES',
  'UPCOMING',
  'PAST',
]

/**
 * The statuses the visits view offers as a one-click narrowing.
 *
 * Deliberately the two the retired select already had — moving them onto
 * `?status=` is a rewiring, not a new control surface. The LABELS are not here:
 * `labelForBookingStatus` owns that copy, so a status can never be spelled one
 * way in the filter and another on the row's own pill.
 */
export const VISIT_STATUS_CHOICES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
]

export function normalizeVisitFilter(raw: unknown): VisitFilter {
  const normalized = String(raw ?? '').trim().toUpperCase()

  return VISIT_FILTERS.includes(normalized as VisitFilter)
    ? (normalized as VisitFilter)
    : 'ALL'
}

// The `bookingFilter` values that ARE a server-side param now. Kept, rather than
// dropped, because a saved `?bookingFilter=COMPLETED` link that quietly falls
// back to "all visits" hands the pro every booking under a heading that says
// completed — the same silent wrong answer `parseChartBookingFilter` refuses to
// give for a misspelled status. Each maps onto the axis that answers it now.
const RETIRED_VISIT_FILTERS: Readonly<
  Record<string, Partial<ChartBookingFilter>>
> = Object.freeze({
  WITH_ME: { withMe: true },
  COMPLETED: { status: BookingStatus.COMPLETED },
  CANCELLED: { status: BookingStatus.CANCELLED },
})

/**
 * The server-side filter a retired `bookingFilter` value means now, or `null`
 * for a value that was never retired (including one this view still handles).
 */
export function retiredVisitFilterParams(
  raw: unknown,
): Partial<ChartBookingFilter> | null {
  const normalized = String(raw ?? '').trim().toUpperCase()
  return RETIRED_VISIT_FILTERS[normalized] ?? null
}

/**
 * Merge the explicit `?status=` / `?withMe=` pair with whatever a retired
 * `bookingFilter` value asked for. The explicit params win — they are what the
 * view's own controls submit, so a stale `bookingFilter` riding along in a
 * bookmarked URL can never override the control the pro just used.
 */
export function resolveVisitChartFilter(args: {
  parsed: ChartBookingFilter
  retired: Partial<ChartBookingFilter> | null
}): ChartBookingFilter {
  const { parsed, retired } = args

  return {
    status: parsed.status ?? retired?.status ?? null,
    withMe: parsed.withMe || retired?.withMe === true,
  }
}

/**
 * The residual in-memory pass, over whatever rows the (possibly narrowed)
 * history query returned. Status and with-me are NOT here — they are real
 * Prisma `where` clauses via `chartBookingWhere`.
 */
export function visitMatchesFilter(
  booking: Pick<ChartVisitRow, 'serviceId' | 'scheduledFor'>,
  args: {
    filter: VisitFilter
    myServiceIds: string[]
    now: Date
  },
): boolean {
  const { filter, myServiceIds, now } = args

  switch (filter) {
    case 'MATCHES_MY_SERVICES':
      return myServiceIds.includes(booking.serviceId)
    case 'UPCOMING':
      return booking.scheduledFor.getTime() >= now.getTime()
    case 'PAST':
      return booking.scheduledFor.getTime() < now.getTime()
    default:
      return true
  }
}
