// lib/pro/visibilityHealth.ts
//
// Step 15 / spec §6.5 — Pro-side transparency ("why aren't I showing up").
//
// The pro dashboard answers "what happened" (creatorAnalytics.ts: views, saves,
// followers, top looks). This module answers the *other* question §6.5 names:
// "why aren't I showing up, and what do I pull?" It is a READ over signals the
// ranking engine already consumes — it instruments nothing new and it never
// changes a score.
//
// ── What is surfaced, and why only these ────────────────────────────────────
// A lever is surfaced only if it is BOTH (a) a real input to discovery today and
// (b) something the pro can actually act on. That excludes most rank terms:
//   - underbooked_pro_boost — deliberately HIDDEN. It is a fairness on-ramp that
//     pays MORE lift the fewer completed bookings a pro has, so publishing it
//     both invites gaming (throttle bookings to farm the boost) and reads as an
//     insult to the pros earning it. Anti-gaming posture matches §5.6.
//   - price_fit / proximity_fit / visual / category / occasion / follow /
//     relationship — all VIEWER-relative. They score a (viewer, look) pair, not
//     the pro, so there is no lever here: "you rank lower for people who book
//     cheaper services" is not an action, and the per-viewer detail isn't the
//     pro's to see.
// What's left is the pro-controllable set: bookability, calendar openness, look
// /tag coverage, this-look booking efficiency, and booking follow-through.
//
// ── Honesty rules (the whole point of §6.5 is trust) ────────────────────────
//  1. No weights, scores, or formulas are exposed — direction and lever only. A
//     published formula is a gaming target (§5.6); an unpublished one that the
//     pro can still act on is the trade §6.5 asks for.
//  2. UNKNOWN is a first-class status. Every aggregate here is cron-populated,
//     so "we haven't measured this yet" must never be rendered as "you did
//     something wrong". A missing/stale stat blames the cron, not the pro.
//  3. Nothing is invented to fill a gap. §6.5's third example string ("your
//     response time to consult messages is affecting your ranking") has NO
//     backing capture — no column, no aggregate — and no ranking term consumes
//     response time today. It is reported in `notMeasured` rather than faked.
//     (Same posture as PR #638 leaving feed-freshness serve-log-only.)
//
// Thresholds are reused from the shipped SSOTs (badge engine + rank weights)
// wherever one exists, so the dashboard can't drift from what ranking does.
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import {
  LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS,
  LOOK_BADGE_THRESHOLDS,
} from '@/lib/looks/badges/engine'
import { PERSONALIZED_RANK_WEIGHTS } from '@/lib/looks/personalizedRanking'
import { prisma } from '@/lib/prisma'
import { blockerCopy } from '@/lib/pro/readiness/blockerCopy'
import {
  checkProReadiness,
  type ProReadiness,
} from '@/lib/pro/readiness/proReadiness'

// ── DTOs (JSON-safe: strings / numbers / booleans only) ─────────────────────

export type ProVisibilityLeverKey =
  | 'BOOKABLE'
  | 'AVAILABILITY'
  | 'LOOK_COVERAGE'
  | 'BOOKING_CONVERSION'
  | 'RELIABILITY'

/**
 * ACTION  — discovery is actively held back and the pro can fix it now.
 * ATTENTION — a real lift is being left on the table.
 * GOOD    — this input is healthy.
 * UNKNOWN — not measured yet (cron hasn't populated, or too little data to
 *           judge). Never the pro's fault; carries no blame copy.
 */
export type ProVisibilityStatus = 'GOOD' | 'ATTENTION' | 'ACTION' | 'UNKNOWN'

/** Where the pro goes to pull this lever. */
export type ProVisibilityActionDTO = {
  label: string
  href: string
}

export type ProVisibilityLeverDTO = {
  key: ProVisibilityLeverKey
  status: ProVisibilityStatus
  /** One-line verdict, written to be readable on its own. */
  headline: string
  /** Plain-language "here's how this affects discovery" — no weights. */
  detail: string
  actions: ProVisibilityActionDTO[]
}

