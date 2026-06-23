import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationDeliveryStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationDelivery: {
      groupBy: mocks.groupBy,
      count: mocks.count,
    },
  },
}))

import {
  evaluateNotificationDeliveryHealth,
  FAILED_FINAL_ALERT_THRESHOLD,
} from './notificationDeliveryHealth'

const NOW = new Date('2026-06-23T12:00:00.000Z')

type StatusRow = {
  status: NotificationDeliveryStatus
  _count: { _all: number }
}
type ErrorRow = { lastErrorCode: string; _count: { _all: number } }

function setup(opts: {
  byStatus?: StatusRow[]
  errors?: ErrorRow[]
  stuck?: number
}) {
  mocks.groupBy.mockImplementation(
    async (args: { by: readonly string[] }) => {
      if (args.by.includes('status')) return opts.byStatus ?? []
      if (args.by.includes('lastErrorCode')) return opts.errors ?? []
      return []
    },
  )
  mocks.count.mockResolvedValue(opts.stuck ?? 0)
}

describe('evaluateNotificationDeliveryHealth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is healthy with no stuck deliveries and few terminal failures', async () => {
    setup({
      byStatus: [
        { status: NotificationDeliveryStatus.SENT, _count: { _all: 100 } },
        {
          status: NotificationDeliveryStatus.FAILED_FINAL,
          _count: { _all: 1 },
        },
      ],
      stuck: 0,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.healthy).toBe(true)
    expect(h.countsByStatus.SENT).toBe(100)
    expect(h.failedFinalCount).toBe(1)
    expect(h.reasons).toEqual([])
  })

  it('is unhealthy when deliveries are stuck past their nextAttemptAt', async () => {
    setup({ stuck: 3 })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.healthy).toBe(false)
    expect(h.stuckCount).toBe(3)
    expect(h.reasons.join(' ')).toMatch(/overdue/)
  })

  it('is unhealthy when terminal failures exceed the threshold and surfaces top error codes', async () => {
    setup({
      byStatus: [
        {
          status: NotificationDeliveryStatus.FAILED_FINAL,
          _count: { _all: FAILED_FINAL_ALERT_THRESHOLD + 1 },
        },
      ],
      errors: [
        { lastErrorCode: 'PROVIDER_NOT_CONFIGURED', _count: { _all: 9 } },
      ],
      stuck: 0,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.healthy).toBe(false)
    expect(h.topErrorCodes[0]).toEqual({
      code: 'PROVIDER_NOT_CONFIGURED',
      count: 9,
    })
  })

  it('uses the configured overdue cutoff for the stuck query', async () => {
    setup({ stuck: 0 })

    await evaluateNotificationDeliveryHealth({
      now: NOW,
      windowMinutes: 30,
      overdueMinutes: 5,
    })

    const countArgs = mocks.count.mock.calls[0]?.[0] as {
      where: { nextAttemptAt: { lt: Date } }
    }
    expect(countArgs.where.nextAttemptAt.lt).toEqual(
      new Date(NOW.getTime() - 5 * 60_000),
    )
  })
})
