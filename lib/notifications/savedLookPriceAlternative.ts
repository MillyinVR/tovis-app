// lib/notifications/savedLookPriceAlternative.ts
//
// §6.8 "price" blocker response — the FIFTH consumer of the §8.1 re-engagement
// notification budget (lib/notifications/reEngagementBudget.ts), after §8 event
// countdowns, §6.8 saved-look availability-opened, §6.7 rebook cadence, and §6.8
// hesitation consult.
//
// The §6.8 table lists five likely blockers behind an aging saved-not-booked look
// and a tailored response to each. This module ships the "price" row — "saved
// something well out of budget → surface similar looks in their range":
//
//   A client who saved a look priced well ABOVE their LEARNED price band (the
//   recency-weighted center of what they actually pay for services — learnPriceBand,
//   lib/looks/personalizedFeed.ts, spec §4.5) but never booked that pro is,
//   plausibly, blocked on price. Rather than keep surfacing out-of-budget work, we
//   send ONE gentle nudge pointing at a SIMILAR look (same service category) from a
//   DIFFERENT pro whose price sits IN their band — pooled under the weekly
//   re-engagement budget, at the lowest live priority (clockless, and the more
//   speculative of the two §6.8 conversion nudges since it steers to a new pro).
//
// The band is SELECTION logic, never a judgment: the copy never mentions price or
// budget. It anchors on the style the client already liked ("loved a look you
// saved?") and warmly introduces the in-band pro's similar work. The spec's §4.5
// price_fit RANK term already de-emphasizes out-of-budget work in the feed; this is
// the active re-engagement counterpart — an in-band alternative delivered when a
// pricey save has aged without a booking.
//
// Design mirrors savedLookActivation / hesitationConsultNudge: candidate selection +
// budget allocation is PURE (plain record inputs, no Prisma) and unit-tested; the
// orchestrator maps DB rows to those records, runs the pure core, then emits via
// createClientNotification. Idempotent per (client, over-budget pro) per cooldown
// window via a bucketed dedupeKey. Shares the pooled-budget / opt-out / dedup reads
// with its siblings via reEngagementLedger.ts.
//
// Retrieval is the new piece. Surfacing a NEW look to a client is Pro discovery, so
// the alternative-look read is tenant-scoped through the canonical
// proDiscoveryVisibilityFilter (check:tenant-aware-discovery): a client is only ever
// offered a look from their OWN tenant. Candidate saves are grouped by tenant and one
// bounded, rankScore-ordered pool is fetched per (tenant, category).

