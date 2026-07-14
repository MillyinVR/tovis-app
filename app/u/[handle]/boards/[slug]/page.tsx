// app/u/[handle]/boards/[slug]/page.tsx — public, shareable board (social-first D3)
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Role } from '@prisma/client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'
import { resolveFocalPoint } from '@/lib/media/focalPoint'
import { loadPublicBoard } from '@/lib/boards/publicBoard'

export const dynamic = 'force-dynamic'

type RouteParams = { handle: string; slug: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>
}): Promise<Metadata> {
  const { handle, slug } = await params
  const data = await loadPublicBoard(handle, slug)
  if (!data) return { title: 'Board' }

  const brand = getBrandConfig()
  const title = `${data.boardName} · @${data.handle}`
  const description = `${data.boardName} — a board of looks saved by @${data.handle} on ${brand.displayName}.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/u/${data.handle}/boards/${data.boardSlug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function PublicBoardPage({
  params,
}: {
  params: Promise<RouteParams>
}) {
  const { handle, slug } = await params

  const viewer = await getCurrentUser().catch(() => null)
  const viewerClientId =
    viewer && viewer.role === Role.CLIENT
      ? (viewer.clientProfile?.id ?? null)
      : null

  const data = await loadPublicBoard(handle, slug, { viewerClientId })
  if (!data) notFound()

  return (
    <main
      className="min-h-dvh bg-bgPrimary text-textPrimary"
      aria-labelledby="public-board-heading"
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:px-8">
        <header className="mb-6 border-b border-white/10 pb-5">
          {data.ownerProfilePublic ? (
            <Link
              href={`/u/${data.handle}`}
              className="inline-flex items-center gap-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
            >
              {data.ownerAvatarUrl ? (
                <RemoteImage
                  src={data.ownerAvatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : null}
              @{data.handle}
            </Link>
          ) : (
            <span className="text-[12px] font-bold text-textSecondary">
              @{data.handle}
            </span>
          )}

          <div className="mt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-textSecondary/60">
              Board
            </div>
            <h1
              id="public-board-heading"
              className="mt-1 font-display text-3xl font-semibold italic leading-tight text-textPrimary"
            >
              {data.boardName}
            </h1>
            <div className="mt-2 text-[12px] text-textSecondary">
              {data.looks.length}{' '}
              {data.looks.length === 1 ? 'look' : 'looks'}
            </div>
          </div>
        </header>

        {data.looks.length === 0 ? (
          <section className="rounded-card border border-white/10 bg-bgSecondary px-5 py-10 text-center">
            <div className="text-[14px] font-bold text-textPrimary">
              Nothing to see here yet.
            </div>
            <div className="mt-2 text-[13px] text-textSecondary">
              This board doesn’t have any public looks right now.
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.looks.map((look) => (
              <Link
                key={look.id}
                href={look.href}
                className="group block"
                aria-label={`Open ${look.name}`}
              >
                <div
                  className="relative overflow-hidden rounded-card border border-white/10 bg-bgSecondary transition group-hover:border-white/20"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  {look.imageUrl ? (
                    <RemoteImage
                      src={look.imageUrl}
                      alt={look.name}
                      width={300}
                      height={400}
                      className="absolute inset-0 h-full w-full object-cover"
                      focalPoint={resolveFocalPoint(look.focalX, look.focalY)}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-bgSurface to-bgPrimary" />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-bgPrimary/85 via-transparent to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <div className="line-clamp-2 text-[11px] font-semibold text-textPrimary">
                      {look.name}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  )
}
