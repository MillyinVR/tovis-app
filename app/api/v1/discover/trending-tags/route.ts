// app/api/v1/discover/trending-tags/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getTrendingLookTags } from '@/lib/discovery/trendingTags'
import { resolveTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const tenant = await resolveTenantContextForRequest(req)
    const tags = await getTrendingLookTags({ tenant, now: new Date() })

    return jsonOk({ tags })
  } catch (error: unknown) {
    console.error('GET /api/v1/discover/trending-tags error', error)

    return jsonFail(500, 'DISCOVER_TRENDING_TAGS_FAILED')
  }
}
