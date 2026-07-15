// lib/looks/personalizedRanking.ts
//
// Pure, viewer-personalized re-rank for the personalized Looks feed (B1, phase 1).
//
// The persisted `rankScore` (lib/looks/ranking.ts) is a global, viewer-agnostic
// blend of engagement × recency. The personalized feed layers a QUERY-TIME, per-viewer boost
// on top of it — no new tables, no precomputed per-viewer score:
//
//   score = rankScore * BASE_WEIGHT
//         + followBoost          (look is from a pro the viewer follows)
//         + categoryAffinityBoost(viewer has liked/saved this look's category)
//         + occasionBoost        (look's tags match a declared board occasion,
//                                 e.g. a bridal board with an upcoming wedding
//                                 — spec §7–8; weight is event-proximity-scaled
//                                 at load time in personalizedFeed.ts)
//         + visualBoost          (candidate look's image embedding is cosine-
//                                 similar to the viewer's taste vector — spec
//                                 §6.0; tags retrieve, embeddings RANK within
//                                 the candidates. Confidence-gated by how many
//                                 signals built the taste vector)
//         + availabilityBoost    (the look's pro has a real near-term opening and
//                                 an un-booked-out calendar — spec §4.2/§4.4; a
//                                 SOFT weight off the per-pro availability
//                                 primitive, never a hard filter, guardrail #8)
//         + relationshipBoost    (the look is from a pro the viewer has actually
//                                 BOOKED — a completed visit — spec §6.7
//                                 post-booking relationship layer. A booking is
//                                 the strongest, nearly un-fakeable signal in the
//                                 hierarchy (spec §2), so a booked pro's new looks
//                                 reliably surface; graded by recency × loyalty)
//         + underbookedBoost     (a fairness / on-ramp lift for a genuinely
//                                 bookable pro who is still under-discovered — new
//                                 or chronically underbooked — spec §4.2/§4.5. An
//                                 anti-winner-take-all floor so discovery doesn't
//                                 concentrate on already-busy pros; graded DOWN by
//                                 the pro's completed-booking volume and gated on a
//                                 real near-term opening, so it tapers off as they
//                                 gain traction and never lifts an unbookable pro)
//         + freshnessBoost       (extra nudge for very recent looks)
//         - seenPenalty          (viewer has already seen this look this session)
//         - suppressionPenalty   (viewer keeps hiding this look's category — the
//                                 explicit "not for me" negative signal, spec
//                                 §2.2; decayed, only past repeated hides)
//
// Follow and category boosts are ADDITIVE (not multiplicative) so a fresh
// followed-pro look with zero engagement — rankScore 0 — still gets lifted into
// view; a multiplicative boost would leave it at zero. Seen items are normally
// excluded from the query, so the penalty is a belt-and-suspenders that also
// sinks any injected-but-already-seen look.
//
// This module is intentionally pure (all clock input injected) so the ranking
// is unit-testable in isolation from Prisma and request wiring.

const DAY_MS = 24 * 60 * 60 * 1000

