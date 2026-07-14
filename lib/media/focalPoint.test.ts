import { describe, expect, it } from 'vitest'

import {
  focalObjectPosition,
  focalObjectPositionFromCoords,
  resolveFocalPoint,
} from '@/lib/media/focalPoint'

describe('resolveFocalPoint', () => {
  it('returns a point for a valid normalized pair', () => {
    expect(resolveFocalPoint(0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('accepts the exact [0, 1] bounds', () => {
    expect(resolveFocalPoint(0, 0)).toEqual({ x: 0, y: 0 })
    expect(resolveFocalPoint(1, 1)).toEqual({ x: 1, y: 1 })
  })

  it('returns null when either coordinate is missing', () => {
    expect(resolveFocalPoint(0.5, null)).toBeNull()
    expect(resolveFocalPoint(null, 0.5)).toBeNull()
    expect(resolveFocalPoint(null, null)).toBeNull()
    expect(resolveFocalPoint(undefined, undefined)).toBeNull()
  })

  it('rejects out-of-range or non-finite coordinates (degrades to center)', () => {
    expect(resolveFocalPoint(-0.01, 0.5)).toBeNull()
    expect(resolveFocalPoint(0.5, 1.5)).toBeNull()
    expect(resolveFocalPoint(Number.NaN, 0.5)).toBeNull()
    expect(resolveFocalPoint(Number.POSITIVE_INFINITY, 0.5)).toBeNull()
  })
})

describe('focalObjectPosition', () => {
  it('formats a focal point as a percentage object-position', () => {
    expect(focalObjectPosition({ x: 0.25, y: 0.75 })).toBe('25% 75%')
  })

  it('maps the corners to 0% / 100%', () => {
    expect(focalObjectPosition({ x: 0, y: 0 })).toBe('0% 0%')
    expect(focalObjectPosition({ x: 1, y: 1 })).toBe('100% 100%')
  })

  it('rounds to one decimal place', () => {
    expect(focalObjectPosition({ x: 0.333, y: 0.6667 })).toBe('33.3% 66.7%')
  })

  it('returns undefined for a null focal (→ browser-default center)', () => {
    expect(focalObjectPosition(null)).toBeUndefined()
    expect(focalObjectPosition(undefined)).toBeUndefined()
  })
})

describe('focalObjectPositionFromCoords', () => {
  it('validates then formats in one call', () => {
    expect(focalObjectPositionFromCoords(0.4, 0.2)).toBe('40% 20%')
  })

  it('returns undefined for an invalid pair (center fallback)', () => {
    expect(focalObjectPositionFromCoords(null, 0.2)).toBeUndefined()
    expect(focalObjectPositionFromCoords(2, 0.2)).toBeUndefined()
  })
})
