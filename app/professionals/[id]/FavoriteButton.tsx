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
  initialCount?: number | null
  disabledReason?: string // e.g. "Log in to favorite"
}) {
  const [favorited, setFavorited] = useState<boolean>(Boolean(initialFavorited))
  const [count, setCount] = useState<number>(Math.max(0, Number(initialCount ?? 0) || 0))
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
      const res = await fetch(`/api/professionals/${encodeURIComponent(professionalId)}/favorite`, {
        method: next ? 'POST' : 'DELETE',
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Failed to update favorite (${res.status})`
        throw new Error(msg)
      }

      // server truth
      setFavorited(Boolean(data?.favorited))
      if (typeof data?.count === 'number') setCount(Math.max(0, data.count))
    } catch (e: any) {
      // rollback
      setFavorited(!next)
      setCount((c) => Math.max(0, c + (next ? -1 : 1)))
      flashError(e?.message || 'Could not update favorite.')
    } finally {
      setLoading(false)
    }
  }

  const title = disabledReason ? disabledReason : favorited ? 'Unfavorite' : 'Favorite'

  return (
    <div className="grid justify-items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-pressed={favorited}
        title={title}
        className={[
          'tovis-glass grid justify-items-center gap-1 rounded-full border px-3 py-2 transition',
          'border-white/10 bg-bgPrimary/25 hover:border-white/20 hover:bg-white/5',
          loading ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <div
          className={[
            'grid h-9 w-9 place-items-center rounded-full border text-[18px] font-black transition',
            favorited
              ? 'border-accentPrimary/40 bg-accentPrimary/15 text-accentPrimary'
              : 'border-white/10 bg-bgSecondary text-textPrimary',
          ].join(' ')}
          aria-hidden="true"
        >
          {favorited ? '♥' : '♡'}
        </div>

        <div className="text-[11px] font-extrabold text-textSecondary">{count}</div>
      </button>

      {error ? (
        <div
          aria-live="polite"
          className="tovis-glass-soft max-w-160px rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-center text-[11px] font-semibold text-toneDanger"
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}
