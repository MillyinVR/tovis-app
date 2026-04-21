// app/api/search/services/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { SearchRequestError } from '@/lib/search/contracts'
import {
  parseSearchServicesParams,
  searchServices,
} from '@/lib/search/services'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const body = await searchServices(
      parseSearchServicesParams(searchParams),
    )

    return jsonOk({
      ok: true,
      ...body,
    })
  } catch (e) {
    if (e instanceof SearchRequestError) {
      return jsonFail(e.status, e.message)
    }

    console.error('GET /api/search/services error', e)
    return jsonFail(500, 'Failed to search services.')
  }
}