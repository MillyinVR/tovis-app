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
    it('reports all capabilities when destinations are present and both phone/email are verified', () => {
      expect(
        getRecipientChannelCapabilities({
          recipientKind: NotificationRecipientKind.CLIENT,
          inAppTargetId: 'client_1',
          phone: '+15551234567',
          phoneVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
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

    it('narrows channels using requestedChannels without expanding beyond defaults', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_CONFIRMED,
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
        key: NotificationEventKey.BOOKING_CONFIRMED,
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
        key: NotificationEventKey.BOOKING_CONFIRMED,
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

    it('suppresses SMS and EMAIL during quiet hours but keeps IN_APP enabled', () => {
      const result = resolveChannelPolicy({
        key: NotificationEventKey.BOOKING_CONFIRMED,
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
        key: NotificationEventKey.BOOKING_CONFIRMED,
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