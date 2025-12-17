// app/pro/media/MediaTile.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type MediaTileProps = {
  id: string
  src: string
  caption?: string | null
  isFeaturedInPortfolio: boolean
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

export default function MediaTile({ id, src, caption, isFeaturedInPortfolio }: MediaTileProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [featured, setFeatured] = useState(Boolean(isFeaturedInPortfolio))
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/pro/media/${encodeURIComponent(id)}/toggle-portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFeaturedInPortfolio: !featured }),
      })

      const body = await safeJson(res)
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)

      setFeatured((v) => !v)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to update.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />

      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        {caption ? <div style={{ fontSize: 12, color: '#111' }}>{caption}</div> : null}
        {error ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div> : null}

        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          style={{
            border: '1px solid #ddd',
            background: featured ? '#111' : '#fff',
            color: featured ? '#fff' : '#111',
            padding: '8px 10px',
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 12,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : featured ? 'In portfolio' : 'Add to portfolio'}
        </button>
      </div>
    </div>
  )
}