/** Counts behind the LOOK_COVERAGE lever, shown as a breakdown strip. */
export type ProVisibilityLookCountsDTO = {
  /** Pro-authored looks that clear every gate the pro controls. */
  feedEligibleCount: number
  /** Published but still awaiting moderation — nothing for the pro to do. */
  pendingReviewCount: number
  /** Published but not approved — actionable. */
  rejectedCount: number
  /** Never published. */
  draftCount: number
  /** Distinct non-banned tags across feed-eligible looks (match surface). */
  distinctTagCount: number
  /**
   * Distinct services represented across feed-eligible looks. Services, not
   * categories: groupBy can't traverse Service → ServiceCategory, and "you have
   * looks for 3 of your services" is the more concrete read for a pro anyway.
   * Display only — the coverage lever's status keys off looks + tags.
   */
  distinctServiceCount: number
}

export type ProVisibilityHealthDTO = {
  /** Worst lever status — drives the section header tone. */
  status: ProVisibilityStatus
  /** False = the pro is filtered out of discovery entirely; levers are moot. */
  discoverable: boolean
  /** Biggest lever first (ACTION → ATTENTION → GOOD → UNKNOWN, stable). */
  levers: ProVisibilityLeverDTO[]
  looks: ProVisibilityLookCountsDTO
  /**
   * Inputs a pro might expect to matter that discovery does NOT read today.
   * Stated plainly so the dashboard never implies coverage it doesn't have.
   */
  notMeasured: string[]
}

// ── Signals (evaluator input — Dates allowed, never serialized) ─────────────

export type ProVisibilityAvailabilitySignal = {
  nextOpeningDate: Date | null
  fullness14d: number
  computedAt: Date
}

export type ProVisibilityConversionSignal = {
  bookingCount: number
  interestCount: number
}

export type ProVisibilityReliabilitySignal = {
  resolvedBookingCount: number
  completedResolvedCount: number
}

export type ProVisibilitySignals = {
  now: Date
  readiness: ProReadiness
  /** Null = this pro has no availability row at all. */
  availability: ProVisibilityAvailabilitySignal | null
  /**
   * Whether the availability cron has produced ANY row platform-wide. Without
   * this, an unpopulated table would tell every pro "you have no openings" —
   * the exact false blame rule 2 exists to prevent. It gates no-row → UNKNOWN
   * instead of ATTENTION.
   */
  availabilityEverComputed: boolean
  looks: ProVisibilityLookCountsDTO
  /** Null = none of this pro's looks has a conversion row (no attributed booking). */
  conversion: ProVisibilityConversionSignal | null
  /** Null = no badge-stat row for this pro. */
  reliability: ProVisibilityReliabilitySignal | null
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Display heuristics for the coverage lever — NOT ranking inputs. Retrieval has
 * no "enough looks" constant to borrow: more feed-eligible looks with more
 * distinct tags simply means more chances to match a viewer's taste. These bars
 * are where the advice stops being useful, chosen to be encouraging rather than
 * punitive (a pro with 4 good looks is not failing).
 */
export const PRO_VISIBILITY_THRESHOLDS = {
  healthyLookCount: 5,
  healthyTagCount: 6,
  /**
   * Below this much lifetime interest, a booking rate is noise — stay UNKNOWN
   * rather than tell a pro their looks convert badly on a handful of views.
   */
  conversionMinInterest: 50,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

const STATUS_RANK: Record<ProVisibilityStatus, number> = {
  ACTION: 0,
  ATTENTION: 1,
  GOOD: 2,
  UNKNOWN: 3,
}

/**
 * Discovery inputs a pro will reasonably ask about that genuinely aren't wired.
 * Keep this list truthful — it is the credibility anchor for everything above
 * it. Move an entry out only when a real term starts reading the signal.
 */
const NOT_MEASURED: string[] = [
  'How fast you reply to messages. The plan calls for it, but nothing measures it yet, so it does not affect where you appear.',
  'Reviews and star ratings. They matter to clients deciding, but they are not an input to discovery ranking today.',
]

// ── Pure evaluator ──────────────────────────────────────────────────────────

/**
 * Mirrors the badge engine's day-count convention (ceil, floored at 0) so the
 * dashboard and the "Available in N days" pill can never disagree by a day.
 */
function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS))
}

