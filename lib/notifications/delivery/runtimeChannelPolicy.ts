import {
  NotificationChannel,
  NotificationEventKey,
} from '@prisma/client'

import {
  getRecipientLocalMinutes,
  type NotificationPreferenceLike,
} from '../channelPolicy'
import { getNotificationEventDefinition } from '../eventKeys'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import { getZonedParts } from '@/lib/time'

type ZonedDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export type RuntimeDeliveryChannelPolicyArgs = {
  key: NotificationEventKey
  channel: NotificationChannel
  now: Date
  recipientTimeZone?: string | null
  preference?: NotificationPreferenceLike | null
  bypassQuietHours?: boolean
}

export type RuntimeDeliveryChannelPolicyResult =
  | {
      action: 'SEND'
      reason:
        | 'CHANNEL_DOES_NOT_USE_QUIET_HOURS'
        | 'NO_QUIET_HOURS_CONFIGURED'
        | 'NO_RECIPIENT_TIME_ZONE'
        | 'OUTSIDE_QUIET_HOURS'
        | 'QUIET_HOURS_BYPASSED'
      allowQuietHoursBypass: boolean
      quietHoursStartMinutes: number | null
      quietHoursEndMinutes: number | null
      recipientLocalMinutes: number | null
      nextAttemptAt: null
    }
  | {
      action: 'DEFER'
      reason: 'QUIET_HOURS'
      allowQuietHoursBypass: boolean
      quietHoursStartMinutes: number
      quietHoursEndMinutes: number
      recipientLocalMinutes: number
      nextAttemptAt: Date
    }

type QuietHoursWindow = {
  quietHoursStartMinutes: number
  quietHoursEndMinutes: number
}

/**
 * Platform default quiet-hours window (recipient-local), applied when a
 * recipient has NO preference row. 22:00 → 08:00.
 *
 * Once a per-user preference row exists it fully overrides this default,
 * including disabling quiet hours entirely (null/unset window, or a window
 * whose start equals its end).
 */
const DEFAULT_QUIET_HOURS_START_MINUTES = 22 * 60
const DEFAULT_QUIET_HOURS_END_MINUTES = 8 * 60

/**
 * Conservative quiet-hours fallback zone for recipients we have NO timezone for
 * (unclaimed / phone-only clients whose profile and booking-location zones are
 * both absent). Used ONLY to gate quiet hours — never for scheduling truth.
 *
 * The generic app fallback is UTC (lib/timeZone), but UTC fails the TCPA goal
 * here: a US-Pacific recipient's 03:00 local is 11:00 UTC, OUTSIDE a 22:00–08:00
 * UTC window, so a UTC-gated send would still fire in the middle of their night.
 * Enforcing the window in a real US business zone instead means a missing-zone
 * recipient is DEFERRED rather than texted at 3am. We pick the eastern zone
 * (most-populous, and the policy note specifically forbids defaulting to
 * America/Los_Angeles); the booking-location zone is already preferred upstream
 * whenever it exists, so this only bites the genuinely zone-less tail.
 */
const QUIET_HOURS_FALLBACK_TIME_ZONE = 'America/New_York'

function normalizeNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('runtimeChannelPolicy: invalid now')
  }

  return value
}

function normalizeTimeZone(value: string | null | undefined): string | null {
  return pickTimeZoneOrNull(value)
}

function normalizeMinuteOfDay(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const truncated = Math.trunc(value)
  if (truncated < 0 || truncated > 1439) return null

  return truncated
}

function getQuietHoursWindow(
  preference: NotificationPreferenceLike | null | undefined,
): QuietHoursWindow | null {
  // No preference row on file → apply the platform default quiet-hours window.
  if (preference == null) {
    return {
      quietHoursStartMinutes: DEFAULT_QUIET_HOURS_START_MINUTES,
      quietHoursEndMinutes: DEFAULT_QUIET_HOURS_END_MINUTES,
    }
  }

  // A preference row fully overrides the default. A null/unset window, or one
  // whose start equals its end, means the recipient has disabled quiet hours.
  const quietHoursStartMinutes = normalizeMinuteOfDay(
    preference.quietHoursStartMinutes ?? null,
  )
  const quietHoursEndMinutes = normalizeMinuteOfDay(
    preference.quietHoursEndMinutes ?? null,
  )

  if (
    quietHoursStartMinutes == null ||
    quietHoursEndMinutes == null ||
    quietHoursStartMinutes === quietHoursEndMinutes
  ) {
    return null
  }

  return {
    quietHoursStartMinutes,
    quietHoursEndMinutes,
  }
}

