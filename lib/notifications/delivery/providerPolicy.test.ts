import { describe, expect, it } from 'vitest'
import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

import {
  DELIVERY_PROVIDER_BINDING_LIST,
  DELIVERY_PROVIDER_BINDINGS,
  buildProviderSendRequest,
  getDeliveryProviderBinding,
  getMaxAttemptsForChannel,
  getProviderForChannel,
  isProviderAllowedForChannel,
} from './providerPolicy'

describe('lib/notifications/delivery/providerPolicy', () => {
  describe('DELIVERY_PROVIDER_BINDINGS', () => {
    it('defines the expected provider policy for each channel', () => {
      expect(DELIVERY_PROVIDER_BINDINGS).toEqual({
        [NotificationChannel.IN_APP]: {
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          maxAttempts: 3,
        },
        [NotificationChannel.SMS]: {
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          maxAttempts: 5,
        },
        [NotificationChannel.EMAIL]: {
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          maxAttempts: 6,
        },
      })
    })

    it('exposes the bindings as a stable ordered list', () => {
      expect(DELIVERY_PROVIDER_BINDING_LIST).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          maxAttempts: 3,
        },
        {
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          maxAttempts: 5,
        },
        {
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          maxAttempts: 6,
        },
      ])
    })
  })

  describe('getDeliveryProviderBinding', () => {
    it('returns the binding for IN_APP', () => {
      expect(getDeliveryProviderBinding(NotificationChannel.IN_APP)).toEqual({
        channel: NotificationChannel.IN_APP,
        provider: NotificationProvider.INTERNAL_REALTIME,
        maxAttempts: 3,
      })
    })

    it('returns the binding for SMS', () => {
      expect(getDeliveryProviderBinding(NotificationChannel.SMS)).toEqual({
        channel: NotificationChannel.SMS,
        provider: NotificationProvider.TWILIO,
        maxAttempts: 5,
      })
    })

    it('returns the binding for EMAIL', () => {
      expect(getDeliveryProviderBinding(NotificationChannel.EMAIL)).toEqual({
        channel: NotificationChannel.EMAIL,
        provider: NotificationProvider.POSTMARK,
        maxAttempts: 6,
      })
    })
  })

  describe('getProviderForChannel', () => {
    it('maps IN_APP to INTERNAL_REALTIME', () => {
      expect(getProviderForChannel(NotificationChannel.IN_APP)).toBe(
        NotificationProvider.INTERNAL_REALTIME,
      )
    })

    it('maps SMS to TWILIO', () => {
      expect(getProviderForChannel(NotificationChannel.SMS)).toBe(
        NotificationProvider.TWILIO,
      )
    })

    it('maps EMAIL to POSTMARK', () => {
      expect(getProviderForChannel(NotificationChannel.EMAIL)).toBe(
        NotificationProvider.POSTMARK,
      )
    })
  })

  describe('getMaxAttemptsForChannel', () => {
    it('returns 3 for IN_APP', () => {
      expect(getMaxAttemptsForChannel(NotificationChannel.IN_APP)).toBe(3)
    })

    it('returns 5 for SMS', () => {
      expect(getMaxAttemptsForChannel(NotificationChannel.SMS)).toBe(5)
    })

    it('returns 6 for EMAIL', () => {
      expect(getMaxAttemptsForChannel(NotificationChannel.EMAIL)).toBe(6)
    })
  })

  describe('isProviderAllowedForChannel', () => {
    it('returns true for valid provider/channel pairs', () => {
      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
        }),
      ).toBe(true)

      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
        }),
      ).toBe(true)

      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
        }),
      ).toBe(true)
    })

    it('returns false for invalid provider/channel pairs', () => {
      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.TWILIO,
        }),
      ).toBe(false)

      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.POSTMARK,
        }),
      ).toBe(false)

      expect(
        isProviderAllowedForChannel({
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.INTERNAL_REALTIME,
        }),
      ).toBe(false)
    })
  })

  describe('buildProviderSendRequest', () => {
    it('builds an in-app provider request', () => {
      const result = buildProviderSendRequest({
        deliveryId: 'delivery_in_app_1',
        dispatchId: 'dispatch_1',
        destination: 'pro_1',
        attemptCount: 0,
        content: {
          channel: NotificationChannel.IN_APP,
          templateKey: 'booking_confirmed',
          templateVersion: 1,
          title: 'Appointment confirmed',
          body: 'Your appointment is confirmed.',
          href: '/pro/bookings/booking_1',
        },
        metadata: {
          bookingId: 'booking_1',
        },
      })

      expect(result).toEqual({
        deliveryId: 'delivery_in_app_1',
        dispatchId: 'dispatch_1',
        destination: 'pro_1',
        attemptCount: 0,
        maxAttempts: 3,
        idempotencyKey: 'delivery:delivery_in_app_1:attempt:1',
        metadata: {
          bookingId: 'booking_1',
        },
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
        content: {
          channel: NotificationChannel.IN_APP,
          templateKey: 'booking_confirmed',
          templateVersion: 1,
          title: 'Appointment confirmed',
          body: 'Your appointment is confirmed.',
          href: '/pro/bookings/booking_1',
        },
      })
    })

    it('builds an sms provider request', () => {
      const result = buildProviderSendRequest({
        deliveryId: 'delivery_sms_1',
        dispatchId: 'dispatch_1',
        destination: '+15551234567',
        attemptCount: 1,
        content: {
          channel: NotificationChannel.SMS,
          templateKey: 'appointment_reminder',
          templateVersion: 1,
          text: 'TOVIS: Reminder for tomorrow.',
        },
      })

      expect(result).toEqual({
        deliveryId: 'delivery_sms_1',
        dispatchId: 'dispatch_1',
        destination: '+15551234567',
        attemptCount: 1,
        maxAttempts: 5,
        idempotencyKey: 'delivery:delivery_sms_1:attempt:2',
        metadata: null,
        provider: NotificationProvider.TWILIO,
        channel: NotificationChannel.SMS,
        content: {
          channel: NotificationChannel.SMS,
          templateKey: 'appointment_reminder',
          templateVersion: 1,
          text: 'TOVIS: Reminder for tomorrow.',
        },
      })
    })

    it('builds an email provider request', () => {
      const result = buildProviderSendRequest({
        deliveryId: 'delivery_email_1',
        dispatchId: 'dispatch_1',
        destination: 'client@example.com',
        attemptCount: 2,
        content: {
          channel: NotificationChannel.EMAIL,
          templateKey: 'aftercare_ready',
          templateVersion: 1,
          subject: 'TOVIS: Aftercare ready',
          text: 'Your aftercare is ready.',
          html: '<p>Your aftercare is ready.</p>',
        },
      })

      expect(result).toEqual({
        deliveryId: 'delivery_email_1',
        dispatchId: 'dispatch_1',
        destination: 'client@example.com',
        attemptCount: 2,
        maxAttempts: 6,
        idempotencyKey: 'delivery:delivery_email_1:attempt:3',
        metadata: null,
        provider: NotificationProvider.POSTMARK,
        channel: NotificationChannel.EMAIL,
        content: {
          channel: NotificationChannel.EMAIL,
          templateKey: 'aftercare_ready',
          templateVersion: 1,
          subject: 'TOVIS: Aftercare ready',
          text: 'Your aftercare is ready.',
          html: '<p>Your aftercare is ready.</p>',
        },
      })
    })

    it('throws when deliveryId is blank', () => {
      expect(() =>
        buildProviderSendRequest({
          deliveryId: '   ',
          dispatchId: 'dispatch_1',
          destination: 'client@example.com',
          attemptCount: 0,
          content: {
            channel: NotificationChannel.EMAIL,
            templateKey: 'booking_confirmed',
            templateVersion: 1,
            subject: 'TOVIS: Booking confirmed',
            text: 'Confirmed.',
            html: '<p>Confirmed.</p>',
          },
        }),
      ).toThrow('providerPolicy: missing deliveryId')
    })

    it('throws when dispatchId is blank', () => {
      expect(() =>
        buildProviderSendRequest({
          deliveryId: 'delivery_1',
          dispatchId: '   ',
          destination: 'client@example.com',
          attemptCount: 0,
          content: {
            channel: NotificationChannel.EMAIL,
            templateKey: 'booking_confirmed',
            templateVersion: 1,
            subject: 'TOVIS: Booking confirmed',
            text: 'Confirmed.',
            html: '<p>Confirmed.</p>',
          },
        }),
      ).toThrow('providerPolicy: missing dispatchId')
    })

    it('throws when destination is blank', () => {
      expect(() =>
        buildProviderSendRequest({
          deliveryId: 'delivery_1',
          dispatchId: 'dispatch_1',
          destination: '   ',
          attemptCount: 0,
          content: {
            channel: NotificationChannel.SMS,
            templateKey: 'appointment_reminder',
            templateVersion: 1,
            text: 'Reminder',
          },
        }),
      ).toThrow('providerPolicy: missing destination')
    })

    it('throws when attemptCount is invalid', () => {
      expect(() =>
        buildProviderSendRequest({
          deliveryId: 'delivery_1',
          dispatchId: 'dispatch_1',
          destination: 'pro_1',
          attemptCount: -1,
          content: {
            channel: NotificationChannel.IN_APP,
            templateKey: 'booking_confirmed',
            templateVersion: 1,
            title: 'Booking confirmed',
            body: 'Confirmed.',
            href: '/pro/bookings/booking_1',
          },
        }),
      ).toThrow('providerPolicy: invalid attemptCount')
    })
  })
})