function isFresh(computedAt: Date, now: Date, maxAgeMs: number): boolean {
  const age = now.getTime() - computedAt.getTime()
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs
}

function evaluateBookable(readiness: ProReadiness): ProVisibilityLeverDTO {
  if (readiness.ok) {
    return {
      key: 'BOOKABLE',
      status: 'GOOD',
      headline: 'You are live and bookable',
      detail:
        'Your profile clears every requirement to appear in discovery. Everything below is about how often you surface.',
      actions: [],
    }
  }

  return {
    key: 'BOOKABLE',
    status: 'ACTION',
    headline: 'You are not appearing in discovery yet',
    detail:
      'Discovery only shows professionals who can actually be booked, so this is the first thing to fix — until it is done, nothing else below can help.',
    actions: readiness.blockers.map((blocker) => blockerCopy(blocker)),
  }
}

function evaluateAvailability(
  signals: ProVisibilitySignals,
): ProVisibilityLeverDTO {
  const { availability, availabilityEverComputed, now } = signals
  const key = 'AVAILABILITY' as const

  // Rule 2: an empty table means the hourly refresh hasn't run — not that every
  // pro is booked solid.
  if (!availabilityEverComputed) {
    return {
      key,
      status: 'UNKNOWN',
      headline: 'Your calendar has not been measured yet',
      detail:
        'Openings are refreshed in the background every hour. Check back shortly.',
      actions: [],
    }
  }

  if (!availability) {
    return {
      key,
      status: 'ATTENTION',
      headline: 'We cannot see an opening on your calendar',
      detail:
        'Clients who could book you soon are more likely to be shown your work. Right now there is no bookable time in your next two weeks — opening even a few hours helps.',
      actions: [{ label: 'Review your working hours', href: '/pro/calendar' }],
    }
  }

  if (!isFresh(availability.computedAt, now, LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS)) {
    return {
      key,
      status: 'UNKNOWN',
      headline: 'Your calendar reading is out of date',
      detail:
        'The background refresh has not run recently, so this may not reflect your current openings.',
      actions: [],
    }
  }

  // The spec's own example string ("visibility is down because your booked-out
  // percentage is high") is true but one-sided: high fullness lowers the
  // openness lift AND earns the "Almost booked out" badge. Say both — a pro
  // told only the first half would reasonably conclude success is punished.
  if (availability.fullness14d >= LOOK_BADGE_THRESHOLDS.bookingOutMinFullness) {
    return {
      key,
      status: 'ATTENTION',
      headline: 'You are nearly booked out',
      detail:
        'Your next two weeks are almost full. That earns you an "Almost booked out" badge, but it also means you surface less to clients looking to book soon — because there is little left to book. Adding hours is the only lever here, and ignoring this is a perfectly reasonable choice when you are full.',
      actions: [{ label: 'Add more hours', href: '/pro/calendar' }],
    }
  }

  const opening = availability.nextOpeningDate
  if (opening) {
    const days = daysUntil(opening, now)
    if (days > LOOK_BADGE_THRESHOLDS.availableSoonMaxDays) {
      return {
        key,
        status: 'ATTENTION',
        headline: `Your next opening is ${days} days out`,
        detail:
          'Clients browsing to book soon see pros with nearer openings first. Freeing up something sooner lifts how often you appear.',
        actions: [{ label: 'Review your working hours', href: '/pro/calendar' }],
      }
    }

    return {
      key,
      status: 'GOOD',
      headline:
        days <= 0
          ? 'You have an opening today'
          : days === 1
            ? 'You have an opening tomorrow'
            : `You have an opening in ${days} days`,
      detail:
        'Near-term availability is working in your favour with clients looking to book soon.',
      actions: [],
    }
  }

  return {
    key,
    status: 'GOOD',
    headline: 'Your calendar has room',
    detail: 'You have bookable time in the next two weeks.',
    actions: [],
  }
}

