// app/pro/bookings/[id]/session/MediaUploader.tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type Phase = 'BEFORE' | 'AFTER' | 'OTHER'
type MediaType = 'IMAGE' | 'VIDEO'

type UploadState = 'IDLE' | 'UPLOADING' | 'SAVING'

const MAX_IMAGE_MB = 25
const MAX_VIDEO_MB = 200
const CAPTION_MAX = 300

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function extFromFile(file: File) {
  const name = (file.name || '').trim()
  const i = name.lastIndexOf('.')
  if (i === -1) return null
  const ext = name.slice(i + 1).toLowerCase()
  return ext || null
}

function guessMediaType(file: File): MediaType {
  const t = (file.type || '').toLowerCase()
  if (t.startsWith('video/')) return 'VIDEO'
  return 'IMAGE'
}

function bytesFromMb(mb: number) {
  return mb * 1024 * 1024
}

function safeFileNameStem(file: File) {
  const base = (file.name || 'upload').replace(/\.[^/.]+$/, '')
  return base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'upload'
}

function makeObjectPath(opts: {
  bookingId: string
  phase: Phase
  mediaType: MediaType
  originalExt: string | null
  fileStem: string
}) {
  const ext =
    opts.originalExt ||
    (opts.mediaType === 'VIDEO' ? 'mp4' : 'jpg') // best-effort default

  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const ts = String(now.getTime())

  // Example:
  // bookings/<bookingId>/after/2026/02/08/170742...-blowout.jpg
  return [
    'bookings',
    opts.bookingId,
    opts.phase.toLowerCase(),
    yyyy,
    mm,
    dd,
    `${ts}-${opts.fileStem}.${ext}`,
  ].join('/')
}

async function createLocalPreview(file: File): Promise<string | null> {
  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

/**
 * Optional: create an image thumbnail client-side.
 * We keep it disabled by default to avoid adding fragility.
 * Later we can enable this and upload to thumbBucket/thumbPath.
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

    if (!next) return

    // auto-detect type
    const inferred = guessMediaType(next)
    setMediaType(inferred)

    // preview for images/videos
    const p = await createLocalPreview(next)
    setPreviewUrl(p)
  }

  async function submit() {
    if (!canSubmit || !file || disabled) return
    resetMessages()

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const cap = caption.trim().slice(0, CAPTION_MAX) || null
    const mt: MediaType = mediaType
    const bucket = 'media-private' // session capture is private by policy

    try {
      setStatus('UPLOADING')

      const path = makeObjectPath({
        bookingId,
        phase,
        mediaType: mt,
        originalExt: extFromFile(file),
        fileStem: safeFileNameStem(file),
      })

      // Upload main file
      const uploadRes = await supabaseBrowser.storage.from(bucket).upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      })

      if (uploadRes.error) {
        // If file already exists, user probably double-clicked.
        const msg = uploadRes.error.message || 'Upload failed.'
        setError(msg)
        setStatus('IDLE')
        return
      }

      // Optional thumb for images (currently disabled)
      let thumbBucket: string | null = null
      let thumbPath: string | null = null

      if (mt === 'IMAGE') {
        const thumbBlob = await maybeCreateImageThumb(file)
        if (thumbBlob) {
          thumbBucket = bucket
          thumbPath = path.replace(/(\.[a-z0-9]+)$/i, '') + '-thumb.jpg'

          const thumbRes = await supabaseBrowser.storage.from(thumbBucket).upload(thumbPath, thumbBlob, {
            upsert: false,
            contentType: 'image/jpeg',
          })

          if (thumbRes.error) {
            // Thumb failure should not block main upload; just omit thumb fields.
            thumbBucket = null
            thumbPath = null
          }
        }
      }

      setStatus('SAVING')

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          // ✅ canonical storage identity (Prisma requires these)
          storageBucket: bucket,
          storagePath: path,
          thumbBucket,
          thumbPath,

          // ✅ metadata
          caption: cap,
          mediaType: upper(mt),
          phase: upper(phase),
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
        {/* File picker */}
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

        {/* Preview */}
        {previewUrl ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-2">
            {mediaType === 'VIDEO' ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={previewUrl} controls className="block h-56 w-full rounded-card object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="block h-56 w-full rounded-card object-cover" />
            )}
          </div>
        ) : null}

        {/* Type (override) */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-black text-textSecondary">Type</label>
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
              disabled={disabled}
              className={select}
            >
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div className="text-[11px] font-semibold text-textSecondary">
            Limits: {mediaType === 'VIDEO' ? `${MAX_VIDEO_MB}MB video` : `${MAX_IMAGE_MB}MB image`}
          </div>
        </div>

        {/* Caption */}
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

        {/* Actions */}
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
