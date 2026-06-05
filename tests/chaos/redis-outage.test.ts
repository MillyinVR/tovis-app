// tests/chaos/redis-outage.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  processDueDeliveries,
  type ProcessDueDeliveriesResult,
} from '@/lib/notifications/delivery/processDueDeliveries'
import type {
  EmailProviderSendRequest,
  InAppProviderSendRequest,
  NotificationDeliveryProvider,
  SmsProviderSendRequest,
} from '@/lib/notifications/delivery/providerTypes'

function createRedisOutageInAppProvider(): NotificationDeliveryProvider<InAppProviderSendRequest> {
  return {
    provider: NotificationProvider.INTERNAL_REALTIME,
    channel: NotificationChannel.IN_APP,
    async send() {
      throw new Error(
        'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.',
      )
    },
  }
}

function createUnusedSmsProvider(): NotificationDeliveryProvider<SmsProviderSendRequest> {
  return {
    provider: NotificationProvider.TWILIO,
    channel: NotificationChannel.SMS,
    async send() {
      throw new Error('Unexpected SMS provider call during Redis chaos test.')
    },
  }
}

function createUnusedEmailProvider(): NotificationDeliveryProvider<EmailProviderSendRequest> {
  return {
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    async send() {
      throw new Error('Unexpected email provider call during Redis chaos test.')
    },
  }
}

function expectValidProcessorResult(result: ProcessDueDeliveriesResult): void {
  expect(result).toEqual(
    expect.objectContaining({
      claimedCount: expect.any(Number),
      processedCount: expect.any(Number),
      sentCount: expect.any(Number),
      retryScheduledCount: expect.any(Number),
      finalFailureCount: expect.any(Number),
      orchestrationErrorCount: expect.any(Number),
      outcomes: expect.any(Array),
    }),
  )
}

describe('chaos: Redis outage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not crash the notification delivery processor when Redis-backed in-app delivery fails', async () => {
    const result = await processDueDeliveries({
      providers: {
        inApp: createRedisOutageInAppProvider(),
        sms: createUnusedSmsProvider(),
        email: createUnusedEmailProvider(),
      },
      claim: {
        now: new Date('2026-06-05T00:00:00.000Z'),
        batchSize: 25,
      },
    })

    expectValidProcessorResult(result)

    expect(result.processedCount).toBe(result.outcomes.length)
    expect(result.claimedCount).toBeGreaterThanOrEqual(result.processedCount)
  })
})