export const PERSONALIZED_RANK_WEIGHTS = {
  // rankScore passes through unscaled — it is the quality/recency backbone.
  base: 1,
  // A followed-pro look reliably leads its rankScore band, even at 0 engagement.
  follow: 25,
  // Per unit of category affinity (count of liked/saved looks in that category),
  // capped so a single hobby-horse category can't bury everything else.
  categoryUnit: 3,
  categoryWeightCap: 5,
  // Peak boost for a look whose tags match a declared board occasion at full
  // event proximity (weight 1.0). Sits between the category cap (15) and the
  // follow boost (25): an imminent wedding should out-pull accumulated
  // category taste but not bury the people you chose to follow.
  occasionMax: 20,
  // Peak visual-similarity boost (spec §6.0): a candidate whose image embedding
  // is cosine-1.0 to the viewer's taste vector, at full taste confidence. Sits
  // alongside the occasion boost (20) and below the follow boost (25) — a strong
  // visual match should out-pull accumulated category taste (cap 15) but never
  // override a pro the viewer explicitly chose to follow. The realized boost is
  // visualMax × clamped-cosine × confidence, so a typical genuine match (cosine
  // ~0.3–0.5) contributes ~single digits, not the full 20; it nudges ordering
  // within a rankScore band rather than dominating it.
  visualMax: 20,
  // Taste-confidence ramp: the visual boost reaches full strength only once the
  // taste vector is built from this many embedded signals. A 1–2 signal vector
  // is noisy — one outlier save can swing it — so it barely steers the feed
  // until the taste picture fills in (spec §6.0 "signal-weighted average").
  visualConfidenceFullSignals: 10,
  // availability_boost (spec §4.2/§4.4): a pro with real open slots should
  // outrank one booked out for weeks — a SOFT weight off the per-pro
  // ProfessionalAvailabilityStat primitive (next opening + 14-day fullness),
  // never a hard filter (guardrail #8). Peak sits below the category cap (15):
  // calendar health nudges ordering within a rankScore band but never buries
  // accumulated taste or a followed pro. Applied feed-wide today — every look
  // links to a bookable pro and there is no inspiration/bookable split yet (spec
  // §4.3, step 10) — so it stays modest, a tie-breaker rather than a directory sort.
  availabilityMax: 12,
  // Soonness half-life for the availability boost: an opening today scores ~1.0,
  // ~7 days out ~0.5, decaying smoothly. Blended at equal weight with 14-day
  // openness (1 - fullness) inside computeAvailabilityBoost.
  availabilitySoonHalfLifeDays: 7,
  // relationship_boost (spec §6.7 post-booking relationship layer): a pro the
  // viewer has actually BOOKED (a completed visit) is the strongest, nearly
  // un-fakeable relationship signal — the spec's §2 hierarchy puts a booking
  // above every save/share/like, and above an explicit follow (just a tap). So a
  // booked pro's NEW looks should reliably surface in that client's feed. Peak
  // sits at/just above the follow boost (25): at full strength a paid-for
  // relationship out-pulls a followed pro, but the realized boost is graded by
  // recency × loyalty (computeRelationshipBoost), so a single old visit
  // contributes only a fraction. Additive (like follow) so a fresh booked-pro
  // look at rankScore 0 still lifts into view. Dark-safe: a viewer with no
  // completed bookings has an empty relationship map → boost 0 → byte-identical.
  relationshipMax: 30,
  // Recency half-life for the relationship boost. Booking-driven affinity decays
  // the SLOWEST of any signal (spec §6.2 / the note in personalizedFeed.ts —
  // "~6–12 months"): a visit today scores ~1.0, ~120 days ago ~0.5, a year ago
  // ~0.12, so a lapsed-but-loyal client's pro keeps surfacing (the feed side of
  // the §6.7 re-engagement moment) while a one-and-done from long ago fades.
  relationshipRecencyHalfLifeDays: 120,
  // Completed-visit count at which the loyalty half of the blend saturates. One
  // visit is already a real relationship (0.33); a repeat client (3+) is a full
  // one — the spec treats repeat bookings as the deepest personalization signal.
  relationshipFullVisits: 3,
  // underbooked_pro_boost (spec §4.2/§4.5): a fairness / on-ramp lift for a
  // genuinely bookable pro who is still under-discovered — either brand new or
  // chronically underbooked. An anti-winner-take-all floor (the TikTok
  // new-creator velocity analog, tied here to calendar health) so discovery
  // doesn't concentrate every impression on already-busy pros; every bookable
  // pro gets a modest baseline of exposure to gather signal. Graded DOWN by the
  // pro's completed-booking volume (computeUnderbookedProBoost) and GATED on a
  // real near-term opening — so it tapers to 0 as the pro books up (self-
  // correcting: once discovered, the crutch is removed) and never lifts a pro a
  // client can't actually book. Peak sits BELOW the availability boost (12): a
  // fairness floor is a touch weaker than the pro's actual openness, and both
  // stay well under accumulated taste (category cap 15) / a followed (25) /
  // booked (30) pro — a tie-breaker within a rankScore band, never a takeover.
  underbookedMax: 10,
  // Completed bookings (trailing 30 days, ProfessionalBadgeStat) at which the
  // on-ramp fully tapers out. Matched to the "N bookings in 30 days" social-proof
  // badge threshold (LOOK_BADGE_THRESHOLDS.booked30dMin = 8): the fairness lift
  // fades exactly as the pro crosses into "established / earns social proof"
  // territory. 0 completed → full boost; 4 → half; 8+ → none.
  underbookedFullBookings: 8,
  // Peak nudge for a brand-new look; decays with a 1-day half-life.
  freshnessMax: 6,
  freshnessHalfLifeDays: 1,
  // Large enough to sink an already-seen look beneath everything unseen.
  seen: 1_000,
  // Category-level suppression from explicit "not for me" hides (spec §2.2).
  // A NEGATIVE boost, never a hard filter (guardrail #10 — item hides are the
  // hard exclusion; this is the softer "you keep hiding this category" signal
  // and it decays). Input is the summed DECAYED hide weight in the look's
  // category (computed in personalizedFeed.ts with a slower-than-positive
  // half-life). A single dismissed card (~weight 1) stays below the threshold so
  // it never tars the whole category; the penalty ramps from threshold→full and
  // caps at hideCategoryMax. Peak sits alongside the follow boost (25) so a
  // strongly-suppressed category is pushed down hard but a followed pro's look
  // in it can still surface.
  hideCategoryThreshold: 2,
  hideCategoryFull: 6,
  hideCategoryMax: 30,
} as const

