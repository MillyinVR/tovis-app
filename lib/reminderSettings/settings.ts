// lib/reminderSettings/settings.ts
//
// Single source of truth for a pro's account-level appointment-reminder cadence
// (Phase 2.3). One ProReminderSettings row per pro, created lazily. Owns reads,
// the upsert applied by the settings surface, DTO mapping, and the resolver the
// scheduling spine (lib/notifications/appointmentReminders.ts) uses to decide
// which reminders to plan. Nothing here schedules or sends — it only records the
// pro's cadence choices and normalizes them against the supported menu.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type {
  ProReminderSettingsDTO,
  ReminderOffsetOptionDTO,
} from '@/lib/dto/reminderSettings'

type DbClient = Prisma.TransactionClient | typeof prisma

type ProReminderSettingsRow = {
  enabled: boolean
  offsetDays: number[]
}

/**
 * The supported reminder offsets (days before the appointment). Each value maps
 * to exactly one reminder kind in appointmentReminders.ts, so keep the two in
 * sync when extending the menu. Ordered longest-lead first for display.
 */
export const REMINDER_OFFSET_OPTIONS: readonly ReminderOffsetOptionDTO[] = [
  { days: 7, label: '1 week before' },
  { days: 3, label: '3 days before' },
  { days: 1, label: '1 day before' },
] as const

const ALLOWED_OFFSET_DAYS: ReadonlySet<number> = new Set(
  REMINDER_OFFSET_OPTIONS.map((option) => option.days),
)

/** Default cadence for a pro with no saved row: 1 week + 3 days + day before. */
const DEFAULTS: ProReminderSettingsRow = {
  enabled: true,
  offsetDays: [7, 3, 1],
}

const SELECT = {
  enabled: true,
  offsetDays: true,
} satisfies Prisma.ProReminderSettingsSelect

/**
 * Keep only supported offsets, drop duplicates, and sort longest-lead first so
 * the stored/returned order is stable regardless of how the client sent it.
 */
function normalizeOffsetDays(values: readonly number[]): number[] {
  const seen = new Set<number>()
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isInteger(value)) continue
    if (!ALLOWED_OFFSET_DAYS.has(value)) continue
    seen.add(value)
  }
  return Array.from(seen).sort((a, b) => b - a)
}

function toRow(row: ProReminderSettingsRow): ProReminderSettingsRow {
  return {
    enabled: row.enabled,
    offsetDays: normalizeOffsetDays(row.offsetDays),
  }
}

export function toProReminderSettingsDTO(
  row: ProReminderSettingsRow,
): ProReminderSettingsDTO {
  const normalized = toRow(row)
  return {
    enabled: normalized.enabled,
    offsetDays: normalized.offsetDays,
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
 * The offsets that should actually fire for this pro's bookings. Used by the
 * scheduling spine. Returns an empty list when reminders are turned off, and the
 * default cadence when the pro has never saved a row.
 */
export async function resolveEnabledReminderOffsetDays(args: {
  professionalId: string
  db?: DbClient
}): Promise<number[]> {
  const row = await getDb(args.db).proReminderSettings.findUnique({
    where: { professionalId: args.professionalId },
    select: SELECT,
  })

  const resolved = toRow(row ?? DEFAULTS)
  return resolved.enabled ? resolved.offsetDays : []
}

/** Validated patch the settings route applies. */
export type ProReminderSettingsUpdate = {
  enabled: boolean
  offsetDays: number[]
}

export class ProReminderSettingsValidationError extends Error {}

function normalizeUpdate(update: ProReminderSettingsUpdate): {
  enabled: boolean
  offsetDays: number[]
} {
  if (!Array.isArray(update.offsetDays)) {
    throw new ProReminderSettingsValidationError(
      'Reminder offsets must be a list.',
    )
  }

  // Reject values outside the supported menu rather than silently dropping them,
  // so a bad client can't quietly end up with a cadence it didn't intend.
  for (const value of update.offsetDays) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      !ALLOWED_OFFSET_DAYS.has(value)
    ) {
      throw new ProReminderSettingsValidationError(
        'Choose reminder timing from the available options.',
      )
    }
  }

  return {
    enabled: update.enabled === true,
    offsetDays: normalizeOffsetDays(update.offsetDays),
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
