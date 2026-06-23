// app/pro/bookings/[id]/session/MediaUploader.tsx
'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import MediaFill from '@/app/_components/media/MediaFill'
import MediaLoading from '@/app/_components/media/MediaLoading'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import {
  processImageForUpload,
  formatBytes,
} from '@/lib/media/processImageForUpload'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'

type Phase = 'BEFORE' | 'AFTER' | 'OTHER'
type MediaType = 'IMAGE' | 'VIDEO'
type UploadState = 'IDLE' | 'COMPRESSING' | 'UPLOADING' | 'SAVING'

// The signing route (app/api/pro/uploads) hard-caps any single upload at 30MB.
// Videos upload as-is, so their source ceiling must match the server. Images
// are downscaled + compressed below COMPRESS_MAX_BYTES before upload, so we
// accept a generous source file and let compression bring it under the cap.
const SERVER_MAX_MB = 30
const SERVER_MAX_BYTES = SERVER_MAX_MB * 1024 * 1024
const MAX_VIDEO_MB = SERVER_MAX_MB
const MAX_IMAGE_SOURCE_MB = 75
const CAPTION_MAX = 300

const COMPRESS_MAX_DIMENSION = 2000
const COMPRESS_MAX_BYTES = 25 * 1024 * 1024

type SignedUploadResponse = {
  ok: true
  kind: string
  bucket: string
  path: string
  token: string
  signedUrl: string | null
  publicUrl: string | null
  isPublic: boolean | null
  cacheBuster: number | null
  uploadSessionId: string | null
}

