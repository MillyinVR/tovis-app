// app/pro/calendar/_utils/calendarMath.ts
import type { CalendarEvent, WorkingHoursJson, BlockRow } from '../_types'
import { addDays, clamp, startOfDay, DAY_KEYS } from './date'
import {
  getWorkingWindowForDay as getWorkingWindowForDayLib,
  isOutsideWorkingHours as isOutsideWorkingHoursLib,
} from '@/lib/scheduling/workingHours'

export const PX_PER_MINUTE = 1.5
export const SNAP_MINUTES = 15
export const MIN_DURATION = 15
export const MAX_DURATION = 12 * 60

export function snapMinutes(mins: number) {
  const snapped = Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
  return clamp(snapped, 0, 24 * 60 - SNAP_MINUTES)
}

export function roundTo15(mins: number) {
  const snapped = Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
  return clamp(snapped, MIN_DURATION, MAX_DURATION)
}

export function computeDurationMinutesFromIso(startsAtIso: string, endsAtIso: string) {
  const s = new Date(startsAtIso).getTime()
  const e = new Date(endsAtIso).getTime()
  const mins = Math.round((e - s) / 60_000)
  return Number.isFinite(mins) && mins > 0 ? mins : 60
}

// ✅ single source of truth: lib/scheduling/workingHours
export function getWorkingWindowForDay(day: Date, workingHours: WorkingHoursJson, timeZone: string) {
  // Keep return shape compatible with existing callers.
  const w = getWorkingWindowForDayLib(day, workingHours, timeZone)
  if (!w) return null
  return { startMinutes: w.startMinutes, endMinutes: w.endMinutes, key: w.key as (typeof DAY_KEYS)[number] }
}

export function isOutsideWorkingHours(args: {
  day: Date
  startMinutes: number
  endMinutes: number
  workingHours: WorkingHoursJson
  timeZone: string
}) {
  return isOutsideWorkingHoursLib({
    day: args.day,
    startMinutes: args.startMinutes,
    endMinutes: args.endMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
  })
}

/** Prefer discriminant `kind`, fallback for legacy */
export function isBlockedEvent(ev: CalendarEvent) {
  if (ev.kind === 'BLOCK') return true
  const s = String(ev.status || '').toUpperCase()
  if (s === 'BLOCKED') return true
  if (String(ev.id || '').startsWith('block:')) return true
  return false
}

/** Only BLOCK events have blockId; fallback parses "block:xyz" */
export function extractBlockId(ev: CalendarEvent) {
  if (ev.kind === 'BLOCK') return ev.blockId
  const id = String(ev.id || '')
  if (id.startsWith('block:')) return id.slice('block:'.length)
  return null
}

export function blockToEvent(b: BlockRow): CalendarEvent {
  const s = new Date(b.startsAt)
  const e = new Date(b.endsAt)
  const note = b.note ?? null
  const durationMinutes = Math.max(15, Math.round((e.getTime() - s.getTime()) / 60_000))

  return {
    kind: 'BLOCK',
    id: `block:${b.id}`,
    blockId: b.id,
    status: 'BLOCKED',
    title: 'Blocked',
    clientName: note || 'Personal time',
    note,
    startsAt: s.toISOString(),
    endsAt: e.toISOString(),
    durationMinutes,
  }
}

export function overlapMinutesWithinDay(startsAtIso: string, endsAtIso: string, day: Date) {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)

  const s = new Date(startsAtIso)
  const e = new Date(endsAtIso)

  const startMs = Math.max(s.getTime(), dayStart.getTime())
  const endMs = Math.min(e.getTime(), dayEnd.getTime())

  const mins = Math.round((endMs - startMs) / 60_000)
  return mins > 0 ? mins : 0
}