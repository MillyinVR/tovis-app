// lib/looks/feedComposition.ts
//
// Pure feed-composition logic for the personalized Looks feed (spec §4.3 feed
// composition ratio + §4.3.1 diversity injection + §4.3.2 session intent). All
// three sub-sections share one small, clock-free, Prisma-free module so the
// composition math is unit-testable in isolation from request wiring.
//
// The personalized feed blends three things on top of the RANKED backbone:
//
//   1. Bookable-vs-inspiration lean (§4.3): every Look links to a bookable pro,
//      so "bookable-now" is realized as the availability_boost (spec §4.2/§4.4,
//      the per-pro ProfessionalAvailabilityStat primitive) — a SOFT re-rank
//      weight, never a hard filter. This module supplies the intent-scaled
//      MULTIPLIER on that weight (below), so a booking-minded session leans the
//      re-rank toward pros with real openings while an idle-browse session lets
//      inspiration lead. The ratio itself is observed (bookable/inspiration
//      counts on the feed meta), not hard-enforced — the blend is soft.
//
//   2. Diversity injection (§4.3.1): reserve a small share of every entry load
//      for high-quality content OUTSIDE the viewer's established taste graph, so
//      a confident graph doesn't narrow into a repetitive bubble (and so someone
//      who's never thought about microblading can still stumble into it). This
//      module sizes that reserved slice (explorationSlots) and interleaves it.
//
//   3. Session intent (§4.3.2): the 60/40-ish inspiration/bookable lean isn't
//      static — sessions have moods. Entry point (opened from an opening push →
//      book; opened cold → default) shifts BOTH knobs: book mode raises the
//      availability multiplier and trims exploration; dream mode lowers the
//      multiplier and widens exploration. In-session behavior can escalate the
//      intent the same way, via the client re-requesting with a stronger hint.
//
// Everything here is soft and additive: intent defaults to 'default' (neutral
// multiplier 1.0, byte-identical availability boost), and the exploration slice
// is gated on both a confident graph and the ENABLE_FEED_DIVERSITY_INJECTION
// flag, so with the flag off the plan reserves zero slots and the feed is
// unchanged.

/**
 * Per-session intent (spec §4.3.2). `default` is the neutral idle-browse lean;
 * `book` is a booking-minded session (opened from an opening push, or repeated
 * availability/pricing taps); `dream` is pure inspiration browsing. Unknown or
 * absent hints resolve to `default` — intent only ever softens or sharpens an
 * already-soft lean, so a bad hint costs nothing.
 */
export type SessionIntent = 'default' | 'book' | 'dream'

type CompositionProfile = {
  // Multiplier on the availability_boost weight (spec §4.2/§4.4) in the
  // personalized re-rank. 1.0 is the calibrated peak (availabilityMax 12, below
  // the category cap 15). `book` lifts it toward the follow band so a real
  // near-term opening can out-pull accumulated category taste; `dream` damps it
  // so calendar health barely nudges an inspiration-led feed.
  availabilityWeightMultiplier: number
  // Fraction of the entry page reserved for exploration content outside the
  // taste graph (spec §4.3.1's "~10–15%"). `book` trims it (a booking session
  // wants relevant, bookable content, not wandering); `dream` widens it slightly
  // (dreaming welcomes discovery).
  explorationShare: number
}

// Calibrated soft leans per intent. Tunable once real conversion data exists
// (spec §4.3 "tunable once real conversion data exists").
export const SESSION_INTENT_PROFILES: Record<SessionIntent, CompositionProfile> =
  {
    default: { availabilityWeightMultiplier: 1, explorationShare: 0.12 },
    book: { availabilityWeightMultiplier: 1.75, explorationShare: 0.08 },
    dream: { availabilityWeightMultiplier: 0.5, explorationShare: 0.15 },
  }

// A viewer needs a "confident enough" taste graph before reserving slots for
// exploration is meaningful — a cold viewer's whole feed is already exploration,
// and there's nothing "outside the graph" to contrast against. We proxy
// confidence by the count of distinct categories the viewer shows affinity for
// (likes/saves + declared board purposes + self-profile interests). Set
// conservatively so the initial affected population is small and grows naturally
// as graphs fill in — the cautious "dark-ish" rollout the epoch favors. Tunable.
export const EXPLORATION_MIN_AFFINITY_CATEGORIES = 4

