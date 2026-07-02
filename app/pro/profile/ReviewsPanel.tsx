// app/pro/profile/ReviewsPanel.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import { isRecord } from '@/lib/guards'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { Z } from '@/lib/zIndex'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type MediaType = 'IMAGE' | 'VIDEO'

export type ReviewForPanel = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName?: string | null
  clientHref?: string | null

  helpfulCount?: number
  viewerHelpful?: boolean

  mediaAssets?: Array<{
    id: string
    url: string
    thumbUrl: string | null
    mediaType: MediaType
    isFeaturedInPortfolio?: boolean
    isEligibleForLooks?: boolean
    // Opt-in before/after pairing → this after photo renders as the slider.
    before?: {
      id: string
      thumbUrl: string | null
      fullUrl: string | null
    } | null
  }>
}

type HelpfulResponse = {
  helpful?: boolean
  helpfulCount?: number
  error?: string
}

function parseHelpfulResponse(value: unknown): HelpfulResponse {
  if (!isRecord(value)) return {}

  return {
    helpful: typeof value.helpful === 'boolean' ? value.helpful : undefined,
    helpfulCount:
      typeof value.helpfulCount === 'number' ? value.helpfulCount : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
  }
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (isRecord(error) && typeof error.message === 'string') {
    const message = error.message.trim()
    if (message) return message
  }
  return 'Failed to update portfolio.'
}

function pickNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mediaSrc(media: { url: string; thumbUrl: string | null }): string | null {
  const thumbUrl = pickNonEmptyString(media.thumbUrl)
  if (thumbUrl) return thumbUrl

  const url = pickNonEmptyString(media.url)
  return url || null
}

function currentPathWithQuery(): string {
  if (typeof window === 'undefined') return '/looks'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string): string {
  const trimmed = from.trim()
  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'
  return trimmed
}

function reviewListKey(reviews: ReviewForPanel[]): string {
  return reviews.map((review) => review.id).join('|')
}

