// app/professionals/[id]/FavoriteButton.tsx

'use client'

import { useEffect, useRef, useState } from 'react'

export default function FavoriteButton({
  professionalId,
  initialFavorited,
  initialCount,
  disabledReason,
}: {
  professionalId: string
  initialFavorited: boolean
  initialCount: number
  disabledReason?: string // e.g. "Log in to favorite"
}) {
  const [favorited, setFavorited] = useState<boolean>(initialFavorited)
  const [count, setCount] = useState<number>(Math.max(0, initialCount || 0))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  function flashError(msg: string) {
    setError(msg)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setError(null), 2500)
  }

  async function toggle() {
    if (loading) return

    if (disabledReason) {
      flashError(disabledReason)
      return
    }

    setLoading(true)
    setError(null)

    // optimistic
    const next = !favorited
    setFavorited(next)
    setCount((c) => Math.max(0, c + (next ? 1 : -1)))

    try {
      const res = await fetch(`/api/professionals/${professionalId}/favorite`, {
        method: next ? 'POST' : 'DELETE',
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : `Failed to update favorite (${res.status})`
        throw new Error(msg)
      }

      // server truth
      setFavorited(!!data.favorited)
      if (typeof data.count === 'number') setCount(Math.max(0, data.count))
    } catch (e: any) {
      // rollback
      setFavorited(!next)
      setCount((c) => Math.max(0, c + (next ? -1 : 1)))
      flashError(e?.message || 'Could not update favorite.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-pressed={favorited}
        title={
          disabledReason
            ? disabledReason
            : favorited
              ? 'Unfavorite'
              : 'Favorite'
        }
        style={{
          border: 'none',
          background: 'transparent',
          display: 'grid',
          justifyItems: 'center',
          gap: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.75 : 1,
        }}
      >
        <div style={{ fontSize: 22, lineHeight: 1 }}>
          {favorited ? '♥' : '♡'}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>{count}</div>
      </button>

      {error && (
        <div
          aria-live="polite"
          style={{
            fontSize: 11,
            color: '#b91c1c',
            maxWidth: 120,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
