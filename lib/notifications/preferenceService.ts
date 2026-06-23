import { NotificationEventKey } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { isEmailAlwaysOnEvent } from './eventKeys'
import {
  DEFAULT_QUIET_HOURS_END_MINUTES,
  DEFAULT_QUIET_HOURS_START_MINUTES,
  getNotificationCategoriesForAudience,
  getAudienceEventKeys,
  type NotificationAudience,
  type NotificationCategoryMeta,
} from './preferenceCategories'

/**
 * Read/write surface for the *NotificationPreference tables. The delivery engine
 * already consumes these rows (see channelPolicy.ts); this module only lets a
 * user view and edit their own rows. It changes no policy default.
 *
 * Quiet hours are stored per-eventKey on every preference row, so a single
 * user-facing window is written uniformly across all of an owner's rows.
 *
 * To tell "never configured" apart from "explicitly turned off", we use a
 * sentinel the engine already treats as no-quiet-hours: equal start/end minutes
 * (channelPolicy.isWithinQuietHours returns false when start === end). So:
 *   - both null               → never configured → UI default ON (22:00–08:00)
 *   - start === end (e.g. 0)  → explicitly OFF
 *   - start !== end           → explicitly ON with that window
 */

export type ChannelPreferenceState = {
  inAppEnabled: boolean
  smsEnabled: boolean
  emailEnabled: boolean
}

export type QuietHoursState = {
  enabled: boolean
  startMinutes: number
  endMinutes: number
}

export type NotificationPreferencesPayload = {
  categories: NotificationCategoryMeta[]
  // Effective per-event channel state, keyed by event key.
  events: Record<string, ChannelPreferenceState>
  quietHours: QuietHoursState
}

export type SaveNotificationPreferencesInput = {
  audience: NotificationAudience
  ownerId: string
  events: Array<{ eventKey: NotificationEventKey; channels: ChannelPreferenceState }>
  quietHours: QuietHoursState
}

type PreferenceRow = {
  eventKey: NotificationEventKey
  inAppEnabled: boolean
  smsEnabled: boolean
  emailEnabled: boolean
  quietHoursStartMinutes: number | null
  quietHoursEndMinutes: number | null
}

const ROW_SELECT = {
  eventKey: true,
  inAppEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  quietHoursStartMinutes: true,
  quietHoursEndMinutes: true,
} as const

async function findRows(
  audience: NotificationAudience,
  ownerId: string,
): Promise<PreferenceRow[]> {
  if (audience === 'pro') {
    return prisma.professionalNotificationPreference.findMany({
      where: { professionalId: ownerId },
      select: ROW_SELECT,
    })
  }
  return prisma.clientNotificationPreference.findMany({
    where: { clientId: ownerId },
    select: ROW_SELECT,
  })
}

function deriveQuietHours(rows: readonly PreferenceRow[]): QuietHoursState {
  for (const row of rows) {
    const start = row.quietHoursStartMinutes
    const end = row.quietHoursEndMinutes
    if (start == null || end == null) continue

    if (start === end) {
      // Explicit "off" sentinel.
      return {
        enabled: false,
        startMinutes: DEFAULT_QUIET_HOURS_START_MINUTES,
        endMinutes: DEFAULT_QUIET_HOURS_END_MINUTES,
      }
    }

    return { enabled: true, startMinutes: start, endMinutes: end }
  }

  // Never configured → UI default ON.
  return {
    enabled: true,
    startMinutes: DEFAULT_QUIET_HOURS_START_MINUTES,
    endMinutes: DEFAULT_QUIET_HOURS_END_MINUTES,
  }
}

export async function loadNotificationPreferences(args: {
  audience: NotificationAudience
  ownerId: string
}): Promise<NotificationPreferencesPayload> {
  const categories = getNotificationCategoriesForAudience(args.audience)
  const rows = await findRows(args.audience, args.ownerId)
  const byKey = new Map(rows.map((row) => [row.eventKey, row]))

  const events: Record<string, ChannelPreferenceState> = {}

  for (const category of categories) {
    for (const event of category.events) {
      const row = byKey.get(event.eventKey)
      // No row → the engine treats every channel as enabled. Mirror that.
      events[event.eventKey] = row
        ? {
            inAppEnabled: row.inAppEnabled,
            smsEnabled: row.smsEnabled,
            emailEnabled: row.emailEnabled,
          }
        : { inAppEnabled: true, smsEnabled: true, emailEnabled: true }
    }
  }

  return {
    categories,
    events,
    quietHours: deriveQuietHours(rows),
  }
}

function quietHoursColumns(quietHours: QuietHoursState): {
  quietHoursStartMinutes: number
  quietHoursEndMinutes: number
} {
  if (!quietHours.enabled) {
    // Equal start/end is the engine's no-quiet-hours sentinel; reused here to
    // persist an explicit "off" distinct from "never configured".
    return { quietHoursStartMinutes: 0, quietHoursEndMinutes: 0 }
  }
  return {
    quietHoursStartMinutes: quietHours.startMinutes,
    quietHoursEndMinutes: quietHours.endMinutes,
  }
}

export async function saveNotificationPreferences(
  input: SaveNotificationPreferencesInput,
): Promise<void> {
  const quiet = quietHoursColumns(input.quietHours)
  const provided = new Map(
    input.events.map((event) => [event.eventKey, event.channels]),
  )
  const existingByKey = new Map(
    (await findRows(input.audience, input.ownerId)).map((row) => [
      row.eventKey,
      row,
    ]),
  )

  // Declarative, idempotent sync over EVERY audience event key (not just the
  // ones provided) so the single quiet-hours window is written uniformly across
  // all of the owner's rows. Events the caller didn't include keep their stored
  // channel state (or, with no row yet, the all-enabled state — exactly the
  // engine's no-row default, so the row's mere existence changes nothing). Re-
  // applying the same input yields the same rows. Owner id comes only from the
  // authenticated caller.
  const ops = getAudienceEventKeys(input.audience).map((eventKey) => {
    const existing = existingByKey.get(eventKey)
    const channels: ChannelPreferenceState = provided.get(eventKey) ??
      (existing
        ? {
            inAppEnabled: existing.inAppEnabled,
            smsEnabled: existing.smsEnabled,
            emailEnabled: existing.emailEnabled,
          }
        : { inAppEnabled: true, smsEnabled: true, emailEnabled: true })
    const data = {
      inAppEnabled: channels.inAppEnabled,
      smsEnabled: channels.smsEnabled,
      // Critical events always email — never persist email-off for them, so the
      // stored row matches what the engine actually delivers.
      emailEnabled: isEmailAlwaysOnEvent(eventKey) ? true : channels.emailEnabled,
      quietHoursStartMinutes: quiet.quietHoursStartMinutes,
      quietHoursEndMinutes: quiet.quietHoursEndMinutes,
    }

    if (input.audience === 'pro') {
      return prisma.professionalNotificationPreference.upsert({
        where: {
          professionalId_eventKey: {
            professionalId: input.ownerId,
            eventKey,
          },
        },
        create: { professionalId: input.ownerId, eventKey, ...data },
        update: data,
      })
    }

    return prisma.clientNotificationPreference.upsert({
      where: {
        clientId_eventKey: {
          clientId: input.ownerId,
          eventKey,
        },
      },
      create: { clientId: input.ownerId, eventKey, ...data },
      update: data,
    })
  })

  if (ops.length === 0) return

  await prisma.$transaction(ops)
}