export type PersonalizedViewerAffinity = {
  followedProfessionalIds: ReadonlySet<string>
  // slug → affinity weight (raw count of the viewer's likes/saves in that
  // category; capped inside the ranker).
  categoryWeights: ReadonlyMap<string, number>
  // slug → summed DECAYED explicit-hide weight in that category (spec §2.2).
  // Down-ranks categories the viewer keeps hiding, past a threshold, decaying
  // over weeks (guardrail #10). Optional so non-suppression callers (unit tests,
  // follow-only paths) omit it → no penalty.
  categorySuppressionWeights?: ReadonlyMap<string, number>
  // LookTag slug → occasion weight in [0, 1], derived from the viewer's
  // declared board purposes and scaled by event proximity at load time
  // (lib/looks/personalizedFeed.ts + lib/boards/context.ts). A look matching any of
  // these tags gets occasionMax × the strongest matched weight.
  occasionTagWeights: ReadonlyMap<string, number>
  // The viewer's global taste vector (spec §6.1 global_taste_embedding) —
  // L2-normalized at write in lib/personalization/tasteVectors.ts — and how many
  // embedded signals built it. null/absent when the viewer has no stored vector
  // (pre-backfill, no signals, or signals only on unembedded looks): the visual
  // boost is then 0. Optional so non-visual callers (unit tests, the follow-only
  // paths) can omit them without churn. Note: from §6.3 this vector is the stored
  // vector already blended with this sitting's fresh likes/saves at load time
  // (lib/looks/personalizedFeed.ts), and tasteSignalCount its blended confidence.
  tasteVector?: readonly number[] | null
  tasteSignalCount?: number
  // Observability only (ignored by scoring): how many fresh same-session
  // like/save embeddings folded into the taste vector this request (spec §6.3).
  sessionVisualSignalCount?: number
  // Per-pro post-booking relationship signals (spec §6.7), keyed by
  // professionalId — the pros the viewer has a completed booking with, loaded
  // once per request (like followedProfessionalIds, viewer state, not
  // per-candidate). A pro absent from the map earns no relationship boost.
  // Optional so non-relationship callers (unit tests, follow-only paths) omit it
  // → byte-identical to the pre-§6.7 feed.
  relationshipSignals?: ReadonlyMap<string, ProRelationshipSignal>
}

