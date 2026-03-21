// lib/booking/cacheVersion.ts
import { getRedis } from '@/lib/redis'

const redis = getRedis()

const SCHEDULE_VERSION_PREFIX = 'booking:scheduleVersion'
const SCHEDULE_CONFIG_VERSION_PREFIX = 'booking:scheduleConfigVersion'

function normalizeProfessionalId(professionalId: string): string {
  const id = professionalId.trim()
  if (!id) {
    throw new Error('professionalId is required')
  }
  return id
}

function buildScheduleVersionKey(professionalId: string): string {
  return `${SCHEDULE_VERSION_PREFIX}:${normalizeProfessionalId(professionalId)}`
}

function buildScheduleConfigVersionKey(professionalId: string): string {
  return `${SCHEDULE_CONFIG_VERSION_PREFIX}:${normalizeProfessionalId(professionalId)}`
}

function parseVersion(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(parsed)) return 0

  const whole = Math.trunc(parsed)
  return whole >= 0 ? whole : 0
}

function logCacheVersionError(args: {
  action: 'get' | 'bump'
  scope: 'schedule' | 'scheduleConfig'
  professionalId: string
  error: unknown
}): void {
  console.error('booking cache version error', {
    route: 'lib/booking/cacheVersion.ts',
    action: args.action,
    scope: args.scope,
    professionalId: args.professionalId,
    error:
      args.error instanceof Error
        ? {
            name: args.error.name,
            message: args.error.message,
          }
        : args.error,
  })
}

async function getVersion(
  key: string,
  scope: 'schedule' | 'scheduleConfig',
  professionalId: string,
): Promise<number> {
  if (!redis) return 0

  try {
    const raw = await redis.get<string | number>(key)
    return parseVersion(raw)
  } catch (error: unknown) {
    logCacheVersionError({
      action: 'get',
      scope,
      professionalId,
      error,
    })
    return 0
  }
}

async function bumpVersion(
  key: string,
  scope: 'schedule' | 'scheduleConfig',
  professionalId: string,
): Promise<number> {
  if (!redis) return 0

  try {
    const next = await redis.incr(key)
    return parseVersion(next)
  } catch (error: unknown) {
    logCacheVersionError({
      action: 'bump',
      scope,
      professionalId,
      error,
    })
    return 0
  }
}

export async function getScheduleVersion(
  professionalId: string,
): Promise<number> {
  const normalizedProfessionalId = normalizeProfessionalId(professionalId)

  return getVersion(
    buildScheduleVersionKey(normalizedProfessionalId),
    'schedule',
    normalizedProfessionalId,
  )
}

export async function bumpScheduleVersion(
  professionalId: string,
): Promise<number> {
  const normalizedProfessionalId = normalizeProfessionalId(professionalId)

  return bumpVersion(
    buildScheduleVersionKey(normalizedProfessionalId),
    'schedule',
    normalizedProfessionalId,
  )
}

export async function getScheduleConfigVersion(
  professionalId: string,
): Promise<number> {
  const normalizedProfessionalId = normalizeProfessionalId(professionalId)

  return getVersion(
    buildScheduleConfigVersionKey(normalizedProfessionalId),
    'scheduleConfig',
    normalizedProfessionalId,
  )
}

export async function bumpScheduleConfigVersion(
  professionalId: string,
): Promise<number> {
  const normalizedProfessionalId = normalizeProfessionalId(professionalId)

  return bumpVersion(
    buildScheduleConfigVersionKey(normalizedProfessionalId),
    'scheduleConfig',
    normalizedProfessionalId,
  )
}