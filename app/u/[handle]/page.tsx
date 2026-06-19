// app/u/[handle]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getBrandConfig } from '@/lib/brand'
import { loadPublicClientProfile } from './_data/loadPublicClientProfile'

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="h-full w-full object-cover" />
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[15px] font-black text-textPrimary">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-textSecondary">
        {label}
      </span>
    </div>
  )
}

export default async function PublicClientProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params
  const data = await loadPublicClientProfile(handle)
  if (!data) notFound()

  return (
    <main className="min-h-dvh bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-6 md:px-8">
        <section className="mt-2 flex items-start gap-4">
          <Avatar name={data.handle} url={data.avatarUrl} />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="truncate font-display text-[28px] font-semibold italic leading-none">
              {data.displayName}
            </h1>
            <div className="mt-3 flex items-center gap-5">
              <Stat value={data.counts.followers} label="Followers" />
              <Stat value={data.counts.following} label="Following" />
              <Stat value={data.counts.looks} label="Looks" />
            </div>
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
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={look.imageUrl}
                        alt={look.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
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
