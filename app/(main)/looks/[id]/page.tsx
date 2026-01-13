// app/looks/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function LookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (!id) notFound()

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      professional: {
        select: {
          id: true,
          businessName: true,
          professionType: true,
          location: true,
        },
      },
      services: { include: { service: true } },
      review: {
        select: {
          rating: true,
          headline: true,
          body: true,
          createdAt: true,
        },
      },
    },
  })

  if (!media || media.visibility !== 'PUBLIC') notFound()

  const src = media.url
  const isVideo = media.mediaType === 'VIDEO'
  const pro = media.professional

  return (
    <main
      className="text-textPrimary"
      style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}
    >
      <Link
        href="/looks"
        className="text-textPrimary"
        style={{ fontSize: 12, textDecoration: 'none', display: 'inline-block', marginBottom: 10 }}
      >
        ← Back to Looks
      </Link>

      <section
        className="border border-surfaceGlass/10 bg-bgSecondary"
        style={{ borderRadius: 16, overflow: 'hidden' }}
      >
        <div className="bg-bgPrimary" style={{ display: 'grid', placeItems: 'center', maxHeight: 520 }}>
          {isVideo ? (
            <video src={src} controls style={{ width: '100%', maxHeight: 520 }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={media.caption || 'Look'} style={{ width: '100%', height: 'auto', display: 'block' }} />
          )}
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{pro?.businessName || 'Beauty professional'}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {pro?.professionType || 'Beauty pro'}
              {pro?.location ? ` • ${pro.location}` : ''}
            </div>
          </div>

          {media.services.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {media.services.map(
                (t: { id: string; service?: { name?: string | null } | null }) => (
                  <span
                    key={t.id}
                    className="bg-surfaceGlass/16 text-textPrimary"
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {t.service?.name || 'Service'}
                  </span>
                ),
              )}
            </div>
          )}

          {media.caption && <div style={{ fontSize: 13, color: '#374151' }}>{media.caption}</div>}

          {media.review && (
            <div
              className="border-t border-surfaceGlass/10"
              style={{ marginTop: 6, paddingTop: 10, display: 'grid', gap: 6 }}
            >
              <div style={{ fontSize: 12, color: '#f59e0b' }}>{'★'.repeat(media.review.rating).padEnd(5, '☆')}</div>
              {media.review.headline && <div style={{ fontSize: 14, fontWeight: 600 }}>{media.review.headline}</div>}
              {media.review.body && <div style={{ fontSize: 13, color: '#374151' }}>{media.review.body}</div>}
            </div>
          )}

          {pro?.id && (
            <div style={{ marginTop: 6 }}>
              <Link
                href={`/professionals/${pro.id}`}
                className="border border-surfaceGlass/25 text-textPrimary"
                style={{
                  fontSize: 12,
                  textDecoration: 'none',
                  padding: '8px 12px',
                  borderRadius: 999,
                  display: 'inline-block',
                }}
              >
                View profile
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
