import { describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  assertProviderMatchesRenderedContent,
  isEmailProviderSendRequest,
  isInAppProviderSendRequest,
  isPushProviderSendRequest,
  isSmsProviderSendRequest,
  type ProviderSendRequest,
} from './providerTypes'

const PUSH_BASE = {
  deliveryId: 'delivery_push_1',
  dispatchId: 'dispatch_1',
  destination: 'device_token',
  attemptCount: 0,
  maxAttempts: 4,
  idempotencyKey: 'delivery:delivery_push_1:attempt:1',
  metadata: null,
} as const

function buildPushRequest(
  provider: typeof NotificationProvider.APNS | typeof NotificationProvider.FCM,
): ProviderSendRequest {
  return {
    ...PUSH_BASE,
    provider,
    channel: NotificationChannel.PUSH,
    content: {
      channel: NotificationChannel.PUSH,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      title: 'Appointment confirmed',
      body: 'Your appointment is confirmed.',
      href: '/client/bookings/booking_1',
    },
  }
}

describe('lib/notifications/delivery/providerTypes', () => {
  describe('isPushProviderSendRequest', () => {
    it('matches APNS and FCM push requests', () => {
      expect(isPushProviderSendRequest(buildPushRequest(NotificationProvider.APNS))).toBe(
        true,
      )
      expect(isPushProviderSendRequest(buildPushRequest(NotificationProvider.FCM))).toBe(
        true,
      )
    })

    it('does not match non-push requests, and other guards do not match push', () => {
      const pushRequest = buildPushRequest(NotificationProvider.APNS)

      expect(isInAppProviderSendRequest(pushRequest)).toBe(false)
      expect(isSmsProviderSendRequest(pushRequest)).toBe(false)
      expect(isEmailProviderSendRequest(pushRequest)).toBe(false)
    })
  })

  describe('assertProviderMatchesRenderedContent (PUSH)', () => {
    it('accepts an APNS/FCM provider with PUSH content', () => {
      expect(() =>
        assertProviderMatchesRenderedContent({
          provider: NotificationProvider.APNS,
          channel: NotificationChannel.PUSH,
          content: buildPushRequest(NotificationProvider.APNS).content,
        }),
      ).not.toThrow()

      expect(() =>
        assertProviderMatchesRenderedContent({
          provider: NotificationProvider.FCM,
          channel: NotificationChannel.PUSH,
          content: buildPushRequest(NotificationProvider.FCM).content,
        }),
      ).not.toThrow()
    })

    it('throws when an APNS/FCM provider is paired with a non-PUSH channel', () => {
      expect(() =>
        assertProviderMatchesRenderedContent({
          provider: NotificationProvider.APNS,
          channel: NotificationChannel.SMS,
          content: {
            channel: NotificationChannel.SMS,
            templateKey: 'appointment_reminder',
            templateVersion: 1,
            text: 'Reminder',
          },
        }),
      ).toThrow('providerTypes: APNS/FCM must use PUSH channel')
    })
  })
})