function evaluateLookCoverage(
  looks: ProVisibilityLookCountsDTO,
): ProVisibilityLeverDTO {
  const key = 'LOOK_COVERAGE' as const

  if (looks.feedEligibleCount === 0 && looks.rejectedCount > 0) {
    return {
      key,
      status: 'ACTION',
      headline:
        looks.rejectedCount === 1
          ? 'Your look was not approved'
          : 'None of your looks were approved',
      detail:
        'Looks that do not pass review never reach the feed. Reviewing what was flagged and re-posting is the fastest way back into discovery.',
      actions: [{ label: 'Review your looks', href: '/pro/media' }],
    }
  }

  if (looks.feedEligibleCount === 0) {
    return {
      key,
      status: 'ACTION',
      headline: 'You have no looks in the feed',
      detail:
        'Looks are how clients find you when they are not searching for you by name. With none published, you can only be found by people already looking for you.',
      actions: [{ label: 'Publish a look', href: '/pro/media/new' }],
    }
  }

  // The spec's second example: "Add more Looks to widen your tag matches."
  const thinLooks =
    looks.feedEligibleCount < PRO_VISIBILITY_THRESHOLDS.healthyLookCount
  const thinTags = looks.distinctTagCount < PRO_VISIBILITY_THRESHOLDS.healthyTagCount

  if (thinLooks || thinTags) {
    return {
      key,
      status: 'ATTENTION',
      headline: thinLooks
        ? 'Adding looks would widen your reach'
        : 'Your looks match a narrow set of searches',
      detail:
        'Clients reach your work through the tags and services on your looks. Each new look — especially in a service or style you have not covered yet — is another way to be found.',
      actions: [{ label: 'Publish a look', href: '/pro/media/new' }],
    }
  }

  return {
    key,
    status: 'GOOD',
    headline: 'Your looks cover a healthy range',
    detail:
      'You have enough published work, across enough tags, to match a wide set of clients.',
    actions: [],
  }
}

function evaluateBookingConversion(
  conversion: ProVisibilityConversionSignal | null,
): ProVisibilityLeverDTO {
  const key = 'BOOKING_CONVERSION' as const

  if (
    !conversion ||
    conversion.interestCount < PRO_VISIBILITY_THRESHOLDS.conversionMinInterest
  ) {
    return {
      key,
      status: 'UNKNOWN',
      headline: 'Not enough views to judge yet',
      detail:
        'Once your looks have been seen a bit more, this will show how often they turn into bookings.',
      actions: [],
    }
  }

  const rate = conversion.bookingCount / conversion.interestCount

  if (conversion.bookingCount === 0) {
    return {
      key,
      status: 'ATTENTION',
      headline: 'Your looks draw interest but no bookings yet',
      detail:
        'People are seeing and saving your work without booking it. Looks that turn into bookings are shown more, so it is worth checking that the service behind each look is bookable and priced as you expect.',
      actions: [{ label: 'Check your services', href: '/pro/services' }],
    }
  }

  if (rate < PERSONALIZED_RANK_WEIGHTS.conversionTargetRate) {
    return {
      key,
      status: 'ATTENTION',
      headline: 'Your looks convert below average',
      detail:
        'Your work gets attention, but fewer viewers book it than is typical. Looks that fill chairs are shown more — making sure each look points at a bookable, clearly priced service is the lever.',
      actions: [{ label: 'Check your services', href: '/pro/services' }],
    }
  }

  return {
    key,
    status: 'GOOD',
    headline: 'Your looks turn into bookings',
    detail:
      'Viewers book your work at a healthy rate, which helps it surface more.',
    actions: [],
  }
}

