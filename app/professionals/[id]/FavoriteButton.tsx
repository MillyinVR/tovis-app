// app/professionals/[id]/FavoriteButton.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type FavoriteButtonProps = {
  professionalId: string
  initialFavorited: boolean
  initialCount?: number | null
  disabledReason?: string
}

type FavoritePatch = {
  favorited: boolean
  countDelta: number
}

function normalizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number') return 0
  if (!Number.isFinite(value)) return 0

  return Math.max(0, Math.trunc(value))
}

function readServerError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('error' in payload)) return null

  return typeof payload.error === 'string' ? payload.error : null
}

function readServerFavorited(payload: unknown): boolean | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('favorited' in payload)) return null

  return typeof payload.favorited === 'boolean' ? payload.favorited : null
}

function readServerCount(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('count' in payload)) return null
  if (typeof payload.count !== 'number') return null
  if (!Number.isFinite(payload.count)) return null

  return Math.max(0, Math.trunc(payload.count))
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function favoritePatch(nextFavorited: boolean): FavoritePatch {
  return {
    favorited: nextFavorited,
    countDelta: nextFavorited ? 1 : -1,
  }
}

function rollbackPatch(nextFavorited: boolean): FavoritePatch {
  return {
    favorited: !nextFavorited,
    countDelta: nextFavorited ? -1 : 1,
  }
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Could not update favorite.'
}

export default function FavoriteButton({
  professionalId,
  initialFavorited,
  initialCount,
  disabledReason,
}: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(Boolean(initialFavorited))
  const [count, setCount] = useState(normalizeCount(initialCount))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    setFavorited(Boolean(initialFavorited))
    setCount(normalizeCount(initialCount))
  }, [initialCount, initialFavorited])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const flashError = useCallback((message: string) => {
    setError(message)

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }

    timerRef.current = window.setTimeout(() => {
      setError(null)
      timerRef.current = null
    }, 2500)
  }, [])

  const applyPatch = useCallback((patch: FavoritePatch) => {
    setFavorited(patch.favorited)
    setCount((current) => Math.max(0, current + patch.countDelta))
  }, [])

  const applyServerTruth = useCallback((payload: unknown) => {
    const serverFavorited = readServerFavorited(payload)
    const serverCount = readServerCount(payload)

    if (serverFavorited !== null) {
      setFavorited(serverFavorited)
    }

    if (serverCount !== null) {
      setCount(serverCount)
    }
  }, [])

  const toggle = useCallback(async () => {
    if (loading) return

    if (disabledReason) {
      flashError(disabledReason)
      return
    }

    const nextFavorited = !favorited

    setLoading(true)
    setError(null)
    applyPatch(favoritePatch(nextFavorited))

    try {
      const response = await fetch(
        `/api/professionals/${encodeURIComponent(professionalId)}/favorite`,
        {
          method: nextFavorited ? 'POST' : 'DELETE',
          headers: { Accept: 'application/json' },
        },
      )

      const payload = await readJsonSafely(response)

      if (!response.ok) {
        const serverError = readServerError(payload)
        throw new Error(
          serverError ?? `Failed to update favorite (${response.status})`,
        )
      }

      applyServerTruth(payload)
    } catch (caughtError) {
      applyPatch(rollbackPatch(nextFavorited))
      flashError(errorMessageFromUnknown(caughtError))
    } finally {
      setLoading(false)
    }
  }, [
    applyPatch,
    applyServerTruth,
    disabledReason,
    favorited,
    flashError,
    loading,
    professionalId,
  ])

  const title = disabledReason
    ? disabledReason
    : favorited
      ? 'Unfavorite'
      : 'Favorite'

  return (
    <div className="grid justify-items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-pressed={favorited}
        aria-label={title}
        title={title}
        className={[
          'brand-button-ghost brand-focus grid justify-items-center gap-1 px-3 py-2 transition',
          loading ? 'cursor-wait opacity-75' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          className={[
            'grid h-9 w-9 place-items-center rounded-full border text-[18px] font-black transition',
            favorited
              ? 'border-[rgb(var(--accent-primary)/0.4)] bg-[rgb(var(--accent-primary)/0.15)] text-[rgb(var(--accent-primary))]'
              : 'border-[rgb(var(--surface-glass)/0.12)] bg-[rgb(var(--bg-secondary))] text-textPrimary',
          ].join(' ')}
          aria-hidden="true"
        >
          {favorited ? '♥' : '♡'}
        </span>

        <span className="text-[11px] font-extrabold text-textSecondary">
          {count}
        </span>
      </button>

      {error ? (
        <div
          aria-live="polite"
          className="brand-profile-card max-w-[160px] rounded-full px-3 py-1 text-center text-[11px] font-semibold text-[rgb(var(--tone-danger))]"
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}