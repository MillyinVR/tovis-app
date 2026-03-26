// lib/availability/data/busyIntervals.ts

import { pickString } from '@/app/api/_utils/pick'
import { type BusyInterval } from '@/lib/booking/conflicts'
import { loadBusyIntervalsForWindow } from '@/lib/booking/conflictQueries'
import {
  buildBusyIntervalsCacheKey,
  cacheGetJson,
  cacheSetJson,
} from '@/lib/availability/data/cache'
import { isRecord } from '@/lib/guards'

const TTL_BUSY_SECONDS = 60

export type LoadBusyIntervalsArgs = {
  professionalId: string
  locationId: string | null
  windowStartUtc: Date
  windowEndUtc: Date
  nowUtc: Date
  fallbackDurationMinutes: number
  locationBufferMinutes: number
  scheduleVersion: number
  cache?: { enabled: boolean }
}

function queryBusyIntervals(args: LoadBusyIntervalsArgs): Promise<BusyInterval[]> {
  return loadBusyIntervalsForWindow({
    professionalId: args.professionalId,
    locationId: args.locationId,
    windowStartUtc: args.windowStartUtc,
    windowEndUtc: args.windowEndUtc,
    nowUtc: args.nowUtc,
    fallbackDurationMinutes: args.fallbackDurationMinutes,
    defaultBufferMinutes: args.locationBufferMinutes,
  })
}

export function parseCachedBusyIntervals(value: unknown): BusyInterval[] | null {
  if (!isRecord(value) || !Array.isArray(value.busy)) return null

  const intervals: BusyInterval[] = []

  for (const row of value.busy) {
    if (!isRecord(row)) continue

    const startRaw = pickString(row.start)
    const endRaw = pickString(row.end)
    if (!startRaw || !endRaw) continue

    const start = new Date(startRaw)
    const end = new Date(endRaw)

    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      continue
    }

    if (end.getTime() <= start.getTime()) continue

    intervals.push({ start, end })
  }

  return intervals
}

export async function loadBusyIntervals(
  args: LoadBusyIntervalsArgs,
): Promise<BusyInterval[]> {
  const cacheEnabled = Boolean(args.cache?.enabled)

  if (!cacheEnabled) {
    return queryBusyIntervals(args)
  }

  const key = buildBusyIntervalsCacheKey({
    professionalId: args.professionalId,
    locationId: args.locationId,
    windowStartUtc: args.windowStartUtc,
    windowEndUtc: args.windowEndUtc,
    locationBufferMinutes: args.locationBufferMinutes,
    fallbackDurationMinutes: args.fallbackDurationMinutes,
    scheduleVersion: args.scheduleVersion,
  })

  const hit = await cacheGetJson<unknown>(key)
  const parsedHit = parseCachedBusyIntervals(hit)
  if (parsedHit) {
    return parsedHit
  }

  const busy = await queryBusyIntervals(args)

  void cacheSetJson(
    key,
    {
      busy: busy.map((interval) => ({
        start: interval.start.toISOString(),
        end: interval.end.toISOString(),
      })),
    },
    TTL_BUSY_SECONDS,
  )

  return busy
}