// app/(main)/looks/tags/[slug]/page.tsx
//
// Public SEO/browse landing page for a hashtag/style tag (social-first D1).
// "#balayage near you" is the long game — full metadata + sitemap inclusion.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadLookTagPage } from '@/lib/looks/tagPage'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

type Params = { slug: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const tenant = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenant)
  const wordmark = brand.assets.wordmark.text

  const data = await loadLookTagPage({ slug, tenant })
  if (!data) {
    return { title: `Tag not found | ${wordmark}` }
  }

  const title = `#${data.display} looks | ${wordmark}`
  const description = `Browse #${data.display} looks on ${wordmark} — and book the pro who made the one you love.`

  return {
    title,
    description,
    alternates: { canonical: `/looks/tags/${data.slug}` },
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function LookTagPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const tenant = await resolveTenantContextForLayout()
  const data = await loadLookTagPage({ slug, tenant })
  if (!data) notFound()

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-textPrimary">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-textMuted">
          Looks
        </p>
        <h1 className="mt-1 font-display text-[28px] font-medium">
          #{data.display}
        </h1>
        <p className="mt-1 text-[14px] text-textSecondary">
          {data.tiles.length} {data.tiles.length === 1 ? 'look' : 'looks'}
        </p>
      </header>

      {data.tiles.length === 0 ? (
        <p className="text-[14px] text-textSecondary">
          No looks with this tag yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {data.tiles.map((tile) => (
            <Link
              key={tile.id}
              href={`/looks/${tile.id}`}
              className="relative aspect-[4/5] overflow-hidden rounded-card bg-bgSurface"
            >
              {tile.thumbUrl ? (
                <RemoteImage
                  src={tile.thumbUrl}
                  alt={tile.caption ?? `#${data.display} look`}
                  width={400}
                  height={500}
                  className="h-full w-full object-cover transition hover:opacity-90"
                />
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
