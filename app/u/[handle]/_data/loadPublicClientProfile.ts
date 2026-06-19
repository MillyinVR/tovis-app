// app/u/[handle]/_data/loadPublicClientProfile.ts
import 'server-only'

import { LookPostStatus, LookPostVisibility } from '@prisma/client'

import { normalizeHandle } from '@/lib/handles'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'

export type PublicClientLook = {
  id: string
  name: string
  imageUrl: string | null
  saveCount: number
  href: string
}

export type PublicClientProfileData = {
  handle: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  counts: { followers: number; following: number; looks: number }
  looks: PublicClientLook[]
}

/**
 * Loads a client's PUBLIC creator profile by handle. Returns null when the handle
 * doesn't resolve or the client hasn't opted into a public profile — the page
 * turns that into a 404 (a private/non-existent profile is indistinguishable).
 */
export async function loadPublicClientProfile(
  handleParam: string,
): Promise<PublicClientProfileData | null> {
  const normalized = normalizeHandle(handleParam)
  if (!normalized) return null

  // Scoped to this client via the relation (not a cross-tenant lookPost discovery
  // read): the profile only ever shows its OWN author's PUBLIC published looks.
  const client = await prisma.clientProfile.findUnique({
    where: { handleNormalized: normalized },
    select: {
      id: true,
      handle: true,
      // Public profiles are addressed and displayed by HANDLE, not legal name —
      // we deliberately do NOT surface firstName/lastName to strangers.
      avatarUrl: true,
      publicBio: true,
      isPublicProfile: true,
      _count: {
        select: {
          followers: true,
          following: true,
        },
      },
      authoredLooks: {
        where: {
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
        },
        orderBy: { publishedAt: 'desc' },
        take: 60,
        select: {
          id: true,
          caption: true,
          saveCount: true,
          primaryMediaAsset: {
            select: {
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
              url: true,
              thumbUrl: true,
            },
          },
        },
      },
    },
  })

  if (!client || !client.isPublicProfile || !client.handle) return null

  const looks = await Promise.all(
    client.authoredLooks.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(
        row.primaryMediaAsset,
      )
      return {
        id: row.id,
        name: lookNameFromCaption(row.caption),
        imageUrl: renderThumbUrl ?? renderUrl,
        saveCount: row.saveCount,
        href: `/looks/${encodeURIComponent(row.id)}`,
      }
    }),
  )

  return {
    handle: client.handle,
    displayName: `@${client.handle}`,
    avatarUrl: client.avatarUrl ?? null,
    bio: client.publicBio ?? null,
    counts: {
      followers: client._count.followers,
      following: client._count.following,
      looks: looks.length,
    },
    looks,
  }
}
