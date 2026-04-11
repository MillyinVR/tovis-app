import { describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

import {
  computeQuietHoursResumeAt,
  evaluateRuntimeDeliveryChannelPolicy,
} from './runtimeChannelPolicy'

function buildPreference(args?: {
  quietHoursStartMinutes?: number | null
  quietHoursEndMinutes?: number | null
  inAppEnabled?: boolean
  smsEnabled?: boolean
  emailEnabled?: boolean
}) {
  return {
    inAppEnabled: args?.inAppEnabled ?? true,
    smsEnabled: args?.smsEnabled ?? true,
    emailEnabled: args?.emailEnabled ?? true,
    quietHoursStartMinutes: args?.quietHoursStartMinutes ?? null,
    quietHoursEndMinutes: args?.quietHoursEndMinutes ?? null,
  }
}

describe('lib/notifications/delivery/runtimeChannelPolicy', () => {
  it('returns SEND for in-app channels because quiet hours do not apply', () => {
    const now = new Date('2026-04-09T06:30:00.000Z')

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.IN_APP,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'CHANNEL_DOES_NOT_USE_QUIET_HOURS',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: null,
      quietHoursEndMinutes: null,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    })
  })

  it('returns SEND when no quiet hours are configured', () => {
    const now = new Date('2026-04-09T06:30:00.000Z')

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference(),
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'NO_QUIET_HOURS_CONFIGURED',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: null,
      quietHoursEndMinutes: null,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    })
  })

  it('returns SEND when recipient timezone is missing', () => {
    const now = new Date('2026-04-09T06:30:00.000Z')

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: null,
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'NO_RECIPIENT_TIME_ZONE',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    })
  })

  it('returns SEND when recipient timezone is invalid', () => {
    const now = new Date('2026-04-09T06:30:00.000Z')

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'Mars/Olympus',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'NO_RECIPIENT_TIME_ZONE',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    })
  })

  it('returns SEND when outside an overnight quiet-hours window', () => {
    const now = new Date('2026-04-09T18:00:00.000Z') // 11:00 AM America/Los_Angeles

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'OUTSIDE_QUIET_HOURS',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: 11 * 60,
      nextAttemptAt: null,
    })
  })

  it('returns DEFER when inside an overnight quiet-hours window and computes nextAttemptAt at quiet-hours end', () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'DEFER',
      reason: 'QUIET_HOURS',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: 23 * 60 + 30,
      nextAttemptAt: new Date('2026-04-09T15:00:00.000Z'),
    })
  })

  it('returns DEFER when inside a same-day quiet-hours window and computes nextAttemptAt on the same local date', () => {
    const now = new Date('2026-04-09T20:00:00.000Z') // 1:00 PM America/Los_Angeles

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.EMAIL,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 12 * 60,
        quietHoursEndMinutes: 15 * 60,
      }),
    })

    expect(result).toEqual({
      action: 'DEFER',
      reason: 'QUIET_HOURS',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 12 * 60,
      quietHoursEndMinutes: 15 * 60,
      recipientLocalMinutes: 13 * 60,
      nextAttemptAt: new Date('2026-04-09T22:00:00.000Z'),
    })
  })

  it('returns SEND when bypass is requested and the event allows quiet-hours bypass', () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.BOOKING_REQUEST_CREATED,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
      bypassQuietHours: true,
    })

    expect(result).toEqual({
      action: 'SEND',
      reason: 'QUIET_HOURS_BYPASSED',
      allowQuietHoursBypass: true,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: 23 * 60 + 30,
      nextAttemptAt: null,
    })
  })

  it('does not bypass quiet hours when bypass is requested but the event disallows it', () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    const result = evaluateRuntimeDeliveryChannelPolicy({
      key: NotificationEventKey.APPOINTMENT_REMINDER,
      channel: NotificationChannel.SMS,
      now,
      recipientTimeZone: 'America/Los_Angeles',
      preference: buildPreference({
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
      }),
      bypassQuietHours: true,
    })

    expect(result).toEqual({
      action: 'DEFER',
      reason: 'QUIET_HOURS',
      allowQuietHoursBypass: false,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: 23 * 60 + 30,
      nextAttemptAt: new Date('2026-04-09T15:00:00.000Z'),
    })
  })

  it('computeQuietHoursResumeAt returns the next local end time for overnight quiet hours', () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    const nextAttemptAt = computeQuietHoursResumeAt({
      now,
      recipientTimeZone: 'America/Los_Angeles',
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      recipientLocalMinutes: 23 * 60 + 30,
    })

    expect(nextAttemptAt).toEqual(new Date('2026-04-09T15:00:00.000Z'))
  })

  it('computeQuietHoursResumeAt returns the first valid local time after a DST spring-forward gap', () => {
    const now = new Date('2026-03-08T09:30:00.000Z') // 1:30 AM America/Los_Angeles, DST start day

    const nextAttemptAt = computeQuietHoursResumeAt({
      now,
      recipientTimeZone: 'America/Los_Angeles',
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 2 * 60 + 30,
      recipientLocalMinutes: 1 * 60 + 30,
    })

    // 2:30 AM local does not exist on DST spring-forward day.
    // The first valid local time at or after 2:30 AM is 3:00 AM PDT.
    expect(nextAttemptAt).toEqual(new Date('2026-03-08T10:00:00.000Z'))
  })

  it('throws for invalid now', () => {
    expect(() =>
      evaluateRuntimeDeliveryChannelPolicy({
        key: NotificationEventKey.APPOINTMENT_REMINDER,
        channel: NotificationChannel.SMS,
        now: new Date('invalid'),
        recipientTimeZone: 'America/Los_Angeles',
        preference: buildPreference({
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 8 * 60,
        }),
      }),
    ).toThrow('runtimeChannelPolicy: invalid now')
  })
})