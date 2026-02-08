// app/client/bookings/[id]/ReviewSection.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

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

type PendingUpload = {
  id: string
  file: File
  mediaType: MediaType
  localUrl: string
  status: 'QUEUED' | 'UPLOADING' | 'UPLOADED' | 'ERROR'
  error?: string | null
  publicUrl?: string | null
}

const MAX_IMAGES = 6
const MAX_VIDEOS = 1
const APPT_SELECT_MAX = 6 // appointment media attached to review

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
    disabled
      ? 'cursor-not-allowed opacity-70 bg-bgPrimary text-textSecondary'
      : 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
  ].join(' ')
}

function btnDanger(disabled?: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black transition',
    'border border-white/10',
    disabled
      ? 'cursor-not-allowed opacity-70 bg-bgPrimary text-textSecondary'
      : 'bg-bgPrimary text-microAccent hover:bg-surfaceGlass',
  ].join(' ')
}

function tinyBtn(disabled?: boolean, active?: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-black transition',
    'border border-white/10',
    disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-surfaceGlass',
    active ? 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover' : 'bg-bgPrimary text-textPrimary',
  ].join(' ')
}

function isVideoFile(f: File) {
  return f.type.startsWith('video/')
}
function isImageFile(f: File) {
  return f.type.startsWith('image/')
}

function countCaps(items: PendingUpload[]) {
  let images = 0
  let videos = 0
  for (const it of items) {
    if (it.mediaType === 'VIDEO') videos += 1
    else images += 1
  }
  return { images, videos }
}

