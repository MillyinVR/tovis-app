import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { recordHeartbeat } from '@/lib/presence/presenceSignals'

export const dynamic = 'force-dynamic'

const VALID_RESOURCE_TYPES = new Set(['opening', 'offering'])

export async function POST(req: Request) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const body = await readJsonRecord(req)

  const resourceType = typeof body.resourceType === 'string' ? body.resourceType.trim() : ''
  const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : ''

  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    return jsonFail(400, 'resourceType must be "opening" or "offering".')
  }

  if (!resourceId) {
    return jsonFail(400, 'resourceId is required.')
  }

  const recorded = await recordHeartbeat({
    resourceType: resourceType as 'opening' | 'offering',
    resourceId,
    clientId: auth.clientId,
  })

  return jsonOk({ recorded }, 200)
}
