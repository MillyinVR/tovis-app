import { jsonFail, jsonOk } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  getPresenceSignalsBatch,
  type PresenceBatchItem,
} from '@/lib/presence/presenceSignals'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

const VALID_RESOURCE_TYPES = new Set(['opening', 'offering'])
const MAX_ITEMS = 50

function parseItem(raw: unknown): PresenceBatchItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>

  const resourceType = typeof obj.resourceType === 'string' ? obj.resourceType.trim() : ''
  const resourceId = typeof obj.resourceId === 'string' ? obj.resourceId.trim() : ''
  const professionalId =
    typeof obj.professionalId === 'string' ? obj.professionalId.trim() : ''
  const serviceId =
    typeof obj.serviceId === 'string' && obj.serviceId.trim() ? obj.serviceId.trim() : undefined

  if (!VALID_RESOURCE_TYPES.has(resourceType)) return null
  if (!resourceId || !professionalId) return null

  return {
    resourceType: resourceType as 'opening' | 'offering',
    resourceId,
    professionalId,
    serviceId,
  }
}

export async function POST(req: Request) {
  // Same reasoning as the single-resource route, at half the ceiling: MAX_ITEMS
  // means one request here is worth up to 50 of those.
  const rateLimit = await enforceRateLimit({
    bucket: 'presence:signals:batch',
    key: clientRateLimitKey({ request: req }),
  })

  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit)
  }

  const body = await readJsonRecord(req)
  const rawItems = Array.isArray(body.items) ? body.items : null

  if (!rawItems) {
    return jsonFail(400, 'items must be an array.')
  }

  // Dedupe by resourceId and cap the batch size so one request can't fan out
  // into an unbounded number of Redis + DB lookups.
  const seen = new Set<string>()
  const items: PresenceBatchItem[] = []
  for (const raw of rawItems) {
    const item = parseItem(raw)
    if (!item || seen.has(item.resourceId)) continue
    seen.add(item.resourceId)
    items.push(item)
    if (items.length >= MAX_ITEMS) break
  }

  const signals = await getPresenceSignalsBatch(items)

  return jsonOk({ signals }, 200)
}
