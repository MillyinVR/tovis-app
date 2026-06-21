// app/(main)/looks/_components/useProFollow.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

type ProFollowState = {
  following: boolean
  followerCount: number
}

type UseProFollowArgs = {
  /** The pro to follow. `null` (e.g. unknown pro) disables the hook. */
  professionalId: string | null
  /** Called with `'follow'` when the viewer must sign in to follow. */
  onRequireAuth: (reason: string) => void
}

type UseProFollowResult = ProFollowState & {
  /** True once the initial follow state has been hydrated (or failed). */
  ready: boolean
  toggle: () => void
}

function parseFollowState(raw: unknown): Partial<ProFollowState> {
  if (!isRecord(raw)) return {}
  return {
    following: typeof raw.following === 'boolean' ? raw.following : undefined,
    followerCount:
      typeof raw.followerCount === 'number'
        ? Math.max(0, raw.followerCount)
        : undefined,
  }
}

function isGuestBlocked(status: number): boolean {
  return status === 401
}

/**
 * Single-pro follow toggle backed by `/api/pros/[id]/follow` — the same
 * endpoint the Looks feed uses. The feed reconciles many slides at once from
 * its own item array; this hook owns the per-pro case (the look-detail rail),
 * hydrating state via GET on mount and toggling with the same optimistic
 * update + rollback + guest-redirect behavior.
 */
export function useProFollow({
  professionalId,
  onRequireAuth,
}: UseProFollowArgs): UseProFollowResult {
  const [following, setFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [ready, setReady] = useState(false)
  const inFlight = useRef(false)

  // Hydrate the current follow state. A guest (401) or any error simply leaves
  // the default "not following" state — no redirect until the viewer acts.
  useEffect(() => {
    if (!professionalId) {
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)

    void (async () => {
      try {
        const res = await fetch(
          `/api/pros/${encodeURIComponent(professionalId)}/follow`,
          { method: 'GET', cache: 'no-store' },
        )
        const raw = await safeJson(res)
        if (cancelled) return

        if (res.ok) {
          const parsed = parseFollowState(raw)
          if (typeof parsed.following === 'boolean') setFollowing(parsed.following)
          if (typeof parsed.followerCount === 'number') {
            setFollowerCount(parsed.followerCount)
          }
        }
      } catch {
        // Non-fatal: leave the default not-following state.
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [professionalId])

  const toggle = useCallback(() => {
    if (!professionalId) return
    if (inFlight.current) return
    inFlight.current = true

    const before = following
    const beforeCount = followerCount
    const optimisticCount = Math.max(0, beforeCount + (before ? -1 : 1))

    // Optimistic flip + ±1.
    setFollowing(!before)
    setFollowerCount(optimisticCount)

    const rollback = () => {
      setFollowing(before)
      setFollowerCount(beforeCount)
    }

    void (async () => {
      try {
        const res = await fetch(
          `/api/pros/${encodeURIComponent(professionalId)}/follow`,
          { method: 'POST' },
        )
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          rollback()
          onRequireAuth('follow')
          return
        }

        if (!res.ok) {
          rollback()
          return
        }

        // Reconcile with the authoritative server state when present.
        const parsed = parseFollowState(raw)
        setFollowing(
          typeof parsed.following === 'boolean' ? parsed.following : !before,
        )
        if (typeof parsed.followerCount === 'number') {
          setFollowerCount(parsed.followerCount)
        }
      } catch {
        rollback()
      } finally {
        inFlight.current = false
      }
    })()
  }, [followerCount, following, onRequireAuth, professionalId])

  return { following, followerCount, ready, toggle }
}
