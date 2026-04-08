import { describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  InAppDeliveryProvider,
  createInAppDeliveryProvider,
} from './sendInApp'

describe('lib/notifications/delivery/sendInApp', () => {
  it('creates a provider instance from the factory', () => {
    const publish = vi.fn()

    const provider = createInAppDeliveryProvider({ publish })

    expect(provider).toBeInstanceOf(InAppDeliveryProvider)
    expect(provider.provider).toBe(NotificationProvider.INTERNAL_REALTIME)
    expect(provider.channel).toBe(NotificationChannel.IN_APP)
  })

  it('sends a valid in-app request and returns success metadata', async () => {
    const publish = vi.fn().mockResolvedValue({
      accepted: true,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'published',
      responseMeta: {
        channel: 'professional:pro_1',
      },
    })

    const provider = new InAppDeliveryProvider({ publish })

    const result = await provider.send({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      deliveryId: 'delivery_1',
      dispatchId: 'dispatch_1',
      destination: 'pro_1',
      attemptCount: 0,
      maxAttempts: 3,
      idempotencyKey: 'delivery:delivery_1:attempt:1',
      metadata: {
        bookingId: 'booking_1',
      },
      content: {
        channel: NotificationChannel.IN_APP,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        title: 'Appointment confirmed',
        body: 'Your appointment is confirmed.',
        href: '/pro/bookings/booking_1',
      },
    })

    expect(publish).toHaveBeenCalledWith({
      kind: 'notification.in_app',
      deliveryId: 'delivery_1',
      dispatchId: 'dispatch_1',
      recipientInAppTargetId: 'pro_1',
      idempotencyKey: 'delivery:delivery_1:attempt:1',
      metadata: {
        bookingId: 'booking_1',
      },
      content: {
        title: 'Appointment confirmed',
        body: 'Your appointment is confirmed.',
        href: '/pro/bookings/booking_1',
        templateKey: 'booking_confirmed',
        templateVersion: 1,
      },
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'published',
      responseMeta: {
        channel: 'professional:pro_1',
      },
    })
  })

  it('falls back to idempotencyKey as providerMessageId when publisher does not return one', async () => {
    const publish = vi.fn().mockResolvedValue({
      accepted: true,
      providerMessageId: null,
      providerStatus: null,
    })

    const provider = new InAppDeliveryProvider({ publish })

    const result = await provider.send({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      deliveryId: 'delivery_1',
      dispatchId: 'dispatch_1',
      destination: 'client_1',
      attemptCount: 1,
      maxAttempts: 3,
      idempotencyKey: 'delivery:delivery_1:attempt:2',
      content: {
        channel: NotificationChannel.IN_APP,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        title: 'Reminder',
        body: 'Your appointment is tomorrow.',
        href: '/client/bookings/booking_1',
      },
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_1:attempt:2',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    })
  })

  it('returns non-retryable failure when request data is invalid', async () => {
    const publish = vi.fn()
    const provider = new InAppDeliveryProvider({ publish })

    const result = await provider.send({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      deliveryId: '   ',
      dispatchId: 'dispatch_1',
      destination: 'pro_1',
      attemptCount: 0,
      maxAttempts: 3,
      idempotencyKey: 'delivery:delivery_1:attempt:1',
      content: {
        channel: NotificationChannel.IN_APP,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        title: 'Appointment confirmed',
        body: 'Confirmed.',
        href: '/pro/bookings/booking_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'IN_APP_REQUEST_INVALID',
      message: 'sendInApp: missing deliveryId',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendInApp',
      },
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('returns retryable failure when publisher rejects the envelope', async () => {
    const publish = vi.fn().mockResolvedValue({
      accepted: false,
      providerMessageId: null,
      providerStatus: 'backpressure',
      responseMeta: {
        retryAfterMs: 250,
      },
    })

    const provider = new InAppDeliveryProvider({ publish })

    const result = await provider.send({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      deliveryId: 'delivery_1',
      dispatchId: 'dispatch_1',
      destination: 'pro_1',
      attemptCount: 0,
      maxAttempts: 3,
      idempotencyKey: 'delivery:delivery_1:attempt:1',
      content: {
        channel: NotificationChannel.IN_APP,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        title: 'Appointment confirmed',
        body: 'Confirmed.',
        href: '/pro/bookings/booking_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'IN_APP_PUBLISH_REJECTED',
      message: 'In-app realtime publish was rejected.',
      providerStatus: 'backpressure',
      responseMeta: {
        retryAfterMs: 250,
      },
    })
  })

  it('returns retryable failure when publisher throws', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('redis offline'))
    const provider = new InAppDeliveryProvider({ publish })

    const result = await provider.send({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      deliveryId: 'delivery_1',
      dispatchId: 'dispatch_1',
      destination: 'client_1',
      attemptCount: 0,
      maxAttempts: 3,
      idempotencyKey: 'delivery:delivery_1:attempt:1',
      content: {
        channel: NotificationChannel.IN_APP,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        title: 'Reminder',
        body: 'Your appointment is tomorrow.',
        href: '/client/bookings/booking_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'IN_APP_PUBLISH_ERROR',
      message: 'redis offline',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendInApp',
        errorName: 'Error',
      },
    })
  })

  it('throws at construction time when publish is not a function', () => {
    expect(() =>
      new InAppDeliveryProvider({
        publish: null as unknown as never,
      }),
    ).toThrow('sendInApp: publish must be a function')
  })
})