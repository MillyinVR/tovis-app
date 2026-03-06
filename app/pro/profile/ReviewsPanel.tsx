// app/pro/profile/ReviewsPanel.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type MediaType = 'IMAGE' | 'VIDEO'

export type ReviewForPanel = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName?: string | null

  // Spotlight fuel:
  helpfulCount?: number
  viewerHelpful?: boolean

  mediaAssets?: Array<{
    id: string
    url: string // render-safe (server must provide)
    thumbUrl: string | null // render-safe (server must provide)
    mediaType: MediaType
    isFeaturedInPortfolio?: boolean
    isEligibleForLooks?: boolean
  }>
}

function pickNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function mediaSrc(m: { url: string; thumbUrl: string | null }): string | null {
  const t = pickNonEmptyString(m.thumbUrl)
  if (t) return t
  const u = pickNonEmptyString(m.url)
  return u || null
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/looks'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'
  return trimmed
}

export default function ReviewsPanel({
  reviews,
  editable = false,
}: {
  reviews: ReviewForPanel[]
  editable?: boolean
}) {
  const [lightbox, setLightbox] = useState<{ src: string; mediaType: MediaType } | null>(null)
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null)

  // Helpful toggle busy state (per review)
  const [busyHelpfulReviewId, setBusyHelpfulReviewId] = useState<string | null>(null)

  // local copy so we can update UI without reload
  const [localReviews, setLocalReviews] = useState<ReviewForPanel[]>(reviews)

  useEffect(() => {
    setLocalReviews(reviews)
  }, [reviews])

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])

  function open(src: string, mediaType: MediaType) {
    setLightbox({ src, mediaType })
  }
  function close() {
    setLightbox(null)
  }

  useEffect(() => {
    if (!lightbox) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox])

  function redirectToLogin(reason: string) {
    if (typeof window === 'undefined') return
    const from = sanitizeFrom(currentPathWithQuery())
    const qs = new URLSearchParams({ from, reason })
    window.location.href = `/login?${qs.toString()}`
  }

  async function setPortfolio(mediaId: string, value: boolean) {
    if (!editable) return
    setBusyMediaId(mediaId)

    try {
      const res = await fetch(`/api/pro/media/${encodeURIComponent(mediaId)}/portfolio`, {
        method: value ? 'POST' : 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update portfolio.')

      setLocalReviews((prev) =>
        prev.map((r) => ({
          ...r,
          mediaAssets: r.mediaAssets?.map((m) => (m.id === mediaId ? { ...m, isFeaturedInPortfolio: value } : m)),
        })),
      )
    } catch (e) {
      console.error(e)
      alert((e as Error).message || 'Failed to update portfolio.')
    } finally {
      setBusyMediaId(null)
    }
  }

  async function toggleHelpful(reviewId: string) {
    if (editable) return // pros editing portfolio shouldn’t be voting on reviews here
    if (busyHelpfulReviewId) return

    const cur = localReviews.find((r) => r.id === reviewId)
    if (!cur) return

    const beforeHelpful = Boolean(cur.viewerHelpful)
    const beforeCount = typeof cur.helpfulCount === 'number' ? cur.helpfulCount : 0

    const optimisticHelpful = !beforeHelpful
    const optimisticCount = Math.max(0, beforeCount + (optimisticHelpful ? 1 : -1))

    // optimistic update
    setLocalReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? { ...r, viewerHelpful: optimisticHelpful, helpfulCount: optimisticCount }
          : r,
      ),
    )

    setBusyHelpfulReviewId(reviewId)

    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/helpful`, {
        method: beforeHelpful ? 'DELETE' : 'POST',
        headers: { Accept: 'application/json' },
      })

      // guest → login
      if (res.status === 401) {
        // revert
        setLocalReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? { ...r, viewerHelpful: beforeHelpful, helpfulCount: beforeCount }
              : r,
          ),
        )
        redirectToLogin('helpful')
        return
      }

      const data: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        // revert on any failure
        setLocalReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? { ...r, viewerHelpful: beforeHelpful, helpfulCount: beforeCount }
              : r,
          ),
        )
        return
      }

      // sync to server response if present
      const serverHelpful =
        typeof (data as any)?.helpful === 'boolean' ? (data as any).helpful : optimisticHelpful
      const serverCount =
        typeof (data as any)?.helpfulCount === 'number' ? (data as any).helpfulCount : optimisticCount

      setLocalReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId ? { ...r, viewerHelpful: serverHelpful, helpfulCount: serverCount } : r,
        ),
      )
    } catch (e) {
      console.error(e)
      // revert on network error
      setLocalReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, viewerHelpful: beforeHelpful, helpfulCount: beforeCount }
            : r,
        ),
      )
    } finally {
      setBusyHelpfulReviewId(null)
    }
  }

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      {localReviews.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280' }}>No reviews yet.</div>
      ) : (
        localReviews.map((rev) => {
          const name = rev.clientName?.trim() || 'Client'
          const date = new Date(rev.createdAt).toLocaleDateString()

          const media = rev.mediaAssets ?? []
          const primary = media[0] ?? null
          const primarySrc = primary ? mediaSrc(primary) : null

          const helpfulCount = typeof rev.helpfulCount === 'number' ? rev.helpfulCount : 0
          const viewerHelpful = Boolean(rev.viewerHelpful)
          const helpfulBusy = busyHelpfulReviewId === rev.id

          return (
            <div
              key={rev.id}
              style={{
                borderRadius: 12,
                border: '1px solid #eee',
                background: '#fff',
                padding: 12,
                display: 'grid',
                gridTemplateColumns: primarySrc ? '1fr 170px' : '1fr',
                gap: 12,
                alignItems: 'start',
              }}
            >
              {/* LEFT */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>{name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{date}</div>
                  </div>

                  <div style={{ fontSize: 12, color: '#f59e0b' }}>
                    {stars.map((s) => (
                      <span key={s}>{s <= rev.rating ? '★' : '☆'}</span>
                    ))}
                  </div>
                </div>

                {rev.headline ? <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>{rev.headline}</div> : null}

                {rev.body ? <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>{rev.body}</div> : null}

                {/* Helpful row (client-facing only) */}
                {!editable ? (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      type="button"
                      disabled={helpfulBusy}
                      onClick={() => toggleHelpful(rev.id)}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 999,
                        padding: '6px 10px',
                        background: viewerHelpful ? '#111' : '#fff',
                        color: viewerHelpful ? '#fff' : '#111',
                        cursor: helpfulBusy ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        opacity: helpfulBusy ? 0.75 : 1,
                      }}
                      title={viewerHelpful ? 'Marked helpful' : 'Mark helpful'}
                    >
                      {helpfulBusy ? '…' : viewerHelpful ? 'Helpful ✓' : 'Helpful'}
                    </button>

                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {helpfulCount} {helpfulCount === 1 ? 'helpful' : 'helpfuls'}
                    </div>
                  </div>
                ) : (
                  // In editable mode, show count only (no vote)
                  <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                    {helpfulCount} {helpfulCount === 1 ? 'helpful' : 'helpfuls'}
                  </div>
                )}

                {/* thumbnails */}
                {media.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {media.slice(0, 6).map((m) => {
                      const src = mediaSrc(m)
                      if (!src) return null

                      const inPortfolio = Boolean(m.isFeaturedInPortfolio)
                      const isVideo = m.mediaType === 'VIDEO'

                      return (
                        <div key={m.id} style={{ width: 92 }}>
                          <button
                            type="button"
                            onClick={() => open(src, m.mediaType)}
                            style={{
                              border: '1px solid #eee',
                              borderRadius: 10,
                              padding: 0,
                              background: '#f3f4f6',
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
                                  background: '#111',
                                  color: '#fff',
                                  fontSize: 10,
                                  fontWeight: 800,
                                }}
                              >
                                VIDEO
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={src}
                                alt="Review media"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              />
                            )}

                            {isVideo ? (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  background: 'rgba(0,0,0,0.65)',
                                  color: '#fff',
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
                              disabled={busyMediaId === m.id}
                              onClick={() => setPortfolio(m.id, !inPortfolio)}
                              style={{
                                marginTop: 6,
                                width: '100%',
                                border: '1px solid #e5e7eb',
                                borderRadius: 999,
                                padding: '6px 8px',
                                background: inPortfolio ? '#111' : '#fff',
                                color: inPortfolio ? '#fff' : '#111',
                                cursor: busyMediaId === m.id ? 'default' : 'pointer',
                                fontSize: 11,
                                opacity: busyMediaId === m.id ? 0.75 : 1,
                              }}
                              title={inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
                            >
                              {busyMediaId === m.id ? 'Saving…' : inPortfolio ? 'Remove' : 'Add'}
                            </button>
                          ) : null}
                        </div>
                      )
                    })}

                    {media.length > 6 ? (
                      <div style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>+{media.length - 6}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* RIGHT: big media */}
              {primary && primarySrc ? (
                <button
                  type="button"
                  onClick={() => open(primarySrc, primary.mediaType)}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 12,
                    padding: 0,
                    background: '#f3f4f6',
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
                        background: '#111',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      VIDEO
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={primarySrc}
                      alt="Primary review media"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}

                  {primary.mediaType === 'VIDEO' ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        background: 'rgba(0,0,0,0.65)',
                        color: '#fff',
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

      {/* LIGHTBOX */}
      {lightbox ? (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#111',
              borderRadius: 14,
              overflow: 'hidden',
              maxWidth: 920,
              width: '100%',
            }}
          >
            {lightbox.mediaType === 'VIDEO' ? (
              <video src={lightbox.src} controls playsInline style={{ width: '100%', height: 'auto', display: 'block' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightbox.src} alt="Full size" style={{ width: '100%', height: 'auto', display: 'block' }} />
            )}

            <div style={{ padding: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={close}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '8px 12px',
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}