import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientFindMany: vi.fn(),
  clientUpsert: vi.fn(),
  proFindMany: vi.fn(),
  proUpsert: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientNotificationPreference: {
      findMany: mocks.clientFindMany,
      upsert: mocks.clientUpsert,
    },
    professionalNotificationPreference: {
      findMany: mocks.proFindMany,
      upsert: mocks.proUpsert,
    },
    $transaction: mocks.transaction,
  },
}))

import { getAudienceEventKeys } from './preferenceCategories'
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from './preferenceService'

describe('loadNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientFindMany.mockResolvedValue([])
  })

  it('defaults quiet hours ON at 22:00–08:00 when never configured', async () => {
    mocks.clientFindMany.mockResolvedValue([])

    const result = await loadNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
    })

    expect(result.quietHours).toEqual({
      enabled: true,
      startMinutes: 1320,
      endMinutes: 480,
    })
    expect(mocks.clientFindMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      select: expect.any(Object),
    })
  })

  it('reads a stored custom quiet-hours window', async () => {
    mocks.clientFindMany.mockResolvedValue([
      {
        eventKey: 'BOOKING_CONFIRMED',
        inAppEnabled: true,
        smsEnabled: false,
        emailEnabled: true,
        quietHoursStartMinutes: 600,
        quietHoursEndMinutes: 900,
      },
    ])

    const result = await loadNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
    })

    expect(result.quietHours).toEqual({
      enabled: true,
      startMinutes: 600,
      endMinutes: 900,
    })
    expect(result.events.BOOKING_CONFIRMED).toEqual({
      inAppEnabled: true,
      smsEnabled: false,
      emailEnabled: true,
    })
  })

  it('treats equal start/end as an explicit OFF', async () => {
    mocks.clientFindMany.mockResolvedValue([
      {
        eventKey: 'BOOKING_CONFIRMED',
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
      },
    ])

    const result = await loadNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
    })

    expect(result.quietHours.enabled).toBe(false)
  })

  it('reports all channels enabled for events with no stored row', async () => {
    mocks.clientFindMany.mockResolvedValue([])

    const result = await loadNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
    })

    expect(result.events.BOOKING_CONFIRMED).toEqual({
      inAppEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
    })
  })
})

describe('saveNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientFindMany.mockResolvedValue([])
    mocks.proFindMany.mockResolvedValue([])
    mocks.clientUpsert.mockImplementation((args: unknown) => args)
    mocks.proUpsert.mockImplementation((args: unknown) => args)
    mocks.transaction.mockResolvedValue([])
  })

  it('upserts a row for every audience event key, owner-scoped', async () => {
    await saveNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
      events: [
        {
          eventKey: getAudienceEventKeys('client')[0]!,
          channels: { inAppEnabled: true, smsEnabled: false, emailEnabled: true },
        },
      ],
      quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
    })

    const expectedCount = getAudienceEventKeys('client').length
    expect(mocks.clientUpsert).toHaveBeenCalledTimes(expectedCount)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)

    for (const call of mocks.clientUpsert.mock.calls) {
      expect(call[0].where.clientId_eventKey.clientId).toBe('client_1')
      expect(call[0].create.clientId).toBe('client_1')
    }
  })

  it('persists the 0/0 OFF sentinel when quiet hours are disabled', async () => {
    await saveNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
      events: [],
      quietHours: { enabled: false, startMinutes: 1320, endMinutes: 480 },
    })

    const first = mocks.clientUpsert.mock.calls[0]?.[0]
    expect(first.update.quietHoursStartMinutes).toBe(0)
    expect(first.update.quietHoursEndMinutes).toBe(0)
  })

  it('writes the enabled window to every row', async () => {
    await saveNotificationPreferences({
      audience: 'pro',
      ownerId: 'pro_1',
      events: [],
      quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
    })

    for (const call of mocks.proUpsert.mock.calls) {
      expect(call[0].update.quietHoursStartMinutes).toBe(1320)
      expect(call[0].update.quietHoursEndMinutes).toBe(480)
      expect(call[0].where.professionalId_eventKey.professionalId).toBe('pro_1')
    }
  })

  it('preserves stored channel state for events not in the payload', async () => {
    const key = getAudienceEventKeys('client')[1]!
    mocks.clientFindMany.mockResolvedValue([
      {
        eventKey: key,
        inAppEnabled: true,
        smsEnabled: false,
        emailEnabled: false,
        quietHoursStartMinutes: null,
        quietHoursEndMinutes: null,
      },
    ])

    await saveNotificationPreferences({
      audience: 'client',
      ownerId: 'client_1',
      events: [],
      quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
    })

    const call = mocks.clientUpsert.mock.calls.find(
      (c) => c[0].where.clientId_eventKey.eventKey === key,
    )
    expect(call?.[0].update.smsEnabled).toBe(false)
    expect(call?.[0].update.emailEnabled).toBe(false)
  })
})
