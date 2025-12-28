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

export default function MediaUploader({
  bookingId,
  phase,
}: {
  bookingId: string
  phase: Phase
}) {
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
    return Boolean(
      bookingId &&
        u.length > 10 &&
        (u.startsWith('http://') || u.startsWith('https://')),
    )
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

  return (
    <div
      style={{
        border: '1px solid #eee',
        background: '#fff',
        borderRadius: 12,
        padding: 14,
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Temporary uploader: paste a hosted URL (real uploads next).
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
          Media URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={loading}
          style={{
            width: '100%',
            borderRadius: 10,
            border: '1px solid #ddd',
            padding: '10px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
          Thumb URL (optional)
        </label>
        <input
          value={thumbUrl}
          onChange={(e) => setThumbUrl(e.target.value)}
          placeholder="https://…"
          disabled={loading}
          style={{
            width: '100%',
            borderRadius: 10,
            border: '1px solid #ddd',
            padding: '10px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
          Caption (optional)
        </label>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="e.g. Before: grown-out blonde"
          disabled={loading}
          style={{
            width: '100%',
            borderRadius: 10,
            border: '1px solid #ddd',
            padding: '10px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
            Type
          </label>
          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value as any)}
            disabled={loading}
            style={{ borderRadius: 10, border: '1px solid #ddd', padding: '10px 10px', fontSize: 13 }}
          >
            <option value="IMAGE">Image</option>
            <option value="VIDEO">Video</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
            Visibility
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as any)}
            disabled={loading}
            style={{ borderRadius: 10, border: '1px solid #ddd', padding: '10px 10px', fontSize: 13 }}
          >
            <option value="PUBLIC">Public</option>
            <option value="PRIVATE">Private</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 22 }}>
          <input
            type="checkbox"
            checked={eligible}
            disabled={loading}
            onChange={(e) => setEligible(e.target.checked)}
          />
          Eligible for Looks
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 22 }}>
          <input
            type="checkbox"
            checked={featured}
            disabled={loading}
            onChange={(e) => setFeatured(e.target.checked)}
          />
          Featured in portfolio
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || loading}
          style={{
            border: '1px solid #111',
            background: !canSubmit || loading ? '#374151' : '#111',
            color: '#fff',
            borderRadius: 999,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 900,
            cursor: !canSubmit || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Adding…' : 'Add media'}
        </button>

        {message ? <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 900 }}>{message}</span> : null}
        {error ? <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 900 }}>{error}</span> : null}
      </div>
    </div>
  )
}
