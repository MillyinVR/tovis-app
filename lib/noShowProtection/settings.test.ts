import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoShowFeeType, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    proNoShowSettings: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}))

import {
  getProNoShowSettings,
  updateProNoShowSettings,
  ProNoShowSettingsValidationError,
  toProNoShowSettingsDTO,
} from '@/lib/noShowProtection/settings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getProNoShowSettings', () => {
  it('returns off-defaults when the pro has no row', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const dto = await getProNoShowSettings('pro_1')
    expect(dto).toEqual({
      enabled: false,
      feeType: NoShowFeeType.FLAT,
      feeFlatAmount: null,
      feePercent: null,
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    })
  })

  it('maps a persisted row to the DTO', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      feeType: NoShowFeeType.FLAT,
      feeFlatAmount: new Prisma.Decimal('25'),
      feePercent: null,
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: false,
    })
    const dto = await getProNoShowSettings('pro_1')
    expect(dto.enabled).toBe(true)
    expect(dto.feeFlatAmount).toBe('25.00')
    expect(dto.chargeLateCancel).toBe(false)
  })
})

describe('updateProNoShowSettings validation', () => {
  const base = {
    enabled: true,
    feeType: NoShowFeeType.FLAT,
    feeFlatAmount: '25.00',
    feePercent: null,
    chargeNoShow: true,
    chargeLateCancel: true,
  }

  it('persists a valid flat policy', async () => {
    mocks.upsert.mockResolvedValue({
      enabled: true,
      feeType: NoShowFeeType.FLAT,
      feeFlatAmount: new Prisma.Decimal('25'),
      feePercent: null,
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    })
    const dto = await updateProNoShowSettings({
      professionalId: 'pro_1',
      update: base,
    })
    expect(mocks.upsert).toHaveBeenCalledOnce()
    expect(dto.feeFlatAmount).toBe('25.00')
  })

  it('rejects enabling with no flat amount', async () => {
    await expect(
      updateProNoShowSettings({
        professionalId: 'pro_1',
        update: { ...base, feeFlatAmount: null },
      }),
    ).rejects.toBeInstanceOf(ProNoShowSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects enabling a percent policy with no percent', async () => {
    await expect(
      updateProNoShowSettings({
        professionalId: 'pro_1',
        update: {
          ...base,
          feeType: NoShowFeeType.PERCENT,
          feeFlatAmount: null,
          feePercent: null,
        },
      }),
    ).rejects.toBeInstanceOf(ProNoShowSettingsValidationError)
  })

  it('rejects a percent outside 1..100', async () => {
    await expect(
      updateProNoShowSettings({
        professionalId: 'pro_1',
        update: {
          ...base,
          feeType: NoShowFeeType.PERCENT,
          feeFlatAmount: null,
          feePercent: 250,
        },
      }),
    ).rejects.toBeInstanceOf(ProNoShowSettingsValidationError)
  })

  it('rejects a negative flat amount', async () => {
    await expect(
      updateProNoShowSettings({
        professionalId: 'pro_1',
        update: { ...base, feeFlatAmount: '-5' },
      }),
    ).rejects.toBeInstanceOf(ProNoShowSettingsValidationError)
  })

  it('allows disabling without a configured amount', async () => {
    mocks.upsert.mockResolvedValue({
      enabled: false,
      feeType: NoShowFeeType.FLAT,
      feeFlatAmount: null,
      feePercent: null,
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    })
    const dto = await updateProNoShowSettings({
      professionalId: 'pro_1',
      update: { ...base, enabled: false, feeFlatAmount: null },
    })
    expect(dto.enabled).toBe(false)
  })
})

describe('toProNoShowSettingsDTO', () => {
  it('renders a null flat amount as null', () => {
    const dto = toProNoShowSettingsDTO({
      enabled: false,
      feeType: NoShowFeeType.PERCENT,
      feeFlatAmount: null,
      feePercent: 20,
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    })
    expect(dto.feeFlatAmount).toBeNull()
    expect(dto.feePercent).toBe(20)
  })
})
