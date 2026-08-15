// app/client/(gated)/_components/SubmitViralLookForm.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import TovisEye from '@/lib/brand/TovisEye'
import { readErrorMessage, safeJsonRecord } from '@/lib/http'
import { compressImageForUpload } from '@/lib/media/processImageForUpload'
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/media/uploadLimits'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'

type UploadInit = {
  bucket: string
  path: string
  token: string
  publicUrl: string
}

function readUploadInit(data: Record<string, unknown> | null): UploadInit | null {
  if (!data) return null

  const bucket = typeof data.bucket === 'string' ? data.bucket : ''
  const path = typeof data.path === 'string' ? data.path : ''
  const token = typeof data.token === 'string' ? data.token : ''
  const publicUrl = typeof data.publicUrl === 'string' ? data.publicUrl : ''

  if (!bucket || !path || !token || !publicUrl) return null

  return { bucket, path, token, publicUrl }
}

/**
 * The server's own copy for anything the person can act on (a file that's too
 * big, an unsupported type), our copy for anything else.
 *
 * A 5xx body is written for whoever is on call, not for a client: the signing
 * route's 500s carry storage hostnames and provider detail straight through.
 */
function failureMessage(
  res: Response,
  body: Record<string, unknown> | null,
  fallback: string,
): string {
  if (res.status >= 500) return fallback
  return readErrorMessage(body) ?? fallback
}

