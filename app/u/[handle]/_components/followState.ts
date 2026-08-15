// app/u/[handle]/_components/followState.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readErrorMessage } from '@/lib/http'

// Who is looking, and what they're allowed to do:
// - own    → it's their profile; no follow control
// - client → a signed-in client (not the owner); interactive Follow toggle
// - guest  → signed out; a Follow CTA that routes to login
// - hidden → signed in but not as a client (pro/admin); no control
export type FollowMode = 'own' | 'client' | 'guest' | 'hidden'

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

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export type ClientFollowState = {
  following: boolean
  /** Optimistically nudged, then reconciled with server truth. */
  followerCount: number
  loading: boolean
  error: string | null
  toggle: () => Promise<void>
}

/**
 * The follow toggle's state machine, extracted from the old `ProfileStats` so
 * the follower COUNT (rendered in the stats row) and the Follow BUTTON can sit
 * in different parts of the layout — the design frame puts the bio between them
 * — while still sharing one optimistic state. Two components each owning their
 * own copy would let the count and the button disagree mid-request.
 */
export function useClientFollow(args: {
  handle: string
  initialFollowing: boolean
  initialFollowerCount: number
}): ClientFollowState {
  const { handle, initialFollowing, initialFollowerCount } = args

  const [following, setFollowing] = useState(Boolean(initialFollowing))
  const [followerCount, setFollowerCount] = useState(
    Math.max(0, Math.trunc(initialFollowerCount)),
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
        const serverError = readErrorMessage(payload)
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

  return { following, followerCount, loading, error, toggle }
}
