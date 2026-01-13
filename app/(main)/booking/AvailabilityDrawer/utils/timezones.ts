// app/(main)/booking/AvailabilityDrawer/utils/timezones.ts

export function getViewerTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/**
 * Pro-timezone-first display.
 * Use pro timezone always for labels. Viewer timezone only shown as a hint.
 */
export function fmtSlotInTimeZone(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Invalid time'
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function fmtFullInTimeZone(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function fmtInViewerTz(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

function zonedTimeToUtc(args: { year: number; month: number; day: number; hour: number; minute: number; timeZone: string }) {
  const { year, month, day, hour, minute, timeZone } = args

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)

  return guess
}

function parseDatetimeLocal(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  }
}

/**
 * Converts a viewer-entered datetime-local into a UTC ISO instant
 * interpreted as occurring in the pro's timezone.
 */
export function toISOFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  if (!value) return null
  const p = parseDatetimeLocal(value)
  if (!p) return null
  const utc = zonedTimeToUtc({ ...p, timeZone })
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString()
}
// app/(main)/booking/AvailabilityDrawer/utils/timezones.ts

export function getHourInTimeZone(iso: string, timeZone: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  } as any).formatToParts(d)

  const hh = parts.find((p) => p.type === 'hour')?.value
  const n = Number(hh)
  return Number.isFinite(n) ? n : null
}

export function fmtSelectedLineInTimeZone(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}
