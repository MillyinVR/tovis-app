// app/u/[handle]/_components/ProfileStats.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Who is looking, and what they're allowed to do:
// - own    → it's their profile; no follow control
// - client → a signed-in client (not the owner); interactive Follow toggle
// - guest  → signed out; a Follow CTA that routes to login
// - hidden → signed in but not as a client (pro/admin); no control
export type FollowMode = 'own' | 'client' | 'guest' | 'hidden'

type Counts = { followers: number; following: number; looks: number }

type ProfileStatsProps = {
  handle: string
  counts: Counts
  mode: FollowMode
  initialFollowing: boolean
  loginHref: string
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[15px] font-black text-textPrimary">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-textSecondary">
        {label}
      </span>
    </div>
  )
}

function readBoolean(payload: unknown, key: string): boolean | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!(key in payload)) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : null
}

function readCount(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!(key in payload)) return null
  const value = (payload as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

function readError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('error' in payload)) return null
  const value = (payload as Record<string, unknown>).error
  return typeof value === 'string' ? value : null
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const followButtonBase =
  'mt-3 inline-flex min-w-[112px] items-center justify-center rounded-full px-5 py-2 text-[13px] font-bold transition brand-focus'

export default function ProfileStats({
  handle,
  counts,
  mode,
  initialFollowing,
  loginHref,
}: ProfileStatsProps) {
  const [following, setFollowing] = useState(Boolean(initialFollowing))
  const [followerCount, setFollowerCount] = useState(
    Math.max(0, Math.trunc(counts.followers)),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)

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

  const toggle = useCallback(async () => {
    if (loading) return

    const nextFollowing = !following

    setLoading(true)
    setError(null)
    // Optimistic: flip state and nudge the visible follower count.
    setFollowing(nextFollowing)
    setFollowerCount((current) => Math.max(0, current + (nextFollowing ? 1 : -1)))

    try {
      const response = await fetch(
        `/api/v1/client/follow/${encodeURIComponent(handle)}`,
        { method: 'POST', headers: { Accept: 'application/json' } },
      )
      const payload = await readJsonSafely(response)

      if (!response.ok) {
        const serverError = readError(payload)
        throw new Error(
          serverError ?? `Failed to update follow (${response.status})`,
        )
      }

      // Reconcile with server truth (authoritative count + state).
      const serverFollowing = readBoolean(payload, 'following')
      const serverCount = readCount(payload, 'followerCount')
      if (serverFollowing !== null) setFollowing(serverFollowing)
      if (serverCount !== null) setFollowerCount(serverCount)
    } catch (caughtError) {
      // Roll back the optimistic patch.
      setFollowing(!nextFollowing)
      setFollowerCount((current) =>
        Math.max(0, current + (nextFollowing ? -1 : 1)),
      )
      flashError(
        caughtError instanceof Error && caughtError.message.trim()
          ? caughtError.message
          : 'Could not update follow.',
      )
    } finally {
      setLoading(false)
    }
  }, [flashError, following, handle, loading])

  return (
    <>
      <div className="mt-3 flex items-center gap-5">
        <Stat value={followerCount} label="Followers" />
        <Stat value={counts.following} label="Following" />
        <Stat value={counts.looks} label="Looks" />
      </div>

      {mode === 'client' ? (
        <div className="mt-0">
          <button
            type="button"
            onClick={toggle}
            disabled={loading}
            aria-pressed={following}
            className={[
              followButtonBase,
              following
                ? 'border border-textPrimary/15 bg-bgSecondary text-textPrimary hover:border-textPrimary/30'
                : 'bg-accentPrimary text-onAccent hover:opacity-90',
              loading ? 'cursor-wait opacity-75' : 'cursor-pointer',
            ].join(' ')}
          >
            {following ? 'Following' : 'Follow'}
          </button>

          {error ? (
            <div
              aria-live="polite"
              className="mt-2 max-w-[220px] text-[11px] font-semibold text-[rgb(var(--tone-danger))]"
            >
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'guest' ? (
        <a
          href={loginHref}
          className={[
            followButtonBase,
            'bg-accentPrimary text-onAccent hover:opacity-90',
          ].join(' ')}
        >
          Follow
        </a>
      ) : null}
    </>
  )
}
