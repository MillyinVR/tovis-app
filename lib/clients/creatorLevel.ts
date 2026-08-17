// lib/clients/creatorLevel.ts
//
// The client-as-creator LEVEL — "Lvl 3" on `/client/me`.
//
// Tori's call (2026-08-17): a creator's level is the HIGHER of two ladders,
// saves-on-your-looks and bookings-from-your-looks. She picked "both, whichever
// is higher" over either alone, so a creator whose looks get saved widely and a
// creator whose looks actually get booked both progress, and neither ladder can
// hold the other back.
//
// LEVEL IS NOT TIER. Tier (`lib/clients/creatorTier.ts`) is percentile-based —
// a statement about where you stand against everyone else, recomputed by an
// hourly job, and it can go DOWN when other people out-perform you. Level is
// absolute and monotonic: it is a statement about your own totals only, so it
// never falls because someone else did well. The two are deliberately separate
// and render as separate things.
//
// WHY THIS FILE IS THE ONLY HOME FOR THE THRESHOLDS
// Both clients render the level, and a ladder re-typed in Swift is a ladder
// that drifts — the number under the progress bar would disagree with the
// number in the pill the first time either list is edited. The server computes
// the level and the progress; iOS renders what it is handed and owns no
// thresholds of its own.

/**
 * Saves-on-your-looks thresholds, level 1 through 5.
 *
 * Index `i` is the total needed to reach level `i + 1`, so the array length IS
 * {@link CREATOR_MAX_LEVEL}. Starting at 1 rather than 0 means the first save
 * anyone gives you is a visible event; level 0 is "nobody has saved a look of
 * yours yet", which is the honest empty state rather than a failing grade.
 */
export const CREATOR_SAVES_LADDER = [1, 100, 250, 500, 1000] as const

/**
 * Bookings-from-your-looks thresholds, level 1 through 5.
 *
 * Deliberately far shorter than the saves ladder: a booking is somebody
 * spending money on your taste, which is a much scarcer and much stronger
 * signal than a save. 100 bookings and 1000 saves are meant to be comparable
 * achievements, not comparable numbers.
 */
export const CREATOR_BOOKINGS_LADDER = [1, 5, 15, 40, 100] as const

/** The top of both ladders. They are the same length by construction. */
export const CREATOR_MAX_LEVEL = CREATOR_SAVES_LADDER.length

/** Which ladder a level or a progress reading came from. */
export type CreatorLadderKey = 'saves' | 'bookings'

export type CreatorLevelInputs = {
  /** Total saves across this creator's public looks. */
  savesOnYourLooks: number
  /** Total non-cancelled bookings attributed to this creator's looks. */
  bookedFromYou: number
}

export type CreatorLevelProgress = {
  /** 0 through {@link CREATOR_MAX_LEVEL}. 0 means "not on the ladder yet". */
  level: number
  /** The level being worked toward, or null at the top. */
  nextLevel: number | null
  /**
   * The ladder the creator is FURTHEST along toward the next level — the one
   * the progress line should talk about. Null at the top.
   */
  nextLadder: CreatorLadderKey | null
  /** {@link nextLadder}'s threshold for {@link nextLevel}, or null at the top. */
  nextThreshold: number | null
  /**
   * How many more saves (or bookings) on {@link nextLadder} are needed. Always
   * at least 1 below the top, and null at the top.
   */
  remaining: number | null
  /**
   * 0–1 along {@link nextLadder}'s current rung. 1 at the top of the ladder, so
   * a finished bar reads as finished rather than as an empty new one.
   */
  progress: number
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/** How many rungs of one ladder a total has cleared. */
function levelForLadder(
  ladder: readonly number[],
  value: number,
): number {
  let level = 0
  for (const threshold of ladder) {
    if (value < threshold) break
    level += 1
  }
  return level
}

/**
 * How far along `ladder`'s rung for `level → level + 1` a total sits, as 0–1.
 *
 * Clamped at the bottom because the level can come from the OTHER ladder: a
 * creator at level 3 on saves with zero bookings sits BELOW the bookings
 * ladder's level-3 floor, which is a negative fraction before clamping and
 * would draw a bar running backwards.
 */
function progressForLadder(
  ladder: readonly number[],
  value: number,
  level: number,
): number {
  if (level >= ladder.length) return 1
  const floor = level === 0 ? 0 : (ladder[level - 1] ?? 0)
  const ceiling = ladder[level] ?? floor
  const span = ceiling - floor
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (value - floor) / span))
}

/**
 * The creator's level and their progress toward the next one.
 *
 * The level is the max of the two ladders. The PROGRESS is reported for
 * whichever ladder the creator is furthest along by fraction — not by the
 * smaller remaining count, which would compare bookings against saves as if
 * they were the same unit and routinely tell a creator sitting on 300 saves
 * that they are "40 bookings away", ignoring the ladder they are actually
 * climbing.
 */
export function resolveCreatorLevel(
  inputs: CreatorLevelInputs,
): CreatorLevelProgress {
  const saves = clampCount(inputs.savesOnYourLooks)
  const booked = clampCount(inputs.bookedFromYou)

  const savesLevel = levelForLadder(CREATOR_SAVES_LADDER, saves)
  const bookingsLevel = levelForLadder(CREATOR_BOOKINGS_LADDER, booked)
  const level = Math.max(savesLevel, bookingsLevel)

  if (level >= CREATOR_MAX_LEVEL) {
    return {
      level: CREATOR_MAX_LEVEL,
      nextLevel: null,
      nextLadder: null,
      nextThreshold: null,
      remaining: null,
      progress: 1,
    }
  }

  const savesProgress = progressForLadder(CREATOR_SAVES_LADDER, saves, level)
  const bookingsProgress = progressForLadder(
    CREATOR_BOOKINGS_LADDER,
    booked,
    level,
  )

  // Ties go to saves: it is the broader signal and the one a creator with no
  // bookings at all is always on, so the tie at 0/0 reads as "get your first
  // save" rather than "get your first booking".
  const useSaves = savesProgress >= bookingsProgress
  const ladder = useSaves ? CREATOR_SAVES_LADDER : CREATOR_BOOKINGS_LADDER
  const value = useSaves ? saves : booked
  const nextThreshold = ladder[level] ?? null

  return {
    level,
    nextLevel: level + 1,
    nextLadder: useSaves ? 'saves' : 'bookings',
    nextThreshold,
    // `level` is the MAX of both ladders, so neither ladder has cleared this
    // rung: the remainder is always positive and never needs a zero floor to
    // avoid claiming "0 to go" on a level that has not been reached.
    remaining: nextThreshold === null ? null : nextThreshold - value,
    progress: useSaves ? savesProgress : bookingsProgress,
  }
}
