// lib/discovery/trendingTagsContract.ts
//
// The CLIENT-SAFE half of trending tags: the DTO the
// `/api/v1/discover/trending-tags` envelope carries, and the parser that
// validates it in the browser. No Prisma, no database.
//
// The query that produces this DTO lives in the server-only sibling
// `@/lib/discovery/trendingTags`, which re-exports everything here. Keeping the
// parser in the same file as the query shipped `new PrismaClient()` to every
// visitor of /search — `TrendingTagsRail` is a client component and imports the
// parser.

import { isArray, isRecord } from '@/lib/guards'

export type TrendingTagDto = {
  slug: string
  display: string
  /** Feed-visible looks carrying this tag published within the window. */
  lookCount: number
}

function parseTrendingTag(raw: unknown): TrendingTagDto | null {
  if (!isRecord(raw)) return null

  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : ''
  const display = typeof raw.display === 'string' ? raw.display.trim() : ''
  if (!slug || !display) return null

  const lookCount =
    typeof raw.lookCount === 'number' && Number.isFinite(raw.lookCount)
      ? raw.lookCount
      : 0

  return { slug, display, lookCount }
}

/** Client-side parser for the `/api/v1/discover/trending-tags` envelope. */
export function parseTrendingTagsResponse(raw: unknown): TrendingTagDto[] {
  if (!isRecord(raw) || !isArray(raw.tags)) return []

  return raw.tags
    .map(parseTrendingTag)
    .filter((tag): tag is TrendingTagDto => tag !== null)
}
