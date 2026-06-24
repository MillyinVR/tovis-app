// tests/chaos/redis-outage.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rootTenantContext } from '@/lib/tenant/context'
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventKey,
  NotificationProvider,
  NotificationRecipientKind,
  NotificationPriority,
} from '@prisma/client'

import type {
  ClaimedNotificationDelivery,
  ClaimDeliveriesResult,
} from '@/lib/notifications/delivery/claimDeliveries'
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

const mocks = vi.hoisted(() => ({
  claimDeliveries: vi.fn(),
  completeDeliveryAttempt: vi.fn(),
}))

vi.mock('@/lib/notifications/delivery/claimDeliveries', () => ({
  claimDeliveries: mocks.claimDeliveries,
}))

vi.mock('@/lib/notifications/delivery/completeDeliveryAttempt', () => ({
  completeDeliveryAttempt: mocks.completeDeliveryAttempt,
}))

const NOW = new Date('2026-06-05T00:00:00.000Z')
const LEASE_EXPIRES_AT = new Date('2026-06-05T00:01:00.000Z')
const LEASE_TOKEN = 'redis-chaos-lease-token'

function createClaimedInAppDelivery(): ClaimedNotificationDelivery {
  return {
    id: 'delivery_redis_outage_1',
    channel: NotificationChannel.IN_APP,
    provider: NotificationProvider.INTERNAL_REALTIME,
    status: NotificationDeliveryStatus.PENDING,
    destination: 'professional_redis_outage_1',
    templateKey: 'booking_confirmed',
    templateVersion: 1,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: NOW,
    lastAttemptAt: null,
    claimedAt: NOW,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    leaseToken: LEASE_TOKEN,
    providerMessageId: null,
    providerStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    suppressedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    dispatch: {
      id: 'dispatch_redis_outage_1',
      sourceKey: 'chaos:redis-outage:delivery-1',
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      recipientKind: NotificationRecipientKind.PRO,
      priority: NotificationPriority.NORMAL,
      userId: null,
      professionalId: 'professional_redis_outage_1',
      clientId: null,
      recipientInAppTargetId: 'professional_redis_outage_1',
      recipientPhone: null,
      recipientEmail: null,
      recipientTimeZone: 'America/Los_Angeles',
      notificationId: null,
      clientNotificationId: null,
      title: 'Booking confirmed',
      body: 'Your booking was confirmed.',
      href: '/pro/bookings/booking_redis_outage_1',
      payload: null,
      scheduledFor: NOW,
      cancelledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  }
}

function createRedisOutageClaimResult(): ClaimDeliveriesResult {
  return {
    now: NOW,
    claimedAt: NOW,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    deliveries: [createClaimedInAppDelivery()],
  }
}

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
    vi.clearAllMocks()

    mocks.claimDeliveries.mockResolvedValue(createRedisOutageClaimResult())
    mocks.completeDeliveryAttempt.mockResolvedValue(undefined)
  })

  it('does not crash the notification delivery processor when Redis-backed in-app delivery fails', async () => {
    const result = await processDueDeliveries({
      tenantContext: rootTenantContext('tenant_root'),
      providers: {
        inApp: createRedisOutageInAppProvider(),
        sms: createUnusedSmsProvider(),
        email: createUnusedEmailProvider(),
      },
      claim: {
        now: NOW,
        batchSize: 25,
      },
    })

    expectValidProcessorResult(result)

    expect(mocks.claimDeliveries).toHaveBeenCalledWith({
      now: NOW,
      batchSize: 25,
    })

    // A transient outage must NOT permanently drop the message: with attempts
    // remaining it's rescheduled with backoff, not finalized.
    const expectedNextAttemptAt = new Date(NOW.getTime() + 60_000)

    expect(mocks.completeDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_redis_outage_1',
      leaseToken: LEASE_TOKEN,
      attemptedAt: NOW,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message:
        'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_redis_outage_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })

    expect(JSON.stringify(result)).not.toContain('postgres://')
    expect(JSON.stringify(result)).not.toContain('DATABASE_URL')
    expect(JSON.stringify(result)).not.toContain('SUPABASE')
  })
})