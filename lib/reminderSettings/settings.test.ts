import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    proReminderSettings: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}))

import {
  getProReminderSettings,
  resolveEnabledReminderOffsetDays,
  updateProReminderSettings,
  ProReminderSettingsValidationError,
} from '@/lib/reminderSettings/settings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getProReminderSettings', () => {
  it('returns the default cadence when the pro has no row', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const dto = await getProReminderSettings('pro_1')
    expect(dto).toEqual({ enabled: true, offsetDays: [7, 3, 1] })
  })

  it('normalizes a persisted row (drops unsupported, dedupes, sorts desc)', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      offsetDays: [1, 3, 3, 99, 7],
    })
    const dto = await getProReminderSettings('pro_1')
    expect(dto).toEqual({ enabled: true, offsetDays: [7, 3, 1] })
  })
})

describe('resolveEnabledReminderOffsetDays', () => {
  it('returns the default cadence when the pro has no row', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const offsets = await resolveEnabledReminderOffsetDays({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([7, 3, 1])
  })

  it('returns an empty list when reminders are disabled', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: false,
      offsetDays: [7, 3, 1],
    })
    const offsets = await resolveEnabledReminderOffsetDays({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([])
  })

  it('normalizes the stored offsets it returns', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      offsetDays: [1, 7],
    })
    const offsets = await resolveEnabledReminderOffsetDays({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([7, 1])
  })
})

describe('updateProReminderSettings', () => {
  it('persists a normalized cadence and returns the DTO', async () => {
    mocks.upsert.mockResolvedValue({ enabled: true, offsetDays: [7, 3] })

    const dto = await updateProReminderSettings({
      professionalId: 'pro_1',
      update: { enabled: true, offsetDays: [3, 7, 3] },
    })

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        create: { professionalId: 'pro_1', enabled: true, offsetDays: [7, 3] },
        update: { enabled: true, offsetDays: [7, 3] },
      }),
    )
    expect(dto).toEqual({ enabled: true, offsetDays: [7, 3] })
  })

  it('rejects an unsupported offset value', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: { enabled: true, offsetDays: [7, 5] },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a non-array offsets payload', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        // @ts-expect-error — exercising the runtime guard against bad input
        update: { enabled: true, offsetDays: 'nope' },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('allows turning reminders off with an empty cadence', async () => {
    mocks.upsert.mockResolvedValue({ enabled: false, offsetDays: [] })

    const dto = await updateProReminderSettings({
      professionalId: 'pro_1',
      update: { enabled: false, offsetDays: [] },
    })

    expect(dto).toEqual({ enabled: false, offsetDays: [] })
  })
})
