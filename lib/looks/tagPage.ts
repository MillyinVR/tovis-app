// lib/looks/tagPage.ts
//
// Server loaders for the /looks/tags/[slug] pages (social-first D1) — the
// SEO/browse payoff of the tag layer. Reuses buildLooksFeedWhere (so tag pages
// inherit the exact discovery/visibility/tenant gates the main feed uses) with a
// tag filter; a banned or unknown tag resolves to null → 404.

import { Prisma } from '@prisma/client'

import { buildLooksFeedWhere } from '@/lib/looks/feed'
import { slugifyLookTag } from '@/lib/looks/tags'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'

export type LookTagTile = {
  id: string
  caption: string | null
  thumbUrl: string | null
}

export type LookTagPageData = {
  slug: string
  display: string
  tiles: LookTagTile[]
}

const TAG_PAGE_TILE_LIMIT = 60
const SITEMAP_TAG_LIMIT = 500

const tileMediaSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  thumbUrl: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  storageBucket: true,
  storagePath: true,
})

export async function loadLookTagPage(args: {
  slug: string
  tenant: TenantContext
  limit?: number
}): Promise<LookTagPageData | null> {
  const slug = slugifyLookTag(args.slug)
  if (slug.length < 2) return null

  const tag = await prisma.lookTag.findUnique({
    where: { slug },
    select: { slug: true, display: true, bannedAt: true },
  })
  if (!tag || tag.bannedAt !== null) return null

  const rows = await prisma.lookPost.findMany({
    where: buildLooksFeedWhere({ kind: 'ALL', tenant: args.tenant, tagSlug: slug }),
    select: {
      id: true,
      caption: true,
      primaryMediaAsset: { select: tileMediaSelect },
    },
    orderBy: { publishedAt: 'desc' },
    take: args.limit ?? TAG_PAGE_TILE_LIMIT,
  })

  const tiles: LookTagTile[] = await Promise.all(
    rows.map(async (row) => {
      const media = row.primaryMediaAsset
      const rendered = await renderMediaUrls({
        storageBucket: media.storageBucket,
        storagePath: media.storagePath,
        thumbBucket: media.thumbBucket,
        thumbPath: media.thumbPath,
        url: media.url,
        thumbUrl: media.thumbUrl,
      })
      return {
        id: row.id,
        caption: row.caption,
        thumbUrl: rendered.renderThumbUrl ?? rendered.renderUrl ?? null,
      }
    }),
  )

  return { slug: tag.slug, display: tag.display, tiles }
}

/**
 * Non-banned tag slugs that have at least one publicly-visible look, for the
 * sitemap. Ordered by recency (no denormalized count column yet — a fine v1
 * proxy for "active" tags).
 */
export async function loadIndexableLookTagSlugs(args: {
  tenant: TenantContext
  limit?: number
}): Promise<string[]> {
  const tags = await prisma.lookTag.findMany({
    where: {
      bannedAt: null,
      looks: { some: buildLooksFeedWhere({ kind: 'ALL', tenant: args.tenant }) },
    },
    select: { slug: true },
    orderBy: { createdAt: 'desc' },
    take: args.limit ?? SITEMAP_TAG_LIMIT,
  })
  return tags.map((tag) => tag.slug)
}
