// lib/availability/core/dayComputation.ts

import { clampInt } from '@/lib/pick'
import { sanitizeTimeZone } from '@/lib/timeZone'
import {
  dateTimeLocalToUtcDate,
  getUtcBoundsForLocalDate,
  utcDateToLocalParts,
} from '@/lib/booking/dateTime'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'
import {
  addMinutes,
  mergeBusyIntervals,
  normalizeToMinute,
  type BusyInterval,
} from '@/lib/booking/conflicts'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { checkSlotReadiness } from '@/lib/booking/slotReadiness'
import { type YMD, ymdToString } from '@/lib/availability/core/summaryWindow'

const MAX_LEAD_MINUTES = 30 * 24 * 60

const AMBIGUOUS_LOCAL_TIME_PROBE_MINUTES = [
  -180,
  -120,
  -90,
  -60,
  -30,
  30,
  60,
  90,
  120,
  180,
] as const

export type DayComputationResult =
  | {
      ok: true
      slots: string[]
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }
  | {
      ok: false
      code: 'WORKING_HOURS_REQUIRED' | 'WORKING_HOURS_INVALID'
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }

type LocalWallTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

type LocalMinuteCandidateCache = Map<number, Date[]>

type BusyConflictScanResult = {
  hasConflict: boolean
  nextIndex: number
}

export function computeDayBoundsUtc(dateYMD: YMD, timeZoneRaw: string) {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC')
  const ymd = ymdToString(dateYMD)
  const { startUtc, endUtc } = getUtcBoundsForLocalDate(ymd, timeZone)

  return {
    timeZone,
    dayStartUtc: startUtc,
    dayEndExclusiveUtc: endUtc,
  }
}

function buildLocalDateTimeString(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}) {
  const month = String(args.month).padStart(2, '0')
  const day = String(args.day).padStart(2, '0')
  const hour = String(args.hour).padStart(2, '0')
  const minute = String(args.minute).padStart(2, '0')

  return `${args.year}-${month}-${day}T${hour}:${minute}:00`
}

export function localSlotToUtcOrNull(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}): Date | null {
  const localValue = buildLocalDateTimeString(args)

  try {
    const utc = normalizeToMinute(
      dateTimeLocalToUtcDate(localValue, args.timeZone),
    )

    const roundTrip = utcDateToLocalParts(utc, args.timeZone)
    const matches =
      roundTrip.year === args.year &&
      roundTrip.month === args.month &&
      roundTrip.day === args.day &&
      roundTrip.hour === args.hour &&
      roundTrip.minute === args.minute

    return matches ? utc : null
  } catch {
    return null
  }
}

