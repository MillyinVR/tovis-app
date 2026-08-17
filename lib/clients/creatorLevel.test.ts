import { describe, expect, it } from 'vitest'

import {
  CREATOR_BOOKINGS_LADDER,
  CREATOR_MAX_LEVEL,
  CREATOR_SAVES_LADDER,
  resolveCreatorLevel,
} from './creatorLevel'

describe('resolveCreatorLevel', () => {
  it('starts at level 0 with nothing, pointing at the first save', () => {
    const result = resolveCreatorLevel({
      savesOnYourLooks: 0,
      bookedFromYou: 0,
    })

    expect(result.level).toBe(0)
    expect(result.nextLevel).toBe(1)
    expect(result.nextLadder).toBe('saves')
    expect(result.remaining).toBe(1)
    expect(result.progress).toBe(0)
  })

  it('takes the HIGHER of the two ladders — saves ahead', () => {
    // 250 saves is level 3; 2 bookings is level 1.
    const result = resolveCreatorLevel({
      savesOnYourLooks: 250,
      bookedFromYou: 2,
    })

    expect(result.level).toBe(3)
  })

  it('takes the HIGHER of the two ladders — bookings ahead', () => {
    // 40 bookings is level 4; 5 saves is level 1. Either ladder alone would
    // under-rank this creator, which is the whole point of the max.
    const result = resolveCreatorLevel({
      savesOnYourLooks: 5,
      bookedFromYou: 40,
    })

    expect(result.level).toBe(4)
  })

  it('reports progress on the ladder the creator is FURTHEST along, not the one with the smaller remainder', () => {
    // Level 3 (250 saves). Remaining: 250 saves vs 38 bookings — a "smallest
    // remaining count" rule would pick bookings and tell a creator climbing the
    // saves ladder they are 38 bookings away. By fraction, saves is 0 (just
    // crossed the rung) and bookings is 0 too, so the saves tie-break holds.
    const result = resolveCreatorLevel({
      savesOnYourLooks: 375,
      bookedFromYou: 2,
    })

    expect(result.level).toBe(3)
    expect(result.nextLadder).toBe('saves')
    expect(result.nextLevel).toBe(4)
    expect(result.nextThreshold).toBe(500)
    expect(result.remaining).toBe(125)
    // Halfway from 250 to 500.
    expect(result.progress).toBeCloseTo(0.5, 5)
  })

  it('switches to the bookings ladder when that is the one being climbed', () => {
    // Level 2 either way (100 saves / 5 bookings). Saves sits exactly on its
    // rung floor (0%), bookings is 10 of the way from 5 to 15 (50%).
    const result = resolveCreatorLevel({
      savesOnYourLooks: 100,
      bookedFromYou: 10,
    })

    expect(result.level).toBe(2)
    expect(result.nextLadder).toBe('bookings')
    expect(result.nextThreshold).toBe(15)
    expect(result.remaining).toBe(5)
    expect(result.progress).toBeCloseTo(0.5, 5)
  })

  it('never reports a negative bar when the level came from the other ladder', () => {
    // Level 3 on saves; 0 bookings is BELOW the bookings ladder's level-3 floor
    // of 15, which is a negative fraction before clamping.
    const result = resolveCreatorLevel({
      savesOnYourLooks: 260,
      bookedFromYou: 0,
    })

    expect(result.level).toBe(3)
    expect(result.progress).toBeGreaterThanOrEqual(0)
    expect(result.nextLadder).toBe('saves')
  })

  it('caps at the top of the ladder with a full bar and nothing left to chase', () => {
    const result = resolveCreatorLevel({
      savesOnYourLooks: 100_000,
      bookedFromYou: 100_000,
    })

    expect(result.level).toBe(CREATOR_MAX_LEVEL)
    expect(result.nextLevel).toBeNull()
    expect(result.nextLadder).toBeNull()
    expect(result.nextThreshold).toBeNull()
    expect(result.remaining).toBeNull()
    expect(result.progress).toBe(1)
  })

  it('reaches the top from EITHER ladder alone', () => {
    expect(
      resolveCreatorLevel({ savesOnYourLooks: 1000, bookedFromYou: 0 }).level,
    ).toBe(CREATOR_MAX_LEVEL)
    expect(
      resolveCreatorLevel({ savesOnYourLooks: 0, bookedFromYou: 100 }).level,
    ).toBe(CREATOR_MAX_LEVEL)
  })

  it('treats negative and non-finite totals as zero rather than throwing', () => {
    expect(
      resolveCreatorLevel({ savesOnYourLooks: -5, bookedFromYou: Number.NaN })
        .level,
    ).toBe(0)
  })

  it('lands exactly on each rung of both ladders', () => {
    CREATOR_SAVES_LADDER.forEach((threshold, index) => {
      const result = resolveCreatorLevel({
        savesOnYourLooks: threshold,
        bookedFromYou: 0,
      })
      expect(result.level).toBe(index + 1)
    })

    CREATOR_BOOKINGS_LADDER.forEach((threshold, index) => {
      const result = resolveCreatorLevel({
        savesOnYourLooks: 0,
        bookedFromYou: threshold,
      })
      expect(result.level).toBe(index + 1)
    })
  })

  it('always leaves a positive remainder below the top', () => {
    // The level is the max of both ladders, so no ladder can already have
    // cleared the rung being reported — "0 to go" on an unreached level would
    // be a lie the UI would render as a finished bar.
    for (const saves of [0, 1, 99, 100, 249, 250, 499, 500, 999]) {
      for (const booked of [0, 1, 4, 5, 14, 15, 39, 40, 99]) {
        const result = resolveCreatorLevel({
          savesOnYourLooks: saves,
          bookedFromYou: booked,
        })
        if (result.nextLevel === null) continue
        expect(result.remaining).toBeGreaterThan(0)
      }
    }
  })
})
