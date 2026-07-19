// lib/format/compactCount.test.ts
import { describe, expect, it } from 'vitest'

import { formatCompactCount } from './compactCount'

describe('formatCompactCount', () => {
  it('leaves counts below 1,000 alone', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(1)).toBe('1')
    expect(formatCompactCount(999)).toBe('999')
  })

  it('abbreviates thousands with at most one fraction digit and no trailing .0', () => {
    expect(formatCompactCount(1_000)).toBe('1K')
    expect(formatCompactCount(1_500)).toBe('1.5K')
    // The looks rail used to render this bare ("9999") — it abbreviates now.
    expect(formatCompactCount(9_999)).toBe('10K')
    expect(formatCompactCount(10_500)).toBe('10.5K')
    expect(formatCompactCount(100_500)).toBe('100.5K')
  })

  it('rolls over to M instead of reporting a four-digit K', () => {
    // The pro-profile manager rendered "1000K" here; the comments drawer
    // "1000.0K". Both were wrong — this is the headline consolidation fix.
    expect(formatCompactCount(999_999)).toBe('1M')
    expect(formatCompactCount(1_000_000)).toBe('1M')
    expect(formatCompactCount(1_200_000)).toBe('1.2M')
    expect(formatCompactCount(12_345_678)).toBe('12.3M')
  })

  it('keeps going above a million (the rail used to clamp at 999,999)', () => {
    expect(formatCompactCount(1_000_000_000)).toBe('1B')
  })

  it('normalizes junk input instead of rendering NaN', () => {
    expect(formatCompactCount(null)).toBe('0')
    expect(formatCompactCount(undefined)).toBe('0')
    expect(formatCompactCount(Number.NaN)).toBe('0')
    expect(formatCompactCount(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatCompactCount(-5)).toBe('0')
    expect(formatCompactCount(1_500.9)).toBe('1.5K')
  })

  it('reuses one formatter instance rather than building one per call', () => {
    // Guards the ICU-leak rule in this module's header: a formatter built
    // inside the function would allocate ~31KB of native state per call.
    const source = formatCompactCount.toString()
    expect(source).not.toContain('Intl.NumberFormat')
  })
})