export type PersonalizedRankableRow = {
  id: string
  professionalId: string
  publishedAt: Date | null
  rankScore: number
  service?: {
    category?: {
      slug?: string | null
    } | null
  } | null
  tags?: ReadonlyArray<{ slug?: string | null }> | null
}

// Per-pro availability summary (spec §4.2/§4.4), read from ProfessionalAvailabilityStat
// at serve time (lib/looks/availabilitySignal.ts). A pro absent from the map — no
// row, i.e. no opening in the scan horizon — earns no availability boost. Kept a
// plain data shape (no Prisma import) so the ranker stays pure.
export type ProAvailabilitySignal = {
  // Start-of-local-day UTC instant of the pro's next open day; null = no opening.
  nextOpeningDate: Date | null
  // Booked/capacity over the next 14 working days, [0, 1] (0 = wide open).
  fullness14d: number
}

// Per-pro post-booking relationship summary (spec §6.7), keyed by professionalId
// and derived from the VIEWER's completed bookings (lib/looks/relationshipSignals.ts).
// A pro absent from the map — the viewer has never completed a visit with them —
// earns no relationship boost. Plain data shape (no Prisma import) so the ranker
// stays pure.
export type ProRelationshipSignal = {
  // Most recent COMPLETED visit with this pro (finishedAt ?? scheduledFor);
  // drives the recency half of the boost.
  lastVisitAt: Date
  // Count of COMPLETED visits with this pro; drives the loyalty half.
  completedVisits: number
}

// Per-pro under-discovery summary (spec §4.2/§4.5), keyed by professionalId and
// read from ProfessionalBadgeStat at serve time (lib/looks/badges/stats.ts). The
// only field the fairness boost grades on is the pro's recent completed-booking
// volume; a pro ABSENT from the map has no badge-stat row, which means zero
// completed bookings in the window (the "skip the zeros" rule) — i.e. maximally
// under-discovered, NOT "no signal". Plain data shape (no Prisma import) so the
// ranker stays pure.
export type ProUnderbookedSignal = {
  // COMPLETED bookings in the trailing 30 days (ProfessionalBadgeStat window).
  completedBookingCount30d: number
}

export type PersonalizedRankContext = {
  affinity: PersonalizedViewerAffinity
  seenLookIds: ReadonlySet<string>
  now: Date
  // Candidate look image embeddings keyed by look id (raw provider vectors,
  // fetched by PK for the page in lib/looks/personalizedFeed.ts). A look absent from
  // the map is not yet embedded → 0 visual boost. Optional/empty when the viewer
  // has no taste vector to compare against (the fetch is skipped entirely then).
  candidateEmbeddings?: ReadonlyMap<string, readonly number[]>
  // Per-pro availability signals keyed by professionalId (spec §4.2/§4.4). Absent
  // pro or empty map → no availability boost (byte-identical to the pre-primitive
  // feed until the pro-availability-stats cron populates the table).
  availabilitySignals?: ReadonlyMap<string, ProAvailabilitySignal>
  // Session-intent multiplier on the availability boost (spec §4.3/§4.3.2). >1
  // leans the feed bookable-heavy, <1 inspiration-heavy. Absent → 1 (neutral),
  // so a caller that doesn't shift by intent is byte-identical.
  availabilityWeightMultiplier?: number
  // Per-pro under-discovery signals keyed by professionalId (spec §4.2/§4.5), for
  // the underbooked fairness boost. ABSENT (undefined) → the term is off entirely
  // (byte-identical to the pre-§4.5 feed; unit tests + non-personalized callers
  // omit it). PRESENT but a pro missing from it → that pro has no badge-stat row →
  // 0 completed bookings → maximally under-discovered (the boost still applies,
  // gated on availability). The bookability gate reuses `availabilitySignals`
  // (a pro with an availability row has a real near-term opening), so no extra
  // read funds the gate.
  underbookedSignals?: ReadonlyMap<string, ProUnderbookedSignal>
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function categorySlugOf(row: PersonalizedRankableRow): string | null {
  const slug = row.service?.category?.slug
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function computePersonalizedFreshnessBoost(
  publishedAt: Date | null,
  now: Date,
): number {
  if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) {
    return 0
  }

  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime())
  const ageDays = ageMs / DAY_MS
  const decay =
    1 / (1 + ageDays / PERSONALIZED_RANK_WEIGHTS.freshnessHalfLifeDays)

  return PERSONALIZED_RANK_WEIGHTS.freshnessMax * decay
}

