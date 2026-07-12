// app/u/[handle]/_data/loadPublicClientProfile.ts
import 'server-only'

import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import { getViewerClientFollowState } from '@/lib/follows'
import { asTrimmedString } from '@/lib/guards'
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

export type PublicClientProfileViewer = {
  /** The signed-in client is looking at their OWN profile. */
  isOwn: boolean
  /** The signed-in client already follows this profile. */
  following: boolean
}

export type PublicClientProfileData = {
  handle: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  counts: { followers: number; following: number; looks: number }
  looks: PublicClientLook[]
  viewer: PublicClientProfileViewer
}

/**
 * Loads a client's PUBLIC creator profile by handle. Returns null when the handle
 * doesn't resolve or the client hasn't opted into a public profile — the page
 * turns that into a 404 (a private/non-existent profile is indistinguishable).
 */
export async function loadPublicClientProfile(
  handleParam: string,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  const normalized = normalizeHandle(handleParam)
  if (!normalized) return null

  return loadPublicClientProfileWhere({ handleNormalized: normalized }, options)
}

/**
 * Same public profile, keyed by clientId instead of handle. Used by the
 * pro-facing client chart's "public profile" view (the pro already knows the
 * client by id, not handle). Shares one body with {@link loadPublicClientProfile}
 * — same null contract (not public / no handle → null → empty state).
 */
export async function loadPublicClientProfileByClientId(
  clientId: string,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  const id = asTrimmedString(clientId)
  if (!id) return null

  return loadPublicClientProfileWhere({ id }, options)
}

async function loadPublicClientProfileWhere(
  where: Prisma.ClientProfileWhereUniqueInput,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  // Scoped to this client via the relation (not a cross-tenant lookPost discovery
  // read): the profile only ever shows its OWN author's PUBLIC published looks.
  const client = await prisma.clientProfile.findUnique({
    where,
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
          // §19c — reconcile the moderation gate: client-authored looks are created
          // PENDING_REVIEW (clientLookService), so filtering only status+visibility
          // exposed them on this public grid before a human approved them (§19
          // divergence a — pre-moderation public exposure). Require APPROVED so
          // nothing renders public pre-approval, matching the global feed.
          moderationStatus: ModerationStatus.APPROVED,
          removedAt: null,
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

  const viewerClientId = asTrimmedString(options?.viewerClientId)
  const isOwn = viewerClientId !== null && viewerClientId === client.id
  const following = viewerClientId
    ? await getViewerClientFollowState(prisma, {
        viewerClientId,
        followedClientId: client.id,
      })
    : false

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
    viewer: { isOwn, following },
  }
}
