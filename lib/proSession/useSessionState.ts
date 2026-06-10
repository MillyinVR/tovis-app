'use client'

// lib/proSession/useSessionState.ts
//
// Polls the compact Pro session state endpoint while a session is active so
// the server-rendered session UI can refresh when the client acts (approves
// a consultation, completes checkout, cancels) without a manual reload.
//
// Contract:
// - polls every 5–10 seconds (clamped) while the tab is visible
// - skips ticks while the tab is hidden, catches up on visibility
// - stops permanently once the booking reaches a terminal state, or the
//   endpoint says the booking is gone / no longer ours (401/403/404)
// - fires `onChange` only when the state hash actually changes

import { useEffect, useRef, useState } from 'react'

import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

export const SESSION_STATE_DEFAULT_INTERVAL_MS = 7000
const MIN_INTERVAL_MS = 5000
const MAX_INTERVAL_MS = 10000

export type UseSessionStateArgs = {
  bookingId: string
  /**
   * Hash computed during server render. Providing it lets the very first
   * poll detect a change that landed between render and first tick.
   */
  initialStateHash?: string | null
  intervalMs?: number
  enabled?: boolean
  onChange?: (nextStateHash: string) => void
}

export type UseSessionStateResult = {
  stateHash: string | null
  terminal: boolean
}

export function useSessionState({
  bookingId,
  initialStateHash = null,
  intervalMs = SESSION_STATE_DEFAULT_INTERVAL_MS,
  enabled = true,
  onChange,
}: UseSessionStateArgs): UseSessionStateResult {
  const [stateHash, setStateHash] = useState<string | null>(initialStateHash)
  const [terminal, setTerminal] = useState(false)

  const lastHashRef = useRef<string | null>(initialStateHash)
  const terminalRef = useRef(false)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // After a server-driven refresh the layout passes a fresh hash; adopt it
  // as the new baseline so the next poll does not re-report a change the
  // UI already shows.
  useEffect(() => {
    if (initialStateHash) {
      lastHashRef.current = initialStateHash
      setStateHash(initialStateHash)
    }
  }, [initialStateHash])

  useEffect(() => {
    if (!enabled || !bookingId || terminalRef.current) return undefined

    const delay = Math.min(Math.max(intervalMs, MIN_INTERVAL_MS), MAX_INTERVAL_MS)

    let cancelled = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const stopForever = () => {
      terminalRef.current = true
      setTerminal(true)
    }

    const schedule = () => {
      if (cancelled || terminalRef.current) return
      timer = setTimeout(() => {
        void tick()
      }, delay)
    }

    const tick = async (): Promise<void> => {
      if (cancelled || terminalRef.current) return

      if (document.visibilityState === 'hidden') {
        schedule()
        return
      }

      if (inFlight) {
        schedule()
        return
      }

      inFlight = true
      try {
        const res = await fetch(
          `/api/pro/bookings/${encodeURIComponent(bookingId)}/session/state`,
          {
            method: 'GET',
            cache: 'no-store',
            headers: { accept: 'application/json' },
          },
        )

        if (res.status === 401 || res.status === 403 || res.status === 404) {
          stopForever()
          return
        }

        if (!res.ok) return

        const data = await safeJson(res)
        if (cancelled || !isRecord(data) || data.ok !== true) return

        const nextHash =
          typeof data.stateHash === 'string' && data.stateHash
            ? data.stateHash
            : null
        if (!nextHash) return

        const state = isRecord(data.state) ? data.state : null
        const isTerminal = state?.terminal === true

        const prevHash = lastHashRef.current
        lastHashRef.current = nextHash
        setStateHash(nextHash)

        if (isTerminal) {
          stopForever()
        }

        if (prevHash !== null && prevHash !== nextHash) {
          onChangeRef.current?.(nextHash)
        }
      } catch {
        // Transient network failure — keep polling.
      } finally {
        inFlight = false
        if (!cancelled && !terminalRef.current) schedule()
      }
    }

    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !cancelled &&
        !terminalRef.current
      ) {
        if (timer) clearTimeout(timer)
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [bookingId, enabled, intervalMs])

  return { stateHash, terminal }
}
