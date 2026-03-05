// app/pro/reviews/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaPortfolioToggle from './MediaPortfolioToggle'
import HashJumpHighlight from './HashJumpHighlight'
import { renderMediaUrls } from '@/lib/media/renderUrls'

function pickNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export default async function ProReviewsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/reviews')
  }

  const proId = user.professionalProfile.id

  // ✅ Option A: load canonical storage pointers for media assets
  const reviews = await prisma.review.findMany({
    where: { professionalId: proId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      client: true,
      mediaAssets: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          caption: true,
          mediaType: true,
          isFeaturedInPortfolio: true,

          // ✅ canonical pointers (single source of truth)
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,

          // legacy fallback only (renderMediaUrls will ignore unless already http(s))
          url: true,
          thumbUrl: true,

          services: {
            include: { service: true },
          },
        },
      },
    },
  })

  // ✅ Precompute render-safe src URLs server-side
  const reviewsForUI = await Promise.all(
    reviews.map(async (rev) => {
      const first = pickNonEmptyString(rev.client?.firstName)
      const last = pickNonEmptyString(rev.client?.lastName)
      const clientName = `${first} ${last}`.trim() || 'Client'
      const date = new Date(rev.createdAt).toLocaleDateString()
      const reviewAnchor = `review-${rev.id}`

      const mediaTiles = (
        await Promise.all(
          (rev.mediaAssets || []).map(async (m) => {
            // If canonical pointers are missing, we can’t render under Option A.
            // (Leaving legacy fallback in renderMediaUrls as a safety net.)
            if (!m.storageBucket || !m.storagePath) return null

            const { renderUrl, renderThumbUrl } = await renderMediaUrls({
              storageBucket: m.storageBucket,
              storagePath: m.storagePath,
              thumbBucket: m.thumbBucket ?? null,
              thumbPath: m.thumbPath ?? null,
              url: m.url ?? null,
              thumbUrl: m.thumbUrl ?? null,
            })

            const src = (renderThumbUrl ?? renderUrl ?? '').trim()
            if (!src) return null

            return {
              id: m.id,
              caption: m.caption ?? null,
              isVideo: m.mediaType === 'VIDEO',
              isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
              services: m.services ?? [],
              src,
            }
          }),
        )
      ).filter((x): x is NonNullable<typeof x> => Boolean(x))

      return {
        id: rev.id,
        rating: rev.rating,
        headline: rev.headline ?? null,
        body: rev.body ?? null,
        bookingId: rev.bookingId ?? null,
        createdAtISO: new Date(rev.createdAt).toISOString(),
        date,
        clientName,
        reviewAnchor,
        mediaTiles,
      }
    }),
  )

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '80px auto 90px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <HashJumpHighlight />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0 }}>Reviews</h1>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/pro/profile?tab=reviews" style={{ fontSize: 12, color: '#111', textDecoration: 'none' }}>
            View on Profile →
          </Link>
        </div>
      </div>

      {reviewsForUI.length === 0 ? (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #eee',
            background: '#fff',
            padding: 12,
            fontSize: 13,
            color: '#6b7280',
          }}
        >
          No reviews yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {reviewsForUI.map((rev) => {
            return (
              <article
                key={rev.id}
                id={rev.reviewAnchor}
                style={{
                  borderRadius: 14,
                  border: '1px solid #eee',
                  background: '#fff',
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {rev.clientName} • {rev.date}
                    </div>

                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: '#f59e0b',
                      }}
                      aria-label={`Rating ${rev.rating} out of 5`}
                    >
                      {'★'.repeat(rev.rating).padEnd(5, '☆')}
                    </div>

                    {rev.headline ? <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600 }}>{rev.headline}</div> : null}

                    {rev.body ? <div style={{ marginTop: 6, fontSize: 13, color: '#111' }}>{rev.body}</div> : null}

                    <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Link
                        href={`/pro/reviews#${rev.reviewAnchor}`}
                        style={{
                          fontSize: 12,
                          color: '#111',
                          textDecoration: 'none',
                          border: '1px solid #e5e7eb',
                          padding: '6px 10px',
                          borderRadius: 999,
                        }}
                        title="Direct link to this review"
                      >
                        Copy link target
                      </Link>

                      {rev.bookingId ? (
                        <Link
                          href={`/pro/bookings/${rev.bookingId}`}
                          style={{
                            fontSize: 12,
                            textDecoration: 'none',
                            color: '#111',
                            border: '1px solid #111',
                            padding: '6px 10px',
                            borderRadius: 999,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          View booking
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>

                {rev.mediaTiles.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Photos / videos from this review</div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 8,
                      }}
                    >
                      {rev.mediaTiles.map((m) => {
                        return (
                          <div
                            key={m.id}
                            style={{
                              borderRadius: 10,
                              border: '1px solid #eee',
                              overflow: 'hidden',
                              background: '#fafafa',
                            }}
                          >
                            <Link
                              href={`/media/${m.id}`}
                              style={{
                                display: 'block',
                                position: 'relative',
                                aspectRatio: '1 / 1',
                                background: '#f3f4f6',
                              }}
                              title="Open"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={m.src}
                                alt={m.caption || 'Review media'}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />

                              {m.isVideo ? (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    background: 'rgba(0,0,0,0.65)',
                                    color: '#fff',
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    borderRadius: 999,
                                  }}
                                >
                                  VIDEO
                                </div>
                              ) : null}
                            </Link>

                            <div style={{ padding: 10, display: 'grid', gap: 8 }}>
                              {m.services?.length ? (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {m.services.slice(0, 2).map((t) => (
                                    <span
                                      key={t.id}
                                      style={{
                                        background: '#111',
                                        color: '#fff',
                                        fontSize: 10,
                                        padding: '2px 6px',
                                        borderRadius: 999,
                                      }}
                                    >
                                      {t.service?.name || 'Service'}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <MediaPortfolioToggle mediaId={m.id} initialFeatured={Boolean(m.isFeaturedInPortfolio)} />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                      Note: you can feature review media in your portfolio, but you can’t edit the client’s review content.
                      Because… obviously.
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}