/**
 * Cosine similarity between two equal-length vectors, computed as
 * dot / (‖a‖·‖b‖) so it is correct regardless of whether either side is
 * pre-normalized — the taste vector is L2-normalized at write, but raw look
 * embeddings are not. Returns 0 on a length mismatch or a zero-norm/degenerate
 * input (no signal, never NaN). Pure + exported for unit testing.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA <= 0 || normB <= 0) return 0
  const sim = dot / Math.sqrt(normA * normB)
  return Number.isFinite(sim) ? sim : 0
}

/**
 * Additive visual-similarity boost (spec §6.0):
 *   visualMax × clamped-cosine × confidence
 * Cosine is clamped to [0, 1] — a look aesthetically opposite the viewer's taste
 * earns no boost rather than a negative penalty (sinking dissimilar looks is not
 * this term's job; the seen penalty handles exclusion). Confidence ramps 0→1 as
 * the taste vector accrues embedded signals (visualConfidenceFullSignals), so a
 * thin, noisy vector barely moves the feed. Any missing input — no taste vector,
 * no candidate embedding — yields 0. Pure + exported for unit testing.
 */
export function computeVisualSimilarityBoost(args: {
  tasteVector: readonly number[] | null | undefined
  tasteSignalCount: number | null | undefined
  candidateEmbedding: readonly number[] | null | undefined
}): number {
  const { tasteVector, candidateEmbedding } = args
  if (!tasteVector || tasteVector.length === 0) return 0
  if (!candidateEmbedding || candidateEmbedding.length === 0) return 0

  const clampedCosine = Math.min(
    Math.max(cosineSimilarity(tasteVector, candidateEmbedding), 0),
    1,
  )
  if (clampedCosine <= 0) return 0

  const rawSignals = args.tasteSignalCount
  const signals =
    typeof rawSignals === 'number' && Number.isFinite(rawSignals)
      ? Math.max(0, rawSignals)
      : 0
  const confidence = Math.min(
    signals / PERSONALIZED_RANK_WEIGHTS.visualConfidenceFullSignals,
    1,
  )
  if (confidence <= 0) return 0

  return PERSONALIZED_RANK_WEIGHTS.visualMax * clampedCosine * confidence
}

/**
 * Additive availability boost (spec §4.2/§4.4): rewards a pro with a real
 * near-term opening and an un-booked-out calendar, so the bookable-feeling half
 * of discovery leans toward pros a client can actually book soon.
 *
 *   availabilityMax × (0.5 × soonScore + 0.5 × openness)
 *
 * `soonScore` = 1 / (1 + daysUntilNextOpening / soonHalfLife) — 1.0 for an
 * opening today, decaying smoothly (a pro booked out weeks trends toward 0).
 * `openness` = clamp(1 − fullness14d, 0, 1) — 1.0 for a wide-open 14-day window,
 * 0 for fully booked. A missing signal (no row = no opening in the horizon) or a
 * missing/invalid next-opening date yields 0 — this is a SOFT weight, never a
 * hard filter (guardrail #8).
 *
 * `weightMultiplier` (spec §4.3/§4.3.2 session intent) scales the whole term: a
 * booking-minded session (>1) leans the bookable-vs-inspiration blend toward
 * pros with real openings; an idle-browse/dream session (<1) damps it so
 * inspiration leads. Defaults to 1 (calibrated peak) — the board feed and every
 * non-intent caller pass nothing, so their availability boost is unchanged.
 * Pure + exported for unit testing.
 */