function ReviewsPanelInner({
  reviews,
  editable,
}: {
  reviews: ReviewForPanel[]
  editable: boolean
}) {
  const [lightbox, setLightbox] = useState<{
    src: string
    mediaType: MediaType
  } | null>(null)

  const [busyMediaId, setBusyMediaId] = useState<string | null>(null)
  const [busyHelpfulReviewId, setBusyHelpfulReviewId] = useState<string | null>(
    null,
  )

  const [localReviews, setLocalReviews] = useState<ReviewForPanel[]>(reviews)

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])

  function open(src: string, mediaType: MediaType): void {
    setLightbox({ src, mediaType })
  }

  function close(): void {
    setLightbox(null)
  }

  function redirectToLogin(reason: string): void {
    if (typeof window === 'undefined') return

    const from = sanitizeFrom(currentPathWithQuery())
    const qs = new URLSearchParams({ from, reason })

    window.location.href = `/login?${qs.toString()}`
  }

  async function setPortfolio(mediaId: string, value: boolean): Promise<void> {
    if (!editable) return

    setBusyMediaId(mediaId)

    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(mediaId)}/portfolio`,
        {
          method: value ? 'POST' : 'DELETE',
        },
      )

      const rawData: unknown = await res.json().catch(() => ({}))
      const data = parseHelpfulResponse(rawData)

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update portfolio.')
      }

      setLocalReviews((prev) =>
        prev.map((review) => ({
          ...review,
          mediaAssets: review.mediaAssets?.map((media) =>
            media.id === mediaId
              ? { ...media, isFeaturedInPortfolio: value }
              : media,
          ),
        })),
      )
    } catch (error: unknown) {
      console.error(error)
      alert(errorMessageFromUnknown(error))
    } finally {
      setBusyMediaId(null)
    }
  }

  async function toggleHelpful(reviewId: string): Promise<void> {
    if (editable) return
    if (busyHelpfulReviewId) return

    const currentReview = localReviews.find((review) => review.id === reviewId)
    if (!currentReview) return

    const beforeHelpful = Boolean(currentReview.viewerHelpful)
    const beforeCount =
      typeof currentReview.helpfulCount === 'number'
        ? currentReview.helpfulCount
        : 0

    const optimisticHelpful = !beforeHelpful
    const optimisticCount = Math.max(
      0,
      beforeCount + (optimisticHelpful ? 1 : -1),
    )

    setLocalReviews((prev) =>
      prev.map((review) =>
        review.id === reviewId
          ? {
              ...review,
              viewerHelpful: optimisticHelpful,
              helpfulCount: optimisticCount,
            }
          : review,
      ),
    )

    setBusyHelpfulReviewId(reviewId)

    try {
      const res = await fetch(
        `/api/v1/reviews/${encodeURIComponent(reviewId)}/helpful`,
        {
          method: beforeHelpful ? 'DELETE' : 'POST',
          headers: { Accept: 'application/json' },
        },
      )

      if (res.status === 401) {
        setLocalReviews((prev) =>
          prev.map((review) =>
            review.id === reviewId
              ? {
                  ...review,
                  viewerHelpful: beforeHelpful,
                  helpfulCount: beforeCount,
                }
              : review,
          ),
        )

        redirectToLogin('helpful')
        return
      }

      const rawData: unknown = await res.json().catch(() => ({}))
      const data = parseHelpfulResponse(rawData)

      if (!res.ok) {
        setLocalReviews((prev) =>
          prev.map((review) =>
            review.id === reviewId
              ? {
                  ...review,
                  viewerHelpful: beforeHelpful,
                  helpfulCount: beforeCount,
                }
              : review,
          ),
        )

        return
      }

      const serverHelpful =
        typeof data.helpful === 'boolean' ? data.helpful : optimisticHelpful

      const serverCount =
        typeof data.helpfulCount === 'number'
          ? data.helpfulCount
          : optimisticCount

      setLocalReviews((prev) =>
        prev.map((review) =>
          review.id === reviewId
            ? {
                ...review,
                viewerHelpful: serverHelpful,
                helpfulCount: serverCount,
              }
            : review,
        ),
      )
    } catch (error: unknown) {
      console.error(error)

      setLocalReviews((prev) =>
        prev.map((review) =>
          review.id === reviewId
            ? {
                ...review,
                viewerHelpful: beforeHelpful,
                helpfulCount: beforeCount,
              }
            : review,
        ),
      )
    } finally {
      setBusyHelpfulReviewId(null)
    }
  }

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      {localReviews.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))' }}>No reviews yet.</div>
      ) : (
        localReviews.map((review) => {
          const name = review.clientName?.trim() || 'Client'
          const date = formatInTimeZone(
            review.createdAt,
            getViewerTimeZone() ?? DEFAULT_TIME_ZONE,
            { month: 'short', day: 'numeric', year: 'numeric' },
          )

          const allMedia = review.mediaAssets ?? []
          // A paired "after" (carries `before`) renders as the comparison slider
          // in the right column; its before + the after itself drop out of the
          // thumbnail strip so nothing shows twice.
          const paired = allMedia.find((m) => m.before) ?? null
          const pairedBefore = paired?.before ?? null
          const pairedAfterSrc = paired ? mediaSrc(paired) : null
          const showSlider = Boolean(paired && pairedBefore && pairedAfterSrc)

          const media = showSlider
            ? allMedia.filter(
                (m) => m.id !== paired?.id && m.id !== pairedBefore?.id,
              )
            : allMedia
          const primary = showSlider ? null : (media[0] ?? null)
          const primarySrc = primary ? mediaSrc(primary) : null
          const hasRightColumn = showSlider || Boolean(primarySrc)

          const helpfulCount =
            typeof review.helpfulCount === 'number' ? review.helpfulCount : 0

          const viewerHelpful = Boolean(review.viewerHelpful)
          const helpfulBusy = busyHelpfulReviewId === review.id

          return (
            <div
              key={review.id}
              style={{
                borderRadius: 12,
                border: '1px solid rgb(var(--text-primary) / 0.10)',
                background: 'rgb(var(--bg-surface))',
                padding: 12,
                display: 'grid',
                gridTemplateColumns: hasRightColumn ? '1fr 170px' : '1fr',
                gap: 12,
                alignItems: 'start',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>
                      {review.clientHref ? (
                        <Link
                          href={review.clientHref}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'rgb(var(--text-muted))',
                        marginTop: 2,
                      }}
                    >
                      {date}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: 'rgb(var(--amber))' }}>
                    {stars.map((star) => (
                      <span key={star}>
                        {star <= review.rating ? '★' : '☆'}
                      </span>
                    ))}
                  </div>
                </div>

                {review.headline ? (
                  <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>
                    {review.headline}
                  </div>
                ) : null}

                {review.body ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                    {review.body}
                  </div>
                ) : null}

                {!editable ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <button
                      type="button"
                      disabled={helpfulBusy}
                      onClick={() => {
                        void toggleHelpful(review.id)
                      }}
                      style={{
                        border: '1px solid rgb(var(--text-primary) / 0.10)',
                        borderRadius: 999,
                        padding: '6px 10px',
                        background: viewerHelpful ? 'rgb(var(--text-primary))' : 'rgb(var(--bg-surface))',
                        color: viewerHelpful ? 'rgb(var(--bg-primary))' : 'rgb(var(--text-primary))',
                        cursor: helpfulBusy ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        opacity: helpfulBusy ? 0.75 : 1,
                      }}
                      title={viewerHelpful ? 'Marked helpful' : 'Mark helpful'}
                    >
                      {helpfulBusy ? '…' : viewerHelpful ? 'Helpful ✓' : 'Helpful'}
                    </button>

                    <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))' }}>
                      {helpfulCount} {helpfulCount === 1 ? 'helpful' : 'helpfuls'}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--text-muted))' }}>
                    {helpfulCount} {helpfulCount === 1 ? 'helpful' : 'helpfuls'}
                  </div>
                )}

                {media.length > 0 ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {media.slice(0, 6).map((item) => {
                      const src = mediaSrc(item)
                      if (!src) return null

                      const inPortfolio = Boolean(item.isFeaturedInPortfolio)
                      const isVideo = item.mediaType === 'VIDEO'

                      return (
                        <div key={item.id} style={{ width: 92 }}>
                          <button
                            type="button"
                            onClick={() => open(src, item.mediaType)}
                            style={{
                              border: '1px solid rgb(var(--text-primary) / 0.10)',
                              borderRadius: 10,
                              padding: 0,
                              background: 'rgb(var(--text-primary) / 0.04)',
                              width: 92,
                              height: 92,
                              overflow: 'hidden',
                              cursor: 'pointer',
                              display: 'block',
                              position: 'relative',
                            }}
                            title="View"
                          >
                            {isVideo ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'grid',
                                  placeItems: 'center',
                                  background: 'rgb(var(--text-primary))',
                                  color: 'rgb(var(--bg-primary))',
                                  fontSize: 10,
                                  fontWeight: 800,
                                }}
                              >
                                VIDEO
                              </div>
                            ) : (
                              <RemoteImage
                                src={src}
                                alt="Review media"
                                width={400}
                                height={400}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                            )}

                            {isVideo ? (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  background: 'rgb(var(--overlay) / 0.72)',
                                  color: 'rgb(var(--text-primary))',
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  borderRadius: 999,
                                }}
                              >
                                ▶
                              </div>
                            ) : null}
                          </button>

                          {editable ? (
                            <button
                              type="button"
                              disabled={busyMediaId === item.id}
                              onClick={() => {
                                void setPortfolio(item.id, !inPortfolio)
                              }}
                              style={{
                                marginTop: 6,
                                width: '100%',
                                border: '1px solid rgb(var(--text-primary) / 0.10)',
                                borderRadius: 999,
                                padding: '6px 8px',
                                background: inPortfolio ? 'rgb(var(--text-primary))' : 'rgb(var(--bg-surface))',
                                color: inPortfolio ? 'rgb(var(--bg-primary))' : 'rgb(var(--text-primary))',
                                cursor:
                                  busyMediaId === item.id ? 'default' : 'pointer',
                                fontSize: 11,
                                opacity: busyMediaId === item.id ? 0.75 : 1,
                              }}
                              title={
                                inPortfolio
                                  ? 'Remove from portfolio'
                                  : 'Add to portfolio'
                              }
                            >
                              {busyMediaId === item.id
                                ? 'Saving…'
                                : inPortfolio
                                  ? 'Remove'
                                  : 'Add'}
                            </button>
                          ) : null}
                        </div>
                      )
                    })}

                    {media.length > 6 ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'rgb(var(--text-muted))',
                          alignSelf: 'center',
                        }}
                      >
                        +{media.length - 6}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {showSlider && paired && pairedBefore && pairedAfterSrc ? (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    position: 'relative',
                  }}
                >
                  <BeforeAfterReveal
                    beforeSrc={
                      pairedBefore.thumbUrl ??
                      pairedBefore.fullUrl ??
                      pairedAfterSrc
                    }
                    afterSrc={pairedAfterSrc}
                    beforeAlt="Before"
                    afterAlt="After"
                    className="brand-before-after-fill"
                  />
                </div>
              ) : primary && primarySrc ? (
                <button
                  type="button"
                  onClick={() => open(primarySrc, primary.mediaType)}
                  style={{
                    border: '1px solid rgb(var(--text-primary) / 0.10)',
                    borderRadius: 12,
                    padding: 0,
                    background: 'rgb(var(--text-primary) / 0.04)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    width: '100%',
                    aspectRatio: '1 / 1',
                    position: 'relative',
                  }}
                  title="View full size"
                >
                  {primary.mediaType === 'VIDEO' ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        background: 'rgb(var(--text-primary))',
                        color: 'rgb(var(--bg-primary))',
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      VIDEO
                    </div>
                  ) : (
                    <RemoteImage
                      src={primarySrc}
                      alt="Primary review media"
                      width={600}
                      height={600}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  )}

                  {primary.mediaType === 'VIDEO' ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        background: 'rgb(var(--overlay) / 0.72)',
                        color: 'rgb(var(--text-primary))',
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                      }}
                    >
                      ▶
                    </div>
                  ) : null}
                </button>
              ) : null}
            </div>
          )
        })
      )}

      {lightbox ? (
        <Lightbox lightbox={lightbox} onClose={close} />
      ) : null}
    </section>
  )
}

function Lightbox({
  lightbox,
  onClose,
}: {
  lightbox: { src: string; mediaType: MediaType }
  onClose: () => void
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: Z.modal,
        padding: 16,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'rgb(var(--bg-surface))',
          borderRadius: 14,
          overflow: 'hidden',
          maxWidth: 920,
          width: '100%',
        }}
      >
        {lightbox.mediaType === 'VIDEO' ? (
          <video
            src={lightbox.src}
            controls
            playsInline
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        ) : (
          <RemoteImage
            src={lightbox.src}
            alt="Full size"
            intrinsic
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        )}

        <div
          style={{
            padding: 10,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              borderRadius: 999,
              padding: '8px 12px',
              background: 'rgb(var(--text-primary) / 0.08)',
              color: 'rgb(var(--text-primary))',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReviewsPanel({
  reviews,
  editable = false,
}: {
  reviews: ReviewForPanel[]
  editable?: boolean
}) {
  const key = reviewListKey(reviews)

  return <ReviewsPanelInner key={key} reviews={reviews} editable={editable} />
}