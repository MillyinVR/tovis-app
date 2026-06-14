// app/pro/verification/VerificationUploadClient.tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VerificationDocumentType } from '@prisma/client'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'
import { compressImageForUpload } from '@/lib/media/processImageForUpload'

export type VerificationMethodOption = {
  type: VerificationDocumentType
  title: string
  description: string
}

type VerificationUploadClientProps = {
  methods: VerificationMethodOption[]
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export default function VerificationUploadClient({
  methods,
}: VerificationUploadClientProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [selectedType, setSelectedType] = useState<VerificationDocumentType>(
    methods[0]?.type ?? 'LICENSE',
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const selectedMethod =
    methods.find((m) => m.type === selectedType) ?? methods[0] ?? null

  async function uploadVerificationDocument(file: File) {
    if (!selectedMethod) throw new Error('Pick a document type first.')

    const uploadFile = await compressImageForUpload(file)

    // 1) signed upload init
    const metaRes = await fetch('/api/pro/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'VERIFY_PRIVATE',
        contentType: uploadFile.type || 'application/octet-stream',
        size: uploadFile.size,
      }),
    })

    const metaRaw = await safeJson(metaRes)
    if (!metaRes.ok || !isRecord(metaRaw) || metaRaw.ok !== true) {
      const msg = isRecord(metaRaw) && typeof metaRaw.error === 'string' ? metaRaw.error : 'Could not start upload.'
      throw new Error(msg)
    }

    const bucket = typeof metaRaw.bucket === 'string' ? metaRaw.bucket : ''
    const path = typeof metaRaw.path === 'string' ? metaRaw.path : ''
    const token = typeof metaRaw.token === 'string' ? metaRaw.token : ''

    if (!bucket || !path || !token) {
      throw new Error('Upload initialization missing bucket/path/token.')
    }

    // 2) PUT file to the signed-upload endpoint via the shared helper, which
    // carries the PUT-not-POST + apikey + x-upsert semantics (VERIFY_PRIVATE
    // lives in media-private and is not overwritten, so upsert stays false).
    const { error: upErr } = await uploadWithProgress({
      bucket,
      path,
      token,
      file: uploadFile,
      contentType: uploadFile.type || 'application/octet-stream',
      upsert: false,
      onProgress: () => {},
      signal: new AbortController().signal,
    })

    if (upErr) {
      throw new Error(upErr || 'Upload failed while sending file.')
    }

    // 3) create VerificationDocument row
    const ref = `supabase://${bucket}/${path}`

    const createRes = await fetch('/api/pro/verification-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: selectedMethod.type,
        label: `${selectedMethod.title} (pro upload)`,
        url: ref,
      }),
    })

    const createRaw = await safeJson(createRes)
    if (!createRes.ok || !isRecord(createRaw) || createRaw.ok !== true) {
      const msg = isRecord(createRaw) && typeof createRaw.error === 'string' ? createRaw.error : 'Could not save verification doc.'
      throw new Error(msg)
    }
  }

  if (methods.length === 0) return null

  return (
    <div className="grid gap-3">
      <div className="grid gap-2" role="radiogroup" aria-label="Document type">
        {methods.map((method) => {
          const selected = method.type === selectedType
          return (
            <button
              key={method.type}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={uploading}
              onClick={() => {
                setSelectedType(method.type)
                setError(null)
                setDone(false)
              }}
              className={cn(
                'rounded-card border p-3 text-left transition',
                selected
                  ? 'border-accentPrimary/35 bg-accentPrimary/14'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
                uploading && 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="text-xs font-black text-textPrimary">{method.title}</div>
              <div className="mt-0.5 text-xs text-textSecondary">{method.description}</div>
            </button>
          )
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        disabled={uploading}
        aria-label="Verification document photo"
        onChange={async (e) => {
          const file = e.target.files?.[0] ?? null
          if (!file) return

          setError(null)
          setDone(false)

          if (!file.type.startsWith('image/')) {
            setError('Please upload an image file (jpg, png, etc.).')
            return
          }
          if (file.size > 8 * 1024 * 1024) {
            setError('Please choose an image under 8MB.')
            return
          }

          setUploading(true)
          try {
            await uploadVerificationDocument(file)
            setDone(true)
            router.refresh()
          } catch (err: unknown) {
            setDone(false)
            setError(err instanceof Error ? err.message : 'Upload failed.')
          } finally {
            setUploading(false)
            if (fileRef.current) fileRef.current.value = ''
          }
        }}
        className="block w-full text-xs text-textSecondary file:mr-3 file:rounded-full file:border file:border-surfaceGlass/14 file:bg-bgPrimary/25 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-textPrimary hover:file:bg-bgPrimary/30"
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className={cn(
          'inline-flex items-center justify-center rounded-full border px-3 py-2 text-xs font-black transition',
          'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
          'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
          'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
          uploading && 'cursor-not-allowed opacity-60',
        )}
      >
        {uploading
          ? 'Uploading…'
          : `Upload ${selectedMethod ? selectedMethod.title.toLowerCase() : 'document'} photo`}
      </button>

      {done ? (
        <div className="rounded-card border border-toneSuccess/25 bg-toneSuccess/10 px-3 py-2 text-xs font-black text-toneSuccess">
          Uploaded ✔️ We’ll review it shortly.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-xs font-black text-toneDanger">
          {error}
        </div>
      ) : null}
    </div>
  )
}
