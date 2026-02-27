// app/pro/bookings/[id]/session/MediaUploader.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import MediaFill from '@/app/_components/media/MediaFill'

type Phase = 'BEFORE' | 'AFTER' | 'OTHER'
type MediaType = 'IMAGE' | 'VIDEO'
type UploadState = 'IDLE' | 'UPLOADING' | 'SAVING'

const MAX_IMAGE_MB = 25
const MAX_VIDEO_MB = 200
const CAPTION_MAX = 300

type SignedUploadResponse = {
  ok: true
  kind: string
  bucket: string
  path: string
  token: string
  signedUrl?: string | null
  publicUrl?: string | null
  isPublic?: boolean
  cacheBuster?: number
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.message === 'string' && data.message.trim()) return data.message
  if (typeof data?.error === 'string' && data.error.trim()) return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function guessMediaType(file: File): MediaType {
  const t = (file.type || '').toLowerCase()
  return t.startsWith('video/') ? 'VIDEO' : 'IMAGE'
}

function bytesFromMb(mb: number) {
  return mb * 1024 * 1024
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/**
 * Optional: create an image thumbnail client-side.
 * Disabled by default to avoid fragility.
 */
async function maybeCreateImageThumb(_file: File): Promise<Blob | null> {
  return null
}

export default function MediaUploader({ bookingId, phase }: { bookingId: string; phase: Phase }) {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')

  const [status, setStatus] = useState<UploadState>('IDLE')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const disabled = status !== 'IDLE'

  // Clean up preview URL on unmount or when it changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        try {
          URL.revokeObjectURL(previewUrl)
        } catch {}
      }
    }
  }, [previewUrl])

  const maxBytes = useMemo(() => {
    return mediaType === 'VIDEO' ? bytesFromMb(MAX_VIDEO_MB) : bytesFromMb(MAX_IMAGE_MB)
  }, [mediaType])

  const canSubmit = useMemo(() => {
    if (!bookingId) return false
    if (!file) return false
    if (file.size <= 0) return false
    if (file.size > maxBytes) return false
    return true
  }, [bookingId, file, maxBytes])

  function resetMessages() {
    setError(null)
    setMessage(null)
  }

  async function onPickFile(next: File | null) {
    resetMessages()

    // cleanup previous preview
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl)
      } catch {}
      setPreviewUrl(null)
    }

    setFile(next)

    if (!next) {
      setMediaType('IMAGE')
      return
    }

    // ✅ lock mediaType to what the file actually is
    const inferred = guessMediaType(next)
    setMediaType(inferred)

    try {
      const p = URL.createObjectURL(next)
      setPreviewUrl(p)
    } catch {
      setPreviewUrl(null)
    }
  }

  async function submit() {
    if (!canSubmit || !file || disabled) return
    resetMessages()

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const cap = caption.trim().slice(0, CAPTION_MAX) || null
    const mt: MediaType = mediaType

    try {
      setStatus('UPLOADING')

      // 1) Ask server for a signed upload token (booking-scoped, private)
      const signRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          kind: 'CONSULT_PRIVATE',
          bookingId,
          phase, // BEFORE/AFTER/OTHER
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      })

      const signData = (await safeJson(signRes)) as Partial<SignedUploadResponse>
      if (!signRes.ok) {
        setError(errorFrom(signRes, signData))
        setStatus('IDLE')
        return
      }

      const bucket = String(signData.bucket || '')
      const path = String(signData.path || '')
      const token = String(signData.token || '')

      if (!bucket || !path || !token) {
        setError('Upload signing failed (missing bucket/path/token).')
        setStatus('IDLE')
        return
      }

      // 2) Upload to Supabase using the signed token (avoids Storage RLS issues)
      const uploadRes = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, {
        upsert: false,
        contentType: file.type || undefined,
      })

      if (uploadRes.error) {
        setError(uploadRes.error.message || 'Upload failed.')
        setStatus('IDLE')
        return
      }

      // Optional thumb for images (still disabled)
      let thumbBucket: string | null = null
      let thumbPath: string | null = null

      if (mt === 'IMAGE') {
        const thumbBlob = await maybeCreateImageThumb(file)
        if (thumbBlob) {
          // If you enable thumbs later, you should request a second signed token
          // for the thumb path instead of uploading directly.
          thumbBucket = null
          thumbPath = null
        }
      }

      setStatus('SAVING')

      // 3) Save DB record (server route verifies ownership + flow rules)
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          storageBucket: bucket,
          storagePath: path,
          thumbBucket,
          thumbPath,
          caption: cap,
          mediaType: mt, // ✅ already correct union
          phase, // ✅ already correct union
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFrom(res, data))
        setStatus('IDLE')
        return
      }

      setMessage('Uploaded ✅')
      setCaption('')
      await onPickFile(null)

      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error(e)
      setError('Network error. Try again.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setStatus('IDLE')
    }
  }

  const shell = 'rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary'
  const input =
    'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none focus:border-white/20'
  const select =
    'rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary outline-none focus:border-white/20'

  const btn = [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    canSubmit && !disabled
      ? 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60',
  ].join(' ')

  const hint = (() => {
    if (!file) return `Choose a ${phase.toLowerCase()} file to upload.`
    if (file.size > maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      const limit = mediaType === 'VIDEO' ? MAX_VIDEO_MB : MAX_IMAGE_MB
      return `That file is ${mb}MB — over the ${limit}MB limit.`
    }
    return `Ready to upload to private storage.`
  })()

  return (
    <div className={shell}>
      <div className="text-xs font-semibold text-textSecondary">
        Upload {phase.toLowerCase()} media (stored privately). The client can only “release” media by attaching it to a review.
      </div>

      <div className="mt-3 grid gap-3">
        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">File</label>
          <input
            type="file"
            disabled={disabled}
            accept="image/*,video/*"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-textSecondary file:mr-3 file:rounded-full file:border file:border-white/10 file:bg-bgPrimary file:px-4 file:py-2 file:text-xs file:font-black file:text-textPrimary hover:file:bg-surfaceGlass"
          />
          <div className="mt-2 text-[11px] font-semibold text-textSecondary">{hint}</div>
        </div>

        {previewUrl ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-2">
            {/* ✅ Consistent sizing everywhere: 9:16 frame + MediaFill */}
            <div className="relative w-full overflow-hidden rounded-card border border-white/10 bg-black aspect-[9/16]">
              <MediaFill
                src={previewUrl}
                mediaType={mediaType}
                alt="Preview"
                fit="cover"
                className="absolute inset-0 h-full w-full"
                videoProps={{
                  controls: true,
                  playsInline: true,
                  preload: 'metadata',
                  muted: false,
                }}
                imgProps={{
                  draggable: false,
                  loading: 'eager',
                  decoding: 'async',
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-black text-textSecondary">Type</label>
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
              disabled={disabled || Boolean(file)} // ✅ lock once chosen
              className={cx(select, Boolean(file) ? 'opacity-70' : '')}
              title={file ? 'Type is inferred from the selected file.' : undefined}
            >
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div className="text-[11px] font-semibold text-textSecondary">
            Limits: {mediaType === 'VIDEO' ? `${MAX_VIDEO_MB}MB video` : `${MAX_IMAGE_MB}MB image`}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">Caption (optional)</label>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={CAPTION_MAX}
            placeholder="e.g. After: blended caramel, face-framing"
            disabled={disabled}
            className={input}
          />
          <div className="mt-1 text-[11px] font-semibold text-textSecondary">
            {caption.trim().length}/{CAPTION_MAX}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={!canSubmit || disabled} className={btn}>
            {status === 'UPLOADING' ? 'Uploading…' : status === 'SAVING' ? 'Saving…' : 'Upload'}
          </button>

          {message ? <span className="text-xs font-black text-textPrimary">{message}</span> : null}
          {error ? <span className="text-xs font-black text-microAccent">{error}</span> : null}
        </div>
      </div>
    </div>
  )
}