function channelUsesQuietHours(channel: NotificationChannel): boolean {
  return (
    channel === NotificationChannel.SMS ||
    channel === NotificationChannel.EMAIL
  )
}

function isWithinQuietHours(args: {
  quietHoursStartMinutes: number
  quietHoursEndMinutes: number
  recipientLocalMinutes: number
}): boolean {
  if (args.quietHoursStartMinutes < args.quietHoursEndMinutes) {
    return (
      args.recipientLocalMinutes >= args.quietHoursStartMinutes &&
      args.recipientLocalMinutes < args.quietHoursEndMinutes
    )
  }

  return (
    args.recipientLocalMinutes >= args.quietHoursStartMinutes ||
    args.recipientLocalMinutes < args.quietHoursEndMinutes
  )
}

function getZonedDateTimeParts(
  date: Date,
  timeZone: string,
): ZonedDateTimeParts | null {
  const normalizedDate = normalizeNow(date)

  // getZonedParts returns the same {year..second} shape with a cached, per-zone
  // formatter (and hardens the rare hour===24 → next-day case). Keep the
  // null-on-failure contract callers rely on.
  try {
    return getZonedParts(normalizedDate, timeZone)
  } catch {
    return null
  }
}

function shiftLocalCalendarDate(args: {
  year: number
  month: number
  day: number
  days: number
}): {
  year: number
  month: number
  day: number
} {
  const shifted = new Date(
    Date.UTC(args.year, args.month - 1, args.day, 0, 0, 0),
  )

  shifted.setUTCDate(shifted.getUTCDate() + args.days)

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function shiftLocalDateTimeByMinutes(
  parts: ZonedDateTimeParts,
  minutes: number,
): ZonedDateTimeParts {
  const shifted = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute + minutes,
      parts.second,
      0,
    ),
  )

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

function buildDateForZonedLocalDateTime(args: {
  timeZone: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}): Date | null {
  let candidate = new Date(
    Date.UTC(
      args.year,
      args.month - 1,
      args.day,
      args.hour,
      args.minute,
      args.second,
      0,
    ),
  )

  for (let i = 0; i < 6; i += 1) {
    const zoned = getZonedDateTimeParts(candidate, args.timeZone)
    if (!zoned) return null

    const desiredAsUtc = Date.UTC(
      args.year,
      args.month - 1,
      args.day,
      args.hour,
      args.minute,
      args.second,
      0,
    )

    const actualAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      0,
    )

    const diffMs = desiredAsUtc - actualAsUtc
    if (diffMs === 0) {
      return candidate
    }

    candidate = new Date(candidate.getTime() + diffMs)
  }

  const finalParts = getZonedDateTimeParts(candidate, args.timeZone)
  if (!finalParts) return null

  const isExactMatch =
    finalParts.year === args.year &&
    finalParts.month === args.month &&
    finalParts.day === args.day &&
    finalParts.hour === args.hour &&
    finalParts.minute === args.minute &&
    finalParts.second === args.second

  return isExactMatch ? candidate : null
}

function buildFirstValidDateAtOrAfterZonedLocalDateTime(args: {
  now: Date
  timeZone: string
  target: ZonedDateTimeParts
}): Date | null {
  for (let offsetMinutes = 0; offsetMinutes <= 180; offsetMinutes += 1) {
    const shiftedTarget = shiftLocalDateTimeByMinutes(
      args.target,
      offsetMinutes,
    )

    const candidate = buildDateForZonedLocalDateTime({
      timeZone: args.timeZone,
      year: shiftedTarget.year,
      month: shiftedTarget.month,
      day: shiftedTarget.day,
      hour: shiftedTarget.hour,
      minute: shiftedTarget.minute,
      second: shiftedTarget.second,
    })

    if (!candidate) continue
    if (candidate.getTime() < args.now.getTime()) continue

    return candidate
  }

  return null
}

