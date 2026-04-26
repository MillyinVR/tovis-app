// app/pro/calendar/_utils/calendarMath.ts

import type {
  BlockRow,
  CalendarEvent,
  WeekdayKey,
  WorkingHoursJson,
} from '../_types'

import {
  DEFAULT_CALENDAR_STEP_MINUTES,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
} from '../_constants'

import { addDays, clamp, startOfDay } from './date'

import {
  DEFAULT_BLOCK_CLIENT_NAME,
  DEFAULT_BLOCK_TITLE,
  DEFAULT_BOOKING_SERVICE_NAME,
  CALENDAR_MS_PER_MINUTE,
} from '@/lib/calendar/constants'

import { overlapMinutes } from '@/lib/calendar/overlap'

import {
  getWorkingWindowForDay as getWorkingWindowForDayLib,
  isOutsideWorkingHours as isOutsideWorkingHoursLib,
} from '@/lib/scheduling/workingHours'

export const PX_PER_MINUTE = 1.5

/**
 * Default fallback only when a location-specific step is missing or invalid.
 */
export const DEFAULT_STEP_MINUTES = DEFAULT_CALENDAR_STEP_MINUTES
export const MIN_STEP_MINUTES = 5
export const MAX_STEP_MINUTES = 60
export const DEFAULT_DURATION_MINUTES = 60
export const MAX_DURATION = 12 * MINUTES_PER_HOUR

type WorkingWindow = {
  startMinutes: number
  endMinutes: number
  key: WeekdayKey
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

function weekdayKeyFromUnknown(value: unknown): WeekdayKey | null {
  if (value === 'sun') return 'sun'
  if (value === 'mon') return 'mon'
  if (value === 'tue') return 'tue'
  if (value === 'wed') return 'wed'
  if (value === 'thu') return 'thu'
  if (value === 'fri') return 'fri'
  if (value === 'sat') return 'sat'

  return null
}

function eventIdText(event: CalendarEvent): string {
  return typeof event.id === 'string' ? event.id : ''
}

function rawDurationMinutes(startsAt: string | Date, endsAt: string | Date): number {
  const start = validDate(startsAt)
  const end = validDate(endsAt)

  if (!start || !end) return DEFAULT_DURATION_MINUTES

  const minutes = Math.round(
    (end.getTime() - start.getTime()) / CALENDAR_MS_PER_MINUTE,
  )

  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : DEFAULT_DURATION_MINUTES
}

// ─── Step / duration helpers ──────────────────────────────────────────────────

export function normalizeStepMinutes(stepMinutes?: number | null): number {
  const raw = isFiniteNumber(stepMinutes)
    ? Math.trunc(stepMinutes)
    : DEFAULT_STEP_MINUTES

  return clamp(raw, MIN_STEP_MINUTES, MAX_STEP_MINUTES)
}

export function snapMinutes(
  minutes: number,
  stepMinutes?: number | null,
): number {
  const step = normalizeStepMinutes(stepMinutes)
  const raw = isFiniteNumber(minutes) ? minutes : 0
  const snapped = Math.round(raw / step) * step

  return clamp(snapped, 0, MINUTES_PER_DAY - step)
}

export function roundDurationMinutes(
  minutes: number,
  stepMinutes?: number | null,
): number {
  const step = normalizeStepMinutes(stepMinutes)
  const raw = isFiniteNumber(minutes) ? minutes : DEFAULT_DURATION_MINUTES
  const snapped = Math.round(raw / step) * step

  return clamp(snapped, step, MAX_DURATION)
}

export function computeDurationMinutesFromIso(
  startsAtIso: string,
  endsAtIso: string,
): number {
  return rawDurationMinutes(startsAtIso, endsAtIso)
}

// ─── Working-hours helpers ────────────────────────────────────────────────────

/**
 * Single source of truth: lib/scheduling/workingHours.
 */
export function getWorkingWindowForDay(
  day: Date,
  workingHours: WorkingHoursJson,
  timeZone: string,
): WorkingWindow | null {
  const window = getWorkingWindowForDayLib(day, workingHours, timeZone)

  if (!window.ok) return null

  const key = weekdayKeyFromUnknown(window.key)

  if (!key) return null

  return {
    startMinutes: window.startMinutes,
    endMinutes: window.endMinutes,
    key,
  }
}

export function isOutsideWorkingHours(args: {
  day: Date
  startMinutes: number
  endMinutes: number
  workingHours: WorkingHoursJson
  timeZone: string
}): boolean {
  return isOutsideWorkingHoursLib({
    day: args.day,
    startMinutes: args.startMinutes,
    endMinutes: args.endMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
  })
}

// ─── Event helpers ────────────────────────────────────────────────────────────

/**
 * Prefer discriminant `kind`.
 * Fallbacks stay here only so legacy hydrated rows do not break old sessions.
 */
export function isBlockedEvent(event: CalendarEvent): boolean {
  if (event.kind === 'BLOCK') return true

  const status = String(event.status || '').trim().toUpperCase()

  if (status === 'BLOCKED') return true

  return eventIdText(event).startsWith('block:')
}

/**
 * Only BLOCK events have blockId.
 * Fallback parses legacy ids shaped like "block:xyz".
 */
export function extractBlockId(event: CalendarEvent): string | null {
  if (event.kind === 'BLOCK') return event.blockId

  const id = eventIdText(event)

  return id.startsWith('block:') ? id.slice('block:'.length) : null
}

export function blockToEvent(
  block: BlockRow,
  options?: { stepMinutes?: number | null },
): CalendarEvent {
  const startsAt = validDate(block.startsAt)
  const endsAt = validDate(block.endsAt)

  const safeStartsAt = startsAt ?? new Date()
  const fallbackEndsAt = new Date(
    safeStartsAt.getTime() + DEFAULT_DURATION_MINUTES * CALENDAR_MS_PER_MINUTE,
  )

  const safeEndsAt =
    endsAt && endsAt.getTime() > safeStartsAt.getTime()
      ? endsAt
      : fallbackEndsAt

  const note =
    typeof block.note === 'string' && block.note.trim()
      ? block.note.trim()
      : null

  const durationMinutes = roundDurationMinutes(
    rawDurationMinutes(safeStartsAt, safeEndsAt),
    options?.stepMinutes,
  )

  return {
    kind: 'BLOCK',
    id: `block:${block.id}`,
    blockId: block.id,
    status: 'BLOCKED',
    title: DEFAULT_BLOCK_TITLE,
    clientName: note || DEFAULT_BLOCK_CLIENT_NAME,
    note,
    locationId: block.locationId ?? null,
    startsAt: safeStartsAt.toISOString(),
    endsAt: safeEndsAt.toISOString(),
    durationMinutes,
  }
}

// ─── Overlap / geometry helpers ───────────────────────────────────────────────

export function overlapMinutesWithinDay(
  startsAtIso: string,
  endsAtIso: string,
  day: Date,
): number {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)

  return overlapMinutes(
    {
      startsAt: startsAtIso,
      endsAt: endsAtIso,
    },
    {
      startsAt: dayStart,
      endsAt: dayEnd,
    },
  )
}

export function clampMinutesToDay(minutes: number): number {
  const raw = isFiniteNumber(minutes) ? minutes : 0

  return clamp(raw, 0, MINUTES_PER_DAY)
}

export function minutesToTopPx(minutes: number): number {
  return clampMinutesToDay(minutes) * PX_PER_MINUTE
}

export function durationToHeightPx(
  minutes: number,
  stepMinutes?: number | null,
): number {
  return roundDurationMinutes(minutes, stepMinutes) * PX_PER_MINUTE
}