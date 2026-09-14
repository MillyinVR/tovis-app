import { describe, expect, it } from 'vitest'

import {
  CONSULT_HAIR_LEVELS,
  CONSULT_HAIR_LEVEL_DEPTH,
  CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT,
  consultHairLevelNumber,
  consultHairLevelScalePromptText,
  consultHairUnderlyingPigmentPromptText,
  type ConsultHairLevel,
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

describe('consultHairUnderlyingPigmentPromptText', () => {
  const text = consultHairUnderlyingPigmentPromptText()

  it('names every level the swatch card covers, with its complement', () => {
    for (const level of Object.keys(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT) as Exclude<
      ConsultHairLevel,
      'UNKNOWN'
    >[]) {
      const pigment = CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT[level]
      if (!pigment) continue
      expect(text).toContain(
        `${consultHairLevelNumber(level)} exposes ${pigment.exposes} (cancelled by ${pigment.neutralizedBy})`,
      )
    }
  })

  it('says level 1 is not on the card instead of inventing a pigment for it', () => {
    // ⚠️ Tori's physical card starts at level 2. A model told nothing about
    // black would fill the gap; this says the gap out loud.
    expect(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT.LEVEL_1).toBeNull()
    expect(text).toContain('Level 1 is not on this list')
    expect(text).toContain('do not guess')
  })

  it('carries the card, NOT the web charts — they run a level warm', () => {
    // 🔴 The web source says orange at 6 and orange-yellow at 7. The card says
    // red-orange at 6 and orange at 7, and the card is the professional tool.
    // If this test ever fails, someone "corrected" the table back to a chart.
    expect(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT.LEVEL_6?.exposes).toBe('red-orange')
    expect(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT.LEVEL_7?.exposes).toBe('orange')
    expect(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT.LEVEL_8?.exposes).toBe('yellow-orange')
  })

  it('says a lift travels THROUGH the levels between, not just to the last one', () => {
    // The whole point: "4 to 8" is a journey through red and orange, not one
    // row of a table, and that is what makes a multi-visit answer honest.
    expect(text).toContain('passes through every level between')
    expect(text.toLowerCase()).toContain('more than one visit')
  })

  it('never leaks an internal enum spelling into prompt prose', () => {
    expect(text).not.toMatch(/LEVEL_\d/)
  })
})
