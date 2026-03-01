// app/_components/_hooks/useUnreadBadge.ts
'use client'

import { useEffect, useRef, useState } from 'react'

function formatBadgeCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

type UnreadCountOk = { ok: true; badge?: string; count?: number }
type UnreadCountFail = { ok?: false; error?: string; count?: number }
type UnreadCountResponse = UnreadCountOk | UnreadCountFail

async function safeJson(res: Response): Promise<UnreadCountResponse | null> {
  try {
    return (await res.json()) as UnreadCountResponse
  } catch {
    return null
  }
}

export function useUnreadBadge(opts?: { initialBadge?: string | null }) {
  const [badge, setBadge] = useState<string | null>(opts?.initialBadge ?? null)

  const cancelledRef = useRef(false)
  const inFlightRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  async function load() {
    if (cancelledRef.current) return
    if (inFlightRef.current) return
    inFlightRef.current = true

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000)

    try {
      const res = await fetch('/api/messages/unread-count', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })

      const data = await safeJson(res)
      if (cancelledRef.current) return
      if (!res.ok || !data || data.ok !== true) return

      if (typeof data.badge === 'string' && data.badge.trim().length > 0) {
        setBadge(data.badge.trim())
        return
      }

      const n = typeof data.count === 'number' ? data.count : Number(data.count ?? 0)
      setBadge(formatBadgeCount(n))
    } catch {
      // ignore transient errors + aborts
    } finally {
      window.clearTimeout(timeoutId)
      inFlightRef.current = false
    }
  }

  function stop() {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function scheduleNext() {
    stop()
    const base = 15_000
    const jitter = Math.floor(Math.random() * 1500)
    timerRef.current = window.setTimeout(async () => {
      if (document.visibilityState !== 'visible') return
      await load()
      scheduleNext()
    }, base + jitter)
  }

  useEffect(() => {
    cancelledRef.current = false

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
        scheduleNext()
      } else {
        stop()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    onVisibility()

    return () => {
      cancelledRef.current = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [])

  return badge
}