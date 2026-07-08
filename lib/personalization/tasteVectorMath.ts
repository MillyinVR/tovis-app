// lib/personalization/tasteVectorMath.ts
//
// Pure vector math for the §6.0 visual-taste layer — no Prisma, no server
// imports — so it is unit-testable in isolation and safe to import from both
// the taste-vector writer (lib/personalization/tasteVectors.ts) and the For You
// feed loader (lib/looks/forYouFeed.ts) without a circular dependency.
//
// Owns two operations:
//   1. computeWeightedTasteVector — the decayed, signal-weighted, L2-normalized
//      centroid that IS a taste vector (spec §6.0 "signal-weighted average").
//   2. blendSessionTasteVector — the §6.3 in-session overlay: fold the freshest
//      likes/saves from THIS sitting into the mature (daily-cron) taste vector at
//      request time, so the feed leans toward what you just engaged with before
//      the next recompute catches up.

import { LOOK_EMBEDDING_DIMENSIONS } from '@/lib/personalization/lookEmbedding'

export type TasteVectorSignal = {
  embedding: readonly number[]
  weight: number
}

/**
 * Weighted mean of the signal embeddings, L2-normalized so downstream cosine
 * similarity is a plain dot product against unit vectors. Returns null when
 * there is no usable signal (no entries, all weights zero, or a degenerate
 * zero-sum) — callers translate null into "delete any stored vector".
 * Pure + exported for unit testing.
 */
export function computeWeightedTasteVector(
  signals: readonly TasteVectorSignal[],
): number[] | null {
  const sum = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  let totalWeight = 0

  for (const signal of signals) {
    if (!Number.isFinite(signal.weight) || signal.weight <= 0) continue
    if (signal.embedding.length !== LOOK_EMBEDDING_DIMENSIONS) continue

    totalWeight += signal.weight
    for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
      sum[i] = (sum[i] ?? 0) + (signal.embedding[i] ?? 0) * signal.weight
    }
  }

  if (totalWeight <= 0) return null

  let normSquared = 0
  for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
    const mean = (sum[i] ?? 0) / totalWeight
    sum[i] = mean
    normSquared += mean * mean
  }
  if (normSquared <= 0) return null

  const norm = Math.sqrt(normSquared)
  for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
    sum[i] = (sum[i] ?? 0) / norm
  }

  return sum
}

/**
 * L2-normalize a full-dimension vector to a unit vector. Returns null for a
 * missing vector, a dimension mismatch, a non-finite component, or a zero-norm
 * input — every "not a usable direction" case collapses to null so callers can
 * treat it as "no visual signal". Pure.
 */
function normalizeVector(
  vector: readonly number[] | null | undefined,
): number[] | null {
  if (!vector || vector.length !== LOOK_EMBEDDING_DIMENSIONS) return null

  let normSquared = 0
  for (const component of vector) {
    if (!Number.isFinite(component)) return null
    normSquared += component * component
  }
  if (normSquared <= 0) return null

  const norm = Math.sqrt(normSquared)
  const out = new Array<number>(LOOK_EMBEDDING_DIMENSIONS)
  for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
    out[i] = (vector[i] ?? 0) / norm
  }
  return out
}

// Peak fraction by which a full sitting's fresh signals can rotate the mature
// taste vector toward this-session content. With storedPull fixed at 1, a
// steer of 0.6 rotates the effective direction ~31° at most — enough to "lean
// bridal-adjacent" this scroll without abandoning long-run taste. The stored
// direction always keeps the larger share.
export const SESSION_TASTE_STEER_MAX = 0.6

// How many fresh in-session signals reach full steer strength. A single fresh
// save nudges gently (~0.2 pull); three saved in one sitting reach the ceiling.
export const SESSION_TASTE_STEER_FULL_SIGNALS = 3

export type SessionTasteBlend = {
  // The effective taste direction to rank against this request (null = no
  // visual signal at all).
  vector: number[] | null
  // Effective confidence count fed to the visual boost's confidence ramp.
  signalCount: number
}

/**
 * §6.3 real-time adjustment: fold the freshest same-session like/save embeddings
 * into the viewer's mature (daily-cron) taste vector at request time.
 *
 *   - No fresh session signals → the stored vector passes through unchanged
 *     (byte-identical to the pre-§6.3 feed; the null-safe path).
 *   - No mature vector yet → the session alone seeds a low-confidence direction,
 *     so a brand-new viewer who saves three bridal Looks gets an immediate,
 *     modest bridal lean this scroll (confidence = the fresh-signal count).
 *   - Both present → the mature direction is rotated toward the fresh centroid,
 *     bounded by SESSION_TASTE_STEER_MAX, and the fresh signals also lift the
 *     confidence count.
 *
 * Pure + exported for unit testing.
 */
export function blendSessionTasteVector(args: {
  storedVector: readonly number[] | null | undefined
  storedSignalCount: number | null | undefined
  sessionSignals: readonly TasteVectorSignal[]
}): SessionTasteBlend {
  const storedCount =
    typeof args.storedSignalCount === 'number' &&
    Number.isFinite(args.storedSignalCount) &&
    args.storedSignalCount > 0
      ? args.storedSignalCount
      : 0

  const stored = normalizeVector(args.storedVector)

  // The fresh in-session centroid + the count of usable signals behind it. That
  // count both scales the steer and, absent a mature vector, seeds confidence.
  const usable = args.sessionSignals.filter(
    (signal) =>
      Number.isFinite(signal.weight) &&
      signal.weight > 0 &&
      signal.embedding.length === LOOK_EMBEDDING_DIMENSIONS,
  )
  const sessionCentroid = computeWeightedTasteVector(usable)
  const freshCount = usable.length

  if (!sessionCentroid || freshCount === 0) {
    return { vector: stored, signalCount: storedCount }
  }

  if (!stored) {
    return { vector: sessionCentroid, signalCount: freshCount }
  }

  const sessionPull =
    SESSION_TASTE_STEER_MAX *
    Math.min(freshCount / SESSION_TASTE_STEER_FULL_SIGNALS, 1)

  const blended = new Array<number>(LOOK_EMBEDDING_DIMENSIONS)
  for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
    blended[i] = (stored[i] ?? 0) + (sessionCentroid[i] ?? 0) * sessionPull
  }

  return {
    vector: normalizeVector(blended) ?? stored,
    signalCount: storedCount + freshCount,
  }
}