function shiftYmd(dateYMD: YMD, dayOffset: number): YMD {
  const shifted = new Date(
    Date.UTC(dateYMD.year, dateYMD.month - 1, dateYMD.day + dayOffset),
  )

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function normalizeMinuteOffset(minuteOffset: number): {
  dayOffset: number
  minuteOfDay: number
} {
  const dayOffset = Math.floor(minuteOffset / 1440)
  const minuteOfDay = ((minuteOffset % 1440) + 1440) % 1440

  return {
    dayOffset,
    minuteOfDay,
  }
}

function localWallTimeForMinuteOffset(args: {
  dateYMD: YMD
  minuteOffset: number
}): LocalWallTime {
  const { dayOffset, minuteOfDay } = normalizeMinuteOffset(args.minuteOffset)
  const shifted = shiftYmd(args.dateYMD, dayOffset)

  return {
    year: shifted.year,
    month: shifted.month,
    day: shifted.day,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
  }
}

function formatSkippedWallTime(minuteOffset: number): string {
  const { dayOffset, minuteOfDay } = normalizeMinuteOffset(minuteOffset)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60

  return `${dayOffset > 0 ? `+${dayOffset}d ` : ''}${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function matchesLocalWallTime(
  utc: Date,
  target: LocalWallTime,
  timeZone: string,
): boolean {
  const parts = utcDateToLocalParts(utc, timeZone)

  return (
    parts.year === target.year &&
    parts.month === target.month &&
    parts.day === target.day &&
    parts.hour === target.hour &&
    parts.minute === target.minute
  )
}

function uniqueSortedDates(values: Date[]): Date[] {
  const seen = new Set<number>()
  const unique: Date[] = []

  for (const value of values) {
    const normalized = normalizeToMinute(value)
    const key = normalized.getTime()

    if (seen.has(key)) continue
    seen.add(key)
    unique.push(normalized)
  }

  unique.sort((a, b) => a.getTime() - b.getTime())
  return unique
}

function buildUtcCandidatesForLocalMinute(args: {
  dateYMD: YMD
  minuteOffset: number
  timeZone: string
}): Date[] {
  const target = localWallTimeForMinuteOffset({
    dateYMD: args.dateYMD,
    minuteOffset: args.minuteOffset,
  })

  const primary = localSlotToUtcOrNull({
    year: target.year,
    month: target.month,
    day: target.day,
    hour: target.hour,
    minute: target.minute,
    timeZone: args.timeZone,
  })

  if (!primary) {
    return []
  }

  const candidates: Date[] = [primary]

  for (const delta of AMBIGUOUS_LOCAL_TIME_PROBE_MINUTES) {
    const probe = normalizeToMinute(addMinutes(primary, delta))

    if (matchesLocalWallTime(probe, target, args.timeZone)) {
      candidates.push(probe)
    }
  }

  return uniqueSortedDates(candidates)
}

function getCachedUtcCandidatesForLocalMinute(args: {
  cache: LocalMinuteCandidateCache
  dateYMD: YMD
  minuteOffset: number
  timeZone: string
}): Date[] {
  const cached = args.cache.get(args.minuteOffset)
  if (cached) return cached

  const computed = buildUtcCandidatesForLocalMinute({
    dateYMD: args.dateYMD,
    minuteOffset: args.minuteOffset,
    timeZone: args.timeZone,
  })

  args.cache.set(args.minuteOffset, computed)
  return computed
}

function buildRelevantBusyIntervals(args: {
  busy: BusyInterval[]
  dayStartUtc: Date
  dayEndExclusiveUtc: Date
  durationMinutes: number
  bufferMinutes: number
}): BusyInterval[] {
  const relevantWindowStart = addMinutes(
    args.dayStartUtc,
    -(args.durationMinutes + args.bufferMinutes),
  )
  const relevantWindowEnd = addMinutes(
    args.dayEndExclusiveUtc,
    args.durationMinutes + args.bufferMinutes,
  )

  const relevant = args.busy.filter(
    (interval) =>
      interval.end.getTime() > relevantWindowStart.getTime() &&
      interval.start.getTime() < relevantWindowEnd.getTime(),
  )

  return mergeBusyIntervals(relevant)
}

function buildSortedCandidateSlotStarts(args: {
  dateYMD: YMD
  timeZone: string
  windowStartMinutes: number
  windowEndMinutes: number
  durationMinutes: number
  bufferMinutes: number
  stepMinutes: number
  cache: LocalMinuteCandidateCache
  debug: boolean
  skippedDstWallTimes: string[]
}): Date[] {
  const rawCandidates: Date[] = []

  for (
    let minute = args.windowStartMinutes;
    minute + args.durationMinutes + args.bufferMinutes <= args.windowEndMinutes;
    minute += args.stepMinutes
  ) {
    const slotStartUtcCandidates = getCachedUtcCandidatesForLocalMinute({
      cache: args.cache,
      dateYMD: args.dateYMD,
      minuteOffset: minute,
      timeZone: args.timeZone,
    })

    if (slotStartUtcCandidates.length === 0) {
      if (args.debug) {
        args.skippedDstWallTimes.push(formatSkippedWallTime(minute))
      }
      continue
    }

    rawCandidates.push(...slotStartUtcCandidates)
  }

  return uniqueSortedDates(rawCandidates)
}

function scanBusyConflictFromIndex(args: {
  busyIntervals: BusyInterval[]
  requestedStart: Date
  requestedEnd: Date
  startIndex: number
}): BusyConflictScanResult {
  const requestedStartMs = args.requestedStart.getTime()
  const requestedEndMs = args.requestedEnd.getTime()

  let index = args.startIndex

  while (
    index < args.busyIntervals.length &&
    args.busyIntervals[index].end.getTime() <= requestedStartMs
  ) {
    index += 1
  }

  for (let current = index; current < args.busyIntervals.length; current += 1) {
    const interval = args.busyIntervals[current]

    if (interval.start.getTime() >= requestedEndMs) {
      return {
        hasConflict: false,
        nextIndex: index,
      }
    }

    if (
      interval.start.getTime() < requestedEndMs &&
      interval.end.getTime() > requestedStartMs
    ) {
      return {
        hasConflict: true,
        nextIndex: index,
      }
    }
  }

  return {
    hasConflict: false,
    nextIndex: index,
  }
}

export async function computeDaySlotsFast(args: {
  dateYMD: YMD
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  leadTimeMinutes: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  busy: BusyInterval[]
  debug?: boolean
}): Promise<DayComputationResult> {
  const {
    dateYMD,
    durationMinutes,
    stepMinutes,
    timeZone: timeZoneInput,
    workingHours,
    leadTimeMinutes,
    locationBufferMinutes,
    maxAdvanceDays,
    busy,
    debug,
  } = args

  const { timeZone, dayStartUtc, dayEndExclusiveUtc } = computeDayBoundsUtc(
    dateYMD,
    timeZoneInput,
  )
  const nowUtc = new Date()

  const dayAnchorUtc =
    localSlotToUtcOrNull({
      year: dateYMD.year,
      month: dateYMD.month,
      day: dateYMD.day,
      hour: 12,
      minute: 0,
      timeZone,
    }) ?? new Date(dayStartUtc.getTime() + 12 * 60 * 60 * 1000)

  const window = getWorkingWindowForDay(dayAnchorUtc, workingHours, timeZone)

  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return {
        ok: false,
        code: 'WORKING_HOURS_REQUIRED',
        dayStartUtc,
        dayEndExclusiveUtc,
        debug: debug ? { timeZone, reason: 'no-workingHours' } : undefined,
      }
    }

    if (window.reason === 'DISABLED') {
      return {
        ok: true,
        slots: [],
        dayStartUtc,
        dayEndExclusiveUtc,
        debug: debug ? { timeZone, reason: 'disabled-day' } : undefined,
      }
    }

    return {
      ok: false,
      code: 'WORKING_HOURS_INVALID',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug
        ? { timeZone, reason: 'misconfigured-workingHours' }
        : undefined,
    }
  }

  const step = normalizeStepMinutes(stepMinutes, 30)
  const duration = clampInt(
    Number(durationMinutes || DEFAULT_DURATION_MINUTES),
    15,
    MAX_SLOT_DURATION_MINUTES,
  )
  const buffer = clampInt(
    Number(locationBufferMinutes ?? 0) || 0,
    0,
    MAX_BUFFER_MINUTES,
  )
  const normalizedLeadTimeMinutes = clampInt(
    Number(leadTimeMinutes ?? 0) || 0,
    0,
    MAX_LEAD_MINUTES,
  )

  const skippedDstWallTimes: string[] = []
  const candidateCache: LocalMinuteCandidateCache = new Map()

  const relevantBusy = buildRelevantBusyIntervals({
    busy,
    dayStartUtc,
    dayEndExclusiveUtc,
    durationMinutes: duration,
    bufferMinutes: buffer,
  })

  const sortedCandidateStarts = buildSortedCandidateSlotStarts({
    dateYMD,
    timeZone,
    windowStartMinutes: window.startMinutes,
    windowEndMinutes: window.endMinutes,
    durationMinutes: duration,
    bufferMinutes: buffer,
    stepMinutes: step,
    cache: candidateCache,
    debug: Boolean(debug),
    skippedDstWallTimes,
  })

  const slots: string[] = []
  let busyIndex = 0

  for (const slotStartUtc of sortedCandidateStarts) {
    const readiness = checkSlotReadiness({
      startUtc: slotStartUtc,
      nowUtc,
      durationMinutes: duration,
      bufferMinutes: buffer,
      workingHours,
      timeZone,
      stepMinutes: step,
      advanceNoticeMinutes: normalizedLeadTimeMinutes,
      maxDaysAhead: maxAdvanceDays,
      fallbackTimeZone: 'UTC',
    })

    if (!readiness.ok) continue

    const busyConflict = scanBusyConflictFromIndex({
      busyIntervals: relevantBusy,
      requestedStart: slotStartUtc,
      requestedEnd: readiness.endUtc,
      startIndex: busyIndex,
    })

    busyIndex = busyConflict.nextIndex

    if (busyConflict.hasConflict) continue

    slots.push(readiness.startUtc.toISOString())
  }

  return {
    ok: true,
    slots,
    dayStartUtc,
    dayEndExclusiveUtc,
    debug: debug
      ? {
          timeZone,
          dayKey: window.key,
          spansMidnight: window.spansMidnight,
          windowStartMinutes: window.startMinutes,
          windowEndMinutes: window.endMinutes,
          skippedDstWallTimes,
        }
      : undefined,
  }
}