export function computeAvailabilityBoost(args: {
  signal: ProAvailabilitySignal | null | undefined
  now: Date
  weightMultiplier?: number
}): number {
  const { signal, now } = args
  if (!signal) return 0

  const nextOpening = signal.nextOpeningDate
  if (
    !(nextOpening instanceof Date) ||
    Number.isNaN(nextOpening.getTime())
  ) {
    return 0
  }

  const daysUntil = Math.max(0, (nextOpening.getTime() - now.getTime()) / DAY_MS)
  const soonScore =
    1 / (1 + daysUntil / PERSONALIZED_RANK_WEIGHTS.availabilitySoonHalfLifeDays)

  const openness = Math.min(Math.max(1 - safeNumber(signal.fullness14d), 0), 1)

  const blended = Math.min(Math.max(0.5 * soonScore + 0.5 * openness, 0), 1)
  const rawMultiplier = args.weightMultiplier
  const multiplier =
    typeof rawMultiplier === 'number' && Number.isFinite(rawMultiplier)
      ? Math.max(0, rawMultiplier)
      : 1
  return PERSONALIZED_RANK_WEIGHTS.availabilityMax * blended * multiplier
}

/**
 * Additive post-booking relationship boost (spec §6.7): rewards a look from a
 * pro the viewer has actually BOOKED (a completed visit), so "your pro"'s new
 * content reliably surfaces in their feed. A booking is the strongest signal in
 * the hierarchy (spec §2), so this sits at the top of the additive band.
 *
 *   relationshipMax × clamp(0.5 × recencyScore + 0.5 × loyaltyScore, 0, 1)
 *
 * `recencyScore` = 2^(−daysSinceLastVisit / recencyHalfLife) — 1.0 for a visit
 * today, decaying with the slowest half-life of any signal (booking affinity
 * lasts months). `loyaltyScore` = clamp(completedVisits / fullVisits, 0, 1) — one
 * visit is already a third of the way, a repeat client saturates. Blended at
 * equal weight (mirrors computeAvailabilityBoost), so a recent one-off still
 * boosts meaningfully while a lapsed-but-loyal pair keeps surfacing (the feed
 * side of the §6.7 re-engagement moment). A missing/invalid signal yields 0 —
 * this is a SOFT weight, never a hard filter. Pure + exported for unit testing.
 */
export function computeRelationshipBoost(args: {
  signal: ProRelationshipSignal | null | undefined
  now: Date
}): number {
  const { signal, now } = args
  if (!signal) return 0

  const lastVisit = signal.lastVisitAt
  if (!(lastVisit instanceof Date) || Number.isNaN(lastVisit.getTime())) {
    return 0
  }

  const daysSince = Math.max(0, (now.getTime() - lastVisit.getTime()) / DAY_MS)
  const recencyScore =
    2 ** (-daysSince / PERSONALIZED_RANK_WEIGHTS.relationshipRecencyHalfLifeDays)

  const visits = Number.isFinite(signal.completedVisits)
    ? Math.max(0, signal.completedVisits)
    : 0
  const loyaltyScore = Math.min(
    visits / PERSONALIZED_RANK_WEIGHTS.relationshipFullVisits,
    1,
  )

  const strength = Math.min(
    Math.max(0.5 * recencyScore + 0.5 * loyaltyScore, 0),
    1,
  )
  return PERSONALIZED_RANK_WEIGHTS.relationshipMax * strength
}

/**
 * Additive underbooked-pro fairness boost (spec §4.2/§4.5): a modest on-ramp so a
 * genuinely bookable but under-discovered pro — new or chronically underbooked —
 * gets a baseline of exposure rather than being buried by already-busy pros
 * (anti-winner-take-all; the TikTok new-creator velocity analog, tied to calendar
 * health).
 *
 *   underbookedMax × underDiscoveredScore     (0 unless `isBookable`)
 *
 * `underDiscoveredScore` = clamp(1 − completedBookingCount30d / fullBookings, 0, 1)
 * — 1.0 at zero recent completed bookings (a brand-new pro, or one nobody books),
 * decaying linearly to 0 at `underbookedFullBookings`, so the lift tapers off as
 * the pro gains traction and vanishes once they'd earn the "N bookings in 30 days"
 * social-proof badge. `isBookable` is the calendar-health gate (the pro has a
 * real near-term opening — a ProfessionalAvailabilityStat row): an unbookable pro
 * earns nothing, since lifting a look a client can't book wastes the impression.
 *
 * Deliberately NON-overlapping with computeAvailabilityBoost: that term grades on
 * FORWARD openness (next opening + 14-day fullness); this one grades on BACKWARD
 * booking VOLUME. The shared "has an availability row" is a binary bookability
 * FLOOR both require, not a doubled graded weight. A missing/non-finite count is
 * treated as 0 (max under-discovery — the safe fairness default). Pure + exported
 * for unit testing.
 */
