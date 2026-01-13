// app/offerings/[id]/_bookingPanel/time.ts

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

export function ymdFromDateInTz(dateUtc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}`
}

export function isoToYMDInTz(isoUtc: string, timeZone: string): string | null {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return null
  return ymdFromDateInTz(d, timeZone)
}

export function startOfMonthUtcFromYMD(ymd: string) {
  const [y, m] = ymd.split('-').map((x) => Number(x))
  return new Date(Date.UTC(y, (m || 1) - 1, 1, 12, 0, 0, 0))
}

export function addMonthsUtc(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12, 0, 0, 0))
}

export function formatSlotLabel(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return isoUtc
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function buildMonthGrid(args: { monthStartUtc: Date; proTz: string }) {
  const { monthStartUtc, proTz } = args
  const monthKey = ymdFromDateInTz(monthStartUtc, proTz).slice(0, 7)

  const monthStartYMD = ymdFromDateInTz(monthStartUtc, proTz)
  const monthStartLocalNoonUtc = new Date(
    Date.UTC(
      Number(monthStartYMD.slice(0, 4)),
      Number(monthStartYMD.slice(5, 7)) - 1,
      Number(monthStartYMD.slice(8, 10)),
      12,
      0,
      0,
      0,
    ),
  )

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: proTz, weekday: 'short' })
    .format(monthStartLocalNoonUtc)
    .toLowerCase()

  const map: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  const idx =
    weekday.startsWith('mon')
      ? map.mon
      : weekday.startsWith('tue')
        ? map.tue
        : weekday.startsWith('wed')
          ? map.wed
          : weekday.startsWith('thu')
            ? map.thu
            : weekday.startsWith('fri')
              ? map.fri
              : weekday.startsWith('sat')
                ? map.sat
                : map.sun

  const gridStartUtc = addDays(monthStartUtc, -idx)

  const days: { ymd: string; inMonth: boolean; dateUtc: Date }[] = []
  for (let i = 0; i < 42; i++) {
    const dUtc = addDays(gridStartUtc, i)
    const ymd = ymdFromDateInTz(dUtc, proTz)
    const inMonth = ymd.slice(0, 7) === monthKey
    days.push({ ymd, inMonth, dateUtc: dUtc })
  }
  return days
}

/** timezone helpers for waitlist default */
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

export function defaultWaitlistDesiredISO(proTz: string) {
  const tomorrowNoonUtc = zonedTimeToUtc({
    ...(() => {
      const tomorrow = addDays(new Date(), 1)
      const ymd = ymdFromDateInTz(tomorrow, proTz)
      return {
        year: Number(ymd.slice(0, 4)),
        month: Number(ymd.slice(5, 7)),
        day: Number(ymd.slice(8, 10)),
        hour: 12,
        minute: 0,
      }
    })(),
    timeZone: proTz,
  })
  return tomorrowNoonUtc.toISOString()
}


