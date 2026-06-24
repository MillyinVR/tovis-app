import { describe, expect, it } from 'vitest'
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import {
  getRecipientChannelCapabilities,
  getRecipientLocalMinutes,
  isChannelSelected,
  resolveChannelPolicy,
  selectChannelsForDispatch,
  type NotificationPreferenceLike,
  type RecipientChannelCapabilities,
} from './channelPolicy'
import { getNotificationEventDefinition } from './eventKeys'

function makeCapabilities(
  overrides: Partial<RecipientChannelCapabilities> = {},
): RecipientChannelCapabilities {
  return {
    hasInAppTarget: true,
    hasSmsDestination: true,
    hasEmailDestination: true,
    ...overrides,
  }
}

function makePreference(
  overrides: Partial<NotificationPreferenceLike> = {},
): NotificationPreferenceLike {
  return {
    inAppEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    quietHoursStartMinutes: null,
    quietHoursEndMinutes: null,
    ...overrides,
  }
}

describe('lib/notifications/channelPolicy', () => {
  describe('getRecipientChannelCapabilities', () => {
    it('reports all capabilities when destinations are present, both phone/email are verified, and SMS consent exists', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.CLIENT,
          inAppTargetId: 'client_1',
          phone: '+15551234567',
          phoneVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
          transactionalSmsConsentAt: new Date('2026-04-08T12:00:00.000Z'),
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      ).toEqual({
        hasInAppTarget: true,
        hasSmsDestination: true,
        hasEmailDestination: true,
      })
    })

    it('requires a verified phone for SMS capability', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.CLIENT,
          inAppTargetId: 'client_1',
          phone: '+15551234567',
          phoneVerifiedAt: null,
          transactionalSmsConsentAt: new Date('2026-04-08T12:00:00.000Z'),
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      ).toEqual({
        hasInAppTarget: true,
        hasSmsDestination: false,
        hasEmailDestination: true,
      })
    })

    it('requires transactional SMS consent for SMS capability even with a verified phone', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.CLIENT,
          inAppTargetId: 'client_1',
          phone: '+15551234567',
          phoneVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
          transactionalSmsConsentAt: null,
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      ).toEqual({
        hasInAppTarget: true,
        hasSmsDestination: false,
        hasEmailDestination: true,
      })
    })

    it('requires a verified email for EMAIL capability', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.CLIENT,
          inAppTargetId: 'client_1',
          phone: '+15551234567',
          phoneVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
          transactionalSmsConsentAt: new Date('2026-04-08T12:00:00.000Z'),
          email: 'client@example.com',
          emailVerifiedAt: null,
        }),
      ).toEqual({
        hasInAppTarget: true,
        hasSmsDestination: true,
        hasEmailDestination: false,
      })
    })

    it('treats blank destination values as missing', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.PRO,
          inAppTargetId: '   ',
          phone: '   ',
          phoneVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
          email: '   ',
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      ).toEqual({
        hasInAppTarget: false,
        hasSmsDestination: false,
        hasEmailDestination: false,
      })
    })
  })

  describe('getRecipientLocalMinutes', () => {
    it('returns recipient-local minute of day for a valid timezone', () => {
      expect(
        getRecipientLocalMinutes({
          at: new Date('2026-04-08T13:45:00.000Z'),
          timeZone: 'UTC',
        }),
      ).toBe(13 * 60 + 45)
    })

    it('returns null for an invalid date', () => {
      expect(
        getRecipientLocalMinutes({
          at: new Date('invalid'),
          timeZone: 'UTC',
        }),
      ).toBeNull()
    })

    it('returns null when timezone is missing', () => {
      expect(
        getRecipientLocalMinutes({
          at: new Date('2026-04-08T13:45:00.000Z'),
          timeZone: null,
        }),
      ).toBeNull()
    })
  })

  describe('resolveChannelPolicy', () => {
    it('returns RECIPIENT_UNSUPPORTED for an unsupported recipient', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_REQUEST_CREATED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
      })

      expect(result.selectedChannels).toEqual([])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: false,
          reason: 'RECIPIENT_UNSUPPORTED',
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'RECIPIENT_UNSUPPORTED',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'RECIPIENT_UNSUPPORTED',
        },
      ])
    })

    it('selects the default channels for a supported event/recipient pair', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
      })

      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
      ])
    })

    it('omits SMS from a Tier-B client confirmation even with full capabilities', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_CONFIRMED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
      })

      // BOOKING_CONFIRMED is Tier B: in-app + email only (push later), never SMS
      // for app users. SMS is not even in the default channel set, so it is not
      // evaluated.
      expect(result.selectedChannels).toEqual([
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ])
      expect(result.evaluations.map((evaluation) => evaluation.channel)).toEqual(
        [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      )
    })

    it('treats BOOKING_CONFIRMED as a quiet-hours-bypassing event (the delivery path derives runtime bypass from this flag)', () => {
      // Guards the lever itself: the delivery worker requests quiet-hours bypass
      // for exactly the events whose definition allows it, so this flag is what
      // keeps a late-night confirmation from deferring to 08:00.
      expect(
        getNotificationEventDefinition(NotificationEventKey.BOOKING_CONFIRMED)
          .allowQuietHoursBypass,
      ).toBe(true)
    })

    it('delivers a Tier-B confirmation immediately during quiet hours (no email defer)', () => {
      // The delivery path requests bypass exactly when the event allows it, so a
      // confirmation booked at 23:00 must NOT defer its email to 08:00 — it's a
      // receipt for an action the client just took.
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_CONFIRMED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
        }),
        recipientLocalMinutes: 23 * 60,
        bypassQuietHours: true,
      })

      expect(result.allowQuietHoursBypass).toBe(true)
      expect(result.selectedChannels).toEqual([
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ])
      expect(result.evaluations).toEqual([
        { channel: NotificationChannel.IN_APP, enabled: true, reason: null },
        { channel: NotificationChannel.EMAIL, enabled: true, reason: null },
      ])
    })

    it('narrows channels using requestedChannels without expanding beyond defaults', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        requestedChannels: [NotificationChannel.EMAIL],
      })

      expect(result.selectedChannels).toEqual([NotificationChannel.EMAIL])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: false,
          reason: 'CHANNEL_NOT_REQUESTED',
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'CHANNEL_NOT_REQUESTED',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: true,
          reason: null,
        },
      ])
    })

    it('suppresses channels with missing destinations', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities({
          hasSmsDestination: false,
          hasEmailDestination: false,
        }),
      })

      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'MISSING_SMS_DESTINATION',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'MISSING_EMAIL_DESTINATION',
        },
      ])
    })

    it('suppresses channels disabled by preference', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          smsEnabled: false,
          emailEnabled: false,
        }),
      })

      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'PREFERENCE_DISABLED',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'PREFERENCE_DISABLED',
        },
      ])
    })

    it('forces EMAIL through for a critical (payment) event even when the recipient disabled email', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.PAYMENT_COLLECTED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({ emailEnabled: false }),
      })

      expect(result.selectedChannels).toContain(NotificationChannel.EMAIL)
      expect(
        result.evaluations.find(
          (e) => e.channel === NotificationChannel.EMAIL,
        ),
      ).toEqual({
        channel: NotificationChannel.EMAIL,
        enabled: true,
        reason: null,
      })
    })

    it('still cannot email a critical event when there is no email destination', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.PAYMENT_COLLECTED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities({ hasEmailDestination: false }),
        preference: makePreference({ emailEnabled: false }),
      })

      expect(result.selectedChannels).not.toContain(NotificationChannel.EMAIL)
      expect(
        result.evaluations.find(
          (e) => e.channel === NotificationChannel.EMAIL,
        ),
      ).toEqual({
        channel: NotificationChannel.EMAIL,
        enabled: false,
        reason: 'MISSING_EMAIL_DESTINATION',
      })
    })

    it('suppresses SMS and EMAIL during quiet hours but keeps IN_APP enabled', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
        }),
        recipientLocalMinutes: 23 * 60,
      })

      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
      ])
    })

    it('does not automatically bypass quiet hours just because the event allows bypass', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_RESCHEDULED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
        }),
        recipientLocalMinutes: 23 * 60,
      })

      expect(result.allowQuietHoursBypass).toBe(true)
      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
      ])
    })

    it('bypasses quiet hours only when explicitly requested and the event allows it', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_RESCHEDULED,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
        }),
        recipientLocalMinutes: 23 * 60,
        bypassQuietHours: true,
      })

      expect(result.selectedChannels).toEqual([
        NotificationChannel.IN_APP,
        NotificationChannel.SMS,
        NotificationChannel.EMAIL,
      ])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: true,
          reason: null,
        },
      ])
    })

    it('ignores explicit bypass when the event does not allow quiet-hours bypass', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
        }),
        recipientLocalMinutes: 23 * 60,
        bypassQuietHours: true,
      })

      expect(result.allowQuietHoursBypass).toBe(false)
      expect(result.selectedChannels).toEqual([NotificationChannel.IN_APP])
      expect(result.evaluations).toEqual([
        {
          channel: NotificationChannel.IN_APP,
          enabled: true,
          reason: null,
        },
        {
          channel: NotificationChannel.SMS,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
        {
          channel: NotificationChannel.EMAIL,
          enabled: false,
          reason: 'QUIET_HOURS',
        },
      ])
    })

    it('treats equal quiet-hours bounds as disabled', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities(),
        preference: makePreference({
          quietHoursStartMinutes: 0,
          quietHoursEndMinutes: 0,
        }),
        recipientLocalMinutes: 30,
      })

      expect(result.selectedChannels).toEqual([
        NotificationChannel.IN_APP,
        NotificationChannel.SMS,
        NotificationChannel.EMAIL,
      ])
    })
  })

  describe('selectChannelsForDispatch', () => {
    it('returns only the enabled channels', () => {
      const channels = selectChannelsForDispatch({
        key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
        recipientKind: NotificationRecipientKind.CLIENT,
        capabilities: makeCapabilities({
          hasEmailDestination: false,
          hasSmsDestination: false,
        }),
      })

      expect(channels).toEqual([NotificationChannel.IN_APP])
    })
  })

  describe('isChannelSelected', () => {
    it('returns true when the channel is selected', () => {
      expect(
        isChannelSelected({
          key: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
          recipientKind: NotificationRecipientKind.CLIENT,
          channel: NotificationChannel.IN_APP,
          capabilities: makeCapabilities(),
        }),
      ).toBe(true)
    })

    it('returns false when the channel is not selected', () => {
      expect(
        isChannelSelected({
          key: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
          recipientKind: NotificationRecipientKind.CLIENT,
          channel: NotificationChannel.EMAIL,
          capabilities: makeCapabilities(),
        }),
      ).toBe(false)
    })
  })
})