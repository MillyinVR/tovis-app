// app/pro/bookings/[id]/session/MediaUploader.tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Phase = 'BEFORE' | 'AFTER' | 'OTHER'
type MediaType = 'IMAGE' | 'VIDEO'
type Visibility = 'PUBLIC' | 'PRIVATE'

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function upper(v: string) {
  return v.trim().toUpperCase()
}

export default function MediaUploader({ bookingId, phase }: { bookingId: string; phase: Phase }) {
  const router = useRouter()

  const [url, setUrl] = useState('')
  const [thumbUrl, setThumbUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC')
  const [eligible, setEligible] = useState(false)
  const [featured, setFeatured] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const canSubmit = useMemo(() => {
    const u = url.trim()
    return Boolean(bookingId && u.length > 10 && (u.startsWith('http://') || u.startsWith('https://')))
  }, [bookingId, url])

  async function submit() {
    if (!canSubmit || loading) return
    setError(null)
    setMessage(null)
    setLoading(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          url: url.trim(),
          thumbUrl: thumbUrl.trim() || null,
          caption: caption.trim() || null,
          mediaType: upper(mediaType),
          visibility: upper(visibility),
          phase: upper(phase),
          isEligibleForLooks: Boolean(eligible),
          isFeaturedInPortfolio: Boolean(featured),
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFrom(res, data))
        return
      }

      setMessage('Added.')
      setUrl('')
      setThumbUrl('')
      setCaption('')
      setEligible(false)
      setFeatured(false)

      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError('Network error. Try again.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none focus:border-white/20'

  const selectClass =
    'rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary outline-none focus:border-white/20'

  const btnClass = [
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black transition',
    canSubmit && !loading
      ? 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60',
  ].join(' ')

  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">
      <div className="text-xs font-semibold text-textSecondary">
        Temporary uploader: paste a hosted URL (real uploads next).
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">Media URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={loading} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">Thumb URL (optional)</label>
          <input value={thumbUrl} onChange={(e) => setThumbUrl(e.target.value)} placeholder="https://…" disabled={loading} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">Caption (optional)</label>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Before: grown-out blonde" disabled={loading} className={inputClass} />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1 block text-xs font-black text-textSecondary">Type</label>
            <select value={mediaType} onChange={(e) => setMediaType(e.target.value as any)} disabled={loading} className={selectClass}>
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-black text-textSecondary">Visibility</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)} disabled={loading} className={selectClass}>
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </select>
          </div>

          <label className="mt-6 flex items-center gap-2 text-xs font-semibold text-textPrimary">
            <input type="checkbox" checked={eligible} disabled={loading} onChange={(e) => setEligible(e.target.checked)} />
            Eligible for Looks
          </label>

          <label className="mt-6 flex items-center gap-2 text-xs font-semibold text-textPrimary">
            <input type="checkbox" checked={featured} disabled={loading} onChange={(e) => setFeatured(e.target.checked)} />
            Featured in portfolio
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={!canSubmit || loading} className={btnClass}>
            {loading ? 'Adding…' : 'Add media'}
          </button>

          {message ? <span className="text-xs font-black text-textPrimary">{message}</span> : null}
          {error ? <span className="text-xs font-black text-microAccent">{error}</span> : null}
        </div>
      </div>
    </div>
  )
}
