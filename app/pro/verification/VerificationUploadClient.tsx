// app/pro/verification/VerificationUploadClient.tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export default function VerificationUploadClient() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function uploadLicenseImage(file: File) {
    // 1) signed upload init
    const metaRes = await fetch('/api/pro/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'VERIFY_PRIVATE',
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      }),
    })

    const metaRaw = await safeJson(metaRes)
    if (!metaRes.ok || !isRecord(metaRaw) || metaRaw.ok !== true) {
      const msg = isRecord(metaRaw) && typeof metaRaw.error === 'string' ? metaRaw.error : 'Could not start upload.'
      throw new Error(msg)
    }

    const signedUrl = typeof metaRaw.signedUrl === 'string' ? metaRaw.signedUrl : ''
    const bucket = typeof metaRaw.bucket === 'string' ? metaRaw.bucket : ''
    const path = typeof metaRaw.path === 'string' ? metaRaw.path : ''

    if (!signedUrl || !bucket || !path) {
      throw new Error('Upload initialization missing signedUrl/bucket/path.')
    }

    // 2) PUT file to signed URL
    const putRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })

    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => '')
      throw new Error(txt || 'Upload failed while sending file.')
    }

    // 3) create VerificationDocument row
    const ref = `supabase://${bucket}/${path}`

    const createRes = await fetch('/api/pro/verification-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'LICENSE',
        label: 'License (pro upload)',
        url: ref,
      }),
    })

    const createRaw = await safeJson(createRes)
    if (!createRes.ok || !isRecord(createRaw) || createRaw.ok !== true) {
      const msg = isRecord(createRaw) && typeof createRaw.error === 'string' ? createRaw.error : 'Could not save verification doc.'
      throw new Error(msg)
    }
  }

  return (
    <div className="grid gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        disabled={uploading}
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
            await uploadLicenseImage(file)
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
        {uploading ? 'Uploading…' : 'Choose license photo'}
      </button>

      {done ? (
        <div className="rounded-card border border-toneSuccess/25 bg-toneSuccess/10 px-3 py-2 text-xs font-black text-toneSuccess">
          Uploaded ✔️
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