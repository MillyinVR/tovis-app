// lib/notifications/delivery/sendPush.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApnsError, Errors, Notification } from 'apns2'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

const invalidateDeviceToken = vi.hoisted(() => vi.fn())
const realDeliverySuppressed = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/lib/notifications/devices/deviceTokens', () => ({
  invalidateDeviceToken,
}))

vi.mock('@/lib/loadTestDelivery', () => ({
  LOAD_TEST_SUPPRESSED_STATUS: 'load_test_suppressed',
  realDeliverySuppressed,
}))

import {
  ApnsDeliveryProvider,
  FcmDeliveryProvider,
} from './sendPush'
import type { FcmConfig } from '@/lib/notifications/config'
import type { PushProviderSendRequest } from './providerTypes'

function makeApnsRequest(
  overrides?: Partial<PushProviderSendRequest>,
): PushProviderSendRequest {
  return {
    provider: NotificationProvider.APNS,
    channel: NotificationChannel.PUSH,
    deliveryId: 'delivery_push_1',
    dispatchId: 'dispatch_1',
    destination: 'apns-device-token',
    attemptCount: 0,
    maxAttempts: 5,
    idempotencyKey: 'delivery:delivery_push_1:attempt:1',
    content: {
      channel: NotificationChannel.PUSH,
      templateKey: 'appointment_reminder',
      templateVersion: 1,
      title: 'Reminder',
      body: 'You have an appointment tomorrow.',
      href: '/appointments/1',
    },
    ...overrides,
  }
}

function makeFcmRequest(
  overrides?: Partial<PushProviderSendRequest>,
): PushProviderSendRequest {
  return {
    ...makeApnsRequest(),
    provider: NotificationProvider.FCM,
    destination: 'fcm-device-token',
    ...overrides,
  }
}

function makeApnsError(reason: string, statusCode: number): ApnsError {
  return new ApnsError({
    statusCode,
    notification: new Notification('apns-device-token', {
      alert: { title: 't', body: 'b' },
    }),
    response: { reason, timestamp: Date.now() },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  realDeliverySuppressed.mockReturnValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ApnsDeliveryProvider', () => {
  it('exposes APNS provider + PUSH channel', () => {
    const provider = new ApnsDeliveryProvider({
      client: { send: vi.fn() },
      config: {
        provider: NotificationProvider.APNS,
        channel: NotificationChannel.PUSH,
        authKey: 'k',
        keyId: 'KEY',
        teamId: 'TEAM',
        bundleId: 'com.tovis.app',
        production: true,
      },
    })

    expect(provider.provider).toBe(NotificationProvider.APNS)
    expect(provider.channel).toBe(NotificationChannel.PUSH)
  })

  it('sends a notification and returns success metadata', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const provider = new ApnsDeliveryProvider({
      client: { send },
      config: {
        provider: NotificationProvider.APNS,
        channel: NotificationChannel.PUSH,
        authKey: 'k',
        keyId: 'KEY',
        teamId: 'TEAM',
        bundleId: 'com.tovis.app',
        production: true,
      },
    })

    const result = await provider.send(makeApnsRequest())

    expect(send).toHaveBeenCalledTimes(1)
    const notification = send.mock.calls[0]?.[0] as Notification
    expect(notification.deviceToken).toBe('apns-device-token')
    expect(notification.options.alert).toEqual({
      title: 'Reminder',
      body: 'You have an appointment tomorrow.',
    })
    expect(notification.options.topic).toBe('com.tovis.app')
    expect(notification.options.data).toEqual({ href: '/appointments/1' })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_push_1:attempt:1',
      providerStatus: 'sent',
      responseMeta: { source: 'sendPush.apns', topic: 'com.tovis.app' },
    })
    expect(invalidateDeviceToken).not.toHaveBeenCalled()
  })

  it('invalidates the token + FAILED_FINAL on a dead-token reason', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(makeApnsError(Errors.unregistered, 410))
    const provider = new ApnsDeliveryProvider({
      client: { send },
      config: {
        provider: NotificationProvider.APNS,
        channel: NotificationChannel.PUSH,
        authKey: 'k',
        keyId: 'KEY',
        teamId: 'TEAM',
        bundleId: 'com.tovis.app',
        production: true,
      },
    })

    const result = await provider.send(makeApnsRequest())

    expect(invalidateDeviceToken).toHaveBeenCalledWith({
      platform: 'IOS',
      token: 'apns-device-token',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(false)
    expect(result.code).toBe(Errors.unregistered)
    expect(result.providerStatus).toBe('failed')
    expect(result.responseMeta).toMatchObject({
      source: 'sendPush.apns',
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      eventType: NotificationDeliveryEventType.FAILED,
    })
  })

  it('returns FAILED_RETRYABLE on a transient reason', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(makeApnsError(Errors.serviceUnavailable, 503))
    const provider = new ApnsDeliveryProvider({
      client: { send },
      config: {
        provider: NotificationProvider.APNS,
        channel: NotificationChannel.PUSH,
        authKey: 'k',
        keyId: 'KEY',
        teamId: 'TEAM',
        bundleId: 'com.tovis.app',
        production: true,
      },
    })

    const result = await provider.send(makeApnsRequest())

    expect(invalidateDeviceToken).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(true)
    expect(result.providerStatus).toBe('retryable_error')
    expect(result.responseMeta).toMatchObject({
      nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
      eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
    })
  })

  it('returns FAILED_FINAL on a config/payload reason', async () => {
    const send = vi.fn().mockRejectedValue(makeApnsError(Errors.badTopic, 400))
    const provider = new ApnsDeliveryProvider({ client: { send } })

    const result = await provider.send(makeApnsRequest())

    expect(invalidateDeviceToken).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(false)
    expect(result.code).toBe(Errors.badTopic)
  })

  it('returns FAILED_RETRYABLE on a non-ApnsError (network) throw', async () => {
    const send = vi.fn().mockRejectedValue(new Error('socket hang up'))
    const provider = new ApnsDeliveryProvider({ client: { send } })

    const result = await provider.send(makeApnsRequest())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(true)
    expect(result.code).toBe('APNS_TRANSPORT_ERROR')
  })

  it('early-returns suppressed when realDeliverySuppressed', async () => {
    realDeliverySuppressed.mockReturnValue(true)
    const send = vi.fn()
    const provider = new ApnsDeliveryProvider({ client: { send } })

    const result = await provider.send(makeApnsRequest())

    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_push_1:attempt:1',
      providerStatus: 'load_test_suppressed',
      responseMeta: { source: 'sendPush.apns', suppressed: true },
    })
  })

  it('rejects a non-APNS provider request', async () => {
    const provider = new ApnsDeliveryProvider({ client: { send: vi.fn() } })
    const result = await provider.send(makeFcmRequest())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('PUSH_PROVIDER_MISCONFIGURED')
  })
})

