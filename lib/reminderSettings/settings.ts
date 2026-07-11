// lib/reminderSettings/settings.ts
//
// Single source of truth for a pro's account-level appointment-reminder cadence.
// One ProReminderSettings row per pro, created lazily. Owns reads, the upsert
// applied by the settings surface, DTO mapping, and the resolver the scheduling
// spine (lib/notifications/appointmentReminders.ts) uses to decide which
// reminders to plan. Nothing here schedules or sends — it only records the pro's
// cadence choices and normalizes them against the numeric bounds.
//
// A pro builds a fully custom list of reminders, each an arbitrary lead time —
// any number of days OR hours before the appointment. The scalar unit of
// identity is minutes before the appointment (offsetMinutes): a whole-day lead
// is a multiple of 1440, a sub-day lead is a multiple of 60.

import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import type {
  ProReminderSettingsDTO,
  ReminderLeadDTO,
  ReminderPresetDTO,
} from '@/lib/dto/reminderSettings'

type DbClient = Prisma.TransactionClient | typeof prisma

type ProReminderSettingsRow = {
  enabled: boolean
  offsetMinutes: number[]
}

const MINUTES_PER_DAY = 1440
const MINUTES_PER_HOUR = 60

/**
 * Lead-time bounds for a single reminder:
 * - min 1h — below the 15-min drain cron + write latency it can't fire reliably;
 * - max 90d — a sane ceiling well past any real reminder cadence;
 * - multiples of 15 min — clean copy + alignment with the 15-min drain cron.
 * The structured value+unit editor only ever emits whole hours/days (both
 * multiples of 15); the 15-min floor is a defensive bound for direct callers.
 */
const MIN_OFFSET_MINUTES = 60
const MAX_OFFSET_MINUTES = 129_600
const OFFSET_GRANULARITY_MINUTES = 15
/** A pro may configure at most this many distinct reminders. */
const MAX_REMINDERS = 10

/** Default cadence: 1 week + 3 days + 1 day before (in minutes). */
const DEFAULT_OFFSET_MINUTES: readonly number[] = [10080, 4320, 1440]

/**
 * Suggested lead-time presets the UI offers as quick-adds (longest first). These
 * are hints, not an allowlist — a pro may add any lead within the bounds above.
 */
export const REMINDER_PRESETS: readonly ReminderPresetDTO[] = [
  { value: 7, unit: 'days', label: '1 week before' },
  { value: 3, unit: 'days', label: '3 days before' },
  { value: 1, unit: 'days', label: '1 day before' },
  { value: 4, unit: 'hours', label: '4 hours before' },
  { value: 2, unit: 'hours', label: '2 hours before' },
] as const

/** Default cadence for a pro with no saved row: 1 week + 3 days + day before. */
const DEFAULTS: ProReminderSettingsRow = {
  enabled: true,
  offsetMinutes: [...DEFAULT_OFFSET_MINUTES],
}

const SELECT = {
  enabled: true,
  offsetMinutes: true,
} satisfies Prisma.ProReminderSettingsSelect

/** A lead time is valid iff it is a positive int within the granularity bounds. */
function isValidOffsetMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_OFFSET_MINUTES &&
    value <= MAX_OFFSET_MINUTES &&
    value % OFFSET_GRANULARITY_MINUTES === 0
  )
}

/**
 * Keep only valid lead times, drop duplicates, and sort longest-lead first so the
 * stored/returned order is stable regardless of how the client sent it. Lenient
 * (silently drops invalid) — used on the read path to guard against drift; the
 * write path validates strictly instead.
 */
function normalizeOffsetMinutes(values: readonly number[]): number[] {
  const seen = new Set<number>()
  for (const value of values) {
    if (!isValidOffsetMinutes(value)) continue
    seen.add(value)
  }
  return Array.from(seen).sort((a, b) => b - a)
}

function labelForDays(days: number): string {
  if (days === 7) return '1 week before'
  return `${days} day${days === 1 ? '' : 's'} before`
}

function labelForHours(hours: number): string {
  return `${hours} hour${hours === 1 ? '' : 's'} before`
}

/** Describe a stored lead time as a display label + a value/unit for the editor. */
function describeLead(minutes: number): ReminderLeadDTO {
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY
    return { minutes, value: days, unit: 'days', label: labelForDays(days) }
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR
    return { minutes, value: hours, unit: 'hours', label: labelForHours(hours) }
  }
  // Defensive: a sub-hour-granularity lead is not reachable via the value+unit
  // editor (which only emits whole hours/days). Present it in hours with an exact
  // label so nothing renders as a wrong value.
  return {
    minutes,
    value: minutes / MINUTES_PER_HOUR,
    unit: 'hours',
    label: `${minutes} minutes before`,
  }
}

