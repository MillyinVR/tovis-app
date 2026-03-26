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
  normalizeToMinute,
  type BusyInterval,
} from '@/lib/booking/conflicts'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { canShowSlot } from '@/lib/booking/policies/showSlotPolicy'
import {
  type YMD,
  ymdSerial,
  ymdToString,
} from '@/lib/availability/core/summaryWindow'

const MAX_LEAD_MINUTES = 30 * 24 * 60

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

type LocalMinuteCandidateIndex = Map<number, Date[]>

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

function buildLocalMinuteCandidateIndex(args: {
  dateYMD: YMD
  timeZone: string
  dayStartUtc: Date
  dayEndExclusiveUtc: Date
}): LocalMinuteCandidateIndex {
  const { dateYMD, timeZone, dayStartUtc, dayEndExclusiveUtc } = args

  const requestedSerial = ymdSerial(dateYMD)
  const index: LocalMinuteCandidateIndex = new Map()

  const scanEndUtc = addMinutes(dayEndExclusiveUtc, 24 * 60)

  for (
    let cursor = new Date(dayStartUtc.getTime());
    cursor.getTime() < scanEndUtc.getTime();
    cursor = addMinutes(cursor, 1)
  ) {
    const utc = normalizeToMinute(cursor)
    const parts = utcDateToLocalParts(utc, timeZone)

    const localSerial = ymdSerial({
      year: parts.year,
      month: parts.month,
      day: parts.day,
    })

    const dayOffset = localSerial - requestedSerial
    if (dayOffset !== 0 && dayOffset !== 1) continue

    const localMinuteOffset = dayOffset * 1440 + parts.hour * 60 + parts.minute
    const existing = index.get(localMinuteOffset)

    if (existing) {
      const last = existing[existing.length - 1]
      if (!last || last.getTime() !== utc.getTime()) {
        existing.push(utc)
      }
    } else {
      index.set(localMinuteOffset, [utc])
    }
  }

  return index
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

  const rawSlots: string[] = []
  const skippedDstWallTimes: string[] = []

  const candidateIndex = buildLocalMinuteCandidateIndex({
    dateYMD,
    timeZone,
    dayStartUtc,
    dayEndExclusiveUtc,
  })

  for (
    let minute = window.startMinutes;
    minute + duration + buffer <= window.endMinutes;
    minute += step
  ) {
    const normalizedMinute = minute % 1440
    const dayOffset = Math.floor(minute / 1440)

    const hour = Math.floor(normalizedMinute / 60)
    const minuteOfHour = normalizedMinute % 60

    const slotStartUtcCandidates = candidateIndex.get(minute) ?? []

    if (slotStartUtcCandidates.length === 0) {
      if (debug) {
        skippedDstWallTimes.push(
          `${dayOffset > 0 ? `+${dayOffset}d ` : ''}${String(hour).padStart(2, '0')}:${String(minuteOfHour).padStart(2, '0')}`,
        )
      }
      continue
    }

    for (const slotStartUtc of slotStartUtcCandidates) {
      const slotDecision = canShowSlot({
        startUtc: slotStartUtc,
        nowUtc,
        durationMinutes: duration,
        bufferMinutes: buffer,
        workingHours,
        timeZone,
        stepMinutes: step,
        advanceNoticeMinutes: normalizedLeadTimeMinutes,
        maxDaysAhead: maxAdvanceDays,
        busy,
        fallbackTimeZone: 'UTC',
      })

      if (!slotDecision.ok) continue

      rawSlots.push(slotDecision.value.startUtc.toISOString())
    }
  }

  const slots = [...new Set(rawSlots)].sort()

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