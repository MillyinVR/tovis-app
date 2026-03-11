// app/api/pro/calendar/blocked/_shared.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildBlockConflictWhere,
  clampRange,
  parseLocationIdInput,
  parseNoteInput,
  toDateOrNull,
  trimString,
  validateBlockWindow,
} from './_shared'

describe('blocked/_shared', () => {
  describe('trimString', () => {
    it('returns trimmed string for non-empty input', () => {
      expect(trimString('  hello  ')).toBe('hello')
    })

    it('returns null for empty or non-string input', () => {
      expect(trimString('   ')).toBeNull()
      expect(trimString(null)).toBeNull()
      expect(trimString(123)).toBeNull()
    })
  })

  describe('toDateOrNull', () => {
    it('parses valid ISO strings', () => {
      const value = toDateOrNull('2026-03-11T17:00:00.000Z')
      expect(value).toBeInstanceOf(Date)
      expect(value?.toISOString()).toBe('2026-03-11T17:00:00.000Z')
    })

    it('returns null for invalid input', () => {
      expect(toDateOrNull('not-a-date')).toBeNull()
      expect(toDateOrNull('')).toBeNull()
      expect(toDateOrNull(undefined)).toBeNull()
    })
  })

  describe('validateBlockWindow', () => {
    it('rejects end before or equal to start', () => {
      const start = new Date('2026-03-11T17:00:00.000Z')
      const same = new Date('2026-03-11T17:00:00.000Z')
      const before = new Date('2026-03-11T16:59:00.000Z')

      expect(validateBlockWindow(start, same)).toBe('End must be after start.')
      expect(validateBlockWindow(start, before)).toBe('End must be after start.')
    })

    it('rejects windows shorter than 15 minutes', () => {
      const start = new Date('2026-03-11T17:00:00.000Z')
      const end = new Date('2026-03-11T17:14:00.000Z')

      expect(validateBlockWindow(start, end)).toBe(
        'Block must be between 15 minutes and 24 hours.',
      )
    })

    it('rejects windows longer than 24 hours', () => {
      const start = new Date('2026-03-11T17:00:00.000Z')
      const end = new Date('2026-03-12T17:01:00.000Z')

      expect(validateBlockWindow(start, end)).toBe(
        'Block must be between 15 minutes and 24 hours.',
      )
    })

    it('accepts a valid window', () => {
      const start = new Date('2026-03-11T17:00:00.000Z')
      const end = new Date('2026-03-11T18:00:00.000Z')

      expect(validateBlockWindow(start, end)).toBeNull()
    })
  })

  describe('clampRange', () => {
    it('leaves ranges <= 180 days unchanged', () => {
      const from = new Date('2026-01-01T00:00:00.000Z')
      const to = new Date('2026-03-01T00:00:00.000Z')

      const result = clampRange(from, to)

      expect(result.from).toEqual(from)
      expect(result.to).toEqual(to)
    })

    it('clamps ranges > 180 days', () => {
      const from = new Date('2026-01-01T00:00:00.000Z')
      const to = new Date('2026-12-31T00:00:00.000Z')

      const result = clampRange(from, to)

      expect(result.from).toEqual(from)
      expect(result.to.getTime()).toBe(
        from.getTime() + 180 * 24 * 60 * 60_000,
      )
    })
  })

  describe('parseNoteInput', () => {
    it('handles undefined in post mode as explicit null', () => {
      expect(parseNoteInput(undefined, 'post')).toEqual({
        ok: true,
        isSet: true,
        value: null,
      })
    })

    it('handles undefined in patch mode as not set', () => {
      expect(parseNoteInput(undefined, 'patch')).toEqual({
        ok: true,
        isSet: false,
        value: null,
      })
    })

    it('normalizes null and blank strings to null', () => {
      expect(parseNoteInput(null, 'patch')).toEqual({
        ok: true,
        isSet: true,
        value: null,
      })

      expect(parseNoteInput('   ', 'patch')).toEqual({
        ok: true,
        isSet: true,
        value: null,
      })
    })

    it('trims valid strings', () => {
      expect(parseNoteInput('  Lunch break  ', 'patch')).toEqual({
        ok: true,
        isSet: true,
        value: 'Lunch break',
      })
    })

    it('rejects non-string non-null values', () => {
      expect(parseNoteInput(123, 'patch')).toEqual({ ok: false })
    })
  })

  describe('parseLocationIdInput', () => {
    it('accepts undefined and null as null', () => {
      expect(parseLocationIdInput(undefined)).toEqual({
        ok: true,
        value: null,
      })
      expect(parseLocationIdInput(null)).toEqual({
        ok: true,
        value: null,
      })
    })

    it('trims valid string ids', () => {
      expect(parseLocationIdInput('  loc_1  ')).toEqual({
        ok: true,
        value: 'loc_1',
      })
    })

    it('normalizes blank strings to null', () => {
      expect(parseLocationIdInput('   ')).toEqual({
        ok: true,
        value: null,
      })
    })

    it('rejects non-string values', () => {
      expect(parseLocationIdInput(42)).toEqual({ ok: false })
    })
  })

  describe('buildBlockConflictWhere', () => {
    it('builds location-aware overlap query when locationId is present', () => {
      const startsAt = new Date('2026-03-11T17:00:00.000Z')
      const endsAt = new Date('2026-03-11T18:00:00.000Z')

      const result = buildBlockConflictWhere({
        professionalId: 'pro_123',
        startsAt,
        endsAt,
        locationId: 'loc_1',
        excludeBlockId: 'block_1',
      })

      expect(result).toEqual({
        professionalId: 'pro_123',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        id: { not: 'block_1' },
        OR: [{ locationId: 'loc_1' }, { locationId: null }],
      })
    })

    it('builds pro-wide overlap query when locationId is null', () => {
      const startsAt = new Date('2026-03-11T17:00:00.000Z')
      const endsAt = new Date('2026-03-11T18:00:00.000Z')

      const result = buildBlockConflictWhere({
        professionalId: 'pro_123',
        startsAt,
        endsAt,
        locationId: null,
      })

      expect(result).toEqual({
        professionalId: 'pro_123',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      })
    })
  })
})