// Hard cap on reserved exploration slots per load, independent of page size, so
// a large `limit` can't hand the feed over to off-graph content. A soft slice
// stays a slice.
export const EXPLORATION_SLOTS_CAP = 4

export type CompositionPlan = {
  intent: SessionIntent
  availabilityWeightMultiplier: number
  // How many reserved exploration slots this load should inject (0 = none: flag
  // off, thin graph, or a non-entry page).
  explorationSlots: number
}

/**
 * Parse the optional `intent` request hint into a SessionIntent. Lenient like
 * parseBooleanParam — every unrecognized value, including null, resolves to
 * `default`, since intent only softly leans an already-soft blend. Pure.
 */
export function parseSessionIntent(
  raw: string | null | undefined,
): SessionIntent {
  if (typeof raw !== 'string') return 'default'
  switch (raw.trim().toLowerCase()) {
    case 'book':
    case 'booking':
    case 'bookable':
      return 'book'
    case 'dream':
    case 'inspire':
    case 'inspiration':
      return 'dream'
    default:
      return 'default'
  }
}

/**
 * Resolve the composition plan for one feed load. `explorationSlots` is non-zero
 * only when diversity injection is enabled, this is an entry load, and the viewer
 * has a confident-enough graph — otherwise it is 0 and the feed is unchanged.
 * Slots = round(limit × intent.explorationShare), clamped to [0, cap]. Pure.
 */
export function resolveCompositionPlan(args: {
  intent: SessionIntent
  limit: number
  affinityCategoryCount: number
  diversityEnabled: boolean
  isEntryLoad: boolean
}): CompositionPlan {
  const profile = SESSION_INTENT_PROFILES[args.intent]

  const graphConfident =
    args.affinityCategoryCount >= EXPLORATION_MIN_AFFINITY_CATEGORIES

  const limit = Number.isFinite(args.limit) ? Math.max(0, args.limit) : 0
  const rawSlots =
    args.diversityEnabled && args.isEntryLoad && graphConfident
      ? Math.round(limit * profile.explorationShare)
      : 0
  const explorationSlots = Math.max(0, Math.min(rawSlots, EXPLORATION_SLOTS_CAP))

  return {
    intent: args.intent,
    availabilityWeightMultiplier: profile.availabilityWeightMultiplier,
    explorationSlots,
  }
}

/**
 * Interleave up to `slots` exploration items into the personalized order at
 * evenly-spaced positions, returning a NEW array (never mutates the inputs). The
 * personalized items keep their relative order and none are dropped — exploration
 * rides ON TOP, the same "never displace the backbone" contract the followed-pro
 * injection uses — so pagination (which rides the backbone cursor) is untouched.
 *
 * With `p` personalized items and `k = min(slots, exploration.length)` taken, the
 * j-th exploration item (1-based) is inserted after roughly j·p/(k+1)
 * personalized items, so a single exploration Look lands mid-page rather than
 * clustered at an edge. When there are no personalized items (an empty graph feed
 * — spec §4.7), the exploration items become the page. Pure.
 */
export function interleaveExploration<T>(
  personalized: readonly T[],
  exploration: readonly T[],
  slots: number,
): T[] {
  const take = Math.max(0, Math.min(Math.trunc(slots), exploration.length))
  if (take === 0) return [...personalized]

  const explore = exploration.slice(0, take)
  const p = personalized.length
  // Insertion index (into the personalized stream) for each exploration item.
  const positions = explore.map((_, j) => Math.round(((j + 1) * p) / (take + 1)))

  const result: T[] = []
  let e = 0
  for (let i = 0; i <= p; i += 1) {
    while (e < take && positions[e] === i) {
      result.push(explore[e] as T)
      e += 1
    }
    if (i < p) result.push(personalized[i] as T)
  }
  // Any exploration items whose position overshot p (shouldn't happen given the
  // formula, but keep the slice honest) trail the page rather than vanish.
  while (e < take) {
    result.push(explore[e] as T)
    e += 1
  }
  return result
}
