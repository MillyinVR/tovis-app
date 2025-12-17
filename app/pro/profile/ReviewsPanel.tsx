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
  mediaAssets?: Array<{
    id: string
    url: string
    thumbUrl: string | null
    mediaType: MediaType
    isFeaturedInPortfolio?: boolean
  }>
}

export default function ReviewsPanel({ reviews }: { reviews: ReviewForPanel[] }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null)

  // local copy so we can update UI without reload
  const [localReviews, setLocalReviews] = useState<ReviewForPanel[]>(reviews)

  useEffect(() => {
    setLocalReviews(reviews)
  }, [reviews])

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])

  function open(src: string) {
    setLightboxSrc(src)
  }
  function close() {
    setLightboxSrc(null)
  }

  useEffect(() => {
    if (!lightboxSrc) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxSrc])

  async function setPortfolio(mediaId: string, value: boolean) {
    setBusyMediaId(mediaId)
    try {
      const res = await fetch(`/api/pro/media/${mediaId}/toggle-portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update portfolio.')

      // update local state
      setLocalReviews((prev) =>
        prev.map((r) => ({
          ...r,
          mediaAssets: r.mediaAssets?.map((m) =>
            m.id === mediaId ? { ...m, isFeaturedInPortfolio: value } : m,
          ),
        })),
      )
    } catch (e) {
      console.error(e)
      alert((e as Error).message || 'Failed to update portfolio.')
    } finally {
      setBusyMediaId(null)
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
          const primary = media[0]
          const primarySrc = primary?.thumbUrl || primary?.url || null

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

                {rev.headline ? (
                  <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>
                    {rev.headline}
                  </div>
                ) : null}

                {rev.body ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>
                    {rev.body}
                  </div>
                ) : null}

                {/* thumbnails */}
                {media.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {media.slice(0, 6).map((m) => {
                      const src = m.thumbUrl || m.url
                      const inPortfolio = Boolean(m.isFeaturedInPortfolio)

                      return (
                        <div key={m.id} style={{ width: 92 }}>
                          <button
                            type="button"
                            onClick={() => open(src)}
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
                            }}
                            title="View"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt="Review media"
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                          </button>

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
                            }}
                            title={inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
                          >
                            {busyMediaId === m.id
                              ? 'Saving…'
                              : inPortfolio
                                ? 'Remove'
                                : 'Add'}
                          </button>
                        </div>
                      )
                    })}

                    {media.length > 6 ? (
                      <div style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>
                        +{media.length - 6}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* RIGHT: big media */}
              {primarySrc ? (
                <button
                  type="button"
                  onClick={() => open(primarySrc)}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 12,
                    padding: 0,
                    background: '#f3f4f6',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    width: '100%',
                    aspectRatio: '1 / 1',
                  }}
                  title="View full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={primarySrc}
                    alt="Primary review media"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </button>
              ) : null}
            </div>
          )
        })
      )}

      {/* LIGHTBOX */}
      {lightboxSrc ? (
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxSrc}
              alt="Full size"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
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
