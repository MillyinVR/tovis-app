// availability/core/summaryWindow.ts

import { clampInt } from '@/lib/pick'

export type YMD = {
  year: number
  month: number
  day: number
}

const DEFAULT_SUMMARY_WINDOW_DAYS = 7
const MAX_SUMMARY_WINDOW_DAYS = 21

export function parseYYYYMMDD(value: unknown): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null
  }

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  return { year, month, day }
}

export function addDaysToYMD(
  year: number,
  month: number,
  day: number,
  daysToAdd: number,
): YMD {
  const date = new Date(
    Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0),
  )

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

export function ymdSerial(ymd: YMD): number {
  return Math.floor(
    Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0) / 86_400_000,
  )
}

export function ymdToString(ymd: YMD): string {
  const month = String(ymd.month).padStart(2, '0')
  const day = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${month}-${day}`
}

export function parseSummaryWindowDays(
  value: string | null,
  maxAdvanceDays: number,
): number {
  const fallback = Math.min(
    DEFAULT_SUMMARY_WINDOW_DAYS,
    Math.max(1, maxAdvanceDays),
  )

  const parsed = Number(value)
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback

  return clampInt(
    normalized,
    1,
    Math.min(MAX_SUMMARY_WINDOW_DAYS, Math.max(1, maxAdvanceDays)),
  )
}

export function resolveSummaryWindowStart(args: {
  startDateStr: string | null
  todayYMD: YMD
  maxAdvanceDays: number
}):
  | {
      ok: true
      startYMD: YMD
      startDateStr: string
      startDayOffset: number
    }
  | {
      ok: false
      error: string
    } {
  const parsedStart = args.startDateStr
    ? parseYYYYMMDD(args.startDateStr)
    : null

  if (!parsedStart) {
    return {
      ok: true,
      startYMD: args.todayYMD,
      startDateStr: ymdToString(args.todayYMD),
      startDayOffset: 0,
    }
  }

  const offset = ymdSerial(parsedStart) - ymdSerial(args.todayYMD)

  if (offset < 0) {
    return {
      ok: false,
      error: 'startDate cannot be in the past.',
    }
  }

  if (offset > args.maxAdvanceDays) {
    return {
      ok: false,
      error: `You can book up to ${args.maxAdvanceDays} days in advance.`,
    }
  }

  return {
    ok: true,
    startYMD: parsedStart,
    startDateStr: ymdToString(parsedStart),
    startDayOffset: offset,
  }
}

export function buildSummaryYMDs(args: {
  startYMD: YMD
  startDayOffset: number
  requestedDays: number
  maxAdvanceDays: number
}): {
  ymds: YMD[]
  windowDays: number
  endYMD: YMD
  hasMoreDays: boolean
  nextStartYMD: YMD | null
} {
  const remainingDays = args.maxAdvanceDays - args.startDayOffset + 1
  const windowDays = clampInt(args.requestedDays, 1, Math.max(1, remainingDays))

  const ymds = Array.from({ length: windowDays }, (_, index) =>
    addDaysToYMD(
      args.startYMD.year,
      args.startYMD.month,
      args.startYMD.day,
      index,
    ),
  )

  const endYMD = ymds[ymds.length - 1] ?? args.startYMD
  const nextOffset = args.startDayOffset + windowDays
  const hasMoreDays = nextOffset <= args.maxAdvanceDays

  const nextStartYMD = hasMoreDays
    ? addDaysToYMD(
        args.startYMD.year,
        args.startYMD.month,
        args.startYMD.day,
        windowDays,
      )
    : null

  return {
    ymds,
    windowDays,
    endYMD,
    hasMoreDays,
    nextStartYMD,
  }
}