import {
  BookingStatus,
  LookPostStatus,
  ModerationStatus,
  NotificationEventKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { learnPriceBand } from '@/lib/looks/personalizedFeed'
import type { LearnedPriceBand } from '@/lib/looks/personalizedRanking'
import {
  type CompletedBookingSignalRow,
  resolveBookingServicePrice,
} from '@/lib/looks/relationshipSignals'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import {
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadAlreadyNotifiedDedupeKeys,
  loadBookedReEngagementPairs,
  loadMutedClientsForEvent,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import {
  TOVIS_ROOT_TENANT_SLUG,
  proDiscoveryVisibilityFilter,
  rootTenantContext,
  whiteLabelTenantContext,
  type TenantContext,
} from '@/lib/tenant'

const DAY_MS = 24 * 60 * 60 * 1000

export const SAVED_LOOK_PRICE_ALTERNATIVE = {
  // A save younger than this hasn't "aged" — give the client room to save-for-later
  // or book on their own before we suggest an alternative (matches the consult
  // nudge's considered pace).
  minSaveAgeDays: 5,
  // Don't chase saves older than this — intent has gone stale.
  maxSaveAgeDays: 60,
  // At most one nudge per (client, over-budget pro) per this many days (bucketed
  // dedupeKey). Long, like the consult nudge — a considered, spaced touch.
  cooldownDays: 45,
  // Bound the per-run aging-save scan so a viral pricey look's save list can't make
  // the cron unbounded. Capped saves are logged (never silently dropped).
  maxScanSaves: 5000,
  // Bound the completed-booking scan that feeds the per-client learned price bands.
  maxBandBookings: 20000,
  // Bound the per-(tenant, category) alternative-look retrieval pool (rankScore-desc).
  maxAlternativePool: 400,
  // "Over budget" threshold: the saved look's price must be at least this many
  // NATURAL-LOG units above the client's band center to count as a price blocker.
  // ln(3) ≈ a look ~3× the client's usual service price — clearly out of their range
  // (a $60-usual client saving a $180+ look), where the §4.5 price_fit rank term has
  // already fallen well off its peak. Log space because price perception is
  // multiplicative (the same reasoning the band itself uses). Tunable.
  aboveBandLogThreshold: Math.log(3),
  // "In band" ceiling for an ALTERNATIVE look: at most this many log units above the
  // client's band center. ln(1.5) ≈ up to ~1.5× their usual (comfortably affordable;
  // cheaper is always fine, so there is no floor). Sits well below the over-budget
  // threshold, so a matched alternative is ALWAYS cheaper than the saved look.
  inBandCeilingLog: Math.log(1.5),
  // Require a band learned from at least this many priced completed bookings before
  // we trust it enough to call a save "over budget" and steer the client elsewhere
  // (mirrors the ranker's priceFitFullBookings — a one-off splurge shouldn't define
  // a budget).
  minBandSampleCount: 3,
} as const

export const PRICE_ALTERNATIVE_TRIGGER = 'PRICE_ALTERNATIVE' as const

function pairKey(clientId: string, professionalId: string): string {
  return `${clientId}::${professionalId}`
}

/** Composite key for the per-(tenant, category) alternative pool. */
export function tenantCategoryKey(tenantId: string, categorySlug: string): string {
  return `${tenantId}::${categorySlug}`
}

/**
 * Stable-per-cooldown-window dedupeKey, keyed on the OVER-BUDGET pro (the save's
 * pro), so a client isn't re-nudged about the same pricey pro every run. The bucket
 * rolls every cooldownDays. Mirrors buildConsultNudgeDedupeKey.
 */
export function buildPriceAlternativeDedupeKey(args: {
  clientId: string
  professionalId: string
  now: Date
  cooldownDays?: number
}): string {
  const cooldownDays =
    args.cooldownDays ?? SAVED_LOOK_PRICE_ALTERNATIVE.cooldownDays
  const bucket = Math.floor(args.now.getTime() / (cooldownDays * DAY_MS))
  return `saved-price-alt:${args.clientId}:${args.professionalId}:${bucket}`
}

// ── pure predicates ──────────────────────────────────────────────────────────

/** A positive, finite ln(price); null for a non-positive/malformed price. */
function safeLogPrice(price: number): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null
  }
  return Math.log(price)
}

/** The saved look is priced well ABOVE the client's learned band (a price blocker). */
export function isAboveBand(price: number, band: LearnedPriceBand): boolean {
  const logPrice = safeLogPrice(price)
  if (logPrice === null) return false
  return logPrice - band.logCenter >= SAVED_LOOK_PRICE_ALTERNATIVE.aboveBandLogThreshold
}

/** An alternative look is comfortably IN the client's band (never above the ceiling). */
export function isInBand(price: number, band: LearnedPriceBand): boolean {
  const logPrice = safeLogPrice(price)
  if (logPrice === null) return false
  return logPrice - band.logCenter <= SAVED_LOOK_PRICE_ALTERNATIVE.inBandCeilingLog
}

// ── pure candidate selection ────────────────────────────────────────────────

export type PricedSaveRow = {
  clientId: string
  /** The saved look's pro — the potentially over-budget one (dedupe identity). */
  professionalId: string
  lookPostId: string
  savedAt: Date
  /** The client's home tenant — alternatives are scoped to it. */
  tenantId: string
  /** The saved look's service-category slug (required — the SQL filters to it). */
  categorySlug: string
  /** The saved look's starting price (> 0 — the SQL filters to it). */
  price: number
}

