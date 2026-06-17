import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getPresenceSignals } from '@/lib/presence/presenceSignals'

export const dynamic = 'force-dynamic'

const VALID_RESOURCE_TYPES = new Set(['opening', 'offering'])

export async function GET(req: Request) {
  const url = new URL(req.url)

  const resourceType = url.searchParams.get('resourceType')?.trim() ?? ''
  const resourceId = url.searchParams.get('resourceId')?.trim() ?? ''
  const professionalId = url.searchParams.get('professionalId')?.trim() ?? ''
  const serviceId = url.searchParams.get('serviceId')?.trim() || undefined

  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    return jsonFail(400, 'resourceType must be "opening" or "offering".')
  }

  if (!resourceId || !professionalId) {
    return jsonFail(400, 'resourceId and professionalId are required.')
  }

  const signals = await getPresenceSignals({
    resourceType: resourceType as 'opening' | 'offering',
    resourceId,
    professionalId,
    serviceId,
  })

  return jsonOk({ signals }, 200)
}
