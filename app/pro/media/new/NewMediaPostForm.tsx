// app/pro/media/new/NewMediaPostForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { MediaType, MediaVisibility } from '@prisma/client'

type ProService = { id: string; name: string }

const CAPTION_MAX = 300
const MAX_IMAGE_MB = 25
const MAX_VIDEO_MB = 200

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function bytesFromMb(mb: number) {
  return mb * 1024 * 1024
}

function computeVisibility(isEligibleForLooks: boolean, isFeaturedInPortfolio: boolean): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

function guessMediaType(file: File): MediaType {
  return (file.type || '').toLowerCase().startsWith('video/') ? MediaType.VIDEO : MediaType.IMAGE
}

export default function NewMediaPostForm() {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE)

  const [services, setServices] = useState<ProService[]>([])
  const [serviceIds, setServiceIds] = useState<string[]>([])

  // Defaults you had: Looks off, Portfolio on
  const [isEligibleForLooks, setIsEligibleForLooks] = useState(false)
  const [isFeaturedInPortfolio, setIsFeaturedInPortfolio] = useState(true)
  const [visibility, setVisibility] = useState<MediaVisibility>(MediaVisibility.PUBLIC)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPublicSelectionValid = isEligibleForLooks || isFeaturedInPortfolio

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/pro/services', { cache: 'no-store' })
      const data = await safeJson(res)
      const list = Array.isArray(data?.services) ? data.services : []
      setServices(list.map((s: any) => ({ id: String(s.id), name: String(s.name || 'Service') })))
    })().catch(() => setServices([]))
  }, [])

  useEffect(() => {
    setVisibility(computeVisibility(isEligibleForLooks, isFeaturedInPortfolio))
  }, [isEligibleForLooks, isFeaturedInPortfolio])

  const maxBytes = useMemo(() => {
    return mediaType === MediaType.VIDEO ? bytesFromMb(MAX_VIDEO_MB) : bytesFromMb(MAX_IMAGE_MB)
  }, [mediaType])

  const fileError = useMemo(() => {
    if (!file) return null
    if (file.size <= 0) return 'That file looks empty.'
    if (file.size > maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      const limit = mediaType === MediaType.VIDEO ? MAX_VIDEO_MB : MAX_IMAGE_MB
      return `That file is ${mb}MB — over the ${limit}MB limit.`
    }
    return null
  }, [file, maxBytes, mediaType])

  const canSubmit = useMemo(() => {
    return !!file && !fileError && serviceIds.length >= 1 && isPublicSelectionValid && !saving
  }, [file, fileError, serviceIds.length, isPublicSelectionValid, saving])

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function uploadSelectedFile() {
    if (!file) throw new Error('Select a file')

    // If both are off, block (this form is for public posts)
    if (!isPublicSelectionValid) throw new Error('Select “Show in Looks” or “Show in Portfolio”.')

    // If your backend treats both surfaces the same for storage,
    // consider changing this to a single kind like "MEDIA_PUBLIC".
    const kind = isEligibleForLooks ? 'LOOKS_PUBLIC' : 'PORTFOLIO_PUBLIC'

    const res = await fetch('/api/pro/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      }),
    })

    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || `Upload init failed (${res.status})`)

    const storageBucket = String(data.bucket || '')
    const storagePath = String(data.path || '')
    const token = String(data.token || '')
    const publicUrl = data.publicUrl ? String(data.publicUrl) : null

    if (!storageBucket || !storagePath || !token) {
      throw new Error('Upload init failed (missing bucket/path/token).')
    }

    const { error: upErr } = await supabaseBrowser.storage.from(storageBucket).uploadToSignedUrl(storagePath, token, file, {
      contentType: file.type || undefined,
      upsert: false,
    })

    if (upErr) throw new Error(upErr.message || 'Upload failed')

    return { storageBucket, storagePath, publicUrl }
  }

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    try {
      const uploaded = await uploadSelectedFile()

      const res = await fetch('/api/pro/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket: uploaded.storageBucket,
          path: uploaded.storagePath,
          publicUrl: uploaded.publicUrl ?? undefined, // only meaningful for public bucket

          caption: caption.trim().slice(0, CAPTION_MAX) || undefined,
          mediaType,
          isFeaturedInPortfolio,
          isEligibleForLooks,
          serviceIds,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)

      router.push('/pro/media')
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to create post.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-[12px] font-black text-textPrimary">Upload file</label>
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null
              setFile(f)
              if (f) setMediaType(guessMediaType(f))
            }}
            className="block w-full text-[13px] text-textPrimary"
          />
          <div className="text-[11px] text-textSecondary">
            Public posts (Looks/Portfolio) must live in the public bucket to render in the app.
          </div>
          {fileError ? <div className="text-[12px] text-toneDanger">{fileError}</div> : null}
        </div>

        <div className="grid gap-2">
          <label className="text-[12px] font-black text-textPrimary">Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What did we do here? Hair witchcraft? Nail sorcery?"
            rows={3}
            maxLength={CAPTION_MAX}
            className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
          />
          <div className="text-[11px] text-textSecondary">
            {caption.trim().length}/{CAPTION_MAX}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value as MediaType)}
            className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
          >
            <option value={MediaType.IMAGE}>Image</option>
            <option value={MediaType.VIDEO}>Video</option>
          </select>

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-bgPrimary px-3 py-3">
            <span className="text-[12px] font-black text-textSecondary">Visibility</span>
            <span className="text-[12px] font-black text-textPrimary">{visibility}</span>
          </div>

          <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
            <input
              type="checkbox"
              checked={isEligibleForLooks}
              onChange={(e) => setIsEligibleForLooks(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            Show in Looks
          </label>

          <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
            <input
              type="checkbox"
              checked={isFeaturedInPortfolio}
              onChange={(e) => setIsFeaturedInPortfolio(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            Show in Portfolio
          </label>
        </div>

        <div className="grid gap-2">
          <div className="text-[12px] font-black text-textPrimary">
            Tag services <span className="font-extrabold text-textSecondary">(pick at least 1)</span>
          </div>

          {services.length === 0 ? (
            <div className="text-[12px] text-textSecondary">No services found. Add services first.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {services.map((s) => {
                const active = serviceIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleService(s.id)}
                    className={[
                      'rounded-full border px-3 py-2 text-[12px] font-black transition',
                      active
                        ? 'border-white/10 bg-textPrimary text-bgPrimary'
                        : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
                    ].join(' ')}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {!isPublicSelectionValid ? (
          <div className="rounded-xl border border-toneDanger/40 bg-toneDanger/10 px-3 py-2 text-[12px] text-toneDanger">
            Select <strong>Looks</strong> or <strong>Portfolio</strong> to publish this post.
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-toneDanger">{error}</div> : null}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={[
            'rounded-card border px-4 py-3 text-[13px] font-black transition',
            canSubmit
              ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
              : 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70',
          ].join(' ')}
        >
          {saving ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}