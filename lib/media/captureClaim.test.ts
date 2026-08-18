// lib/media/captureClaim.test.ts
import { describe, expect, it } from 'vitest'

import { parseCapturedAtClaimed, parseSha256Hex } from './captureClaim'

describe('parseSha256Hex', () => {
  it('accepts a valid lowercase hex sha256', () => {
    const value = 'a'.repeat(64)
    expect(parseSha256Hex(value)).toBe(value)
  })

  it('lowercases and trims a valid checksum', () => {
    expect(parseSha256Hex(`  ${'AB'.repeat(32)}  `)).toBe('ab'.repeat(32))
  })

  it.each([
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['non-hex characters', 'z'.repeat(64)],
    ['not a string', 12345],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('degrades to null for %s, never throws', (_label, value) => {
    expect(parseSha256Hex(value)).toBeNull()
  })
})

describe('parseCapturedAtClaimed', () => {
  it('parses a valid ISO string', () => {
    const result = parseCapturedAtClaimed('2026-08-17T12:00:00.000Z')
    expect(result).toEqual(new Date('2026-08-17T12:00:00.000Z'))
  })

  it('parses a valid epoch-millis number', () => {
    const ms = Date.parse('2026-08-17T12:00:00.000Z')
    expect(parseCapturedAtClaimed(ms)).toEqual(new Date(ms))
  })

  it('does not reject a claim far in the past or future — the claim is honest as-is', () => {
    expect(parseCapturedAtClaimed('1999-01-01T00:00:00.000Z')).toEqual(
      new Date('1999-01-01T00:00:00.000Z'),
    )
    expect(parseCapturedAtClaimed('2099-01-01T00:00:00.000Z')).toEqual(
      new Date('2099-01-01T00:00:00.000Z'),
    )
  })

  it.each([
    ['unparsable string', 'not-a-date'],
    ['not a string or number', true],
    ['null', null],
    ['undefined', undefined],
    ['an object', { foo: 'bar' }],
  ])('degrades to null for %s, never throws', (_label, value) => {
    expect(parseCapturedAtClaimed(value)).toBeNull()
  })
})
