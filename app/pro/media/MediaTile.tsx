// app/pro/media/MediaTile.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeJson, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'

type MediaTileProps = {
  id: string
  src: string
  caption?: string | null
  isFeaturedInPortfolio: boolean
  uploadedByRole?: string | null
}

function errorFromResponse(res: Response, data: unknown): string {
  const msg = readErrorMessage(data)
  if (msg) return msg
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

export default function MediaTile({ id, src, caption, isFeaturedInPortfolio }: MediaTileProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [featured, setFeatured] = useState(Boolean(isFeaturedInPortfolio))
  const [error, setError] = useState<string | null>(null)

  async function togglePortfolio() {
    if (saving) return
    setSaving(true)
    setError(null)

    const nextFeatured = !featured
    const endpoint = `/api/pro/media/${encodeURIComponent(id)}/portfolio`

    try {
      const res = await fetch(endpoint, { method: nextFeatured ? 'POST' : 'DELETE' })
      const body = await safeJson(res)

      if (!res.ok) {
        throw new Error(errorFromResponse(res, body))
      }

      setFeatured(nextFeatured)
      router.refresh()
    } catch (e: unknown) {
      setError(errorMessageFromUnknown(e, 'Failed to update.'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteMedia() {
    if (saving) return
    setError(null)

    const ok = window.confirm('Delete this media? This cannot be undone.')
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch(`/api/pro/media/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = await safeJson(res)

      if (!res.ok) {
        throw new Error(errorFromResponse(res, body))
      }

      router.refresh()
    } catch (e: unknown) {
      setError(errorMessageFromUnknown(e, 'Failed to delete.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="tovis-glass overflow-hidden rounded-card border border-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="block h-40 w-full object-cover" />

      <div className="grid gap-2 p-3">
        {caption ? <div className="text-[12px] text-textPrimary">{caption}</div> : null}
        {error ? <div className="text-[12px] text-toneDanger">{error}</div> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePortfolio}
            disabled={saving}
            className={[
              'flex-1 rounded-card border px-3 py-2 text-[12px] font-black transition',
              saving ? 'cursor-not-allowed opacity-70' : 'hover:border-white/20',
              featured
                ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
                : 'border-white/10 bg-bgSecondary text-textPrimary',
            ].join(' ')}
          >
            {saving ? 'Saving…' : featured ? 'In portfolio (and Looks)' : 'Add to portfolio'}
          </button>

          <button
            type="button"
            onClick={deleteMedia}
            disabled={saving}
            className={[
              'rounded-card border px-3 py-2 text-[12px] font-black transition',
              'border-white/10 bg-bgSecondary text-toneDanger hover:border-white/20',
              saving ? 'cursor-not-allowed opacity-70' : '',
            ].join(' ')}
            title="Delete media"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}