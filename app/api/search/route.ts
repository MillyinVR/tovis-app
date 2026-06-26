// app/api/search/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { SearchRequestError } from '@/lib/search/contracts'
import {
  parseSearchProsParams,
  searchPros,
} from '@/lib/search/pros'
import {
  parseSearchServicesParams,
  searchServices,
} from '@/lib/search/services'
import { resolveTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

function parseTab(value: string | null): 'PROS' | 'SERVICES' {
  return (pickString(value) ?? '').trim().toUpperCase() === 'SERVICES'
    ? 'SERVICES'
    : 'PROS'
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tab = parseTab(searchParams.get('tab'))
    const tenantContext = await resolveTenantContextForRequest(req)

    if (tab === 'SERVICES') {
      const result = await searchServices(
        parseSearchServicesParams(searchParams),
        tenantContext,
      )

      return jsonOk({
        ok: true,
        pros: [],
        services: result.items,
      })
    }

    const result = await searchPros(
      parseSearchProsParams(searchParams),
      tenantContext,
    )

    return jsonOk({
      ok: true,
      pros: result.items,
      services: [],
    })
  } catch (e) {
    if (e instanceof SearchRequestError) {
      return jsonFail(e.status, e.message)
    }

    console.error('GET /api/search error', e)
    return jsonFail(500, 'Failed to search.')
  }
}