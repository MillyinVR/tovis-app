// app/pro/reviews/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/currentUser'
import MediaPortfolioToggle from './MediaPortfolioToggle'
import HashJumpHighlight from './HashJumpHighlight'
import ReviewReplyEditor from './ReviewReplyEditor'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { loadProReviewsList } from '@/lib/pro/loadProReviewsList'

export default async function ProReviewsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/reviews')
  }

  // Shared loader (also used by GET /api/v1/pro/reviews) runs the query +
  // render-safe media URL resolution, so the page and API never drift.
  const reviewsForUI = await loadProReviewsList({
    professionalId: user.professionalProfile.id,
    viewer: user,
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
          <Link href="/pro/profile?tab=reviews" style={{ fontSize: 12, color: 'rgb(var(--text-primary))', textDecoration: 'none' }}>
            View on Profile →
          </Link>
        </div>
      </div>

      {reviewsForUI.length === 0 ? (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            background: 'rgb(var(--bg-surface))',
            padding: 12,
            fontSize: 13,
            color: 'rgb(var(--text-muted))',
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
                  border: '1px solid rgb(var(--text-primary) / 0.10)',
                  background: 'rgb(var(--bg-surface))',
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
                    <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))' }}>
                      {rev.clientHref ? (
                        <Link
                          href={rev.clientHref}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {rev.clientName}
                        </Link>
                      ) : (
                        rev.clientName
                      )}{' '}
                      • {rev.date}
                    </div>

                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: 'rgb(var(--amber))',
                      }}
                      aria-label={`Rating ${rev.rating} out of 5`}
                    >
                      {'★'.repeat(rev.rating).padEnd(5, '☆')}
                    </div>

                    {rev.headline ? <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600 }}>{rev.headline}</div> : null}

                    {rev.body ? <div style={{ marginTop: 6, fontSize: 13, color: 'rgb(var(--text-primary))' }}>{rev.body}</div> : null}

                    <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Link
                        href={`/pro/reviews#${rev.reviewAnchor}`}
                        style={{
                          fontSize: 12,
                          color: 'rgb(var(--text-primary))',
                          textDecoration: 'none',
                          border: '1px solid rgb(var(--text-primary) / 0.10)',
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
                            color: 'rgb(var(--text-primary))',
                            border: '1px solid rgb(var(--text-primary))',
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
                    <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))', marginBottom: 8 }}>Photos / videos from this review</div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 8,
                      }}
                    >
                      {rev.mediaTiles
                        .filter(
                          (m) =>
                            // A paired before is subsumed by its after's slider.
                            !rev.mediaTiles.some(
                              (t) => t.before?.id === m.id,
                            ),
                        )
                        .map((m) => {
                        if (m.before) {
                          // Paired before/after → the comparison slider fills the tile.
                          return (
                            <div
                              key={m.id}
                              style={{
                                borderRadius: 10,
                                border: '1px solid rgb(var(--text-primary) / 0.10)',
                                overflow: 'hidden',
                                background: 'rgb(var(--text-primary) / 0.04)',
                              }}
                            >
                              <div
                                style={{
                                  position: 'relative',
                                  aspectRatio: '1 / 1',
                                }}
                              >
                                <BeforeAfterReveal
                                  beforeSrc={
                                    m.before.thumbUrl ??
                                    m.before.fullUrl ??
                                    m.src
                                  }
                                  afterSrc={m.src}
                                  beforeAlt={m.caption ? `Before — ${m.caption}` : 'Before'}
                                  afterAlt={m.caption ? `After — ${m.caption}` : 'After'}
                                  className="brand-before-after-fill"
                                />
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div
                            key={m.id}
                            style={{
                              borderRadius: 10,
                              border: '1px solid rgb(var(--text-primary) / 0.10)',
                              overflow: 'hidden',
                              background: 'rgb(var(--text-primary) / 0.04)',
                            }}
                          >
                            <Link
                              href={`/media/${m.id}`}
                              style={{
                                display: 'block',
                                position: 'relative',
                                aspectRatio: '1 / 1',
                                background: 'rgb(var(--text-primary) / 0.04)',
                              }}
                              title="Open"
                            >
                              <RemoteImage
                                src={m.src}
                                alt={m.caption || 'Review media'}
                                width={400}
                                height={400}
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
                                    background: 'rgb(var(--overlay) / 0.72)',
                                    color: 'rgb(var(--text-primary))',
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
                                        background: 'rgb(var(--text-primary))',
                                        color: 'rgb(var(--bg-primary))',
                                        fontSize: 10,
                                        padding: '2px 6px',
                                        borderRadius: 999,
                                      }}
                                    >
                                      {t.serviceName}
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

                    <div style={{ marginTop: 8, fontSize: 11, color: 'rgb(var(--text-muted))' }}>
                      Note: you can feature review media in your portfolio, but you can’t edit the client’s review content.
                      Because… obviously.
                    </div>
                  </div>
                ) : null}

                <ReviewReplyEditor
                  reviewId={rev.id}
                  reply={rev.proReply}
                />
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}