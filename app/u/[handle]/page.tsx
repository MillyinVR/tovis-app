// app/u/[handle]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Role } from '@prisma/client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'
import { buildLoginHref } from '@/lib/profiles/publicProfileFormatting'
import { loadPublicClientProfile } from './_data/loadPublicClientProfile'
import ProfileStats, { type FollowMode } from './_components/ProfileStats'

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

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      <div className="h-[86px] w-[86px] shrink-0 overflow-hidden rounded-full border border-textPrimary/10 bg-bgSecondary">
        <RemoteImage
          src={url}
          alt={name}
          className="h-full w-full object-cover"
          width={86}
          height={86}
        />
      </div>
    )
  }
  return (
    <div
      className="grid h-[86px] w-[86px] shrink-0 place-items-center rounded-full border border-textPrimary/10 bg-bgSecondary text-[34px] font-black text-textPrimary"
      aria-hidden="true"
    >
      {name.trim().slice(0, 1).toUpperCase() || '@'}
    </div>
  )
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
    <main className="min-h-dvh bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-6 md:px-8">
        <section className="mt-2 flex items-start gap-4">
          <Avatar name={data.handle} url={data.avatarUrl} />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="truncate font-display text-[28px] font-semibold italic leading-none">
              {data.displayName}
            </h1>
            <ProfileStats
              handle={data.handle}
              counts={data.counts}
              mode={followMode}
              initialFollowing={data.viewer.following}
              loginHref={buildLoginHref(`/u/${data.handle}`)}
            />
          </div>
        </section>

        {data.bio ? (
          <p className="mt-4 max-w-[520px] text-[14px] leading-relaxed text-textSecondary">
            {data.bio}
          </p>
        ) : null}

        <section className="mt-8">
          {data.looks.length > 0 ? (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
              {data.looks.map((look) => (
                <Link
                  key={look.id}
                  href={look.href}
                  className="block overflow-hidden rounded-[22px] border border-textPrimary/10 bg-bgSecondary transition hover:border-textPrimary/20"
                >
                  <div className="relative aspect-[1.1/1] bg-bgSecondary">
                    {look.imageUrl ? (
                      <RemoteImage
                        src={look.imageUrl}
                        alt={look.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        width={440}
                        height={400}
                      />
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <span className="truncate text-[14px] font-black text-textPrimary">
                      {look.name}
                    </span>
                    <span className="shrink-0 text-[11px] font-bold text-textSecondary">
                      ♥ {look.saveCount}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-[22px] border border-textPrimary/10 px-4 py-10 text-center text-[14px] text-textSecondary">
              No public looks yet.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
