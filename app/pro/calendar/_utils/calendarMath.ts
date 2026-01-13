// app/pro/calendar/_utils/calendarMath.ts

import type { CalendarEvent, WorkingHoursJson, BlockRow } from '../_types'
import { DAY_KEYS, addDays, clamp, startOfDay } from './date'

export const PX_PER_MINUTE = 1
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

export function getWorkingWindowForDate(date: Date, workingHours: WorkingHoursJson) {
  if (!workingHours) return null
  const key = DAY_KEYS[date.getDay()]
  const cfg = (workingHours as any)[key]
  if (!cfg || !cfg.enabled || !cfg.start || !cfg.end) return null

  const [sh, sm] = String(cfg.start).split(':').map((x: string) => parseInt(x, 10) || 0)
  const [eh, em] = String(cfg.end).split(':').map((x: string) => parseInt(x, 10) || 0)

  const startMinutes = sh * 60 + sm
  const endMinutes = eh * 60 + em
  if (endMinutes <= startMinutes) return null
  return { startMinutes, endMinutes }
}

export function isOutsideWorkingHours(args: { day: Date; startMinutes: number; endMinutes: number; workingHours: WorkingHoursJson }) {
  const { day, startMinutes, endMinutes, workingHours } = args
  const key = DAY_KEYS[day.getDay()]
  const cfg = workingHours && (workingHours as any)[key] ? (workingHours as any)[key] : null
  if (!cfg || !cfg.enabled) return true
  const window = getWorkingWindowForDate(day, workingHours)
  if (!window) return true
  return startMinutes < window.startMinutes || endMinutes > window.endMinutes
}

export function isBlockedEvent(ev: CalendarEvent) {
  const s = String(ev.status || '').toUpperCase()
  if (s === 'BLOCKED') return true
  if (String(ev.id || '').startsWith('block:')) return true
  if (String(ev.kind || '').toUpperCase() === 'BLOCK') return true
  return false
}

export function extractBlockId(ev: CalendarEvent) {
  if (ev.blockId) return ev.blockId
  const id = String(ev.id || '')
  if (id.startsWith('block:')) return id.slice('block:'.length)
  return null
}

export function blockToEvent(b: BlockRow): CalendarEvent {
  const s = new Date(b.startsAt)
  const e = new Date(b.endsAt)
  const note = b.note ?? null
  return {
    id: `block:${b.id}`,
    blockId: b.id,
    kind: 'BLOCK',
    status: 'BLOCKED',
    title: 'Blocked',
    clientName: note || 'Personal time',
    note,
    startsAt: s.toISOString(),
    endsAt: e.toISOString(),
    durationMinutes: Math.max(15, Math.round((e.getTime() - s.getTime()) / 60_000)),
  }
}

/**
 * Overlap minutes within a local "day" boundary.
 * NOTE: this is still LOCAL day-based; for timezone-accurate "today stats"
 * we now do that on the server in the pro's timezone.
 */
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
