// app/sitemap.ts
//
// Crawl surface for the root marketplace host: public pro profiles + public
// looks + the static discovery pages. Served at /sitemap.xml (proxy passes
// it through on vanity hosts, so every host serves the root sitemap).
import type { MetadataRoute } from 'next'

import { buildLooksFeedWhere } from '@/lib/looks/feed'
import { prisma } from '@/lib/prisma'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import {
  getRootTenantId,
  proDiscoveryVisibilityFilter,
  rootTenantContext,
} from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Single-file sitemap cap; shard with generateSitemaps() when either
// entity approaches this count.
const MAX_ENTRIES_PER_SECTION = 5000

const STATIC_PATHS = ['/', '/search', '/looks'] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()
  // Sitemap URLs must be absolute; without a configured app URL (never the
  // case in a deployed environment) there is nothing valid to emit.
  if (!base) return []

  const tenant = rootTenantContext(await getRootTenantId())

  const [pros, looks] = await Promise.all([
    prisma.professionalProfile.findMany({
      where: {
        AND: [
          {
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          },
          proDiscoveryVisibilityFilter(tenant),
        ],
      },
      // ProfessionalProfile carries no updatedAt; cuid order approximates
      // creation order, and lastModified is simply omitted for profiles.
      select: { id: true },
      orderBy: { id: 'desc' },
      take: MAX_ENTRIES_PER_SECTION,
    }),
    prisma.lookPost.findMany({
      where: buildLooksFeedWhere({ kind: 'ALL', tenant }),
      select: { id: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: MAX_ENTRIES_PER_SECTION,
    }),
  ])

  const toUrl = (path: string) => new URL(path, base).toString()

  return [
    ...STATIC_PATHS.map((path) => ({
      url: toUrl(path),
      changeFrequency: 'daily' as const,
      priority: path === '/' ? 1 : 0.8,
    })),
    ...pros.map((pro) => ({
      url: toUrl(`/professionals/${pro.id}`),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...looks.map((look) => ({
      url: toUrl(`/looks/${look.id}`),
      lastModified: look.updatedAt ?? look.publishedAt ?? undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
  ]
}
