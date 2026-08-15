// app/pro/profile/ReviewsPanel.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'
import { errorMessageFromUnknown } from '@/lib/http'
import { hardNavigate, loginHrefFromHere } from '@/lib/clientNavigation'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import ClientMediaExportButton from '@/app/_components/media/ClientMediaExportButton'
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

  // The pro's single public response, or null/absent when none.
  proReply?: { body: string; repliedAt: string } | null

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

function mediaSrc(media: { url: string; thumbUrl: string | null }): string | null {
  const thumbUrl = pickStringOrEmpty(media.thumbUrl)
  if (thumbUrl) return thumbUrl

  const url = pickStringOrEmpty(media.url)
  return url || null
}

function reviewListKey(reviews: ReviewForPanel[]): string {
  return reviews.map((review) => review.id).join('|')
}

type ReviewMediaBefore = { thumbUrl: string | null; fullUrl: string | null }

function ReviewsPanelInner({
  reviews,
  editable,
  professionalId,
}: {
  reviews: ReviewForPanel[]
  editable: boolean
  /** Who a client-exported copy of this review's media signs with. `null`
   * when the viewer is the pro looking at their own dashboard (a DIFFERENT
   * signal from `editable`, which only toggles the portfolio add/remove
   * buttons and is false here today for unrelated reasons) — self-viewing
   * your own work isn't this feature; that's the existing pro-side
   * "Make a post" flow. */
  professionalId: string | null
}) {
  const [lightbox, setLightbox] = useState<{
    src: string
    mediaType: MediaType
    before: ReviewMediaBefore | null
  } | null>(null)

  const [busyMediaId, setBusyMediaId] = useState<string | null>(null)
  const [busyHelpfulReviewId, setBusyHelpfulReviewId] = useState<string | null>(
    null,
  )

  const [localReviews, setLocalReviews] = useState<ReviewForPanel[]>(reviews)

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])

  function open(src: string, mediaType: MediaType, before: ReviewMediaBefore | null): void {
    setLightbox({ src, mediaType, before })
  }

  function close(): void {
    setLightbox(null)
  }

  function redirectToLogin(reason: string): void {
    hardNavigate(loginHrefFromHere('/looks', reason))
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
      alert(errorMessageFromUnknown(error, 'Failed to update portfolio.'))
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

                {/* The reply is NOT a card of its own — it is an accent
                    hairline INSIDE the review, so the two are read together and
                    the reply can't be mistaken for a second opinion. */}
                {review.proReply ? (
                  <div
                    style={{
                      marginTop: 8,
                      borderLeft: '2px solid rgb(var(--accent-primary))',
                      paddingLeft: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 650,
                        color: 'rgb(var(--accent-primary))',
                      }}
                    >
                      Response from the pro ·{' '}
                      {formatInTimeZone(
                        review.proReply.repliedAt,
                        getViewerTimeZone() ?? DEFAULT_TIME_ZONE,
                        { month: 'short', day: 'numeric', year: 'numeric' },
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: 'rgb(var(--text-secondary))',
                      }}
                    >
                      {review.proReply.body}
                    </div>
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
                            onClick={() => open(src, item.mediaType, item.before ?? null)}
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
                  {professionalId ? (
                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                      <ClientMediaExportButton
                        professionalId={professionalId}
                        className="border border-white/12 bg-bgPrimary/25 text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl hover:bg-white/10"
                        media={{
                          kind: 'pair',
                          beforeUrl: pairedBefore.thumbUrl ?? pairedBefore.fullUrl ?? pairedAfterSrc,
                          afterUrl: pairedAfterSrc,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : primary && primarySrc ? (
                <button
                  type="button"
                  onClick={() => open(primarySrc, primary.mediaType, primary.before ?? null)}
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
        <Lightbox
          lightbox={lightbox}
          onClose={close}
          professionalId={professionalId}
        />
      ) : null}
    </section>
  )
}

function Lightbox({
  lightbox,
  onClose,
  professionalId,
}: {
  lightbox: { src: string; mediaType: MediaType; before: ReviewMediaBefore | null }
  onClose: () => void
  /** null when the viewer is the pro looking at their own dashboard —
   * exporting/sharing their own work signed with their own handle isn't
   * this feature; that's the existing pro-side "Make a post" flow. */
  professionalId: string | null
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
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          {professionalId && lightbox.mediaType !== 'VIDEO' ? (
            <ClientMediaExportButton
              variant="pill"
              professionalId={professionalId}
              media={
                lightbox.before
                  ? {
                      kind: 'pair',
                      beforeUrl: lightbox.before.thumbUrl ?? lightbox.before.fullUrl ?? lightbox.src,
                      afterUrl: lightbox.src,
                    }
                  : { kind: 'single', url: lightbox.src }
              }
            />
          ) : (
            <span />
          )}
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
  professionalId = null,
}: {
  reviews: ReviewForPanel[]
  editable?: boolean
  /** Who a client-exported copy of this review's media gets signed with, or
   * `null` on the pro's own dashboard (see `ReviewsPanelInner`'s doc). */
  professionalId?: string | null
}) {
  const key = reviewListKey(reviews)

  return (
    <ReviewsPanelInner
      key={key}
      reviews={reviews}
      editable={editable}
      professionalId={professionalId}
    />
  )
}