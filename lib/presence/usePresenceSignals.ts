'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ResourceType = 'opening' | 'offering'

type PresenceSignals = {
  watching: number | null
  waitlisted: number
}

const HEARTBEAT_INTERVAL_MS = 30_000
const POLL_ACTIVE_MS = 15_000
const POLL_IDLE_MS = 30_000
const IDLE_THRESHOLD_ROUNDS = 3

export function usePresenceSignals(args: {
  resourceType: ResourceType
  resourceId: string
  professionalId: string
  serviceId?: string
  enabled?: boolean
}): PresenceSignals & { loading: boolean } {
  const { resourceType, resourceId, professionalId, serviceId, enabled = true } = args

  const [signals, setSignals] = useState<PresenceSignals>({
    watching: null,
    waitlisted: 0,
  })
  const [loading, setLoading] = useState(true)
  const stableRoundsRef = useRef(0)
  const prevSignalsRef = useRef<PresenceSignals | null>(null)

  const sendHeartbeat = useCallback(async () => {
    try {
      await fetch('/api/client/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceType, resourceId }),
      })
    } catch {
      // best-effort
    }
  }, [resourceType, resourceId])

  const fetchSignals = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        resourceType,
        resourceId,
        professionalId,
      })
      if (serviceId) params.set('serviceId', serviceId)

      const res = await fetch(`/api/presence/signals?${params}`)
      if (!res.ok) return

      const data = await res.json()
      if (data.signals) {
        const next: PresenceSignals = data.signals
        const prev = prevSignalsRef.current

        if (
          prev &&
          prev.watching === next.watching &&
          prev.waitlisted === next.waitlisted
        ) {
          stableRoundsRef.current += 1
        } else {
          stableRoundsRef.current = 0
        }

        prevSignalsRef.current = next
        setSignals(next)
        setLoading(false)
      }
    } catch {
      // best-effort
    }
  }, [resourceType, resourceId, professionalId, serviceId])

  useEffect(() => {
    if (!enabled || !resourceId || !professionalId) return

    sendHeartbeat()
    fetchSignals()

    const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    let pollTimer: ReturnType<typeof setTimeout>

    function schedulePoll() {
      const interval =
        stableRoundsRef.current >= IDLE_THRESHOLD_ROUNDS
          ? POLL_IDLE_MS
          : POLL_ACTIVE_MS

      pollTimer = setTimeout(async () => {
        await fetchSignals()
        schedulePoll()
      }, interval)
    }

    schedulePoll()

    return () => {
      clearInterval(heartbeatTimer)
      clearTimeout(pollTimer)
    }
  }, [enabled, resourceId, professionalId, sendHeartbeat, fetchSignals])

  return { ...signals, loading }
}
