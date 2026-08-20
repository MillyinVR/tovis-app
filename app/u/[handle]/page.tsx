// app/u/[handle]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Role } from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { getCurrentUser } from '@/lib/currentUser'
import { buildLoginHref } from '@/lib/profiles/publicProfileFormatting'
import {
  loadViewerBlockId,
  resolveBlockTargetByHandle,
} from '@/lib/blocks/blockTargets'
import { prisma } from '@/lib/prisma'

import { loadPublicClientProfile } from './_data/loadPublicClientProfile'
import { type FollowMode } from './_components/followState'
import PublicProfileView from './_components/PublicProfileView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const data = await loadPublicClientProfile(handle)
  if (!data) return { title: 'Profile' }
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const title = `@${data.handle}`
  const description =
    data.bio ?? `@${data.handle}'s looks on ${brand.displayName}.`
  return {
    title,
    description,
    // The co-located opengraph-image.tsx supplies the image; this block gives
    // the unfurl its title/description/url so shared profiles preview cleanly.
    openGraph: {
      title,
      description,
      type: 'profile',
      url: `/u/${data.handle}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function PublicClientProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params

  const viewer = await getCurrentUser()
  const viewerClientId =
    viewer && viewer.role === Role.CLIENT
      ? (viewer.clientProfile?.id ?? null)
      : null

  const data = await loadPublicClientProfile(handle, { viewerClientId })
  if (!data) notFound()

  // Guideline 1.2 — every signed-in user can block, not just a client. A pro
  // sees client-authored looks and comments in the same feeds.
  //
  // Resolved HERE rather than inside loadPublicClientProfile because that
  // loader's return type is re-exported from lib/dto/index.ts and is therefore
  // part of the iOS wire contract — see loadViewerBlockId.
  const blockTarget = viewer ? await resolveBlockTargetByHandle(prisma, handle) : null
  const viewerBlockId =
    viewer && blockTarget
      ? await loadViewerBlockId(prisma, {
          viewerUserId: viewer.id,
          blockedUserId: blockTarget.userId,
        })
      : null
  // A signed-in viewer who is not the person themselves can block them.
  const blockState =
    viewer && blockTarget && blockTarget.userId !== viewer.id
      ? { blockId: viewerBlockId }
      : null

  // Only signed-in clients can follow. The owner gets no control; a signed-in
  // non-client (pro/admin) sees nothing; a guest gets a CTA that routes to login.
  const followMode: FollowMode = data.viewer.isOwn
    ? 'own'
    : viewerClientId
      ? 'client'
      : viewer
        ? 'hidden'
        : 'guest'

  return (
    <main
      className="min-h-dvh bg-bgPrimary text-textPrimary"
      aria-labelledby="public-profile-heading"
    >
      <div className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-6 md:px-8">
        <PublicProfileView
          data={data}
          followMode={followMode}
          loginHref={buildLoginHref(`/u/${data.handle}`)}
          block={blockState}
        />
      </div>
    </main>
  )
}
