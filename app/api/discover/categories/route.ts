// app/api/discover/categories/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getDiscoverCategoryOptions } from '@/lib/discovery/categories'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const categories = await getDiscoverCategoryOptions()

    return jsonOk({
      categories,
    })
  } catch (error: unknown) {
    console.error('GET /api/discover/categories error', error)

    return jsonFail(500, 'DISCOVER_CATEGORIES_FAILED')
  }
}