import { getRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'

const HEARTBEAT_TTL_SECONDS = 90
const WATCHING_WINDOW_SECONDS = 60
const KEY_PREFIX = 'presence:watching'

type ResourceType = 'opening' | 'offering'

function buildKey(resourceType: ResourceType, resourceId: string): string {
  return `${KEY_PREFIX}:${resourceType}:${resourceId}`
}

export async function recordHeartbeat(args: {
  resourceType: ResourceType
  resourceId: string
  clientId: string
}): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  const key = buildKey(args.resourceType, args.resourceId)
  const now = Date.now()

  await redis.zadd(key, { score: now, member: args.clientId })
  await redis.expire(key, HEARTBEAT_TTL_SECONDS)

  return true
}

export async function countWatching(args: {
  resourceType: ResourceType
  resourceId: string
}): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null

  const key = buildKey(args.resourceType, args.resourceId)
  const cutoff = Date.now() - WATCHING_WINDOW_SECONDS * 1000

  await redis.zremrangebyscore(key, 0, cutoff)

  return redis.zcard(key)
}

export async function countWaitlisted(args: {
  professionalId: string
  serviceId?: string
}): Promise<number> {
  const where: { professionalId: string; status: 'ACTIVE'; serviceId?: string } = {
    professionalId: args.professionalId,
    status: 'ACTIVE',
  }

  if (args.serviceId) {
    where.serviceId = args.serviceId
  }

  return prisma.waitlistEntry.count({ where })
}

export async function getPresenceSignals(args: {
  resourceType: ResourceType
  resourceId: string
  professionalId: string
  serviceId?: string
}): Promise<{
  watching: number | null
  waitlisted: number
}> {
  const [watching, waitlisted] = await Promise.all([
    countWatching({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }),
    countWaitlisted({
      professionalId: args.professionalId,
      serviceId: args.serviceId,
    }),
  ])

  return { watching, waitlisted }
}

export async function removePresence(args: {
  resourceType: ResourceType
  resourceId: string
  clientId: string
}): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const key = buildKey(args.resourceType, args.resourceId)
  await redis.zrem(key, args.clientId)
}
