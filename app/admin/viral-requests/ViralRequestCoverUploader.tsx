'use client'

// Sets the picture a viral look is published under.
//
// Uses the FINALIZE branch of /api/v1/admin/uploads rather than the
// upload-then-save-with-the-form dance the service editor does: a queue row has
// no form to save, so the server commits the URL and writes the audit entry in
// the same round-trip. Same signed-upload mechanics either way.

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'
import { compressImageForUpload } from '@/lib/media/processImageForUpload'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'

type UploadInitOk = {
  bucket: string
  path: string
  token: string
  publicUrl: string
  cacheBuster?: number
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseUploadInit(value: unknown): UploadInitOk | null {
  if (!isRecordValue(value) || value.ok !== true) return null

  const bucket = typeof value.bucket === 'string' ? value.bucket : ''
  const path = typeof value.path === 'string' ? value.path : ''
  const token = typeof value.token === 'string' ? value.token : ''
  const publicUrl = typeof value.publicUrl === 'string' ? value.publicUrl : ''
  const cacheBuster =
    typeof value.cacheBuster === 'number' && Number.isFinite(value.cacheBuster)
      ? value.cacheBuster
      : undefined

  if (!bucket || !path || !token || !publicUrl) return null
  return { bucket, path, token, publicUrl, cacheBuster }
}

export default function ViralRequestCoverUploader({
  requestId,
  hasCover,
}: {
  requestId: string
  /** True only when a REVIEWER has set one — a submitter's photo is not "set". */
  hasCover: boolean
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const commit = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch('/api/v1/admin/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? `Save failed (${res.status}).`)
      }
      return raw
    },
    [],
  )

  const upload = useCallback(
    async (file: File) => {
      setBusy(true)
      setErr(null)
      try {
        if (!file.type.startsWith('image/')) {
          throw new Error('That file is not an image.')
        }

        const uploadFile = await compressImageForUpload(file)

        const initRaw = await commit({
          kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC',
          requestId,
          contentType: uploadFile.type,
          size: uploadFile.size,
        })
        const init = parseUploadInit(initRaw)
        if (!init) throw new Error('Upload could not be started.')

        const { error: uploadError } = await uploadWithProgress({
          bucket: init.bucket,
          path: init.path,
          token: init.token,
          file: uploadFile,
          contentType: uploadFile.type || 'application/octet-stream',
          upsert: true,
          onProgress: () => {},
          signal: new AbortController().signal,
        })
        if (uploadError) throw new Error(uploadError || 'Upload failed.')

        // The server writes the column and the audit entry — the bytes being in
        // the bucket is not the same as the look having a cover, and the old
        // orphaned upload route proved exactly that.
        await commit({
          kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE',
          requestId,
          publicUrl: init.publicUrl,
          path: init.path,
          cacheBuster: init.cacheBuster,
        })

        router.refresh()
      } catch (e: unknown) {
        setErr(errorMessageFromUnknown(e, 'Upload failed.'))
      } finally {
        setBusy(false)
      }
    },
    [commit, requestId, router],
  )

  const clear = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      // An empty publicUrl is refused by the route's own validator, so clearing
      // goes through the same finalize with an explicit null — see
      // setViralRequestCoverImage, which falls readers back to the submitter's
      // own attachment rather than to nothing.
      await commit({
        kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE',
        requestId,
        publicUrl: '',
        clear: true,
      })
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Could not clear the cover.'))
    } finally {
      setBusy(false)
    }
  }, [commit, requestId, router])

  return (
    <div className="grid justify-items-end gap-1">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.currentTarget.value = ''
          if (file) void upload(file)
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-full border border-surfaceGlass/20 px-3.5 py-1.5 text-[12px] font-black text-textSecondary transition hover:text-textPrimary disabled:opacity-50"
        >
          {busy ? 'Working…' : hasCover ? 'Replace cover' : 'Set cover'}
        </button>
        {hasCover ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="rounded-full border border-surfaceGlass/20 px-3 py-1.5 text-[12px] font-black text-textMuted transition hover:text-textSecondary disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
      </div>
      {err ? <div className="text-[11.5px] text-toneDanger">{err}</div> : null}
    </div>
  )
}
