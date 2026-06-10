import { describe, expect, it } from 'vitest'
import { toPrismaJson } from './prismaJson'

describe('toPrismaJson', () => {
  it('accepts plain nested JSON data and returns the same reference', () => {
    const value = {
      mon: { open: '09:00', close: '17:00', enabled: true },
      breaks: [{ start: '12:00', end: '12:30' }],
      note: null,
      count: 3,
    }

    expect(toPrismaJson(value)).toBe(value)
  })

  it('accepts arrays at the top level', () => {
    const value = [1, 'two', true, null, { nested: [] }]

    expect(toPrismaJson(value)).toBe(value)
  })

  it('rejects top-level null', () => {
    expect(() => toPrismaJson(null)).toThrow(/Prisma\.JsonNull/)
  })

  it('rejects undefined', () => {
    expect(() => toPrismaJson(undefined)).toThrow(/not JSON-serializable/)
  })

  it('rejects undefined nested inside an object', () => {
    expect(() => toPrismaJson({ a: { b: undefined } })).toThrow(/value\.a\.b/)
  })

  it('rejects functions', () => {
    expect(() => toPrismaJson({ handler: () => {} })).toThrow(
      /not JSON-serializable \(function\)/,
    )
  })

  it('rejects bigint', () => {
    expect(() => toPrismaJson({ big: BigInt(1) })).toThrow(/bigint/)
  })

  it('rejects non-finite numbers', () => {
    expect(() => toPrismaJson({ bad: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/,
    )
    expect(() => toPrismaJson([Number.NaN])).toThrow(/non-finite/)
  })

  it('rejects class instances and built-ins that are not plain objects', () => {
    expect(() => toPrismaJson({ when: new Date() })).toThrow(/plain object/)
    expect(() => toPrismaJson({ map: new Map() })).toThrow(/plain object/)
  })

  it('accepts null-prototype objects', () => {
    const value = Object.create(null) as Record<string, unknown>
    value.key = 'ok'

    expect(toPrismaJson(value)).toBe(value)
  })

  it('rejects circular references instead of overflowing the stack', () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(() => toPrismaJson(value)).toThrow(/circular/)
  })

  it('allows the same non-circular object to appear in two branches', () => {
    const shared = { reused: true }
    const value = { a: shared, b: shared }

    expect(toPrismaJson(value)).toBe(value)
  })

  it('reports the path of the offending value', () => {
    expect(() => toPrismaJson({ list: [{ deep: BigInt(1) }] })).toThrow(
      /value\.list\[0\]\.deep/,
    )
  })
})