function toRow(row: ProReminderSettingsRow): ProReminderSettingsRow {
  return {
    enabled: row.enabled,
    offsetMinutes: normalizeOffsetMinutes(row.offsetMinutes),
  }
}

export function toProReminderSettingsDTO(
  row: ProReminderSettingsRow,
): ProReminderSettingsDTO {
  const normalized = toRow(row)
  return {
    enabled: normalized.enabled,
    offsetMinutes: normalized.offsetMinutes,
    leads: normalized.offsetMinutes.map(describeLead),
  }
}

function getDb(db?: DbClient): DbClient {
  return db ?? prisma
}

/** Read a pro's cadence, falling back to the default cadence when unset. */
export async function getProReminderSettings(
  professionalId: string,
  db?: DbClient,
): Promise<ProReminderSettingsDTO> {
  const row = await getDb(db).proReminderSettings.findUnique({
    where: { professionalId },
    select: SELECT,
  })
  return toProReminderSettingsDTO(row ?? DEFAULTS)
}

/**
 * The lead times that should actually fire for this pro's bookings, in minutes.
 * Used by the scheduling spine. Returns an empty list when reminders are turned
 * off, and the default cadence when the pro has never saved a row.
 */
export async function resolveEnabledReminderOffsetMinutes(args: {
  professionalId: string
  db?: DbClient
}): Promise<number[]> {
  const row = await getDb(args.db).proReminderSettings.findUnique({
    where: { professionalId: args.professionalId },
    select: SELECT,
  })

  const resolved = toRow(row ?? DEFAULTS)
  return resolved.enabled ? resolved.offsetMinutes : []
}

/**
 * Convert the structured `reminders: {value, unit}[]` the editor submits into raw
 * minutes, preserving the entry count so a malformed entry surfaces as NaN and is
 * rejected by the strict write validator rather than silently dropped.
 */
export function parseReminderLeadsToOffsetMinutes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (!isRecord(entry)) return Number.NaN
    const value =
      typeof entry.value === 'number'
        ? entry.value
        : typeof entry.value === 'string' && entry.value.trim() !== ''
          ? Number(entry.value.trim())
          : Number.NaN
    if (!Number.isFinite(value)) return Number.NaN
    if (entry.unit === 'hours') return value * MINUTES_PER_HOUR
    if (entry.unit === 'days') return value * MINUTES_PER_DAY
    return Number.NaN
  })
}

/** Validated patch the settings route applies. */
export type ProReminderSettingsUpdate = {
  enabled: boolean
  offsetMinutes: number[]
}

export class ProReminderSettingsValidationError extends Error {}

function normalizeUpdate(update: ProReminderSettingsUpdate): {
  enabled: boolean
  offsetMinutes: number[]
} {
  if (!Array.isArray(update.offsetMinutes)) {
    throw new ProReminderSettingsValidationError(
      'Reminder lead times must be a list.',
    )
  }

  // Reject values outside the bounds rather than silently dropping them, so a bad
  // client can't quietly end up with a cadence it didn't intend.
  for (const value of update.offsetMinutes) {
    if (!isValidOffsetMinutes(value)) {
      throw new ProReminderSettingsValidationError(
        'Each reminder must be between 1 hour and 90 days before the appointment.',
      )
    }
  }

  const offsetMinutes = Array.from(new Set(update.offsetMinutes)).sort(
    (a, b) => b - a,
  )

  if (offsetMinutes.length > MAX_REMINDERS) {
    throw new ProReminderSettingsValidationError(
      `You can set at most ${MAX_REMINDERS} reminders.`,
    )
  }

  return {
    enabled: update.enabled === true,
    offsetMinutes,
  }
}

/** Create-or-update a pro's cadence and return the persisted DTO. */
export async function updateProReminderSettings(args: {
  professionalId: string
  update: ProReminderSettingsUpdate
}): Promise<ProReminderSettingsDTO> {
  const data = normalizeUpdate(args.update)

  const row = await prisma.proReminderSettings.upsert({
    where: { professionalId: args.professionalId },
    create: { professionalId: args.professionalId, ...data },
    update: data,
    select: SELECT,
  })

  return toProReminderSettingsDTO(row)
}