function errorFrom(res: Response, data: unknown): string {
  if (isRecord(data)) {
    const message = pickString(data.message)
    if (message) return message

    const error = pickString(data.error)
    if (error) return error
  }

  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function guessMediaType(file: File): MediaType {
  const type = file.type.toLowerCase()
  return type.startsWith('video/') ? 'VIDEO' : 'IMAGE'
}

function parseMediaType(value: string): MediaType {
  return value === 'VIDEO' ? 'VIDEO' : 'IMAGE'
}

function readBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readSignedUploadResponse(value: unknown): SignedUploadResponse | null {
  if (!isRecord(value)) return null

  const ok = value.ok === true
  const kind = pickString(value.kind)
  const bucket = pickString(value.bucket)
  const path = pickString(value.path)
  const token = pickString(value.token)

  if (!ok || !kind || !bucket || !path || !token) {
    return null
  }

  return {
    ok,
    kind,
    bucket,
    path,
    token,
    signedUrl: pickString(value.signedUrl),
    publicUrl: pickString(value.publicUrl),
    isPublic: readBooleanOrNull(value.isPublic),
    cacheBuster: readNumberOrNull(value.cacheBuster),
    uploadSessionId: pickString(value.uploadSessionId),
  }
}

function bytesFromMb(mb: number): number {
  return mb * 1024 * 1024
}

function statusLabel(status: UploadState, uploadPercent: number): string {
  switch (status) {
    case 'COMPRESSING':
      return 'Compressing…'
    case 'UPLOADING':
      return uploadPercent > 0
        ? `Uploading ${uploadPercent}%`
        : 'Uploading…'
    case 'SAVING':
      return 'Saving…'
    default:
      return 'Upload'
  }
}

export default function MediaUploader({
  bookingId,
  phase,
}: {
  bookingId: string
  phase: Phase
}) {
  const router = useRouter()
  const [isRefreshing, startRefreshTransition] = useTransition()

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')

  const [status, setStatus] = useState<UploadState>('IDLE')
  const [uploadPercent, setUploadPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [compressionNote, setCompressionNote] = useState<string | null>(null)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pendingClearRef = useRef(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const disabled = status !== 'IDLE'

  useEffect(() => {
    return () => {
      if (!previewUrl) return

      try {
        URL.revokeObjectURL(previewUrl)
      } catch {
        // Ignore cleanup failure.
      }
    }
  }, [previewUrl])

  // Abort any in-flight upload if the uploader unmounts mid-flow.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isRefreshing && pendingClearRef.current) {
      pendingClearRef.current = false
      setCaption('')
      void onPickFile(null)
    }
  }, [isRefreshing])

  const maxBytes = useMemo(() => {
    return mediaType === 'VIDEO'
      ? bytesFromMb(MAX_VIDEO_MB)
      : bytesFromMb(MAX_IMAGE_SOURCE_MB)
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
    setCompressionNote(null)
    setUploadPercent(0)
  }

  async function onPickFile(next: File | null) {
    resetMessages()

    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl)
      } catch {
        // Ignore cleanup failure.
      }

      setPreviewUrl(null)
    }

    setFile(next)

    if (!next) {
      setMediaType('IMAGE')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    const inferred = guessMediaType(next)
    setMediaType(inferred)

    try {
      setPreviewUrl(URL.createObjectURL(next))
    } catch {
      setPreviewUrl(null)
    }

    // Auto-upload: the salon footer flow should be one tap, so kick off the
    // pipeline the moment a file is chosen. Skip files we can't upload
    // (empty or over-limit) — they stay selected and the hint explains why.
    const limit =
      inferred === 'VIDEO'
        ? bytesFromMb(MAX_VIDEO_MB)
        : bytesFromMb(MAX_IMAGE_SOURCE_MB)

    if (bookingId && next.size > 0 && next.size <= limit) {
      void runUpload(next, inferred)
    }
  }

  async function runUpload(uploadTarget: File, mt: MediaType) {
    if (disabled || !bookingId) return
    if (uploadTarget.size <= 0) return

    const limit =
      mt === 'VIDEO'
        ? bytesFromMb(MAX_VIDEO_MB)
        : bytesFromMb(MAX_IMAGE_SOURCE_MB)
    if (uploadTarget.size > limit) return

    resetMessages()

    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller

    const cap = caption.trim().slice(0, CAPTION_MAX) || null

    try {
      let uploadFile: File = uploadTarget

      if (mt === 'IMAGE') {
        setStatus('COMPRESSING')

        try {
          const result = await processImageForUpload(uploadTarget, {
            maxBytes: COMPRESS_MAX_BYTES,
            maxWidth: COMPRESS_MAX_DIMENSION,
            maxHeight: COMPRESS_MAX_DIMENSION,
            outputMimeType: 'image/jpeg',
          })

          uploadFile = result.file

          if (result.processedBytes < result.originalBytes) {
            setCompressionNote(
              `${formatBytes(result.originalBytes)} → ${formatBytes(result.processedBytes)}`,
            )
          }
        } catch {
          uploadFile = uploadTarget
        }
      }

      // The signing route rejects anything over SERVER_MAX_BYTES. Images are
      // normally compressed well under it; this guards the rare case where
      // compression failed (we kept the original) or a video exceeds the cap,
      // surfacing a clear message instead of an opaque server 400.
      if (uploadFile.size > SERVER_MAX_BYTES) {
        const mb = (uploadFile.size / (1024 * 1024)).toFixed(1)
        setError(`That file is ${mb}MB — over the ${SERVER_MAX_MB}MB limit.`)
        setStatus('IDLE')
        return
      }

      setStatus('UPLOADING')
      setUploadPercent(0)

      const signRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          kind: 'CONSULT_PRIVATE',
          bookingId,
          phase,
          contentType: uploadFile.type || 'application/octet-stream',
          size: uploadFile.size,
        }),
      })

      const signDataUnknown: unknown = await safeJson(signRes)

      if (!signRes.ok) {
        setError(errorFrom(signRes, signDataUnknown))
        setStatus('IDLE')
        return
      }

      const signData = readSignedUploadResponse(signDataUnknown)

      if (!signData) {
        setError('Upload signing failed (missing bucket/path/token).')
        setStatus('IDLE')
        return
      }

      const uploadResult = await uploadWithProgress({
        bucket: signData.bucket,
        path: signData.path,
        token: signData.token,
        file: uploadFile,
        contentType: uploadFile.type || 'application/octet-stream',
        onProgress: setUploadPercent,
        signal: controller.signal,
      })

      if (uploadResult.error) {
        setError(uploadResult.error)
        setStatus('IDLE')
        return
      }

      setStatus('SAVING')

      // Key on the signed storage path, which is unique per uploaded object.
      // The commit body includes this path, so the server hashes it into the
      // request fingerprint — a deterministic key scoped only to
      // booking+phase+type would collide (different path, same key) the moment
      // a second photo is uploaded for the same booking, surfacing as a
      // "different request body" conflict. A genuine retry of the *same* commit
      // reuses the same path and still dedupes correctly.
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-media',
        entityId: bookingId,
        action: `${phase}-${mt}`,
        nonce: signData.path,
      })

      const res = await fetch(
        `/api/pro/bookings/${encodeURIComponent(bookingId)}/media`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          signal: controller.signal,
          body: JSON.stringify({
            uploadSessionId: signData.uploadSessionId,
            caption: cap,
            mediaType: mt,
            phase,
          }),
        },
      )

      const data: unknown = await safeJson(res)

      if (!res.ok) {
        setError(errorFrom(res, data))
        setStatus('IDLE')
        return
      }

      setMessage('Uploaded')

      pendingClearRef.current = true
      startRefreshTransition(() => {
        router.refresh()
      })
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        return
      }

      console.error(caught)
      setError('Network error. Try again.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }

      setStatus('IDLE')
    }
  }

  const shell =
    'rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary'
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
    if (!file) {
      return `Choose a ${phase.toLowerCase()} photo — it uploads automatically.`
    }

    if (file.size > maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      const limit = mediaType === 'VIDEO' ? MAX_VIDEO_MB : MAX_IMAGE_SOURCE_MB
      return `That file is ${mb}MB — over the ${limit}MB limit.`
    }

    return 'Stored privately for you and the client.'
  })()

  const showProgress = status === 'UPLOADING' || status === 'COMPRESSING' || status === 'SAVING'

  return (
    <div className={shell}>
      <div className="text-xs font-semibold text-textSecondary">
        Upload {phase.toLowerCase()} media (stored privately). The client can
        only &ldquo;release&rdquo; media by attaching it to a review.
      </div>

      <div className="mt-3 grid gap-3">
        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">
            File
          </label>

          <input
            ref={fileRef}
            type="file"
            disabled={disabled}
            accept="image/*,video/*"
            aria-label={`Upload ${phase.toLowerCase()} media`}
            onChange={(event) =>
              void onPickFile(event.target.files?.[0] ?? null)
            }
            className="block w-full text-sm text-textSecondary file:mr-3 file:rounded-full file:border file:border-white/10 file:bg-bgPrimary file:px-4 file:py-2 file:text-xs file:font-black file:text-textPrimary hover:file:bg-surfaceGlass"
          />

          <div className="mt-2 text-[11px] font-semibold text-textSecondary">
            {hint}
          </div>
        </div>

        {previewUrl ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-2">
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-card border border-white/10 bg-black">
              {showProgress ? (
                <MediaLoading
                  className="absolute inset-0"
                  percent={
                    status === 'SAVING'
                      ? 100
                      : status === 'UPLOADING' && uploadPercent > 0
                        ? uploadPercent
                        : null
                  }
                  label={statusLabel(status, uploadPercent)}
                />
              ) : (
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
              )}
            </div>

            {message ? (
              <div className="mt-2 text-center text-[11px] font-black text-textPrimary">
                {message}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-black text-textSecondary">
              Type
            </label>

            <select
              value={mediaType}
              onChange={(event) =>
                setMediaType(parseMediaType(event.target.value))
              }
              disabled={disabled || Boolean(file)}
              className={cn(select, Boolean(file) ? 'opacity-70' : '')}
              title={file ? 'Type is inferred from the selected file.' : undefined}
            >
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>

          <div className="text-[11px] font-semibold text-textSecondary">
            Limits:{' '}
            {mediaType === 'VIDEO'
              ? `${MAX_VIDEO_MB}MB video`
              : 'Images are compressed automatically'}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-black text-textSecondary">
            Caption (optional)
          </label>

          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
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
          {error && file && !disabled ? (
            <button
              type="button"
              onClick={() => void runUpload(file, mediaType)}
              disabled={!canSubmit}
              className={btn}
            >
              Retry upload
            </button>
          ) : null}

          {showProgress ? (
            <span
              className="text-xs font-black text-textPrimary"
              aria-live="polite"
            >
              {statusLabel(status, uploadPercent)}
            </span>
          ) : null}

          {compressionNote ? (
            <span className="text-[10px] font-semibold text-textSecondary">
              {compressionNote}
            </span>
          ) : null}

          {!previewUrl && message ? (
            <span className="text-xs font-black text-textPrimary">
              {message}
            </span>
          ) : null}

          {error ? (
            <span className="text-xs font-black text-microAccent">
              {error}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
