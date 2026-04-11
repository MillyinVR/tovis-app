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

const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>()

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
  const quietHoursStartMinutes = normalizeMinuteOfDay(
    preference?.quietHoursStartMinutes ?? null,
  )
  const quietHoursEndMinutes = normalizeMinuteOfDay(
    preference?.quietHoursEndMinutes ?? null,
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

function getZonedDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedDateTimeFormatterCache.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  zonedDateTimeFormatterCache.set(timeZone, formatter)
  return formatter
}

function getZonedDateTimeParts(
  date: Date,
  timeZone: string,
): ZonedDateTimeParts | null {
  const normalizedDate = normalizeNow(date)

  try {
    const parts = getZonedDateTimeFormatter(timeZone).formatToParts(
      normalizedDate,
    )

    const getPart = (type: Intl.DateTimeFormatPartTypes): number | null => {
      const raw = parts.find((part) => part.type === type)?.value ?? null
      if (!raw) return null

      const parsed = Number.parseInt(raw, 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    const year = getPart('year')
    const month = getPart('month')
    const day = getPart('day')
    const hour = getPart('hour')
    const minute = getPart('minute')
    const second = getPart('second')

    if (
      year == null ||
      month == null ||
      day == null ||
      hour == null ||
      minute == null ||
      second == null
    ) {
      return null
    }

    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
    }
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

  const recipientTimeZone = normalizeTimeZone(args.recipientTimeZone)
  if (!recipientTimeZone) {
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