function phaseLabel(phase?: AppointmentMediaOption['phase']) {
  if (phase === 'BEFORE') return 'Before'
  if (phase === 'AFTER') return 'After'
  return 'Other'
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

  const [pending, setPending] = useState<PendingUpload[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [limitNote, setLimitNote] = useState<string | null>(null)

  const [preview, setPreview] = useState<{ url: string; mediaType: MediaType } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stars = useMemo(() => [1, 2, 3, 4, 5], [])
  const reviewMediaList = existingReview?.mediaAssets ?? []
  const hasReviewMedia = reviewMediaList.length > 0

  function resetAlerts() {
    setError(null)
    setSuccess(null)
    setLimitNote(null)
  }

  // Cleanup
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      setPending((prev) => {
        prev.forEach((p) => {
          try {
            URL.revokeObjectURL(p.localUrl)
          } catch {}
        })
        return prev
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load appointment media options (only when creating a new review)
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!bookingId || hasReview) return
      try {
        const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/review-media-options`, {
          method: 'GET',
        })
        if (!res.ok) return
        const data = await safeJson(res)
        if (cancelled) return
        const items = Array.isArray(data?.items) ? (data.items as AppointmentMediaOption[]) : []
        setApptMedia(items)
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [bookingId, hasReview])

  const apptByPhase = useMemo(() => {
    const sorted = [...apptMedia].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return {
      before: sorted.filter((m) => m.phase === 'BEFORE'),
      after: sorted.filter((m) => m.phase === 'AFTER'),
      other: sorted.filter((m) => m.phase !== 'BEFORE' && m.phase !== 'AFTER'),
    }
  }, [apptMedia])

  function toggleApptMedia(id: string) {
    resetAlerts()
    setSelectedApptMediaIds((prev) => {
      const has = prev.includes(id)
      if (has) return prev.filter((x) => x !== id)
      if (prev.length >= APPT_SELECT_MAX) {
        setLimitNote(`You can add up to ${APPT_SELECT_MAX} appointment photos/videos to your review.`)
        return prev
      }
      return [...prev, id]
    })
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

  function removePending(id: string) {
    resetAlerts()
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id)
      if (hit?.localUrl) {
        try {
          URL.revokeObjectURL(hit.localUrl)
        } catch {}
      }
      return prev.filter((p) => p.id !== id)
    })
  }

  function onPickFiles(files: FileList | null) {
    resetAlerts()
    if (!files || files.length === 0) return

    const incoming = Array.from(files)
    const filtered = incoming.filter((f) => isImageFile(f) || isVideoFile(f))
    if (filtered.length === 0) {
      setError('Please select image or video files.')
      return
    }

    setPending((prev) => {
      const { images: curImages, videos: curVideos } = countCaps(prev)

      let imagesLeft = Math.max(0, MAX_IMAGES - curImages)
      let videosLeft = Math.max(0, MAX_VIDEOS - curVideos)

      const next: PendingUpload[] = []
      let rejected = 0

      for (const f of filtered) {
        const mediaType: MediaType = isVideoFile(f) ? 'VIDEO' : 'IMAGE'
        if (mediaType === 'VIDEO') {
          if (videosLeft <= 0) {
            rejected++
            continue
          }
          videosLeft -= 1
        } else {
          if (imagesLeft <= 0) {
            rejected++
            continue
          }
          imagesLeft -= 1
        }

        const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
        next.push({
          id,
          file: f,
          mediaType,
          localUrl: URL.createObjectURL(f),
          status: 'QUEUED',
          error: null,
          publicUrl: null,
        })
      }

      if (rejected > 0) {
        setLimitNote(`Limit is ${MAX_IMAGES} images + ${MAX_VIDEOS} video. Extra files weren’t added.`)
      }

      return [...prev, ...next]
    })
  }

  async function initSignedUpload(file: File) {
    const res = await fetch('/api/client/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'REVIEW_PUBLIC', contentType: file.type, size: file.size }),
    })

    if (res.status === 401) {
      redirectToLogin(router, 'login_required_review_upload')
      return { ok: false as const, handled: true as const }
    }

    const data = await safeJson(res)
    if (!res.ok) return { ok: false as const, error: errorFromResponse(res, data) }
    return { ok: true as const, data }
  }

  async function uploadQueued() {
    if (loading) return
    resetAlerts()

    const queue = pending.filter((p) => p.status === 'QUEUED' || p.status === 'ERROR')
    if (queue.length === 0) return

    setLoading(true)

    let sawError = false
    let uploadedAny = false

    try {
      for (const item of queue) {
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'UPLOADING', error: null } : p)))

        const init = await initSignedUpload(item.file)
        if (!init.ok) {
          sawError = true

          if ('handled' in init) return

          setPending((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: 'ERROR', error: init.error } : p)),
          )
          continue
        }

        const { bucket, path, token, publicUrl, cacheBuster } = init.data || {}

        const up = await (supabaseBrowser as any).storage
          .from(bucket)
          .uploadToSignedUrl(path, token, item.file, { contentType: item.file.type })
          .catch((e: any) => ({ data: null, error: e }))

        if (up?.error) {
          sawError = true
          setPending((prev) =>
            prev.map((p) =>
              p.id === item.id ? { ...p, status: 'ERROR', error: up.error?.message || 'Upload failed' } : p,
            ),
          )
          continue
        }

        uploadedAny = true

        const finalUrl =
          typeof publicUrl === 'string' && publicUrl
            ? `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}v=${Number(cacheBuster || Date.now())}`
            : null

        if (!finalUrl) sawError = true

        setPending((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: 'UPLOADED', publicUrl: finalUrl } : p)),
        )
      }

      if (uploadedAny && !sawError) {
        setSuccess('Uploads ready.')
      }
    } finally {
      setLoading(false)
    }
  }

  function pendingForSubmit() {
    return pending
      .filter((p) => p.status === 'UPLOADED' && typeof p.publicUrl === 'string' && p.publicUrl)
      .map((p) => ({ url: p.publicUrl as string, mediaType: p.mediaType }))
  }

  async function submitReview() {
    if (loading) return
    resetAlerts()

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }

    const hasNotUploaded = pending.some((p) => p.status === 'QUEUED' || p.status === 'UPLOADING')
    if (hasNotUploaded) {
      setError('Upload your queued files first (or remove them).')
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
            media: pendingForSubmit(),
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
      setPending((prev) => {
        prev.forEach((p) => {
          try {
            URL.revokeObjectURL(p.localUrl)
          } catch {}
        })
        return []
      })
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

    const hasNotUploaded = pending.some((p) => p.status === 'QUEUED' || p.status === 'UPLOADING')
    if (hasNotUploaded) {
      setError('Upload your queued files first (or remove them).')
      return
    }

    const media = pendingForSubmit()
    if (media.length === 0) {
      setError('Add at least one upload first.')
      return
    }

    setLoading(true)
    try {
      const result = await requestOrRedirect(
        `/api/client/reviews/${encodeURIComponent(existingReview.id)}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media }),
        },
        'login_required_review_add_media',
      )

      if (!result.ok) {
        if ('handled' in result) return
        setError(result.error)
        return
      }

      setSuccess('Media added.')
      setPending((prev) => {
        prev.forEach((p) => {
          try {
            URL.revokeObjectURL(p.localUrl)
          } catch {}
        })
        return []
      })
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

  const caps = countCaps(pending)

  function SelectedCountPill() {
    if (hasReview) return null
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
        Added to review: {selectedApptMediaIds.length}/{APPT_SELECT_MAX}
      </div>
    )
  }

  function ApptMediaGroup({ title, items }: { title: string; items: AppointmentMediaOption[] }) {
    if (!items.length) {
      return <div className="text-sm font-semibold text-textSecondary">No {title.toLowerCase()} media.</div>
    }

    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-black text-textPrimary">{title}</div>
          <SelectedCountPill />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((m) => {
            const selected = selectedApptMediaIds.includes(m.id)
            const thumb = m.thumbUrl || m.url
            const isVideo = m.mediaType === 'VIDEO'

            return (
              <div key={m.id} className="overflow-hidden rounded-card border border-white/10 bg-bgPrimary">
                <button
                  type="button"
                  onClick={() => setPreview({ url: m.url, mediaType: m.mediaType })}
                  className="block w-full bg-transparent p-0"
                  title="Preview"
                  disabled={loading}
                >
                  {isVideo ? (
                    <div className="flex h-36 items-center justify-center bg-bgSecondary text-xs font-black text-textSecondary">
                      VIDEO
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="Appointment media" className="block h-36 w-full object-cover" />
                  )}
                </button>

                <div className="p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-textSecondary">{phaseLabel(m.phase)}</div>

                    {!hasReview ? (
                      <button
                        type="button"
                        onClick={() => toggleApptMedia(m.id)}
                        disabled={loading}
                        className={tinyBtn(loading, selected)}
                        title={
                          selected
                            ? 'Remove from review (keeps it private between you + your pro)'
                            : 'Add to review (makes it public on your review)'
                        }
                      >
                        {selected ? 'Remove' : 'Add to review'}
                      </button>
                    ) : (
                      <div className="text-[11px] font-semibold text-textSecondary">Review already created</div>
                    )}
                  </div>

                  {!hasReview ? (
                    <div className="mt-2 text-[11px] font-semibold text-textSecondary">
                      {selected ? <>This will appear on your public review.</> : <>Not added → stays private between you + your pro.</>}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Preview modal */}
      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-9999 flex items-center justify-center bg-bgPrimary/70 p-4"
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
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black">{hasReview ? 'Your review' : 'Leave a review'}</div>
          {!hasReview ? <SelectedCountPill /> : null}
        </div>

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

        {/* Appointment media appears AGAIN on review screen */}
        {!hasReview ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="text-xs font-black">Your appointment photos (optional)</div>
            <div className="mt-1 text-xs font-semibold text-textSecondary">
              These are visible in your aftercare summary already. If you add them here, they’ll be shown on your public
              review. If you don’t, they stay private between you + your pro.
            </div>

            <div className="mt-4 grid gap-4">
              <ApptMediaGroup title="Before" items={apptByPhase.before} />
              <ApptMediaGroup title="After" items={apptByPhase.after} />
              {apptByPhase.other.length ? <ApptMediaGroup title="Other" items={apptByPhase.other} /> : null}
            </div>
          </div>
        ) : null}

        {/* Existing review media */}
        {hasReview ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="text-xs font-black">Media on your review</div>
            <div className="mt-1 text-xs font-semibold text-textSecondary">
              These are part of your public review. (Once attached, they can’t be removed.)
            </div>

            {reviewMediaList.length ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {reviewMediaList.map((m) => {
                  const thumb = m.thumbUrl || m.url
                  return (
                    <div key={m.id} className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
                      <button
                        type="button"
                        onClick={() => setPreview({ url: m.url, mediaType: m.mediaType })}
                        className="block w-full bg-transparent p-0"
                        title="Click to preview"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb} alt="Review media" className="block h-36 w-full object-cover" />
                      </button>
                      <div className="p-2 text-[11px] font-semibold text-textSecondary">Attached to your review</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-2 text-sm text-textSecondary">No media added yet.</div>
            )}
          </div>
        ) : null}

        {/* Upload picker + queue */}
        <div className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black">Upload new photos/videos for your review</div>
              <div className="mt-1 text-xs font-semibold text-textSecondary">
                Limit: {MAX_IMAGES} images + {MAX_VIDEOS} video.
              </div>
            </div>
            <div className="text-right text-xs font-semibold text-textSecondary">
              <div>{caps.images}/{MAX_IMAGES} images</div>
              <div>{caps.videos}/{MAX_VIDEOS} video</div>
            </div>
          </div>

          <input
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={loading}
            onChange={(e) => onPickFiles(e.target.files)}
            className="w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none file:mr-3 file:rounded-full file:border file:border-white/10 file:bg-bgPrimary file:px-3 file:py-2 file:text-xs file:font-black file:text-textPrimary"
          />

          {pending.length > 0 ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={uploadQueued} disabled={loading} className={btnPrimary(loading)}>
                  {loading ? 'Uploading…' : 'Upload queued files'}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  className={btnBase(loading)}
                  onClick={() => {
                    resetAlerts()
                    setPending((prev) => {
                      prev.forEach((p) => {
                        try {
                          URL.revokeObjectURL(p.localUrl)
                        } catch {}
                      })
                      return []
                    })
                  }}
                >
                  Clear queue
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {pending.map((p) => (
                  <div key={p.id} className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
                    <button
                      type="button"
                      onClick={() => setPreview({ url: p.localUrl, mediaType: p.mediaType })}
                      className="block w-full bg-transparent p-0"
                      title="Preview"
                    >
                      {p.mediaType === 'VIDEO' ? (
                        <div className="flex h-28 items-center justify-center bg-bgPrimary text-xs font-black text-textSecondary">
                          Video
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.localUrl} alt="Queued upload" className="block h-28 w-full object-cover" />
                      )}
                    </button>

                    <div className="flex items-center justify-between gap-2 p-2">
                      <div className="text-[11px] font-semibold text-textSecondary">
                        {p.status === 'UPLOADED'
                          ? 'Ready'
                          : p.status === 'UPLOADING'
                            ? 'Uploading…'
                            : p.status === 'ERROR'
                              ? 'Upload failed'
                              : 'Queued'}
                      </div>

                      <button
                        type="button"
                        onClick={() => removePending(p.id)}
                        disabled={loading || p.status === 'UPLOADING'}
                        className="rounded-full border border-white/10 bg-bgPrimary px-2 py-1 text-[11px] font-black text-textPrimary transition hover:bg-surfaceGlass disabled:cursor-not-allowed disabled:opacity-70"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>

                    {p.status === 'ERROR' && p.error ? (
                      <div className="px-2 pb-2 text-[11px] font-semibold text-microAccent">{p.error}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {limitNote ? <div className="text-sm font-semibold text-textSecondary">{limitNote}</div> : null}
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
                disabled={loading || pendingForSubmit().length === 0}
                onClick={addMediaToExistingReview}
                className={btnPrimary(loading || pendingForSubmit().length === 0)}
              >
                {loading ? 'Saving…' : 'Add uploaded media'}
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
