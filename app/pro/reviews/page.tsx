// app/pro/reviews/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaPortfolioToggle from './MediaPortfolioToggle'
import HashJumpHighlight from './HashJumpHighlight' // ✅ add this

export default async function ProReviewsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/reviews')
  }

  const proId = user.professionalProfile.id

  const reviews = await prisma.review.findMany({
    where: { professionalId: proId },
    orderBy: { createdAt: 'desc' },
    include: {
      client: true,
      mediaAssets: {
        orderBy: { createdAt: 'desc' },
        include: {
          services: { include: { service: true } },
        },
      },
    },
    take: 100,
  })

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
          <Link
            href="/pro/profile?tab=reviews"
            style={{ fontSize: 12, color: '#111', textDecoration: 'none' }}
          >
            View on Profile →
          </Link>
        </div>
      </div>

      {reviews.length === 0 ? (
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
          {reviews.map((rev) => {
            const first = (rev.client?.firstName || '').trim()
            const last = (rev.client?.lastName || '').trim()
            const clientName = `${first} ${last}`.trim() || 'Client'
            const date = new Date(rev.createdAt).toLocaleDateString()

            const reviewAnchor = `review-${rev.id}`

            return (
              <article
                key={rev.id}
                id={reviewAnchor}
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
                      {clientName} • {date}
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

                    {rev.headline && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        {rev.headline}
                      </div>
                    )}

                    {rev.body && (
                      <div style={{ marginTop: 6, fontSize: 13, color: '#111' }}>
                        {rev.body}
                      </div>
                    )}

                    {/* handy for testing notification deep-links */}
                    <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Link
                        href={`/pro/reviews#${reviewAnchor}`}
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

                {/* Media row */}
                {rev.mediaAssets.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#6b7280',
                        marginBottom: 8,
                      }}
                    >
                      Photos / videos from this review
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 8,
                      }}
                    >
                      {rev.mediaAssets.map((m) => {
                        const src = m.thumbUrl || m.url
                        const isVideo = m.mediaType === 'VIDEO'
                        
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
                              href={`/pro/media/${m.id}`}
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
                                src={src}
                                alt={m.caption || 'Review media'}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />

                              {isVideo && (
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
                              )}
                            </Link>

                            <div style={{ padding: 10, display: 'grid', gap: 8 }}>
                              {/* Service tags (first 2) */}
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

                              <MediaPortfolioToggle
                                mediaId={m.id}
                                initialFeatured={m.isFeaturedInPortfolio}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                      Note: you can feature review media in your portfolio, but you can’t edit the
                      client’s review content. Because… obviously.
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
