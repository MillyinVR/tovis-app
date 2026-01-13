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

function btnBase(disabled?: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black transition',
    'border border-white/10',
    disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-surfaceGlass',
  ].join(' ')
}

function btnPrimary(disabled?: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black transition',
    'border border-white/10',
    disabled ? 'cursor-not-allowed opacity-70 bg-bgPrimary text-textSecondary' : 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
  ].join(' ')
}

function btnDanger(disabled?: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black transition',
    'border border-white/10',
    disabled ? 'cursor-not-allowed opacity-70 bg-bgPrimary text-textSecondary' : 'bg-bgPrimary text-microAccent hover:bg-surfaceGlass',
  ].join(' ')
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

  const [apptMedia, setApptMedia] = useState<AppointmentMediaOption[]>([])
  const [selectedApptMediaIds, setSelectedApptMediaIds] = useState<string[]>([])
  const APPT_SELECT_MAX = 2

  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')
  const [pendingMedia, setPendingMedia] = useState<Array<{ url: string; mediaType: MediaType }>>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [preview, setPreview] = useState<{ url: string; mediaType: MediaType } | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])
  const mediaList = existingReview?.mediaAssets ?? []
  const hasReviewMedia = mediaList.length > 0

  function resetAlerts() {
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!bookingId || hasReview) return
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
      if (prev.length >= APPT_SELECT_MAX) return prev
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
            attachedMediaIds: selectedApptMediaIds,
            media: pendingMedia.map((m) => ({ url: m.url, mediaType: m.mediaType })),
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-bgPrimary/70 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl overflow-hidden rounded-card border border-white/10 bg-bgSecondary shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <div className="text-xs font-semibold text-textSecondary">
                {preview.mediaType === 'VIDEO' ? 'Video preview' : 'Image preview'}
              </div>
              <button type="button" onClick={() => setPreview(null)} className={btnPrimary(false)}>
                Close
              </button>
            </div>

            <div className="bg-bgPrimary">
              {preview.mediaType === 'VIDEO' ? (
                <video src={preview.url} controls className="block max-h-[75vh] w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt="Full size preview" className="block max-h-[75vh] w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <section className="mt-5 grid gap-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
        <div className="text-sm font-black">{hasReview ? 'Your review' : 'Leave a review'}</div>

        {/* Rating */}
        <div className="flex items-center gap-3">
          <div className="w-20 text-xs font-semibold text-textSecondary">Rating</div>
          <div className="flex gap-1">
            {stars.map((s) => {
              const on = s <= rating
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  disabled={loading}
                  className={[
                    'text-lg leading-none transition',
                    loading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                    on ? 'text-accentPrimary' : 'text-textSecondary',
                  ].join(' ')}
                  aria-label={`${s} star`}
                >
                  ★
                </button>
              )
            })}
          </div>
        </div>

        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Headline (optional)"
          disabled={loading}
          className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary outline-none"
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your review (optional)"
          rows={4}
          disabled={loading}
          className="w-full resize-y rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary outline-none"
        />

        {/* Appointment media selector */}
        {!hasReview ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="text-xs font-black">Add photos from your appointment (optional)</div>
            <div className="mt-1 text-xs font-semibold text-textSecondary">
              Select up to {APPT_SELECT_MAX}. If you don’t select any, they stay private inside your aftercare summary.
            </div>

            {apptMedia.length ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {apptMedia.map((m) => {
                  const selected = selectedApptMediaIds.includes(m.id)
                  const thumb = m.thumbUrl || m.url
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleApptMedia(m.id)}
                      disabled={loading}
                      className={[
                        'relative overflow-hidden rounded-card border bg-bgSecondary transition',
                        selected ? 'border-accentPrimary' : 'border-white/10',
                        loading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-surfaceGlass',
                      ].join(' ')}
                      title="Click to select"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="Appointment media" className="block h-36 w-full object-cover" />
                      <div
                        className={[
                          'absolute left-2 bottom-2 rounded-full px-3 py-1 text-[11px] font-black',
                          selected ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary text-textPrimary border border-white/10',
                        ].join(' ')}
                      >
                        {selected ? 'Selected' : 'Select'}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-2 text-sm text-textSecondary">No appointment photos available.</div>
            )}
          </div>
        ) : null}

        {/* Existing media */}
        {hasReview ? (
          <div className="mt-1">
            <div className="mb-2 text-xs font-black">Your media</div>

            {mediaList.length ? (
              <div className="grid grid-cols-3 gap-2">
                {mediaList.map((m) => {
                  const thumb = m.thumbUrl || m.url
                  return (
                    <div key={m.id} className="overflow-hidden rounded-card border border-white/10 bg-bgPrimary">
                      <button
                        type="button"
                        onClick={() => setPreview({ url: m.url, mediaType: m.mediaType })}
                        className="block w-full bg-transparent p-0"
                        title="Click to preview"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb} alt="Review media" className="block h-36 w-full object-cover" />
                      </button>
                      <div className="p-2 text-[11px] font-semibold text-textSecondary">
                        Attached to your review (can’t be removed)
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-textSecondary">No media added yet.</div>
            )}
          </div>
        ) : null}

        {/* Client upload queue */}
        <div className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="text-xs font-black">Add your own photos/videos</div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
            <input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="Paste media URL (we’ll replace with real upload later)"
              disabled={loading}
              className="w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary outline-none"
            />
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
              disabled={loading}
              className="w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
            >
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addPendingMedia} disabled={loading} className={btnPrimary(loading)}>
              Add to list
            </button>

            <div className="text-xs font-semibold text-textSecondary">{pendingMedia.length} item(s) queued</div>

            {pendingMedia.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  resetAlerts()
                  setPendingMedia([])
                }}
                disabled={loading}
                className={btnBase(loading)}
              >
                Clear queue
              </button>
            ) : null}
          </div>

          {pendingMedia.length > 0 ? (
            <div className="text-xs font-semibold text-textSecondary">
              {pendingMedia.map((m, idx) => (
                <div key={`${m.url}-${idx}`} className="truncate">
                  • {m.mediaType}: {m.url}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <div className="text-sm font-semibold text-microAccent">{error}</div> : null}
        {success ? <div className="text-sm font-semibold text-textSecondary">{success}</div> : null}

        <div className="flex flex-wrap justify-end gap-2">
          {!hasReview ? (
            <button
              type="button"
              disabled={loading || !bookingId}
              onClick={submitReview}
              className={btnPrimary(loading || !bookingId)}
            >
              {loading ? 'Submitting…' : 'Submit review'}
            </button>
          ) : (
            <>
              <button type="button" disabled={loading} onClick={saveEdits} className={btnPrimary(loading)}>
                {loading ? 'Saving…' : 'Save changes'}
              </button>

              <button
                type="button"
                disabled={loading || pendingMedia.length === 0}
                onClick={addMediaToExistingReview}
                className={btnPrimary(loading || pendingMedia.length === 0)}
              >
                {loading ? 'Saving…' : 'Add queued media'}
              </button>

              <button
                type="button"
                disabled={loading || hasReviewMedia}
                onClick={deleteReview}
                className={btnDanger(loading || hasReviewMedia)}
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
