// app/pro/calendar/_utils/calendarMath.ts
import type { CalendarEvent, WorkingHoursJson, BlockRow } from '../_types'
import { DAY_KEYS, addDays, clamp, startOfDay } from './date'
import { sanitizeTimeZone } from '@/lib/timeZone'

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

function hhmmToMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const [hhStr, mmStr] = s.split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  const h = clamp(Math.floor(hh), 0, 23)
  const m = clamp(Math.floor(mm), 0, 59)
  return h * 60 + m
}

export function getWorkingWindowForDay(day: Date, workingHours: WorkingHoursJson, timeZone: string) {
  if (!workingHours) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(day)
    .slice(0, 3)
    .toLowerCase()

  const key = (DAY_KEYS as readonly string[]).includes(weekdayShort)
    ? (weekdayShort as (typeof DAY_KEYS)[number])
    : null

  if (!key) return null

  const cfg = workingHours[key]
  if (!cfg || !cfg.enabled) return null

  const startMinutes = hhmmToMinutes(cfg.start)
  const endMinutes = hhmmToMinutes(cfg.end)
  if (startMinutes == null || endMinutes == null) return null
  if (endMinutes <= startMinutes) return null

  return { startMinutes, endMinutes, key }
}

export function isOutsideWorkingHours(args: {
  day: Date
  startMinutes: number
  endMinutes: number
  workingHours: WorkingHoursJson
  timeZone: string
}) {
  const { day, startMinutes, endMinutes, workingHours, timeZone } = args
  if (!workingHours) return true

  const window = getWorkingWindowForDay(day, workingHours, timeZone)
  if (!window) return true

  return startMinutes < window.startMinutes || endMinutes > window.endMinutes
}

/**
 * ✅ Correct, type-safe blocked detection:
 * - Prefer discriminant `kind`
 * - Fallback to legacy signals in case any old data still leaks in
 */
export function isBlockedEvent(ev: CalendarEvent) {
  if (ev.kind === 'BLOCK') return true
  const s = String(ev.status || '').toUpperCase()
  if (s === 'BLOCKED') return true
  if (String(ev.id || '').startsWith('block:')) return true
  return false
}

/**
 * ✅ Correct, type-safe block id extraction:
 * - Only BLOCK events have blockId
 * - Fallback: parse from id if it uses "block:xyz"
 */
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