function evaluateReliability(
  reliability: ProVisibilityReliabilitySignal | null,
): ProVisibilityLeverDTO {
  const key = 'RELIABILITY' as const

  // Ranking gates this term on resolvedBookingCount > 0 — no bookings means no
  // evidence, NOT a penalty. Mirror that exactly: never imply a new pro is
  // being marked down for having no history.
  if (!reliability || reliability.resolvedBookingCount <= 0) {
    return {
      key,
      status: 'UNKNOWN',
      headline: 'No completed bookings to measure yet',
      detail:
        'Once you have finished a few appointments, this will show how your follow-through is affecting discovery. Having no history here does not count against you.',
      actions: [],
    }
  }

  const rate =
    reliability.completedResolvedCount / reliability.resolvedBookingCount

  if (rate < PERSONALIZED_RANK_WEIGHTS.reliabilityFloorRate) {
    return {
      key,
      status: 'ACTION',
      headline: 'Cancelled bookings are holding you back',
      detail:
        'A noticeable share of your recent booked appointments were cancelled rather than completed, which reduces how often you are shown. Client no-shows are not counted against you here — only cancellations.',
      actions: [{ label: 'Review your bookings', href: '/pro/bookings' }],
    }
  }

  return {
    key,
    status: 'GOOD',
    headline: 'You see your bookings through',
    detail:
      'Your appointments reliably get completed, which works in your favour.',
    actions: [],
  }
}

function overallStatus(
  levers: readonly ProVisibilityLeverDTO[],
): ProVisibilityStatus {
  if (levers.some((lever) => lever.status === 'ACTION')) return 'ACTION'
  if (levers.some((lever) => lever.status === 'ATTENTION')) return 'ATTENTION'
  if (levers.some((lever) => lever.status === 'GOOD')) return 'GOOD'
  return 'UNKNOWN'
}

/**
 * Pure §6.5 evaluation: signals → ranked levers. All of the interesting
 * decisions live here so they are unit-testable without a database.
 *
 * When the pro is not bookable at all, the other levers are still evaluated but
 * BOOKABLE sorts first (it is the only ACTION that matters) — the rest are
 * context for once it's fixed.
 */
export function evaluateProVisibilityHealth(
  signals: ProVisibilitySignals,
): ProVisibilityHealthDTO {
  const levers: ProVisibilityLeverDTO[] = [
    evaluateBookable(signals.readiness),
    evaluateAvailability(signals),
    evaluateLookCoverage(signals.looks),
    evaluateBookingConversion(signals.conversion),
    evaluateReliability(signals.reliability),
  ]

  // Biggest lever first. Array.prototype.sort is stable, so equal statuses keep
  // their declaration order (bookability → calendar → looks → conversion →
  // reliability), which reads as a natural funnel.
  const ranked = [...levers].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
  )

  return {
    status: overallStatus(ranked),
    discoverable: signals.readiness.ok,
    levers: ranked,
    looks: signals.looks,
    notMeasured: [...NOT_MEASURED],
  }
}

// ── Prisma orchestrator ─────────────────────────────────────────────────────

/**
 * The pro's own pro-authored looks that clear every gate the PRO controls:
 * published, approved, publicly visible, not removed. Deliberately NOT
 * buildLooksFeedWhere — that is the viewer-side discovery query (tenant scope +
 * pro verification status + feed kind), and the gates it adds are already owned
 * by the BOOKABLE lever. This is the owner-side self-audit of the same look.
 */
