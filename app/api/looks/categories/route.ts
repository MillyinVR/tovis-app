// app/api/looks/categories/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await prisma.serviceCategory.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ name: 'asc' }],
      select: { name: true, slug: true },
      take: 2000,
    })

    return jsonOk({
      ok: true,
      categories: rows.map((r) => ({ name: r.name, slug: r.slug })),
    })
  } catch (e) {
    console.error('GET /api/looks/categories error', e)
    // keep endpoint non-breaking for the UI
    return jsonOk({ ok: false, categories: [] }, 200)
  }
}
