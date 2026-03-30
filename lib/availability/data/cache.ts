// availability/data/cache.ts

import { createHash } from 'crypto'
import { ServiceLocationType } from '@prisma/client'

import { getRedis } from '@/lib/redis'

const redis = getRedis()

const AVAIL_PLACEMENT_CACHE_VERSION = 'v2'
const AVAIL_BUSY_CACHE_VERSION = 'v7'
const AVAIL_SUMMARY_CACHE_VERSION = 'v9'
const AVAIL_DAY_CACHE_VERSION = 'v7'
const AVAIL_OTHER_PROS_CACHE_VERSION = 'v1'

type PlacementCacheKeyArgs = {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType | null
  locationId: string | null
  clientAddressId: string | null
  scheduleConfigVersion: number
}

type BusyIntervalsCacheKeyArgs = {
  professionalId: string
  locationId: string | null
  windowStartUtc: Date
  windowEndUtc: Date
  locationBufferMinutes: number
  fallbackDurationMinutes: number
  scheduleVersion: number
}

type SummaryCacheKeyArgs = {
  professionalId: string
  serviceId: string
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  windowStartDate: string
  windowEndDate: string
  windowDays: number
  stepMinutes: number
  leadTimeMinutes: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  includeOtherPros: boolean
  scheduleVersion: number
  scheduleConfigVersion: number
  addOnIds: string[]
  viewerLat: number | null
  viewerLng: number | null
  radiusMiles: number
  clientAddressId: string | null
}

type DayCacheKeyArgs = {
  professionalId: string
  serviceId: string
  locationId: string
  locationType: ServiceLocationType
  dateStr: string
  timeZone: string
  stepMinutes: number
  leadTimeMinutes: number
  locationBufferMinutes: number
  scheduleVersion: number
  scheduleConfigVersion: number
  addOnIds: string[]
  durationMinutes: number
  clientAddressId: string | null
}

type OtherProsCacheKeyArgs = {
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  centerLat: number
  centerLng: number
  radiusMiles: number
  limit: number
}

function roundCoordForCache(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value * 1000) / 1000
}

function roundRadiusForOtherProsCache(value: number): number {
  return Math.round(value * 10) / 10
}

function mobileClientAddressKey(
  locationType: ServiceLocationType,
  clientAddressId: string | null,
): string | null {
  return locationType === ServiceLocationType.MOBILE ? clientAddressId : null
}

export function stableHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24)
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redis) return null

  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 5_000),
    )
    const raw = await Promise.race([redis.get<string>(key), timeout])
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return

  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // fail-open
  }
}

export function buildPlacementCacheKey(args: PlacementCacheKeyArgs): string {
  return [
    `avail:placement:${AVAIL_PLACEMENT_CACHE_VERSION}`,
    args.professionalId,
    args.serviceId,
    args.locationType ?? 'AUTO',
    args.locationId ?? 'AUTO',
    args.clientAddressId ?? 'none',
    String(args.scheduleConfigVersion),
  ].join(':')
}

export function buildBusyIntervalsCacheKey(
  args: BusyIntervalsCacheKeyArgs,
): string {
  return [
    `avail:busy:${AVAIL_BUSY_CACHE_VERSION}`,
    args.professionalId,
    args.locationId ?? 'GLOBAL',
    args.windowStartUtc.toISOString(),
    args.windowEndUtc.toISOString(),
    String(args.locationBufferMinutes ?? ''),
    String(args.fallbackDurationMinutes ?? ''),
    String(args.scheduleVersion),
  ].join(':')
}

export function buildSummaryCacheKey(args: SummaryCacheKeyArgs): string {
  return [
    `avail:summary:${AVAIL_SUMMARY_CACHE_VERSION}`,
    args.professionalId,
    args.serviceId,
    args.locationId,
    args.locationType,
    args.timeZone,
    args.windowStartDate,
    args.windowEndDate,
    String(args.windowDays),
    String(args.stepMinutes),
    String(args.leadTimeMinutes),
    String(args.locationBufferMinutes),
    String(args.maxAdvanceDays),
    String(args.includeOtherPros ? 1 : 0),
    String(args.scheduleVersion),
    String(args.scheduleConfigVersion),
    stableHash({
      addOnIds: args.addOnIds,
      viewerLat: roundCoordForCache(args.viewerLat),
      viewerLng: roundCoordForCache(args.viewerLng),
      radiusMiles: args.radiusMiles,
      clientAddressId: mobileClientAddressKey(
        args.locationType,
        args.clientAddressId,
      ),
    }),
  ].join(':')
}

export function buildDayCacheKey(args: DayCacheKeyArgs): string {
  return [
    `avail:day:${AVAIL_DAY_CACHE_VERSION}`,
    args.professionalId,
    args.serviceId,
    args.locationId,
    args.locationType,
    args.dateStr,
    args.timeZone,
    String(args.stepMinutes),
    String(args.leadTimeMinutes),
    String(args.locationBufferMinutes),
    String(args.scheduleVersion),
    String(args.scheduleConfigVersion),
    stableHash({
      addOnIds: args.addOnIds,
      durationMinutes: args.durationMinutes,
      clientAddressId: mobileClientAddressKey(
        args.locationType,
        args.clientAddressId,
      ),
    }),
  ].join(':')
}

export function buildOtherProsCacheKey(args: OtherProsCacheKeyArgs): string {
  return [
    `avail:otherPros:${AVAIL_OTHER_PROS_CACHE_VERSION}`,
    args.serviceId,
    args.locationType,
    args.excludeProfessionalId,
    String(roundCoordForCache(args.centerLat)),
    String(roundCoordForCache(args.centerLng)),
    String(roundRadiusForOtherProsCache(args.radiusMiles)),
    String(args.limit),
  ].join(':')
}