describe('FcmDeliveryProvider', () => {
  const config = {
    provider: NotificationProvider.FCM,
    channel: NotificationChannel.PUSH,
    serviceAccount: { type: 'service_account' },
    projectId: 'tovis-prod',
  } satisfies FcmConfig

  function makeProvider(fetchImpl: ReturnType<typeof vi.fn>) {
    return new FcmDeliveryProvider({
      config,
      fetchImpl,
      getAccessToken: async () => 'access-token-123',
    })
  }

  it('exposes FCM provider + PUSH channel', () => {
    const provider = makeProvider(vi.fn())
    expect(provider.provider).toBe(NotificationProvider.FCM)
    expect(provider.channel).toBe(NotificationChannel.PUSH)
  })

  it('POSTs to the v1 send endpoint and returns success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ name: 'projects/tovis-prod/messages/0:abc' }),
    })

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(
      'https://fcm.googleapis.com/v1/projects/tovis-prod/messages:send',
    )
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer access-token-123')
    expect(JSON.parse(init.body)).toEqual({
      message: {
        token: 'fcm-device-token',
        notification: {
          title: 'Reminder',
          body: 'You have an appointment tomorrow.',
        },
        data: { href: '/appointments/1' },
      },
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'projects/tovis-prod/messages/0:abc',
      providerStatus: 'sent',
      responseMeta: { source: 'sendPush.fcm', projectId: 'tovis-prod' },
    })
    expect(invalidateDeviceToken).not.toHaveBeenCalled()
  })

  it('invalidates the token + FAILED_FINAL on a dead-token status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          error: { status: 'UNREGISTERED', message: 'Requested entity not found' },
        }),
    })

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(invalidateDeviceToken).toHaveBeenCalledWith({
      platform: 'ANDROID',
      token: 'fcm-device-token',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(false)
    expect(result.code).toBe('UNREGISTERED')
    expect(result.responseMeta).toMatchObject({
      source: 'sendPush.fcm',
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      eventType: NotificationDeliveryEventType.FAILED,
    })
  })

  it('returns FAILED_RETRYABLE on UNAVAILABLE', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { status: 'UNAVAILABLE' } }),
    })

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(invalidateDeviceToken).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(true)
    expect(result.providerStatus).toBe('retryable_error')
  })

  it('treats a 500 with no parseable status as retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'upstream boom',
    })

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(true)
    expect(result.code).toBe('HTTP_500')
  })

  it('returns FAILED_RETRYABLE when fetch throws (network)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.retryable).toBe(true)
    expect(result.code).toBe('FCM_TRANSPORT_ERROR')
  })

  it('early-returns suppressed when realDeliverySuppressed', async () => {
    realDeliverySuppressed.mockReturnValue(true)
    const fetchImpl = vi.fn()

    const provider = makeProvider(fetchImpl)
    const result = await provider.send(makeFcmRequest())

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_push_1:attempt:1',
      providerStatus: 'load_test_suppressed',
      responseMeta: { source: 'sendPush.fcm', suppressed: true },
    })
  })

  it('rejects a non-FCM provider request', async () => {
    const provider = makeProvider(vi.fn())
    const result = await provider.send(makeApnsRequest())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('PUSH_PROVIDER_MISCONFIGURED')
  })
})