function buildFeedEligibleLooksWhere(
  professionalId: string,
): Prisma.LookPostWhereInput {
  return {
    professionalId,
    clientAuthorId: null,
    removedAt: null,
    status: LookPostStatus.PUBLISHED,
    moderationStatus: ModerationStatus.APPROVED,
    visibility: LookPostVisibility.PUBLIC,
    publishedAt: { not: null },
  }
}

/**
 * Reads every §6.5 signal for one pro and evaluates it.
 *
 * Query notes: all look-side reads are counts / groupBys / aggregates scoped to
 * this pro's own id, so none of them is a discovery surface and
 * check:tenant-aware-discovery stays green without a tenant helper (same shape
 * as PR #638's metrics rollup). Tag breadth is counted from the tag side, which
 * is both guard-free and the only way to get a DISTINCT tag count in one query.
 */
export async function loadProVisibilityHealth(args: {
  professionalId: string
  now: Date
}): Promise<ProVisibilityHealthDTO> {
  const { professionalId, now } = args
  const feedEligibleWhere = buildFeedEligibleLooksWhere(professionalId)
  const ownLooks = { professionalId, clientAuthorId: null, removedAt: null }

  const [
    readiness,
    availabilityRow,
    availabilityProbe,
    badgeRow,
    feedEligibleCount,
    pendingReviewCount,
    rejectedCount,
    draftCount,
    distinctTagCount,
    serviceGroups,
    conversionAgg,
  ] = await Promise.all([
    checkProReadiness(professionalId),
    prisma.professionalAvailabilityStat.findUnique({
      where: { professionalId },
      select: { nextOpeningDate: true, fullness14d: true, computedAt: true },
    }),
    // Existence probe (LIMIT 1, no ordering): has the hourly refresh ever
    // produced anything at all? Distinguishes "no openings" from "never ran".
    prisma.professionalAvailabilityStat.findFirst({
      select: { professionalId: true },
    }),
    prisma.professionalBadgeStat.findUnique({
      where: { professionalId },
      select: { resolvedBookingCount: true, completedResolvedCount: true },
    }),
    prisma.lookPost.count({ where: feedEligibleWhere }),
    prisma.lookPost.count({
      where: {
        ...ownLooks,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: {
          in: [ModerationStatus.PENDING_REVIEW, ModerationStatus.AUTO_FLAGGED],
        },
      },
    }),
    prisma.lookPost.count({
      where: {
        ...ownLooks,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.REJECTED,
      },
    }),
    prisma.lookPost.count({
      where: { ...ownLooks, status: LookPostStatus.DRAFT },
    }),
    prisma.lookTag.count({
      where: { bannedAt: null, looks: { some: feedEligibleWhere } },
    }),
    prisma.lookPost.groupBy({
      by: ['serviceId'],
      where: { ...feedEligibleWhere, serviceId: { not: null } },
    }),
    prisma.lookPostConversionStat.aggregate({
      where: { lookPost: { is: feedEligibleWhere } },
      _sum: { bookingCount: true, interestCount: true },
    }),
  ])

  const bookingCount = conversionAgg._sum.bookingCount ?? 0
  const interestCount = conversionAgg._sum.interestCount ?? 0

  return evaluateProVisibilityHealth({
    now,
    readiness,
    availability: availabilityRow
      ? {
          nextOpeningDate: availabilityRow.nextOpeningDate,
          fullness14d: availabilityRow.fullness14d,
          computedAt: availabilityRow.computedAt,
        }
      : null,
    availabilityEverComputed: availabilityProbe !== null,
    looks: {
      feedEligibleCount,
      pendingReviewCount,
      rejectedCount,
      draftCount,
      distinctTagCount,
      distinctServiceCount: serviceGroups.length,
    },
    conversion: interestCount > 0 ? { bookingCount, interestCount } : null,
    reliability: badgeRow
      ? {
          resolvedBookingCount: badgeRow.resolvedBookingCount,
          completedResolvedCount: badgeRow.completedResolvedCount,
        }
      : null,
  })
}
