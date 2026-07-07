// lib/boards/context.test.ts
import { describe, expect, it } from 'vitest'
import { BoardType } from '@prisma/client'

import {
  BOARD_EVENT_PROXIMITY,
  BOARD_QUESTION_SETS,
  BOARD_TYPE_FEED_SIGNALS,
  BOARD_TYPE_VALUES,
  boardEventDateToYmd,
  boardTypeWantsEventDate,
  computeBoardEventProximity,
  daysUntilEvent,
  normalizeBoardAnswers,
  parseBoardContextInput,
  parseBoardEventDateYmd,
  parseBoardType,
} from './context'

const NOW = new Date('2026-07-08T12:00:00.000Z')

function utcDate(ymd: string): Date {
  const parsed = parseBoardEventDateYmd(ymd)
  if (!parsed) throw new Error(`bad test ymd: ${ymd}`)
  return parsed
}

describe('lib/boards/context', () => {
  describe('parseBoardType', () => {
    it('parses every enum value case-insensitively', () => {
      for (const type of BOARD_TYPE_VALUES) {
        expect(parseBoardType(type)).toBe(type)
        expect(parseBoardType(type.toLowerCase())).toBe(type)
        expect(parseBoardType(`  ${type}  `)).toBe(type)
      }
    })

    it('rejects unknown values and nullish input', () => {
      expect(parseBoardType('WEDDING')).toBeNull()
      expect(parseBoardType('')).toBeNull()
      expect(parseBoardType(null)).toBeNull()
      expect(parseBoardType(undefined)).toBeNull()
    })
  })

  describe('parseBoardEventDateYmd / boardEventDateToYmd', () => {
    it('round-trips a valid calendar date at UTC midnight', () => {
      const date = parseBoardEventDateYmd('2026-09-14')
      expect(date?.toISOString()).toBe('2026-09-14T00:00:00.000Z')
      expect(boardEventDateToYmd(date as Date)).toBe('2026-09-14')
    })

    it('rejects malformed, impossible and out-of-bounds dates', () => {
      expect(parseBoardEventDateYmd('2026-9-14')).toBeNull()
      expect(parseBoardEventDateYmd('09/14/2026')).toBeNull()
      expect(parseBoardEventDateYmd('2026-02-30')).toBeNull()
      expect(parseBoardEventDateYmd('2026-13-01')).toBeNull()
      expect(parseBoardEventDateYmd('0206-05-01')).toBeNull()
      expect(parseBoardEventDateYmd('2101-01-01')).toBeNull()
      expect(parseBoardEventDateYmd('')).toBeNull()
      expect(parseBoardEventDateYmd(null)).toBeNull()
    })
  })

  describe('boardTypeWantsEventDate', () => {
    it('is true only for bridal and prom', () => {
      const dated = BOARD_TYPE_VALUES.filter(boardTypeWantsEventDate)
      expect(dated.sort()).toEqual([BoardType.BRIDAL, BoardType.PROM])
    })
  })

  describe('question sets', () => {
    it('every type asks at most 3 questions (spec §7.2)', () => {
      for (const type of BOARD_TYPE_VALUES) {
        expect(BOARD_QUESTION_SETS[type].length).toBeLessThanOrEqual(3)
      }
    })

    it('GENERAL asks nothing', () => {
      expect(BOARD_QUESTION_SETS.GENERAL).toEqual([])
    })

    it('feed-signal tag slugs are in LookTag normalized form', () => {
      for (const type of BOARD_TYPE_VALUES) {
        for (const slug of BOARD_TYPE_FEED_SIGNALS[type].tagSlugs) {
          expect(slug).toMatch(/^[a-z0-9]{2,}$/)
        }
      }
    })
  })

  describe('normalizeBoardAnswers', () => {
    it('keeps known keys with valid option values and drops the rest', () => {
      expect(
        normalizeBoardAnswers(BoardType.BRIDAL, {
          hair_length: 'long',
          trial_timeline: 'not-an-option',
          dress_color: 'red', // a PROM key
          rogue: 'value',
        }),
      ).toEqual({ hair_length: 'long' })
    })

    it('trims values before matching', () => {
      expect(
        normalizeBoardAnswers(BoardType.NAILS, { occasion: ' vacation ' }),
      ).toEqual({ occasion: 'vacation' })
    })

    it('returns null when nothing valid remains', () => {
      expect(normalizeBoardAnswers(BoardType.BRIDAL, {})).toBeNull()
      expect(normalizeBoardAnswers(BoardType.BRIDAL, null)).toBeNull()
      expect(normalizeBoardAnswers(BoardType.BRIDAL, 'nope')).toBeNull()
      expect(normalizeBoardAnswers(BoardType.BRIDAL, ['a'])).toBeNull()
      expect(
        normalizeBoardAnswers(BoardType.GENERAL, { hair_length: 'long' }),
      ).toBeNull()
    })
  })

  describe('parseBoardContextInput', () => {
    it('passes through valid fields and leaves absent keys absent', () => {
      const result = parseBoardContextInput({
        type: 'bridal',
        eventDate: '2026-09-14',
        answers: { hair_length: 'long' },
      })
      expect(result).toEqual({
        ok: true,
        value: {
          type: BoardType.BRIDAL,
          eventDate: utcDate('2026-09-14'),
          answers: { hair_length: 'long' },
        },
      })

      const empty = parseBoardContextInput({ name: 'unrelated' })
      expect(empty).toEqual({ ok: true, value: {} })
      if (empty.ok) {
        expect('type' in empty.value).toBe(false)
        expect('eventDate' in empty.value).toBe(false)
      }
    })

    it('treats null / empty eventDate as an explicit clear', () => {
      const cleared = parseBoardContextInput({ eventDate: null })
      expect(cleared).toEqual({ ok: true, value: { eventDate: null } })
      expect(parseBoardContextInput({ eventDate: '' })).toEqual({
        ok: true,
        value: { eventDate: null },
      })
    })

    it('rejects malformed fields with a specific code', () => {
      expect(parseBoardContextInput({ type: 'WEDDING' })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BOARD_TYPE' },
      })
      expect(parseBoardContextInput({ eventDate: 'tomorrow' })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BOARD_EVENT_DATE' },
      })
      expect(parseBoardContextInput({ eventDate: 123 })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BOARD_EVENT_DATE' },
      })
      expect(parseBoardContextInput({ answers: 'nope' })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BOARD_ANSWERS' },
      })
      expect(parseBoardContextInput({ answers: ['a'] })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BOARD_ANSWERS' },
      })
    })
  })

  describe('computeBoardEventProximity', () => {
    it('returns the no-date baseline without an event date', () => {
      expect(computeBoardEventProximity(null, NOW)).toBe(
        BOARD_EVENT_PROXIMITY.noDateFactor,
      )
    })

    it('is full strength from the event day through the full window', () => {
      expect(computeBoardEventProximity(utcDate('2026-07-08'), NOW)).toBe(1)
      expect(computeBoardEventProximity(utcDate('2026-08-07'), NOW)).toBe(1)
    })

    it('tapers to the far floor for far-out events', () => {
      const nearTaper = computeBoardEventProximity(utcDate('2026-08-08'), NOW)
      expect(nearTaper).toBeLessThan(1)
      expect(nearTaper).toBeGreaterThan(BOARD_EVENT_PROXIMITY.farFloor)

      // ≥ taperEndDays out → pinned at the floor.
      expect(computeBoardEventProximity(utcDate('2027-06-01'), NOW)).toBe(
        BOARD_EVENT_PROXIMITY.farFloor,
      )
    })

    it('decays sharply to zero after the event passes (spec §6.2)', () => {
      const oneDayPast = computeBoardEventProximity(utcDate('2026-07-07'), NOW)
      expect(oneDayPast).toBeGreaterThan(0)
      expect(oneDayPast).toBeLessThan(1)

      expect(computeBoardEventProximity(utcDate('2026-07-05'), NOW)).toBe(0)
      expect(computeBoardEventProximity(utcDate('2026-01-01'), NOW)).toBe(0)
    })

    it('handles an invalid date defensively', () => {
      expect(computeBoardEventProximity(new Date('nope'), NOW)).toBe(
        BOARD_EVENT_PROXIMITY.noDateFactor,
      )
    })
  })

  describe('daysUntilEvent', () => {
    it('counts whole calendar days in the local calendar', () => {
      // "Today" late in the local evening still counts as the same calendar day.
      const today = new Date(2026, 6, 8, 23, 30)
      expect(daysUntilEvent('2026-07-08', today)).toBe(0)
      expect(daysUntilEvent('2026-07-09', today)).toBe(1)
      expect(daysUntilEvent('2026-08-19', today)).toBe(42)
      expect(daysUntilEvent('2026-07-07', today)).toBe(-1)
    })

    it('returns null for malformed input', () => {
      expect(daysUntilEvent('July 8', NOW)).toBeNull()
      expect(daysUntilEvent('', NOW)).toBeNull()
    })
  })
})
