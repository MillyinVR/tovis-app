// lib/notifications/socialDigest/topLooks.ts
//
// "Top looks this week" module for the digest — the come-back-and-scroll hook.
// Ranks feed-eligible looks published in the window by the persisted rankScore
// (same tenant scoping as the live feed via buildLooksFeedWhere). Read-only.
import { Prisma, PrismaClient } from '@prisma/client'

import { buildLooksFeedWhere } from '@/lib/looks/feed'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import type { TenantContext } from '@/lib/tenant/context'

import type { SocialDigestTopLook } from './render'

type DigestDb = PrismaClient | Prisma.TransactionClient

const digestTopLookMediaSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  url: true,
  thumbUrl: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
})

const digestTopLookSelect = Prisma.validator<Prisma.LookPostSelect>()({
  id: true,
  caption: true,
  primaryMediaAsset: {
    select: digestTopLookMediaSelect,
  },
  // Canonical PII-safe public-name select (lib/privacy) — resolves the pro's
  // public display name honoring their nameDisplay preference.
  professional: {
    select: professionalPublicDisplayNameSelect,
  },
})

type DigestTopLookRow = Prisma.LookPostGetPayload<{
  select: typeof digestTopLookSelect
}>

export type LoadSocialDigestTopLooksArgs = {
  db: DigestDb
  tenant: TenantContext
  /** Only rank looks published on or after this instant. */
  since: Date
  limit: number
}

/**
 * The href is relative (`/looks/<id>`); the orchestrator absolutizes it against
 * the app URL so this stays URL-agnostic.
 */
export async function loadSocialDigestTopLooks(
  args: LoadSocialDigestTopLooksArgs,
): Promise<SocialDigestTopLook[]> {
  const limit = Math.max(0, Math.trunc(args.limit))
  if (limit === 0) return []

  const baseWhere = buildLooksFeedWhere({ kind: 'ALL', tenant: args.tenant })

  const rows: DigestTopLookRow[] = await args.db.lookPost.findMany({
    where: {
      AND: [baseWhere, { publishedAt: { gte: args.since } }],
    },
    orderBy: [
      { rankScore: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit,
    select: digestTopLookSelect,
  })

  const looks = await Promise.all(
    rows.map(async (row) => {
      const media = row.primaryMediaAsset
      const rendered = media ? await renderMediaUrls(media) : null

      const topLook: SocialDigestTopLook = {
        id: row.id,
        caption: row.caption ?? null,
        thumbUrl: rendered?.renderThumbUrl ?? rendered?.renderUrl ?? null,
        proName: formatProfessionalPublicDisplayName(row.professional),
        href: `/looks/${row.id}`,
      }

      return topLook
    }),
  )

  return looks
}
