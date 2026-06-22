// app/u/[handle]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Role } from '@prisma/client'

import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'
import { buildLoginHref } from '@/lib/profiles/publicProfileFormatting'
import { loadPublicClientProfile } from './_data/loadPublicClientProfile'
import { type FollowMode } from './_components/ProfileStats'
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
  const brand = getBrandConfig()
  return {
    title: `@${data.handle}`,
    description: data.bio ?? `@${data.handle}'s looks on ${brand.displayName}.`,
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
        />
      </div>
    </main>
  )
}
