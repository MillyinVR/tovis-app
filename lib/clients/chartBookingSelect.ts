// The client chart's booking-history row shape, in ONE place.
//
// Two surfaces read the same history: the server-rendered web chart
// (app/pro/clients/[id]/page.tsx) and its native twin
// (GET /api/v1/pro/clients/[id]/chart). They were maintaining two hand-copied
// Prisma selects that had already drifted — the API's copy silently missed K5's
// `clientRelationshipLabel`, so the NR/NNR/RR/RNR mark existed on web and could
// not exist on device. A shared select is the fix AND the guard: a column added
// for one surface can no longer be absent from the other by omission.
//
// Both surfaces additionally feed `computeRelationshipIntelligence`, which is
// why `createdAt` (lead time = scheduledFor − createdAt), `finishedAt` and the
// money columns are here rather than at either call site.

import { BookingStatus, type Prisma } from '@prisma/client'

import { RELATIONSHIP_BADGE_SELECT } from '@/lib/booking/relationshipLabel'
import { pickBool, pickString } from '@/lib/pick'

export const CHART_BOOKING_SELECT = {
  id: true,
  status: true,
  // Relationship-badge input: only the K5 snapshot column, by design — the mark
  // is a per-booking SNAPSHOT and must never grow a dependency on live history.
  ...RELATIONSHIP_BADGE_SELECT,
  scheduledFor: true,
  locationTimeZone: true,
  createdAt: true,
  finishedAt: true,
  totalDurationMinutes: true,
  totalAmount: true,
  subtotalSnapshot: true,
  professionalId: true,
  service: {
    select: {
      name: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  },
  professional: {
    select: {
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: names the PRO on a history row ("with Ana R."); plaintext-by-schema, and the fallback when businessName is unset
      lastName: true, // pii-plaintext-read-ok: names the PRO on a history row ("with Ana R."); plaintext-by-schema, and the fallback when businessName is unset
    },
  },
  aftercareSummary: {
    select: {
      notes: true,
    },
  },
} satisfies Prisma.BookingSelect

export type ChartBookingRow = Prisma.BookingGetPayload<{
  select: typeof CHART_BOOKING_SELECT
}>

// How many history rows either surface will read. It was 2000 on web and 500 on
// the API — the same chart, two different ceilings, so a client with >500 visits
// showed a SHORTER history on device than on web with no indication it had been
// truncated. One constant, so that divergence can't come back by editing one
// call site.
export const CHART_BOOKING_HISTORY_TAKE = 2000

/**
 * The chart history's optional narrowing, resolved from request input.
 *
 * Both filters were previously faked in memory on web (`bookingMatchesFilter`)
 * and did not exist at all on the API, so native could only ever render the
 * whole history. These push the same two axes down into Prisma.
 */
export type ChartBookingFilter = {
  /** Exactly one `BookingStatus`, or `null` for every status. */
  status: BookingStatus | null
  /** `true` ⇒ only the VIEWING pro's own bookings. */
  withMe: boolean
}

/** The default: no narrowing at all — what every existing caller gets. */
export const CHART_BOOKING_FILTER_NONE: ChartBookingFilter = Object.freeze({
  status: null,
  withMe: false,
})

export type ChartBookingFilterResult =
  | { ok: true; filter: ChartBookingFilter }
  | { ok: false; error: string }

/**
 * Read the filter off request input. `read` is the caller's accessor — the API
 * passes `URLSearchParams.get`, the page passes its `searchParams` reader.
 *
 * An UNRECOGNIZED status is a failure rather than a silently-ignored param: a
 * caller that asks for `COMPLTED` and is handed the whole history has been told
 * the client completed visits they never did. The API turns that into a 400;
 * the page, which has no way to answer with one, falls back to no narrowing.
 */
export function parseChartBookingFilter(
  read: (key: string) => unknown,
): ChartBookingFilterResult {
  const rawStatus = pickString(read('status'))

  let status: BookingStatus | null = null
  if (rawStatus) {
    const normalized = rawStatus.toUpperCase()
    // Prisma's enum is the source of truth — never a hand-copied list here.
    const match = Object.values(BookingStatus).find((v) => v === normalized)
    if (!match) {
      return {
        // Sliced: the echo is there to name the caller's typo, not to reflect
        // an arbitrary-length string back out of the API.
        ok: false,
        error: `Unknown booking status "${rawStatus.slice(0, 32)}".`,
      }
    }
    status = match
  }

  return { ok: true, filter: { status, withMe: pickBool(read('withMe')) === true } }
}

/** Whether this filter actually narrows anything (i.e. is worth a query). */
export function isChartBookingFilterActive(filter: ChartBookingFilter): boolean {
  return filter.status !== null || filter.withMe
}

/**
 * The history query's `where`. `clientId` is always the floor — the chart is
 * one client's — and the caller has ALREADY passed `assertProCanViewClient`, so
 * `withMe` is a narrowing convenience, never the access check.
 */
export function chartBookingWhere(args: {
  clientId: string
  proId: string
  filter: ChartBookingFilter
}): Prisma.BookingWhereInput {
  const { clientId, proId, filter } = args

  return {
    clientId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.withMe ? { professionalId: proId } : {}),
  }
}

/**
 * "Has this client no-showed before?" — the `where` behind the chart's no-show
 * count, on BOTH surfaces.
 *
 * App-wide on purpose: NO `professionalId`. The question is about the CLIENT,
 * and an answer scoped to the viewing pro would read as "never" for a client
 * who has stood up five other pros. Backed by `@@index([clientId, status])` on
 * Booking — no other index covers `status`, so this would otherwise scan a
 * regular's whole booking history.
 */
export function chartNoShowCountWhere(args: {
  clientId: string
}): Prisma.BookingWhereInput {
  return { clientId: args.clientId, status: BookingStatus.NO_SHOW }
}
