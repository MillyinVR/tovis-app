// availability/core/summaryWindow.ts

import { clampInt } from '@/lib/pick'
import { addDaysToYMD } from '@/lib/time'

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

  // Reject dates that don't exist ("2026-02-31") rather than letting Date roll
  // them forward to March 3. The busy-days route carried its own strict parser
  // for exactly this; the two were merged here in R4, keeping the stricter
  // behaviour — a caller that sends an impossible date wants a 400, not a
  // silently different day ([[drifted-duplicate-is-a-bug-report]]).
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
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

/**
 * Every local day in `[fromYmd, toYmd]` inclusive, ascending.
 *
 * Unlike `buildSummaryYMDs` this takes an explicit END rather than a length,
 * and applies NO booking-horizon clamp — the pro-facing month grid wants a day
 * past the horizon returned so it can be counted as zero-open rather than
 * silently dropped. Callers are expected to have bounded the range already
 * (`busy-days` caps it at `MAX_RANGE_DAYS`); `maxDays` is a backstop, not the
 * policy.
 */
export function enumerateYmdRange(
  fromYmd: string,
  toYmd: string,
  maxDays = 400,
): YMD[] {
  const start = parseYYYYMMDD(fromYmd)
  const end = parseYYYYMMDD(toYmd)
  if (!start || !end) return []

  const endSerial = ymdSerial(end)
  const out: YMD[] = []

  for (let offset = 0; offset < maxDays; offset += 1) {
    const current = addDaysToYMD(start.year, start.month, start.day, offset)
    if (ymdSerial(current) > endSerial) break
    out.push(current)
  }

  return out
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