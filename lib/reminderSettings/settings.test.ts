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
  parseReminderLeadsToOffsetMinutes,
  resolveEnabledReminderOffsetMinutes,
  updateProReminderSettings,
  ProReminderSettingsValidationError,
} from '@/lib/reminderSettings/settings'

const DEFAULT_LEADS = [
  { minutes: 10080, value: 7, unit: 'days', label: '1 week before' },
  { minutes: 4320, value: 3, unit: 'days', label: '3 days before' },
  { minutes: 1440, value: 1, unit: 'days', label: '1 day before' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getProReminderSettings', () => {
  it('returns the default cadence when the pro has no row', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const dto = await getProReminderSettings('pro_1')
    expect(dto).toEqual({
      enabled: true,
      offsetMinutes: [10080, 4320, 1440],
      leads: DEFAULT_LEADS,
    })
  })

  it('normalizes a persisted row (drops out-of-bounds, dedupes, sorts desc)', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      // 200000 is above the 90-day ceiling → dropped; 4320 is duplicated.
      offsetMinutes: [1440, 4320, 4320, 200000, 10080],
    })
    const dto = await getProReminderSettings('pro_1')
    expect(dto).toEqual({
      enabled: true,
      offsetMinutes: [10080, 4320, 1440],
      leads: DEFAULT_LEADS,
    })
  })

  it('describes an hour-scale lead with the hours unit + label', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      offsetMinutes: [240],
    })
    const dto = await getProReminderSettings('pro_1')
    expect(dto.leads).toEqual([
      { minutes: 240, value: 4, unit: 'hours', label: '4 hours before' },
    ])
  })
})

describe('resolveEnabledReminderOffsetMinutes', () => {
  it('returns the default cadence when the pro has no row', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const offsets = await resolveEnabledReminderOffsetMinutes({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([10080, 4320, 1440])
  })

  it('returns an empty list when reminders are disabled', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: false,
      offsetMinutes: [10080, 4320, 1440],
    })
    const offsets = await resolveEnabledReminderOffsetMinutes({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([])
  })

  it('normalizes the stored offsets it returns', async () => {
    mocks.findUnique.mockResolvedValue({
      enabled: true,
      offsetMinutes: [1440, 240, 10080],
    })
    const offsets = await resolveEnabledReminderOffsetMinutes({
      professionalId: 'pro_1',
    })
    expect(offsets).toEqual([10080, 1440, 240])
  })
})

describe('parseReminderLeadsToOffsetMinutes', () => {
  it('converts days and hours to minutes', () => {
    expect(
      parseReminderLeadsToOffsetMinutes([
        { value: 7, unit: 'days' },
        { value: 4, unit: 'hours' },
      ]),
    ).toEqual([10080, 240])
  })

  it('coerces numeric strings', () => {
    expect(
      parseReminderLeadsToOffsetMinutes([{ value: '3', unit: 'days' }]),
    ).toEqual([4320])
  })

  it('maps malformed entries to NaN without dropping them (count preserved)', () => {
    const result = parseReminderLeadsToOffsetMinutes([
      { value: 2, unit: 'weeks' },
      { unit: 'days' },
      { value: 1, unit: 'hours' },
    ])
    expect(result).toHaveLength(3)
    expect(result[0]).toBeNaN()
    expect(result[1]).toBeNaN()
    expect(result[2]).toBe(60)
  })

  it('returns an empty list for a non-array', () => {
    expect(parseReminderLeadsToOffsetMinutes('nope')).toEqual([])
  })
})

describe('updateProReminderSettings', () => {
  it('persists a normalized cadence and returns the DTO', async () => {
    mocks.upsert.mockResolvedValue({ enabled: true, offsetMinutes: [10080, 4320] })

    const dto = await updateProReminderSettings({
      professionalId: 'pro_1',
      update: { enabled: true, offsetMinutes: [4320, 10080, 4320] },
    })

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        create: {
          professionalId: 'pro_1',
          enabled: true,
          offsetMinutes: [10080, 4320],
        },
        update: { enabled: true, offsetMinutes: [10080, 4320] },
      }),
    )
    expect(dto).toEqual({
      enabled: true,
      offsetMinutes: [10080, 4320],
      leads: [
        { minutes: 10080, value: 7, unit: 'days', label: '1 week before' },
        { minutes: 4320, value: 3, unit: 'days', label: '3 days before' },
      ],
    })
  })

  it('rejects a lead below the 1-hour minimum', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: { enabled: true, offsetMinutes: [10080, 45] },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a lead that is not a multiple of 15 minutes', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: { enabled: true, offsetMinutes: [100] },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a lead above the 90-day maximum', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: { enabled: true, offsetMinutes: [130000] },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a NaN lead (from a malformed structured reminder)', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: { enabled: true, offsetMinutes: [Number.NaN] },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects more than ten reminders', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        update: {
          enabled: true,
          offsetMinutes: [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660],
        },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a non-array offsets payload', async () => {
    await expect(
      updateProReminderSettings({
        professionalId: 'pro_1',
        // @ts-expect-error — exercising the runtime guard against bad input
        update: { enabled: true, offsetMinutes: 'nope' },
      }),
    ).rejects.toBeInstanceOf(ProReminderSettingsValidationError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('allows turning reminders off with an empty cadence', async () => {
    mocks.upsert.mockResolvedValue({ enabled: false, offsetMinutes: [] })

    const dto = await updateProReminderSettings({
      professionalId: 'pro_1',
      update: { enabled: false, offsetMinutes: [] },
    })

    expect(dto).toEqual({ enabled: false, offsetMinutes: [], leads: [] })
  })
})
