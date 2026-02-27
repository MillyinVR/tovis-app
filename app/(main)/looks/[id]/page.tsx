// app/(main)/looks/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function LookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) notFound()

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      professional: {
        select: { id: true, businessName: true, professionType: true, location: true },
      },
      services: { include: { service: true } },
      review: { select: { rating: true, headline: true, body: true, createdAt: true } },
    },
  })

if (!media || media.visibility !== 'PUBLIC') notFound()

if (!media.url) notFound() // ✅ url must exist for public detail page

const src = media.url
const isVideo = media.mediaType === 'VIDEO'
  const pro = media.professional

  return (
    <main className="mx-auto max-w-[960px] px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href="/looks"
        className="inline-flex items-center gap-2 text-xs font-black text-textPrimary opacity-80 hover:opacity-100"
      >
        <span aria-hidden>←</span> Back to Looks
      </Link>

      <section className="mt-3 overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgSecondary">
        <div className="grid max-h-[520px] place-items-center bg-bgPrimary">
          {isVideo ? (
            <video src={src} controls playsInline preload="metadata" className="h-auto w-full max-h-[520px]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={media.caption || 'Look'}
              className="block h-auto w-full"
              loading="lazy"
              decoding="async"
            />
          )}
        </div>

        <div className="grid gap-3 p-4">
          <div className="grid gap-1">
            <div className="text-base font-extrabold">{pro?.businessName || 'Beauty professional'}</div>
            <div className="text-xs text-textSecondary">
              {pro?.professionType || 'Beauty pro'}
              {pro?.location ? ` • ${pro.location}` : ''}
            </div>
          </div>

          {media.services.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {media.services.map((t: { id: string; service?: { name?: string | null } | null }) => (
                <span
                  key={t.id}
                  className="rounded-full border border-surfaceGlass/12 bg-surfaceGlass/8 px-3 py-1 text-[11px] font-black text-textPrimary"
                >
                  {t.service?.name || 'Service'}
                </span>
              ))}
            </div>
          ) : null}

          {media.caption ? <div className="text-sm text-textPrimary/90">{media.caption}</div> : null}

          {media.review ? (
            <div className="mt-1 grid gap-2 border-t border-surfaceGlass/10 pt-3">
              <div className="text-xs font-black text-accentPrimary">
                {'★'.repeat(media.review.rating).padEnd(5, '☆')}
              </div>
              {media.review.headline ? <div className="text-sm font-extrabold">{media.review.headline}</div> : null}
              {media.review.body ? <div className="text-sm text-textPrimary/90">{media.review.body}</div> : null}
            </div>
          ) : null}

          {pro?.id ? (
            <div className="mt-1">
              <Link
                href={`/professionals/${pro.id}`}
                className="inline-flex items-center rounded-full border border-surfaceGlass/18 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass/6"
              >
                View profile
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
