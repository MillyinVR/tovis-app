// app/api/v1/search/pros/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { SearchRequestError } from '@/lib/search/contracts'
import {
  parseSearchProsParams,
  searchPros,
} from '@/lib/search/pros'
import { resolveTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const body = await searchPros(
      parseSearchProsParams(searchParams),
      await resolveTenantContextForRequest(req),
    )

    return jsonOk({
      ok: true,
      ...body,
    })
  } catch (e) {
    if (e instanceof SearchRequestError) {
      return jsonFail(e.status, e.message)
    }

    console.error('GET /api/v1/search/pros error', e)
    return jsonFail(500, 'Failed to search pros.')
  }
}