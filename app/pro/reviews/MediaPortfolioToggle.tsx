'use client'

import { useState } from 'react'

export default function MediaPortfolioToggle({
  mediaId,
  initialFeatured,
  onChanged,
}: {
  mediaId: string
  initialFeatured: boolean
  onChanged?: (next: boolean) => void
}) {
  const [featured, setFeatured] = useState(initialFeatured)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    try {
      setLoading(true)
      setError(null)

      const next = !featured
      const res = await fetch(`/api/v1/pro/media/${mediaId}/portfolio`, {
        method: next ? 'POST' : 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed.')
        return
      }

      setFeatured(next)
      onChanged?.(next)
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        style={{
          border: 'none',
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 12,
          cursor: loading ? 'default' : 'pointer',
          background: featured ? 'rgb(var(--text-primary))' : 'rgb(var(--bg-surface))',
          color: featured ? 'rgb(var(--bg-primary))' : 'rgb(var(--text-primary))',
          borderColor: 'rgb(var(--text-primary))',
          borderWidth: 1,
          borderStyle: 'solid',
        }}
        title={featured ? 'Remove from portfolio' : 'Add to portfolio'}
      >
        {loading ? 'Saving…' : featured ? 'In Portfolio' : 'Add to Portfolio'}
      </button>

      {error && <div style={{ fontSize: 11, color: 'rgb(var(--tone-danger))' }}>{error}</div>}
    </div>
  )
}