function readCreatedRequestId(data: Record<string, unknown> | null): string | null {
  const request = data?.request
  if (typeof request !== 'object' || request === null) return null

  const id = (request as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : null
}

export default function SubmitViralLookForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // What a failed attempt already got done. The upload route needs a request id,
  // so the file can only go up AFTER the request exists — and if the upload then
  // fails, retrying must not submit the look a second time for an admin to
  // moderate twice. Refs, not state: a retry reads them in the same tick.
  const createdRequestIdRef = useRef<string | null>(null)
  const uploadedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function replaceFile(next: File | null) {
    setFile(next)
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return next ? URL.createObjectURL(next) : null
    })
    // A different file is a different upload — don't let it inherit the last
    // one's finished PUT.
    uploadedUrlRef.current = null
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    event.currentTarget.value = ''

    if (!picked) return

    const isImage = picked.type.startsWith('image/')
    const isVideo = picked.type.startsWith('video/')

    if (!isImage && !isVideo) {
      setError('Attach a photo or a video.')
      return
    }

    if (picked.size > UPLOAD_MAX_BYTES) {
      setError(`That file is over ${UPLOAD_MAX_LABEL}. Try a shorter clip.`)
      return
    }

    setError(null)
    replaceFile(picked)
  }

  /** Signed upload → PUT → persist. Resumes from whichever leg failed last. */
  async function attachFile(requestId: string, picked: File) {
    if (uploadedUrlRef.current === null) {
      const uploadFile = picked.type.startsWith('image/')
        ? await compressImageForUpload(picked)
        : picked

      const initRes = await fetch('/api/v1/viral-service-requests/upload', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          fileName: picked.name,
          contentType: uploadFile.type,
          size: uploadFile.size,
        }),
      })

      const initBody = await safeJsonRecord(initRes)
      const init = readUploadInit(initBody)

      if (!initRes.ok || !init) {
        throw new Error(
          failureMessage(
            initRes,
            initBody,
            'Couldn’t start the upload. Try again.',
          ),
        )
      }

      const { error: uploadError } = await uploadWithProgress({
        bucket: init.bucket,
        path: init.path,
        token: init.token,
        file: uploadFile,
        contentType: uploadFile.type || 'application/octet-stream',
        onProgress: () => {},
        signal: new AbortController().signal,
      })

      if (uploadError) throw new Error(uploadError)

      uploadedUrlRef.current = init.publicUrl
    }

    // The bytes being in the bucket is not the same as the request carrying
    // them — this is the write that puts the file in front of a reviewer.
    const persistRes = await fetch(
      `/api/v1/viral-service-requests/${encodeURIComponent(requestId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mediaUrl: uploadedUrlRef.current }),
      },
    )

    if (!persistRes.ok) {
      throw new Error(
        failureMessage(
          persistRes,
          await safeJsonRecord(persistRes),
          'Couldn’t attach your file. Try again.',
        ),
      )
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmedName = name.trim()
    const trimmedSourceUrl = sourceUrl.trim()

    setError(null)
    setNotice(null)

    if (!trimmedName && !createdRequestIdRef.current) {
      setError('Name the look so pros know what to match.')
      return
    }

    try {
      setSubmitting(true)

      if (createdRequestIdRef.current === null) {
        const res = await fetch('/api/v1/viral-service-requests', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: trimmedName,
            sourceUrl: trimmedSourceUrl || undefined,
          }),
        })

        const data = await safeJsonRecord(res)

        if (!res.ok) {
          throw new Error(
            failureMessage(res, data, 'Couldn’t submit your look. Try again.'),
          )
        }

        createdRequestIdRef.current = readCreatedRequestId(data)
      }

      const requestId = createdRequestIdRef.current
      const attachedFile = file

      if (attachedFile) {
        if (!requestId) {
          throw new Error(
            'Your look was submitted, but we couldn’t attach the file.',
          )
        }
        await attachFile(requestId, attachedFile)
      }

      createdRequestIdRef.current = null
      uploadedUrlRef.current = null
      setName('')
      setSourceUrl('')
      replaceFile(null)
      setNotice(
        attachedFile
          ? 'Submitted with your file — our team is reviewing it now.'
          : 'Submitted — our team is reviewing it now.',
      )
      router.refresh()
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error && submitError.message.trim()
          ? submitError.message
          : 'Couldn’t submit your look. Try again.'

      // Say which half survived. The look IS submitted at this point, so
      // "try again" without saying so would read as "nothing was saved".
      setError(
        createdRequestIdRef.current
          ? `${message} Your look is submitted — press Attach to try the file again.`
          : message,
      )
    } finally {
      setSubmitting(false)
    }
  }

  const attachOnly = createdRequestIdRef.current !== null
  const submitLabel = submitting
    ? attachOnly
      ? 'Attaching…'
      : 'Submitting…'
    : attachOnly
      ? 'Attach →'
      : 'Submit for review →'

  return (
    <div className="relative flex flex-col overflow-hidden rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[30px] -top-10 h-[150px] w-[150px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--iris) / 0.20), transparent 70%)',
        }}
      />
      <div className="relative flex flex-1 flex-col">
        <div className="mb-2.5 flex items-center gap-2">
          <TovisEye size={18} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
            Spotted a new one?
          </span>
        </div>
        <h3 className="mb-1.5 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
          Submit a viral look
        </h3>
        <p className="mb-3 text-[12.5px] leading-relaxed text-textSecondary">
          Paste the link and name it. Our team vets it and shares it with pros
          before it goes live.
        </p>

        {notice ? (
          <div className="mb-2.5 rounded-[12px] border border-terra/25 bg-terra/10 px-3.5 py-2.5 text-[12px] font-semibold text-terra">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mb-2.5 rounded-[12px] border border-toneDanger/25 bg-toneDanger/10 px-3.5 py-2.5 text-[12px] font-semibold text-toneDanger">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <label className="mb-2.5 flex items-center gap-2.5 rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3 py-[11px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-textMuted">
              <path d="M9 15l6-6" />
              <path d="M11 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
              <path d="M13 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
            </svg>
            <input
              type="url"
              name="sourceUrl"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              disabled={submitting || attachOnly}
              placeholder="Paste TikTok / Instagram / Pinterest link…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-textPrimary outline-none placeholder:text-textMuted/70 disabled:opacity-60"
            />
          </label>
          <label className="mb-2.5 flex items-center gap-2.5 rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3 py-[11px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-textMuted">
              {/* Tag — this field names the look. (It used to be a trash can.) */}
              <path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8.5 8.5a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 12.2a1 1 0 0 1-.3-.7Z" />
              <path d="M7.5 7.5h.01" />
            </svg>
            <input
              type="text"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting || attachOnly}
              maxLength={160}
              placeholder="Name this look…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-textPrimary outline-none placeholder:text-textMuted/70 disabled:opacity-60"
            />
          </label>

          <input
            ref={fileInputRef}
            type="file"
            name="media"
            aria-label="Add a photo or video"
            accept="image/*,video/*"
            className="hidden"
            disabled={submitting}
            onChange={handleFileChange}
          />

          {file && previewUrl ? (
            <div className="mb-3 flex items-center gap-2.5 rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] p-2">
              <div className="grid h-[46px] w-[46px] shrink-0 place-items-center overflow-hidden rounded-[9px] bg-bgPrimary">
                {file.type.startsWith('video/') ? (
                  <video
                    src={previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  // A local object URL, never a remote one — the shared
                  // RemoteImage convention doesn't apply to a blob preview.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-textPrimary">
                  {file.name}
                </div>
                <div className="text-[11px] text-textMuted">
                  Only our team sees this while they review it.
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => replaceFile(null)}
                className="shrink-0 rounded-full border border-textPrimary/10 px-2.5 py-1 text-[11px] font-semibold text-textMuted transition hover:text-textPrimary disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
              className="mb-3 flex items-center justify-center gap-2 rounded-[12px] border border-dashed border-textPrimary/15 px-3 py-[11px] text-[12.5px] font-semibold text-textSecondary transition hover:text-textPrimary disabled:opacity-60"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-textMuted">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Add a photo or video
            </button>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-auto flex h-11 items-center justify-center rounded-[13px] bg-cta font-display text-[13.5px] font-bold text-onCta transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  )
}
