import { describe, expect, it } from 'vitest'
import { NoShowFeeType } from '@prisma/client'

import type { ProNoShowSettingsDTO } from '@/lib/dto/noShowSettings'
import {
  buildCancellationPolicySnapshot,
  cancellationPolicyApplies,
  cancellationPolicyDisclosure,
  formatCancellationPolicy,
  parseCancellationPolicySnapshot,
} from '@/lib/noShowProtection/policyDisclosure'

function dto(over: Partial<ProNoShowSettingsDTO> = {}): ProNoShowSettingsDTO {
  return {
    enabled: true,
    feeType: NoShowFeeType.FLAT,
    feeFlatAmount: '25.00',
    feePercent: null,
    cancelWindowHours: 24,
    chargeNoShow: true,
    chargeLateCancel: true,
    ...over,
  }
}

describe('cancellationPolicyApplies', () => {
  it('false when disabled / no fee / no triggering event', () => {
    expect(cancellationPolicyApplies(dto({ enabled: false }))).toBe(false)
    expect(
      cancellationPolicyApplies(dto({ feeType: NoShowFeeType.FLAT, feeFlatAmount: null })),
    ).toBe(false)
    expect(
      cancellationPolicyApplies(
        dto({ feeType: NoShowFeeType.PERCENT, feePercent: null }),
      ),
    ).toBe(false)
    expect(
      cancellationPolicyApplies(dto({ chargeNoShow: false, chargeLateCancel: false })),
    ).toBe(false)
  })

  it('true for a configured, enabled flat or percent policy', () => {
    expect(cancellationPolicyApplies(dto())).toBe(true)
    expect(
      cancellationPolicyApplies(
        dto({ feeType: NoShowFeeType.PERCENT, feeFlatAmount: null, feePercent: 50 }),
      ),
    ).toBe(true)
  })
})

describe('formatCancellationPolicy', () => {
  it('flat, both events — names the amount, window, and both triggers', () => {
    const s = buildCancellationPolicySnapshot(dto())
    expect(s).not.toBeNull()
    const text = formatCancellationPolicy(s!)
    expect(text).toContain('$25.00')
    expect(text).toContain('24 hours')
    expect(text).toContain("don’t show up")
    expect(text).toContain('cancel within')
  })

  it('percent, no-show only — names the percent and only the no-show trigger', () => {
    const s = buildCancellationPolicySnapshot(
      dto({
        feeType: NoShowFeeType.PERCENT,
        feeFlatAmount: null,
        feePercent: 50,
        chargeLateCancel: false,
      }),
    )!
    const text = formatCancellationPolicy(s)
    expect(text).toContain('50% of the service price')
    expect(text).toContain("don’t show up")
    expect(text).not.toContain('cancel within')
  })

  it('late-cancel only — names only the cancel-window trigger', () => {
    const s = buildCancellationPolicySnapshot(dto({ chargeNoShow: false }))!
    const text = formatCancellationPolicy(s)
    expect(text).toContain('cancel within')
    expect(text).not.toContain("don’t show up")
  })

  it('cancellationPolicyDisclosure returns null when no policy applies', () => {
    expect(cancellationPolicyDisclosure(dto({ enabled: false }))).toBeNull()
  })
})

describe('buildCancellationPolicySnapshot', () => {
  it('captures only the chosen fee type', () => {
    const flat = buildCancellationPolicySnapshot(dto())!
    expect(flat.feeFlatAmount).toBe('25.00')
    expect(flat.feePercent).toBeNull()

    const percent = buildCancellationPolicySnapshot(
      dto({ feeType: NoShowFeeType.PERCENT, feeFlatAmount: '25.00', feePercent: 40 }),
    )!
    expect(percent.feeFlatAmount).toBeNull()
    expect(percent.feePercent).toBe(40)
  })

  it('returns null when no chargeable policy applies', () => {
    expect(buildCancellationPolicySnapshot(dto({ enabled: false }))).toBeNull()
  })
})

describe('parseCancellationPolicySnapshot', () => {
  it('round-trips a built snapshot', () => {
    const built = buildCancellationPolicySnapshot(dto())!
    const parsed = parseCancellationPolicySnapshot(
      JSON.parse(JSON.stringify(built)),
    )
    expect(parsed).toEqual(built)
  })

  it('rejects malformed / absent JSON', () => {
    expect(parseCancellationPolicySnapshot(null)).toBeNull()
    expect(parseCancellationPolicySnapshot(undefined)).toBeNull()
    expect(parseCancellationPolicySnapshot('nope')).toBeNull()
    expect(parseCancellationPolicySnapshot({ feeType: 'WAT' })).toBeNull()
    // Missing cancelWindowHours → invalid.
    expect(
      parseCancellationPolicySnapshot({ feeType: NoShowFeeType.FLAT }),
    ).toBeNull()
  })
})
