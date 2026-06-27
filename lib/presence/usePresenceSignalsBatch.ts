'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { PresenceBatchItem, PresenceSignalCounts } from './presenceSignals'

const POLL_ACTIVE_MS = 15_000
const POLL_IDLE_MS = 30_000
const IDLE_THRESHOLD_ROUNDS = 3

type SignalMap = Record<string, PresenceSignalCounts>

/**
 * Polls the batched presence endpoint for many resources at once (e.g. every
 * card in the openings feed) with a single request per round. Read-only — it
 * sends no heartbeats, so browsing a feed never inflates "watching" counts.
 * Backs off from 15s to 30s polling once the counts stop changing.
 */
export function usePresenceSignalsBatch(
  items: PresenceBatchItem[],
  opts?: { enabled?: boolean },
): SignalMap {
  const enabled = opts?.enabled ?? true

  // Stable signature so the polling effect only resets when the set of
  // resources actually changes, not on every parent re-render.
  const signature = useMemo(
    () =>
      items
        .map((it) => `${it.resourceType}:${it.resourceId}:${it.professionalId}:${it.serviceId ?? ''}`)
        .sort()
        .join('|'),
    [items],
  )

  const [signals, setSignals] = useState<SignalMap>({})
  const itemsRef = useRef(items)
  const stableRoundsRef = useRef(0)
  const prevRef = useRef<string | null>(null)

  // Keep the latest items in a ref so the poll loop reads them lazily without
  // resetting on every parent re-render. Written in an effect to avoid mutating
  // a ref during render.
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    if (!enabled || itemsRef.current.length === 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const res = await fetch('/api/v1/presence/signals/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsRef.current }),
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled && data && typeof data === 'object' && data.signals) {
            const next = data.signals as SignalMap
            const serialized = JSON.stringify(next)
            if (prevRef.current === serialized) {
              stableRoundsRef.current += 1
            } else {
              stableRoundsRef.current = 0
              prevRef.current = serialized
              setSignals(next)
            }
          }
        }
      } catch {
        // best-effort
      }

      if (cancelled) return
      const interval =
        stableRoundsRef.current >= IDLE_THRESHOLD_ROUNDS ? POLL_IDLE_MS : POLL_ACTIVE_MS
      timer = setTimeout(poll, interval)
    }

    void poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, signature])

  return signals
}
