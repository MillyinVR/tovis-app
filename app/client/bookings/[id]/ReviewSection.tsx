// app/client/bookings/[id]/ReviewSection.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type MediaType = 'IMAGE' | 'VIDEO'

type ExistingReview = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  mediaAssets?: Array<{
    id: string
    url: string
    thumbUrl: string | null
    mediaType: MediaType
    createdAt: string
    isFeaturedInPortfolio?: boolean
    isEligibleForLooks?: boolean
  }>
}

type AppointmentMediaOption = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  createdAt: string
  phase?: 'BEFORE' | 'AFTER' | 'OTHER'
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search + window.location.hash
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = currentPathWithQuery()
  const url = `/login?from=${encodeURIComponent(from)}` + (reason ? `&reason=${encodeURIComponent(reason)}` : '')
  router.push(url)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function isProbablyUrl(s: string) {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default function ReviewSection({
  bookingId,
  existingReview,
}: {
  bookingId: string
  existingReview: ExistingReview | null
}) {
  const router = useRouter()
  const hasReview = !!existingReview

  const [rating, setRating] = useState<number>(existingReview?.rating ?? 5)
  const [headline, setHeadline] = useState(existingReview?.headline ?? '')
  const [body, setBody] = useState(existingReview?.body ?? '')

  useEffect(() => {
    setRating(existingReview?.rating ?? 5)
    setHeadline(existingReview?.headline ?? '')
    setBody(existingReview?.body ?? '')
  }, [existingReview?.id])

  // Appointment media options (pro-uploaded booking media)
  const [apptMedia, setApptMedia] = useState<AppointmentMediaOption[]>([])
  const [selectedApptMediaIds, setSelectedApptMediaIds] = useState<string[]>([])
  const APPT_SELECT_MAX = 2

  // URL-based media queue (client uploads, placeholder)
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')
  const [pendingMedia, setPendingMedia] = useState<Array<{ url: string; mediaType: MediaType }>>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [preview, setPreview] = useState<{ url: string; mediaType: MediaType } | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])
  const mediaList = existingReview?.mediaAssets ?? []
  const hasReviewMedia = mediaList.length > 0

  function resetAlerts() {
    setError(null)
    setSuccess(null)
  }

  // Load appointment media options
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!bookingId || hasReview) return // only needed on first creation (simpler UX)
      try {
        const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/review-media-options`, { method: 'GET' })
        if (res.status === 401) return
        const data = await safeJson(res)
        if (!res.ok) return
        if (cancelled) return
        setApptMedia(Array.isArray(data?.items) ? data.items : [])
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [bookingId, hasReview])

  function toggleApptMedia(id: string) {
    resetAlerts()
    setSelectedApptMediaIds((prev) => {
      const has = prev.includes(id)
      if (has) return prev.filter((x) => x !== id)
      if (prev.length >= APPT_SELECT_MAX) return prev // silently enforce max 2
      return [...prev, id]
    })
  }

  function addPendingMedia() {
    resetAlerts()
    const url = mediaUrl.trim()
    if (!url) return
    if (!isProbablyUrl(url)) {
      setError('Please enter a valid http(s) URL.')
      return
    }
    setPendingMedia((prev) => [...prev, { url, mediaType }])
    setMediaUrl('')
  }

  async function requestOrRedirect(
    input: RequestInfo,
    init: RequestInit,
    loginReason: string,
  ): Promise<{ ok: true; data: any } | { ok: false; handled: true } | { ok: false; error: string }> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const res = await fetch(input, { ...init, signal: controller.signal })

    if (res.status === 401) {
      redirectToLogin(router, loginReason)
      return { ok: false, handled: true }
    }

    const data = await safeJson(res)
    if (!res.ok) return { ok: false, error: errorFromResponse(res, data) }
    return { ok: true, data }
  }

  async function submitReview() {
    if (loading) return
    resetAlerts()

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }

    setLoading(true)
    try {
      const result = await requestOrRedirect(
        `/api/client/bookings/${encodeURIComponent(bookingId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating,
            headline,
            body,
            attachedMediaIds: selectedApptMediaIds, // ✅ pro booking media selected by client
            media: pendingMedia.map((m) => ({ url: m.url, mediaType: m.mediaType })), // ✅ client uploads
          }),
        },
        'login_required_review_submit',
      )

      if (!result.ok) {
        if ('handled' in result) return
        setError(result.error)
        return
      }

      setSuccess('Review submitted.')
      setPendingMedia([])
      setSelectedApptMediaIds([])
      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function saveEdits() {
    if (!existingReview || loading) return
    resetAlerts()
    setLoading(true)

    try {
      const result = await requestOrRedirect(
        `/api/client/reviews/${encodeURIComponent(existingReview.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating, headline, body }),
        },
        'login_required_review_edit',
      )

      if (!result.ok) {
        if ('handled' in result) return
        setError(result.error)
        return
      }

      setSuccess('Review updated.')
      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function addMediaToExistingReview() {
    if (!existingReview || loading) return
    resetAlerts()

    if (pendingMedia.length === 0) {
      setError('Add at least one media item first.')
      return
    }

    setLoading(true)
    try {
      const result = await requestOrRedirect(
        `/api/client/reviews/${encodeURIComponent(existingReview.id)}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media: pendingMedia.map((m) => ({ url: m.url, mediaType: m.mediaType })),
          }),
        },
        'login_required_review_add_media',
      )

      if (!result.ok) {
        if ('handled' in result) return
        setError(result.error)
        return
      }

      setSuccess('Media added.')
      setPendingMedia([])
      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteReview() {
    if (!existingReview || loading) return
    resetAlerts()

    // ✅ Your rule: if the review has images, it’s permanent (no “oops” later)
    if (hasReviewMedia) {
      setError('This review has media attached, so it can’t be deleted.')
      return
    }

    const ok = window.confirm('Delete this review? This cannot be undone.')
    if (!ok) return

    setLoading(true)
    try {
      const result = await requestOrRedirect(
        `/api/client/reviews/${encodeURIComponent(existingReview.id)}`,
        { method: 'DELETE' },
        'login_required_review_delete',
      )

      if (!result.ok) {
        if ('handled' in result) return
        setError(result.error)
        return
      }

      setSuccess('Review deleted.')
      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Modal preview */}
      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(920px, 100%)',
              borderRadius: 16,
              background: '#fff',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div
              style={{
                padding: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #eee',
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {preview.mediaType === 'VIDEO' ? 'Video preview' : 'Image preview'}
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                style={{
                  border: 'none',
                  background: '#111',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ background: '#000' }}>
              {preview.mediaType === 'VIDEO' ? (
                <video src={preview.url} controls style={{ width: '100%', maxHeight: '75vh', display: 'block' }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.url}
                  alt="Full size preview"
                  style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain', display: 'block' }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <section
        style={{
          borderRadius: 12,
          border: '1px solid #eee',
          background: '#fff',
          padding: 12,
          marginTop: 16,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>{hasReview ? 'Your review' : 'Leave a review'}</div>

        {/* Rating */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#6b7280', width: 70 }}>Rating</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRating(s)}
                disabled={loading}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: loading ? 'default' : 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  color: s <= rating ? '#f59e0b' : '#d1d5db',
                  opacity: loading ? 0.7 : 1,
                }}
                aria-label={`${s} star`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Headline (optional)"
          disabled={loading}
          style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e7eb', padding: 10, fontSize: 13, opacity: loading ? 0.7 : 1 }}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your review (optional)"
          rows={4}
          disabled={loading}
          style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e7eb', padding: 10, fontSize: 13, resize: 'vertical', opacity: loading ? 0.7 : 1 }}
        />

        {/* Appointment media selector (only when creating a review) */}
        {!hasReview ? (
          <div style={{ borderRadius: 10, border: '1px solid #f3f4f6', padding: 10, background: '#fafafa' }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Add photos from your appointment (optional)</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Select up to {APPT_SELECT_MAX}. If you don’t select any, they stay private inside your aftercare summary.
            </div>

            {apptMedia.length ? (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {apptMedia.map((m) => {
                  const selected = selectedApptMediaIds.includes(m.id)
                  const thumb = m.thumbUrl || m.url
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleApptMedia(m.id)}
                      disabled={loading}
                      style={{
                        border: selected ? '2px solid #111' : '1px solid #eee',
                        borderRadius: 10,
                        overflow: 'hidden',
                        padding: 0,
                        background: '#f3f4f6',
                        cursor: loading ? 'default' : 'pointer',
                        position: 'relative',
                      }}
                      title="Click to select"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="Appointment media" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
                      <div
                        style={{
                          position: 'absolute',
                          left: 8,
                          bottom: 8,
                          background: selected ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)',
                          color: selected ? '#fff' : '#111',
                          borderRadius: 999,
                          padding: '4px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {selected ? 'Selected' : 'Select'}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>No appointment photos available.</div>
            )}
          </div>
        ) : null}

        {/* Existing media (immutable) */}
        {hasReview ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Your media</div>

            {mediaList.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {mediaList.map((m) => {
                  const thumb = m.thumbUrl || m.url
                  return (
                    <div key={m.id} style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', background: '#f3f4f6' }}>
                      <button
                        type="button"
                        onClick={() => setPreview({ url: m.url, mediaType: m.mediaType })}
                        style={{ border: 'none', padding: 0, margin: 0, cursor: 'pointer', width: '100%', display: 'block', background: 'transparent' }}
                        title="Click to preview"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb} alt="Review media" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
                      </button>

                      <div style={{ padding: 8, fontSize: 11, color: '#6b7280' }}>
                        Attached to your review (can’t be removed)
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No media added yet.</div>
            )}
          </div>
        ) : null}

        {/* Client upload queue */}
        <div style={{ borderRadius: 10, border: '1px solid #f3f4f6', padding: 10, background: '#fafafa', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Add your own photos/videos</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
            <input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="Paste media URL (we’ll replace with real upload later)"
              disabled={loading}
              style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e7eb', padding: 10, fontSize: 13, background: '#fff', opacity: loading ? 0.7 : 1 }}
            />
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
              disabled={loading}
              style={{ borderRadius: 10, border: '1px solid #e5e7eb', padding: 10, fontSize: 13, background: '#fff', opacity: loading ? 0.7 : 1 }}
            >
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={addPendingMedia}
              disabled={loading}
              style={{ border: 'none', borderRadius: 999, padding: '8px 12px', background: '#111', color: '#fff', cursor: loading ? 'default' : 'pointer', fontSize: 12, opacity: loading ? 0.7 : 1 }}
            >
              Add to list
            </button>

            <div style={{ fontSize: 12, color: '#6b7280' }}>{pendingMedia.length} item(s) queued</div>

            {pendingMedia.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  resetAlerts()
                  setPendingMedia([])
                }}
                disabled={loading}
                style={{ border: 'none', borderRadius: 999, padding: '8px 12px', background: '#e5e7eb', color: '#111', cursor: loading ? 'default' : 'pointer', fontSize: 12, opacity: loading ? 0.7 : 1 }}
              >
                Clear queue
              </button>
            ) : null}
          </div>

          {pendingMedia.length > 0 ? (
            <div style={{ fontSize: 12, color: '#374151' }}>
              {pendingMedia.map((m, idx) => (
                <div key={`${m.url}-${idx}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  • {m.mediaType}: {m.url}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <div style={{ color: 'red', fontSize: 12 }}>{error}</div> : null}
        {success ? <div style={{ color: 'green', fontSize: 12 }}>{success}</div> : null}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {!hasReview ? (
            <button
              type="button"
              disabled={loading || !bookingId}
              onClick={submitReview}
              style={{ border: 'none', borderRadius: 999, padding: '10px 14px', background: '#111', color: '#fff', cursor: loading ? 'default' : 'pointer', fontSize: 13, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Submitting…' : 'Submit review'}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={saveEdits}
                style={{ border: 'none', borderRadius: 999, padding: '10px 14px', background: '#111', color: '#fff', cursor: loading ? 'default' : 'pointer', fontSize: 13, opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'Saving…' : 'Save changes'}
              </button>

              <button
                type="button"
                disabled={loading || pendingMedia.length === 0}
                onClick={addMediaToExistingReview}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '10px 14px',
                  background: pendingMedia.length === 0 ? '#9ca3af' : '#111',
                  color: '#fff',
                  cursor: loading || pendingMedia.length === 0 ? 'default' : 'pointer',
                  fontSize: 13,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Saving…' : 'Add queued media'}
              </button>

              <button
                type="button"
                disabled={loading || hasReviewMedia}
                onClick={deleteReview}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '10px 14px',
                  background: hasReviewMedia ? '#f3f4f6' : '#b91c1c',
                  color: hasReviewMedia ? '#6b7280' : '#fff',
                  cursor: !hasReviewMedia && !loading ? 'pointer' : 'default',
                  fontSize: 13,
                  opacity: loading ? 0.7 : 1,
                }}
                title={hasReviewMedia ? 'This review has media attached, so it can’t be deleted.' : 'Delete your review'}
              >
                Delete review
              </button>
            </>
          )}
        </div>
      </section>
    </>
  )
}
