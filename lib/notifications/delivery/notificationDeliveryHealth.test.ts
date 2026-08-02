import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { resetApnsAuthKeyCacheForTests } from '../config'
import {
  APNS_CREDENTIAL_REJECTED_ERROR_CODES,
  evaluateNotificationDeliveryHealth,
  FAILED_FINAL_ALERT_THRESHOLD,
  FAILED_RETRYABLE_ALERT_THRESHOLD,
} from './notificationDeliveryHealth'

const APNS_VARS = [
  'APNS_AUTH_KEY',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_BUNDLE_ID',
] as const

function clearApnsEnv() {
  for (const name of APNS_VARS) delete process.env[name]
  resetApnsAuthKeyCacheForTests()
}

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
  credentialRejected?: number
}) {
  mocks.groupBy.mockImplementation(
    async (args: { by: readonly string[] }) => {
      if (args.by.includes('status')) return opts.byStatus ?? []
      if (args.by.includes('lastErrorCode')) return opts.errors ?? []
      return []
    },
  )
  // Two different count() queries now share this mock — discriminate on the
  // where clause so a "stuck" fixture can't leak into the credential count.
  mocks.count.mockImplementation(
    async (args: { where?: { lastErrorCode?: { in?: string[] } } }) => {
      if (args.where?.lastErrorCode?.in) return opts.credentialRejected ?? 0
      return opts.stuck ?? 0
    },
  )
}

describe('evaluateNotificationDeliveryHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearApnsEnv()
  })
  afterEach(clearApnsEnv)

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

  // ── Regression: the exact prod shape this probe reported "healthy" through ──
  //
  // Production ran for weeks with every APNs push failing. Each failure was
  // FAILED_RETRYABLE (so failedFinalCount stayed 0, under its threshold) and
  // none were PENDING/PROCESSING (so stuckCount stayed 0). Both existing checks
  // were structurally incapable of seeing it.
  it('is UNHEALTHY for a retryable-failure spike with zero terminal failures and zero stuck', async () => {
    setup({
      byStatus: [
        { status: NotificationDeliveryStatus.SENT, _count: { _all: 1 } },
        {
          status: NotificationDeliveryStatus.FAILED_RETRYABLE,
          _count: { _all: FAILED_RETRYABLE_ALERT_THRESHOLD + 1 },
        },
      ],
      errors: [{ lastErrorCode: 'APNS_TRANSPORT_ERROR', _count: { _all: 11 } }],
      stuck: 0,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.failedFinalCount).toBe(0)
    expect(h.stuckCount).toBe(0)
    expect(h.failedRetryableCount).toBe(FAILED_RETRYABLE_ALERT_THRESHOLD + 1)
    expect(h.healthy).toBe(false)
    expect(h.reasons.join(' ')).toMatch(/retryable failures/)
  })

  it('tolerates the normal background rate of retryable failures', async () => {
    // 30 days of prod: 1–2 per hour is routine and must not page.
    setup({
      byStatus: [
        { status: NotificationDeliveryStatus.SENT, _count: { _all: 40 } },
        {
          status: NotificationDeliveryStatus.FAILED_RETRYABLE,
          _count: { _all: 2 },
        },
      ],
      stuck: 0,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.healthy).toBe(true)
  })

  it('is UNHEALTHY when APNs credentials are present but the key is unusable', async () => {
    setup({ stuck: 0 })

    process.env.APNS_AUTH_KEY =
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    process.env.APNS_KEY_ID = 'KEY123'
    process.env.APNS_TEAM_ID = 'TEAM456'
    process.env.APNS_BUNDLE_ID = 'com.tovis.app'
    resetApnsAuthKeyCacheForTests()

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.healthy).toBe(false)
    expect(h.providerConfigIssues).toHaveLength(1)
    expect(h.providerConfigIssues[0]).toMatch(/APNS_AUTH_KEY/)
  })

  // Production, 2026-08-01: the .p8 parsed (so the env-side check above was
  // clean) and APNs answered 403 InvalidProviderToken to every send. Nothing in
  // the probe could see that — the volume thresholds were the only thing that
  // would have fired, and only because one phone carried 13 stale device tokens.
  it('is UNHEALTHY on a SINGLE credential rejection, with zero stuck and no failure spike', async () => {
    setup({
      byStatus: [
        {
          status: NotificationDeliveryStatus.FAILED_FINAL,
          _count: { _all: 1 },
        },
      ],
      stuck: 0,
      credentialRejected: 1,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.credentialRejectedCount).toBe(1)
    expect(h.healthy).toBe(false)
    // Well under both volume thresholds — the rejection alone must carry it.
    expect(h.failedFinalCount).toBeLessThan(FAILED_FINAL_ALERT_THRESHOLD)
    expect(h.stuckCount).toBe(0)
    expect(h.providerConfigIssues).toHaveLength(1)
    expect(h.providerConfigIssues[0]).toMatch(/InvalidProviderToken/)
    // The message must name the knobs to check, not just the symptom.
    expect(h.providerConfigIssues[0]).toMatch(/APNS_KEY_ID/)
    expect(h.providerConfigIssues[0]).toMatch(/APNS_TEAM_ID/)
    expect(h.reasons).toContain(h.providerConfigIssues[0])
  })

  it('asks the credential query for every rejection code, over the health window', async () => {
    setup({ stuck: 0, credentialRejected: 0 })

    await evaluateNotificationDeliveryHealth({ now: NOW, windowMinutes: 30 })

    const call = mocks.count.mock.calls.find(
      (c) => (c[0] as { where?: { lastErrorCode?: unknown } }).where
        ?.lastErrorCode,
    )?.[0] as {
      where: { createdAt: { gte: Date }; lastErrorCode: { in: string[] } }
    }

    expect(call.where.createdAt.gte).toEqual(
      new Date(NOW.getTime() - 30 * 60_000),
    )
    expect(call.where.lastErrorCode.in).toEqual([
      ...APNS_CREDENTIAL_REJECTED_ERROR_CODES,
    ])
    // The reason apns2 already self-heals must NOT be in the set, or every
    // routine token refresh would page.
    expect(call.where.lastErrorCode.in).not.toContain('ExpiredProviderToken')
    expect(call.where.lastErrorCode.in).toContain('InvalidProviderToken')
  })

  // A/B against the test above: byte-identical fixture except credentialRejected
  // 1 → 0, so `healthy` can only have flipped on the credential signal.
  it('stays healthy when no delivery was refused for credentials', async () => {
    setup({
      byStatus: [
        {
          status: NotificationDeliveryStatus.FAILED_FINAL,
          _count: { _all: 1 },
        },
      ],
      stuck: 0,
      credentialRejected: 0,
    })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.credentialRejectedCount).toBe(0)
    expect(h.providerConfigIssues).toEqual([])
    expect(h.healthy).toBe(true)
  })

  it('reports no provider issue when APNs is simply absent', async () => {
    // Not configured is a deliberate state, not a fault — it must not page.
    setup({ stuck: 0 })

    const h = await evaluateNotificationDeliveryHealth({ now: NOW })

    expect(h.providerConfigIssues).toEqual([])
    expect(h.healthy).toBe(true)
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