export function computeUnderbookedProBoost(args: {
  completedBookingCount30d: number
  isBookable: boolean
}): number {
  if (!args.isBookable) return 0

  const raw = args.completedBookingCount30d
  const count = Number.isFinite(raw) ? Math.max(0, raw) : 0

  const full = PERSONALIZED_RANK_WEIGHTS.underbookedFullBookings
  const underDiscovered =
    full > 0 ? Math.min(Math.max(1 - count / full, 0), 1) : 0
  if (underDiscovered <= 0) return 0

  return PERSONALIZED_RANK_WEIGHTS.underbookedMax * underDiscovered
}

/**
 * Category-suppression penalty from explicit hides (spec §2.2). Zero until the
 * decayed hide weight for the category crosses `hideCategoryThreshold` (so one
 * dismissed card doesn't suppress the category), then ramps linearly to
 * `hideCategoryMax` at `hideCategoryFull`. Never negative; capped. Pure +
 * exported for unit testing.
 */
export function computeCategorySuppressionPenalty(weight: number): number {
  const w = safeNumber(weight)
  const { hideCategoryThreshold, hideCategoryFull, hideCategoryMax } =
    PERSONALIZED_RANK_WEIGHTS
  if (w <= hideCategoryThreshold) return 0

  const span = hideCategoryFull - hideCategoryThreshold
  const ramp = span > 0 ? Math.min((w - hideCategoryThreshold) / span, 1) : 1
  return hideCategoryMax * Math.max(0, ramp)
}

