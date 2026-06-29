// app/api/v1/pro/services/catalog/route.ts
//
// Read API for the "Add a service" library picker. The web ServicesManagerSection
// server-renders this category tree directly from Prisma; native has no other way
// to reach it, so this exposes the SAME shape (categories → children → services,
// each with minPrice / default duration / image / add-on flags) plus the pro's
// already-added offerings (so the picker can mark/disable them). PRO-only.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

const serviceSelect = {
  id: true,
  name: true,
  minPrice: true,
  defaultDurationMinutes: true,
  defaultImageUrl: true,
  isAddOnEligible: true,
  addOnGroup: true,
} as const

function mapService(s: {
  id: string
  name: string
  minPrice: Prisma.Decimal
  defaultDurationMinutes: number | null
  defaultImageUrl: string | null
  isAddOnEligible: boolean
  addOnGroup: string | null
}) {
  return {
    id: String(s.id),
    name: s.name,
    minPrice: moneyToString(s.minPrice) ?? '0.00',
    defaultDurationMinutes: s.defaultDurationMinutes ?? 60,
    defaultImageUrl: s.defaultImageUrl ?? null,
    isAddOnEligible: Boolean(s.isAddOnEligible),
    addOnGroup: s.addOnGroup ?? null,
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const [categories, offerings] = await Promise.all([
      prisma.serviceCategory.findMany({
        where: { isActive: true, parentId: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          services: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: serviceSelect,
          },
          children: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              services: {
                where: { isActive: true },
                orderBy: { name: 'asc' },
                select: serviceSelect,
              },
            },
          },
        },
      }),
      prisma.professionalServiceOffering.findMany({
        where: { professionalId: auth.professionalId, isActive: true },
        select: { id: true, serviceId: true },
      }),
    ])

    return jsonOk({
      categories: categories.map((cat) => ({
        id: String(cat.id),
        name: cat.name,
        services: cat.services.map(mapService),
        children: cat.children.map((child) => ({
          id: String(child.id),
          name: child.name,
          services: child.services.map(mapService),
        })),
      })),
      offerings: offerings.map((o) => ({
        id: String(o.id),
        serviceId: String(o.serviceId),
      })),
    })
  } catch (e) {
    console.error('GET /api/v1/pro/services/catalog error:', e)
    return jsonFail(500, 'Failed to load the service catalog.')
  }
}
