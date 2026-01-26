// app/_components/ClientSessionFooter/useClientFooterBadge.ts
'use client'

import { useEffect, useRef, useState } from 'react'

function formatBadgeCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export function useClientFooterBadge() {
  const [badge, setBadge] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  const inFlightRef = useRef(false)

  async function load() {
    if (cancelledRef.current) return
    if (inFlightRef.current) return
    inFlightRef.current = true

    try {
      const res = await fetch('/api/messages/unread-count', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
      })

      const data = await res.json().catch(() => ({} as any))
      if (cancelledRef.current) return
      if (!res.ok || data?.ok !== true) return

      if (typeof data?.badge === 'string') {
          setBadge(data.badge)
        } else {
          const n = Number(data?.count || 0)
          setBadge(formatBadgeCount(n))
        }

    } catch {
      // ignore transient network errors
    } finally {
      inFlightRef.current = false
    }
  }

  useEffect(() => {
    cancelledRef.current = false

    // initial load
    void load()

    // poll while visible (gentle)
    let pollId: number | null = null

    const startPolling = () => {
      if (pollId != null) return
      pollId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void load()
      }, 10_000) // every 10s (safe + responsive)
    }

    const stopPolling = () => {
      if (pollId == null) return
      window.clearInterval(pollId)
      pollId = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
        startPolling()
      } else {
        stopPolling()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    // kick polling state based on current visibility
    onVisibility()

    return () => {
      cancelledRef.current = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return badge
}