export function computePersonalizedScore(
  row: PersonalizedRankableRow,
  context: PersonalizedRankContext,
): number {
  const base = safeNumber(row.rankScore) * PERSONALIZED_RANK_WEIGHTS.base

  const followBoost = context.affinity.followedProfessionalIds.has(
    row.professionalId,
  )
    ? PERSONALIZED_RANK_WEIGHTS.follow
    : 0

  const slug = categorySlugOf(row)
  const rawCategoryWeight = slug
    ? safeNumber(context.affinity.categoryWeights.get(slug) ?? 0)
    : 0
  const categoryBoost =
    Math.min(
      Math.max(rawCategoryWeight, 0),
      PERSONALIZED_RANK_WEIGHTS.categoryWeightCap,
    ) * PERSONALIZED_RANK_WEIGHTS.categoryUnit

  // §2.2 explicit-hide category suppression — pushes down categories the viewer
  // keeps saying "not for me" to (decayed; only past the repeated-hide threshold).
  const suppressionPenalty = slug
    ? computeCategorySuppressionPenalty(
        context.affinity.categorySuppressionWeights?.get(slug) ?? 0,
      )
    : 0

  const occasionBoost =
    PERSONALIZED_RANK_WEIGHTS.occasionMax *
    strongestTagWeightMatch(row, context.affinity.occasionTagWeights)

  const visualBoost = computeVisualSimilarityBoost({
    tasteVector: context.affinity.tasteVector,
    tasteSignalCount: context.affinity.tasteSignalCount,
    candidateEmbedding: context.candidateEmbeddings?.get(row.id),
  })

  // §4.2/§4.4 availability_boost — a soft nudge toward pros with real near-term
  // openings; 0 when the pro has no availability row (no opening in the horizon).
  // §4.3/§4.3.2: the session-intent multiplier leans the bookable/inspiration mix.
  const availabilityBoost = computeAvailabilityBoost({
    signal: context.availabilitySignals?.get(row.professionalId),
    now: context.now,
    weightMultiplier: context.availabilityWeightMultiplier,
  })

  // §6.7 post-booking relationship — a pro the viewer has completed a visit with;
  // 0 when the viewer has no booked relationship with this pro (empty map).
  const relationshipBoost = computeRelationshipBoost({
    signal: context.affinity.relationshipSignals?.get(row.professionalId),
    now: context.now,
  })

  // §4.2/§4.5 underbooked fairness on-ramp — a modest lift for a bookable but
  // under-discovered pro. Off entirely unless the caller wired underbookedSignals
  // (byte-identical to the pre-§4.5 feed otherwise). The bookability gate reuses
  // the availability map: a pro with an availability row has a real near-term
  // opening. Absent-from-the-map pro = no badge-stat row = 0 completed bookings =
  // maximally under-discovered (so a brand-new pro gets the full on-ramp).
  const underbookedBoost = context.underbookedSignals
    ? computeUnderbookedProBoost({
        completedBookingCount30d:
          context.underbookedSignals.get(row.professionalId)
            ?.completedBookingCount30d ?? 0,
        isBookable:
          context.availabilitySignals?.has(row.professionalId) ?? false,
      })
    : 0

  const freshnessBoost = computePersonalizedFreshnessBoost(
    row.publishedAt,
    context.now,
  )

  const seenPenalty = context.seenLookIds.has(row.id)
    ? PERSONALIZED_RANK_WEIGHTS.seen
    : 0

  return (
    base +
    followBoost +
    categoryBoost +
    occasionBoost +
    visualBoost +
    availabilityBoost +
    relationshipBoost +
    underbookedBoost +
    freshnessBoost -
    seenPenalty -
    suppressionPenalty
  )
}

/**
 * Strongest single tag match wins (clamped to [0, 1]) — matching both #bridal
 * and #wedding on one look is the same occasion said twice, not double the
 * signal, so weights are NOT summed across tags. Generic over any slug→weight
 * map, so the §4.4 board feed reuses it for its occasion term. Pure + exported.
 */
export function strongestTagWeightMatch(
  row: Pick<PersonalizedRankableRow, 'tags'>,
  tagWeights: ReadonlyMap<string, number>,
): number {
  if (tagWeights.size === 0) return 0

  const tags = row.tags
  if (!Array.isArray(tags) || tags.length === 0) return 0

  let strongest = 0
  for (const tag of tags) {
    const slug = typeof tag?.slug === 'string' ? tag.slug.trim() : ''
    if (!slug) continue
    const weight = safeNumber(tagWeights.get(slug) ?? 0)
    if (weight > strongest) strongest = weight
  }

  return Math.min(Math.max(strongest, 0), 1)
}

// Deterministic tie-break mirrors the DB RANKED order (rankScore desc,
// publishedAt desc, id desc) so equal personalized scores fall back to the
// global ordering rather than an arbitrary sort.
function comparePersonalized(
  a: { row: PersonalizedRankableRow; score: number },
  b: { row: PersonalizedRankableRow; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score
  if (b.row.rankScore !== a.row.rankScore) {
    return b.row.rankScore - a.row.rankScore
  }
  const aTime = a.row.publishedAt?.getTime() ?? 0
  const bTime = b.row.publishedAt?.getTime() ?? 0
  if (bTime !== aTime) return bTime - aTime
  return b.row.id < a.row.id ? -1 : b.row.id > a.row.id ? 1 : 0
}

/**
 * Re-rank a candidate set by personalized score, returning a NEW array
 * ordered best-first. Does not mutate the input.
 */
export function rankPersonalizedRows<T extends PersonalizedRankableRow>(
  rows: readonly T[],
  context: PersonalizedRankContext,
): T[] {
  return rows
    .map((row) => ({ row, score: computePersonalizedScore(row, context) }))
    .sort(comparePersonalized)
    .map((entry) => entry.row)
}
