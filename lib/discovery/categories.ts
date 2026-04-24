// lib/discovery/categories.ts
import { prisma } from '@/lib/prisma'
import type { DiscoverCategoryOption } from '@/lib/discovery/categoryTypes'
import { DISCOVERY_COPY } from '@/lib/discovery/discoveryCopy'

const DISCOVER_ALL_CATEGORY: DiscoverCategoryOption = {
  kind: 'ALL',
  id: null,
  label: DISCOVERY_COPY.allCategoryLabel,
  slug: DISCOVERY_COPY.allCategorySlug,
}

interface ServiceCategoryRow {
  id: string
  name: string
  slug: string
}

function toDiscoverCategoryOption(category: ServiceCategoryRow): DiscoverCategoryOption {
  return {
    kind: 'SERVICE_CATEGORY',
    id: category.id,
    label: category.name,
    slug: category.slug,
  }
}

export async function getDiscoverCategoryOptions(): Promise<DiscoverCategoryOption[]> {
  const rows = await prisma.serviceCategory.findMany({
    where: {
      isActive: true,
      parentId: null,
    },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
    },
    take: 2000,
  })

  return [DISCOVER_ALL_CATEGORY, ...rows.map(toDiscoverCategoryOption)]
}