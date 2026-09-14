import { describe, expect, it } from 'vitest'

import {
  CONSULT_HAIR_LEVELS,
  CONSULT_HAIR_LEVEL_DEPTH,
  consultHairLevelNumber,
  consultHairLevelScalePromptText,
} from './hairLevel'

describe('the salon depth scale', () => {
  it('names every level the enum carries, and only those', () => {
    // The gap this closes: before 2026-09-13 only levels 1 and 10 were ever
    // described to a model. A level that exists in the enum and has no depth
    // name is a rung the model has to guess at.
    const named = Object.keys(CONSULT_HAIR_LEVEL_DEPTH).sort()
    const expected = CONSULT_HAIR_LEVELS.filter((level) => level !== 'UNKNOWN').sort()
    expect(named).toEqual([...expected])
  })

  it('runs dark to light with no repeated depth', () => {
    const names = Object.values(CONSULT_HAIR_LEVEL_DEPTH)
    expect(new Set(names).size).toBe(names.length)
    expect(CONSULT_HAIR_LEVEL_DEPTH.LEVEL_1).toBe('black')
    expect(CONSULT_HAIR_LEVEL_DEPTH.LEVEL_10).toBe('lightest blonde')
  })

  it('places the brown-to-blonde boundary where the salon scale does', () => {
    // The rung most likely to drift, and the one the client-facing copy in
    // lib/brand deliberately words differently. 6 is dark blonde on the
    // industry scale, not light brown.
    expect(CONSULT_HAIR_LEVEL_DEPTH.LEVEL_5).toBe('light brown')
    expect(CONSULT_HAIR_LEVEL_DEPTH.LEVEL_6).toBe('dark blonde')
    expect(CONSULT_HAIR_LEVEL_DEPTH.LEVEL_7).toBe('medium blonde')
  })
})

describe('consultHairLevelScalePromptText', () => {
  const text = consultHairLevelScalePromptText()

  it('renders all ten rungs with their number', () => {
    for (const level of CONSULT_HAIR_LEVELS) {
      if (level === 'UNKNOWN') continue
      expect(text).toContain(
        `${consultHairLevelNumber(level)} ${CONSULT_HAIR_LEVEL_DEPTH[level]}`,
      )
    }
  })

  it('tells the model that level is depth and never tone', () => {
    // Both schemas carry `tone` as its own observation. A model that folds
    // warmth into depth reads a warm 6 as a 7 and hands the plan a lift it
    // does not need.
    expect(text).toContain('DEPTH ONLY')
    expect(text.toLowerCase()).toContain('tone has its own field')
  })

  it('never leaks an internal enum spelling into prompt prose', () => {
    // `LEVEL_9`-style codes are what the follow-up guard throws rounds away
    // over; the scale text must speak in numbers and words.
    expect(text).not.toMatch(/LEVEL_\d/)
  })
})