export function computeQuietHoursResumeAt(args: {
  now: Date
  recipientTimeZone: string
  quietHoursStartMinutes: number
  quietHoursEndMinutes: number
  recipientLocalMinutes: number
}): Date | null {
  const now = normalizeNow(args.now)
  const zonedNow = getZonedDateTimeParts(now, args.recipientTimeZone)
  if (!zonedNow) return null

  const endHour = Math.floor(args.quietHoursEndMinutes / 60)
  const endMinute = args.quietHoursEndMinutes % 60

  const targetDate =
    args.quietHoursStartMinutes < args.quietHoursEndMinutes
      ? {
          year: zonedNow.year,
          month: zonedNow.month,
          day: zonedNow.day,
        }
      : args.recipientLocalMinutes >= args.quietHoursStartMinutes
        ? shiftLocalCalendarDate({
            year: zonedNow.year,
            month: zonedNow.month,
            day: zonedNow.day,
            days: 1,
          })
        : {
            year: zonedNow.year,
            month: zonedNow.month,
            day: zonedNow.day,
          }

  return buildFirstValidDateAtOrAfterZonedLocalDateTime({
    now,
    timeZone: args.recipientTimeZone,
    target: {
      year: targetDate.year,
      month: targetDate.month,
      day: targetDate.day,
      hour: endHour,
      minute: endMinute,
      second: 0,
    },
  })
}

export function evaluateRuntimeDeliveryChannelPolicy(
  args: RuntimeDeliveryChannelPolicyArgs,
): RuntimeDeliveryChannelPolicyResult {
  const now = normalizeNow(args.now)
  const definition = getNotificationEventDefinition(args.key)
  const allowQuietHoursBypass = definition.allowQuietHoursBypass

  if (!channelUsesQuietHours(args.channel)) {
    return {
      action: 'SEND',
      reason: 'CHANNEL_DOES_NOT_USE_QUIET_HOURS',
      allowQuietHoursBypass,
      quietHoursStartMinutes: null,
      quietHoursEndMinutes: null,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    }
  }

  const quietHoursWindow = getQuietHoursWindow(args.preference)
  if (!quietHoursWindow) {
    return {
      action: 'SEND',
      reason: 'NO_QUIET_HOURS_CONFIGURED',
      allowQuietHoursBypass,
      quietHoursStartMinutes: null,
      quietHoursEndMinutes: null,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    }
  }

  // Fail SAFE, not open: a recipient with NO usable timezone (and a configured
  // quiet-hours window) must still have quiet hours enforced — in a conservative
  // business zone — rather than be eligible to send around the clock. Sending at
  // 3am local is a TCPA risk; deferring is not.
  const recipientTimeZone =
    normalizeTimeZone(args.recipientTimeZone) ?? QUIET_HOURS_FALLBACK_TIME_ZONE

  const recipientLocalMinutes = getRecipientLocalMinutes({
    at: now,
    timeZone: recipientTimeZone,
  })

  if (recipientLocalMinutes == null) {
    return {
      action: 'SEND',
      reason: 'NO_RECIPIENT_TIME_ZONE',
      allowQuietHoursBypass,
      quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
      quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
      recipientLocalMinutes: null,
      nextAttemptAt: null,
    }
  }

    const bypassQuietHours = args.bypassQuietHours ?? false
  const withinQuietHours = isWithinQuietHours({
    quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
    quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
    recipientLocalMinutes,
  })

  if (!withinQuietHours) {
    return {
      action: 'SEND',
      reason: 'OUTSIDE_QUIET_HOURS',
      allowQuietHoursBypass,
      quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
      quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
      recipientLocalMinutes,
      nextAttemptAt: null,
    }
  }

  if (allowQuietHoursBypass && bypassQuietHours) {
    return {
      action: 'SEND',
      reason: 'QUIET_HOURS_BYPASSED',
      allowQuietHoursBypass,
      quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
      quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
      recipientLocalMinutes,
      nextAttemptAt: null,
    }
  }

  const nextAttemptAt = computeQuietHoursResumeAt({
    now,
    recipientTimeZone,
    quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
    quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
    recipientLocalMinutes,
  })

  if (!nextAttemptAt) {
    throw new Error(
      'runtimeChannelPolicy: failed to compute nextAttemptAt for quiet-hours deferral',
    )
  }

  return {
    action: 'DEFER',
    reason: 'QUIET_HOURS',
    allowQuietHoursBypass,
    quietHoursStartMinutes: quietHoursWindow.quietHoursStartMinutes,
    quietHoursEndMinutes: quietHoursWindow.quietHoursEndMinutes,
    recipientLocalMinutes,
    nextAttemptAt,
  }
}