/** One in-band alternative look, from the per-(tenant, category) retrieval pool. */
export type AlternativeLook = {
  lookPostId: string
  professionalId: string
  price: number
  rankScore: number
  proName: string
}

export type PriceAlternativeCandidate = {
  clientId: string
  /** The OVER-BUDGET pro whose saved look triggered this (dedupe identity). */
  professionalId: string
  /** The pricey saved look that aged without a booking — the context/hook. */
  blockedLookPostId: string
  savedAt: Date
  categorySlug: string
  /** The in-band similar look we point the client at. */
  alternativeLookPostId: string
  alternativeProfessionalId: string
  alternativeProName: string
  dedupeKey: string
  trigger: typeof PRICE_ALTERNATIVE_TRIGGER
}

/**
 * From aging PRICED saves + per-client learned bands + the per-(tenant, category)
 * alternative pools + exclusion sets, produce one candidate per eligible
 * (client, over-budget pro) pair. A save qualifies only when the client has a
 * TRUSTWORTHY band, the saved look is well ABOVE it, the pair has no booking, the
 * pair wasn't nudged this window, AND a same-category, different-pro, IN-band
 * alternative exists in the client's tenant. The freshest qualifying save is the
 * hook. Pure.
 */
export function selectPriceAlternativeCandidates(args: {
  saves: readonly PricedSaveRow[]
  bandsByClient: ReadonlyMap<string, LearnedPriceBand>
  alternativesByCategory: ReadonlyMap<string, readonly AlternativeLook[]>
  bookedPairs: ReadonlySet<string>
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
  cooldownDays?: number
}): PriceAlternativeCandidate[] {
  // Freshest above-band, unbooked save per (client, over-budget pro).
  const byPair = new Map<string, { save: PricedSaveRow; band: LearnedPriceBand }>()

  for (const save of args.saves) {
    const band = args.bandsByClient.get(save.clientId)
    if (!band) continue // no trustworthy learned band → we don't know their budget
    if (!isAboveBand(save.price, band)) continue // in/near budget → not a blocker

    const key = pairKey(save.clientId, save.professionalId)
    if (args.bookedPairs.has(key)) continue // already engaged this pro

    const existing = byPair.get(key)
    if (!existing || save.savedAt.getTime() > existing.save.savedAt.getTime()) {
      byPair.set(key, { save, band })
    }
  }

  const candidates: PriceAlternativeCandidate[] = []

  for (const { save, band } of byPair.values()) {
    const dedupeKey = buildPriceAlternativeDedupeKey({
      clientId: save.clientId,
      professionalId: save.professionalId,
      now: args.now,
      cooldownDays: args.cooldownDays,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue // nudged this window

    const alternative = pickInBandAlternative(save, band, args.alternativesByCategory)
    if (!alternative) continue // nothing in-band to offer → stay silent (honest)

    candidates.push({
      clientId: save.clientId,
      professionalId: save.professionalId,
      blockedLookPostId: save.lookPostId,
      savedAt: save.savedAt,
      categorySlug: save.categorySlug,
      alternativeLookPostId: alternative.lookPostId,
      alternativeProfessionalId: alternative.professionalId,
      alternativeProName: alternative.proName,
      dedupeKey,
      trigger: PRICE_ALTERNATIVE_TRIGGER,
    })
  }

  return candidates
}

/**
 * The highest-rankScore alternative in the client's tenant + the save's category
 * that is a DIFFERENT pro, a DIFFERENT look, and IN the client's band. The pool is
 * pre-sorted rankScore-desc, so the first match is the best. Pure.
 */
function pickInBandAlternative(
  save: PricedSaveRow,
  band: LearnedPriceBand,
  alternativesByCategory: ReadonlyMap<string, readonly AlternativeLook[]>,
): AlternativeLook | null {
  const pool = alternativesByCategory.get(
    tenantCategoryKey(save.tenantId, save.categorySlug),
  )
  if (!pool) return null

  for (const alt of pool) {
    if (alt.professionalId === save.professionalId) continue // must be a different pro
    if (alt.lookPostId === save.lookPostId) continue // must be a different look
    if (!isInBand(alt.price, band)) continue // must fit the client's range
    return alt
  }
  return null
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type PriceAlternativeAllocation = {
  granted: PriceAlternativeCandidate[]
  /** Candidates dropped because the recipient muted the trigger (opt-out signal). */
  mutedOptOut: number
  /** Candidates dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
}

/**
 * Allocate candidates under the pooled weekly re-engagement budget, per client.
 * Muted recipients (they turned the trigger off — the opt-out signal) are dropped
 * before spending any budget. Each client's candidates are ordered FRESHEST-save
 * first — the strongest current intent wins a scarce slot (no deadline to rank on).
 * Pure.
 */
export function allocatePriceAlternatives(args: {
  candidates: readonly PriceAlternativeCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): PriceAlternativeAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, PriceAlternativeCandidate[]>()
  let mutedOptOut = 0

  for (const candidate of args.candidates) {
    if (args.mutedClients.has(candidate.clientId)) {
      mutedOptOut += 1
      continue
    }
    const list = byClient.get(candidate.clientId) ?? []
    list.push(candidate)
    byClient.set(candidate.clientId, list)
  }

  const granted: PriceAlternativeCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    // Freshest save first — the most current intent wins a scarce slot.
    const ordered = [...list].sort(
      (a, b) => b.savedAt.getTime() - a.savedAt.getTime(),
    )
    const { granted: grantedForClient, denied } = allocateBudgetToCandidates({
      candidates: ordered,
      alreadySent: args.sentCountByClient.get(clientId) ?? 0,
      cap,
    })
    granted.push(...grantedForClient)
    budgetBlocked += denied.length
  }

  return { granted, mutedOptOut, budgetBlocked }
}

// ── pure copy ───────────────────────────────────────────────────────────────

export type PriceAlternativeCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * White-label-safe, price-invisible copy. The learned band is SELECTION logic, never
 * a judgment: the copy NEVER mentions price, budget, or "cheaper" (that would insult
 * a client's saved taste — guardrail: honest, never pressure). It anchors on the
 * style the client already liked and warmly introduces the in-band pro's similar
 * work. No brand strings; the alternative pro's public name is carried on the
 * candidate. The href points at the alternative look.
 */
export function composePriceAlternativeCopy(args: {
  candidate: Pick<
    PriceAlternativeCandidate,
    | 'professionalId'
    | 'blockedLookPostId'
    | 'alternativeLookPostId'
    | 'alternativeProfessionalId'
    | 'alternativeProName'
  >
}): PriceAlternativeCopy {
  const proName = args.candidate.alternativeProName.trim() || 'Another pro'
  return {
    title: `${proName} has a similar look`,
    body: `Loved a look you saved? ${proName} shared a similar one you might love — take a look whenever you're ready.`,
    href: `/looks/${encodeURIComponent(args.candidate.alternativeLookPostId)}`,
    data: {
      trigger: PRICE_ALTERNATIVE_TRIGGER,
      professionalId: args.candidate.professionalId,
      lookPostId: args.candidate.blockedLookPostId,
      alternativeLookPostId: args.candidate.alternativeLookPostId,
      alternativeProfessionalId: args.candidate.alternativeProfessionalId,
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

export type SavedLookPriceAlternativeSummary = {
  agingSaves: number
  scanCapped: boolean
  candidatePairs: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

/** Build the tenant context for a client's home tenant (root vs white-label). */
function tenantContextFor(tenantId: string, tenantSlug: string): TenantContext {
  return tenantSlug === TOVIS_ROOT_TENANT_SLUG
    ? rootTenantContext(tenantId)
    : whiteLabelTenantContext({ tenantId, slug: tenantSlug })
}

type LoadedPricedSaves = {
  saves: PricedSaveRow[]
  capped: boolean
  /** tenantId → TenantContext, for the tenant-scoped alternative retrieval. */
  tenantContexts: Map<string, TenantContext>
}

/**
 * Aging saves on PUBLISHED, PRICED, categorized looks, newest-first, bounded. Each
 * row carries the client's home tenant (for tenant-scoped retrieval), the saved
 * look's category + price (for the band comparison), and the over-budget pro. The
 * saved pro's name is NOT read here — the copy names the ALTERNATIVE pro, resolved in
 * the retrieval pool.
 */
async function loadAgingPricedSaves(
  db: PrismaClient,
  args: { minAgeCutoff: Date; maxAgeCutoff: Date; take: number },
): Promise<LoadedPricedSaves> {
  const rows = await db.boardItem.findMany({
    where: {
      createdAt: { lte: args.minAgeCutoff, gte: args.maxAgeCutoff },
      lookPost: {
        status: LookPostStatus.PUBLISHED,
        priceStartingAt: { gt: 0 },
        // Has a service → has a category (Service.category is a required relation);
        // the category slug drives the alternative match. Uncategorized looks (null
        // serviceId) can't be matched, so they're excluded up front.
        serviceId: { not: null },
      },
    },
    select: {
      lookPostId: true,
      createdAt: true,
      board: {
        select: {
          clientId: true,
          client: {
            select: {
              homeTenantId: true,
              homeTenant: { select: { slug: true } },
            },
          },
        },
      },
      lookPost: {
        select: {
          professionalId: true,
          priceStartingAt: true,
          service: { select: { category: { select: { slug: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: args.take + 1, // +1 to detect capping
  })

  const capped = rows.length > args.take
  const kept = rows.slice(0, args.take)

  const tenantContexts = new Map<string, TenantContext>()
  const saves: PricedSaveRow[] = []
  for (const row of kept) {
    const categorySlug = row.lookPost.service?.category?.slug ?? null
    const price = row.lookPost.priceStartingAt?.toNumber() ?? null
    const tenantId = row.board.client.homeTenantId
    const tenantSlug = row.board.client.homeTenant.slug
    if (!categorySlug || price === null || !(price > 0)) continue

    if (!tenantContexts.has(tenantId)) {
      tenantContexts.set(tenantId, tenantContextFor(tenantId, tenantSlug))
    }
    saves.push({
      clientId: row.board.clientId,
      professionalId: row.lookPost.professionalId,
      lookPostId: row.lookPostId,
      savedAt: row.createdAt,
      tenantId,
      categorySlug,
      price,
    })
  }

  return { saves, capped, tenantContexts }
}

/**
 * Per-client LEARNED price bands from completed bookings, in ONE bounded scan over
 * the candidate clients. Only bands built from at least minBandSampleCount priced
 * bookings are kept — a thin band isn't trusted to call a save "over budget". Reuses
 * learnPriceBand (the same §4.5 band the feed's price_fit term uses) so "in band"
 * means the same thing in the nudge and the feed. The global take is newest-first, so
 * truncation drops the oldest (least-relevant) rows — the band is recency-weighted.
 */
async function loadPriceBandsForClients(
  db: PrismaClient,
  args: { clientIds: string[]; now: Date; take: number },
): Promise<Map<string, LearnedPriceBand>> {
  if (args.clientIds.length === 0) return new Map()

  const rows = await db.booking.findMany({
    where: { clientId: { in: args.clientIds }, status: BookingStatus.COMPLETED },
    orderBy: { scheduledFor: 'desc' },
    take: args.take,
    select: {
      clientId: true,
      scheduledFor: true,
      finishedAt: true,
      subtotalSnapshot: true,
      serviceSubtotalSnapshot: true,
    },
  })

  const byClient = new Map<string, CompletedBookingSignalRow[]>()
  for (const row of rows) {
    const list = byClient.get(row.clientId) ?? []
    list.push({
      professionalId: '', // unused by learnPriceBand
      scheduledFor: row.scheduledFor,
      finishedAt: row.finishedAt,
      categorySlug: null, // unused by learnPriceBand
      servicePrice: resolveBookingServicePrice(row),
    })
    byClient.set(row.clientId, list)
  }

  const bands = new Map<string, LearnedPriceBand>()
  for (const [clientId, bookings] of byClient) {
    const band = learnPriceBand(bookings, args.now)
    if (band && band.sampleCount >= SAVED_LOOK_PRICE_ALTERNATIVE.minBandSampleCount) {
      bands.set(clientId, band)
    }
  }
  return bands
}

/**
 * The in-band alternative-look pools, keyed tenantCategoryKey(tenantId, slug). For
 * each tenant, ONE tenant-scoped, rankScore-ordered lookPost.findMany over the
 * needed categories (surfacing a new look is Pro discovery → the read composes
 * proDiscoveryVisibilityFilter so a client is never offered another tenant's look).
 * The pool carries every look regardless of price; the pure selector applies each
 * client's own in-band ceiling. The alternative pro's public display name is read
 * through the LookPost→professional RELATION (never a top-level pro findMany — that
 * trips check:tenant-aware-discovery differently).
 */
async function loadInBandAlternatives(
  db: PrismaClient,
  args: {
    /** tenantId → the category slugs needed for that tenant's blocked saves. */
    neededByTenant: Map<string, Set<string>>
    tenantContexts: Map<string, TenantContext>
    take: number
  },
): Promise<Map<string, AlternativeLook[]>> {
  const byCategory = new Map<string, AlternativeLook[]>()

  for (const [tenantId, categorySlugs] of args.neededByTenant) {
    if (categorySlugs.size === 0) continue
    const ctx = args.tenantContexts.get(tenantId)
    if (!ctx) continue

    const rows = await db.lookPost.findMany({
      where: {
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: { not: null },
        priceStartingAt: { gt: 0 },
        service: { category: { slug: { in: [...categorySlugs] } } },
        // Client-authored looks only enter discovery once opted in (publicToFeed),
        // same attribution gate the main feed applies (lib/looks/feed.ts).
        OR: [{ clientAuthorId: null }, { publicToFeed: true }],
        professional: {
          is: {
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
            // {} for root (sees all) or { homeTenantId } for a white-label tenant.
            ...proDiscoveryVisibilityFilter(ctx),
          },
        },
      },
      orderBy: { rankScore: 'desc' },
      take: args.take,
      select: {
        id: true,
        professionalId: true,
        priceStartingAt: true,
        rankScore: true,
        service: { select: { category: { select: { slug: true } } } },
        professional: { select: professionalPublicDisplayNameSelect },
      },
    })

    for (const row of rows) {
      const slug = row.service?.category?.slug ?? null
      const price = row.priceStartingAt?.toNumber() ?? null
      if (!slug || price === null || !(price > 0)) continue
      const key = tenantCategoryKey(tenantId, slug)
      const pool = byCategory.get(key) ?? []
      pool.push({
        lookPostId: row.id,
        professionalId: row.professionalId,
        price,
        rankScore: row.rankScore,
        proName: formatProfessionalPublicDisplayName(row.professional),
      })
      byCategory.set(key, pool)
    }
  }

  return byCategory
}

export type PriceAlternativeGathered = {
  /** Eligible candidates, not yet nudged this window. Ready to allocate. */
  candidates: PriceAlternativeCandidate[]
  agingSaves: number
  scanCapped: boolean
}

/**
 * Gather the price-alternative candidates (§6.8) for one pass: aging priced saves →
 * per-client learned bands → over-budget, unbooked pairs → the needed tenant-scoped
 * alternative pools → one candidate per (client, over-budget pro) that has an in-band
 * alternative, minus pairs already nudged this window. The reusable candidate-
 * selection half — both the per-trigger orchestrator below and the unified
 * re-engagement dispatcher call it, then apply the pooled budget themselves.
 */
export async function gatherPriceAlternativeCandidates(
  db: PrismaClient,
  options: { now: Date },
): Promise<PriceAlternativeGathered> {
  const now = options.now
  const minAgeCutoff = new Date(
    now.getTime() - SAVED_LOOK_PRICE_ALTERNATIVE.minSaveAgeDays * DAY_MS,
  )
  const maxAgeCutoff = new Date(
    now.getTime() - SAVED_LOOK_PRICE_ALTERNATIVE.maxSaveAgeDays * DAY_MS,
  )

  const { saves, capped, tenantContexts } = await loadAgingPricedSaves(db, {
    minAgeCutoff,
    maxAgeCutoff,
    take: SAVED_LOOK_PRICE_ALTERNATIVE.maxScanSaves,
  })
  if (saves.length === 0) {
    return { candidates: [], agingSaves: 0, scanCapped: capped }
  }

  const clientIdSet = new Set<string>()
  const proIdSet = new Set<string>()
  const wantedPairs = new Set<string>()
  for (const save of saves) {
    clientIdSet.add(save.clientId)
    proIdSet.add(save.professionalId)
    wantedPairs.add(pairKey(save.clientId, save.professionalId))
  }

  const [bandsByClient, bookedPairs] = await Promise.all([
    loadPriceBandsForClients(db, {
      clientIds: [...clientIdSet],
      now,
      take: SAVED_LOOK_PRICE_ALTERNATIVE.maxBandBookings,
    }),
    loadBookedReEngagementPairs(db, {
      clientIds: [...clientIdSet],
      professionalIds: [...proIdSet],
      wantedPairs,
    }),
  ])

  if (bandsByClient.size === 0) {
    return { candidates: [], agingSaves: saves.length, scanCapped: capped }
  }

  // The (tenant, category) pairs we actually need alternatives for: only saves from a
  // client with a trustworthy band, that are over budget, and aren't already booked.
  const neededByTenant = new Map<string, Set<string>>()
  for (const save of saves) {
    const band = bandsByClient.get(save.clientId)
    if (!band) continue
    if (!isAboveBand(save.price, band)) continue
    if (bookedPairs.has(pairKey(save.clientId, save.professionalId))) continue
    const set = neededByTenant.get(save.tenantId) ?? new Set<string>()
    set.add(save.categorySlug)
    neededByTenant.set(save.tenantId, set)
  }

  if (neededByTenant.size === 0) {
    return { candidates: [], agingSaves: saves.length, scanCapped: capped }
  }

  const alternativesByCategory = await loadInBandAlternatives(db, {
    neededByTenant,
    tenantContexts,
    take: SAVED_LOOK_PRICE_ALTERNATIVE.maxAlternativePool,
  })

  // Provisional candidates (no already-notified filter) → dedupeKeys for the check.
  const provisional = selectPriceAlternativeCandidates({
    saves,
    bandsByClient,
    alternativesByCategory,
    bookedPairs,
    alreadyNotifiedDedupeKeys: new Set(),
    now,
  })
  const alreadyNotifiedDedupeKeys = await loadAlreadyNotifiedDedupeKeys(db, {
    eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
    dedupeKeys: provisional.map((c) => c.dedupeKey),
  })

  const candidates = selectPriceAlternativeCandidates({
    saves,
    bandsByClient,
    alternativesByCategory,
    bookedPairs,
    alreadyNotifiedDedupeKeys,
    now,
  })

  return { candidates, agingSaves: saves.length, scanCapped: capped }
}

/**
 * Run one price-alternative pass (§6.8). Reads via `db`; sends via
 * createClientNotification (global prisma). Returns a summary for the cron response +
 * observability log.
 */
export async function runSavedLookPriceAlternatives(
  db: PrismaClient,
  options: { now: Date },
): Promise<SavedLookPriceAlternativeSummary> {
  const now = options.now

  const { candidates, agingSaves, scanCapped } =
    await gatherPriceAlternativeCandidates(db, { now })

  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]
  const [sentCountByClient, mutedClients] = await Promise.all([
    loadReEngagementBudgetCounts(db, {
      clientIds: candidateClientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClientsForEvent(db, {
      clientIds: candidateClientIds,
      eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
    }),
  ])

  const allocation = allocatePriceAlternatives({
    candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composePriceAlternativeCopy({ candidate })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    agingSaves,
    scanCapped,
    candidatePairs: candidates.length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
