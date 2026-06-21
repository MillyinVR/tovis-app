import { NotificationEventKey } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { pickBool, pickEnum, pickInt } from '@/lib/pick'

import {
  DEFAULT_QUIET_HOURS_END_MINUTES,
  DEFAULT_QUIET_HOURS_START_MINUTES,
  MAX_MINUTE_OF_DAY,
  MIN_MINUTE_OF_DAY,
  getAudienceEventKeys,
  type NotificationAudience,
} from './preferenceCategories'
import type {
  ChannelPreferenceState,
  QuietHoursState,
} from './preferenceService'

export type ParsedPreferenceUpdate = {
  events: Array<{ eventKey: NotificationEventKey; channels: ChannelPreferenceState }>
  quietHours: QuietHoursState
}

export type ParsePreferenceResult =
  | { ok: true; value: ParsedPreferenceUpdate }
  | { ok: false; error: string }

function fail(error: string): ParsePreferenceResult {
  return { ok: false, error }
}

function parseChannels(value: unknown): ChannelPreferenceState | 'invalid' {
  if (!isRecord(value)) return 'invalid'

  const inAppEnabled = pickBool(value.inAppEnabled)
  const smsEnabled = pickBool(value.smsEnabled)
  const emailEnabled = pickBool(value.emailEnabled)

  if (inAppEnabled === null || smsEnabled === null || emailEnabled === null) {
    return 'invalid'
  }

  return { inAppEnabled, smsEnabled, emailEnabled }
}

function parseMinute(value: unknown): number | 'invalid' {
  const minutes = pickInt(value)
  if (minutes === null) return 'invalid'
  if (minutes < MIN_MINUTE_OF_DAY || minutes > MAX_MINUTE_OF_DAY) return 'invalid'
  return minutes
}

function parseQuietHours(value: unknown): QuietHoursState | 'invalid' {
  if (!isRecord(value)) return 'invalid'

  const enabled = pickBool(value.enabled)
  if (enabled === null) return 'invalid'

  if (!enabled) {
    return {
      enabled: false,
      startMinutes: DEFAULT_QUIET_HOURS_START_MINUTES,
      endMinutes: DEFAULT_QUIET_HOURS_END_MINUTES,
    }
  }

  const startMinutes = parseMinute(value.startMinutes)
  const endMinutes = parseMinute(value.endMinutes)
  if (startMinutes === 'invalid' || endMinutes === 'invalid') return 'invalid'

  // Equal start/end is the engine's "no quiet hours" sentinel, so it cannot
  // represent an *enabled* window — reject it instead of silently disabling.
  if (startMinutes === endMinutes) return 'invalid'

  return { enabled: true, startMinutes, endMinutes }
}

/**
 * Validate an untrusted notification-preferences PATCH body for an audience.
 * Only event keys the audience can manage are accepted; channel values must be
 * complete booleans; quiet hours must be a valid window when enabled.
 */
export function parsePreferenceUpdate(args: {
  audience: NotificationAudience
  body: Record<string, unknown>
}): ParsePreferenceResult {
  const audienceKeys = getAudienceEventKeys(args.audience)

  const rawEvents = args.body.events
  if (!isRecord(rawEvents)) {
    return fail('Invalid request: events must be an object.')
  }

  const events: ParsedPreferenceUpdate['events'] = []
  for (const [key, value] of Object.entries(rawEvents)) {
    const eventKey = pickEnum(key, audienceKeys)
    if (eventKey === null) {
      return fail(`Invalid request: unknown notification event "${key}".`)
    }

    const channels = parseChannels(value)
    if (channels === 'invalid') {
      return fail(`Invalid request: channels for "${key}" must be booleans.`)
    }

    events.push({ eventKey, channels })
  }

  const quietHours = parseQuietHours(args.body.quietHours)
  if (quietHours === 'invalid') {
    return fail('Invalid request: quietHours window is invalid.')
  }

  return { ok: true, value: { events, quietHours } }
}
