import { getRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'

const HEARTBEAT_TTL_SECONDS = 90
const WATCHING_WINDOW_SECONDS = 60
const KEY_PREFIX = 'presence:watching'

export type ResourceType = 'opening' | 'offering'

export type PresenceSignalCounts = {
  watching: number | null
  waitlisted: number
}

export type PresenceBatchItem = {
  resourceType: ResourceType
  resourceId: string
  professionalId: string
  serviceId?: string
}

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

/**
 * Counts for many resources at once, for browse surfaces (e.g. the openings
 * feed) that show signals on every card. Read-only by design: it never writes
 * heartbeats, so scrolling a feed does not inflate "watching" — that stays
 * exclusive to the focused detail view.
 *
 * Watching counts come from a single Redis pipeline of read-only ZCOUNTs (no
 * pruning writes); stale members age out via the key TTL and the detail-page
 * prune path. Waitlist counts come from grouped DB queries. Returns a map
 * keyed by resourceId; `watching` is null for every resource when Redis is down.
 */
export async function getPresenceSignalsBatch(
  items: PresenceBatchItem[],
): Promise<Record<string, PresenceSignalCounts>> {
  const result: Record<string, PresenceSignalCounts> = {}
  if (items.length === 0) return result

  // --- watching: one pipelined ZCOUNT per resource (read-only) ---
  const redis = getRedis()
  const watchingByResource: Record<string, number | null> = {}

  if (redis) {
    const cutoff = Date.now() - WATCHING_WINDOW_SECONDS * 1000
    const pipeline = redis.pipeline()
    for (const item of items) {
      pipeline.zcount(buildKey(item.resourceType, item.resourceId), cutoff, '+inf')
    }
    const counts = (await pipeline.exec()) as unknown[]
    items.forEach((item, i) => {
      const c = counts[i]
      watchingByResource[item.resourceId] = typeof c === 'number' ? c : 0
    })
  } else {
    for (const item of items) watchingByResource[item.resourceId] = null
  }

  // --- waitlisted: grouped DB counts ---
  const serviceItems = items.filter((it) => it.serviceId)
  const proOnlyItems = items.filter((it) => !it.serviceId)

  const waitlistByServiceKey = new Map<string, number>()
  if (serviceItems.length > 0) {
    const grouped = await prisma.waitlistEntry.groupBy({
      by: ['professionalId', 'serviceId'],
      where: {
        status: 'ACTIVE',
        professionalId: { in: [...new Set(serviceItems.map((it) => it.professionalId))] },
        serviceId: { in: [...new Set(serviceItems.map((it) => it.serviceId!))] },
      },
      _count: { _all: true },
    })
    for (const g of grouped) {
      waitlistByServiceKey.set(`${g.professionalId}:${g.serviceId}`, g._count._all)
    }
  }

  const waitlistByPro = new Map<string, number>()
  if (proOnlyItems.length > 0) {
    const grouped = await prisma.waitlistEntry.groupBy({
      by: ['professionalId'],
      where: {
        status: 'ACTIVE',
        professionalId: { in: [...new Set(proOnlyItems.map((it) => it.professionalId))] },
      },
      _count: { _all: true },
    })
    for (const g of grouped) {
      waitlistByPro.set(g.professionalId, g._count._all)
    }
  }

  for (const item of items) {
    const waitlisted = item.serviceId
      ? waitlistByServiceKey.get(`${item.professionalId}:${item.serviceId}`) ?? 0
      : waitlistByPro.get(item.professionalId) ?? 0
    result[item.resourceId] = {
      watching: watchingByResource[item.resourceId] ?? null,
      waitlisted,
    }
  }

  return result
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
