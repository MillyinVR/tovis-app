// app/_components/_hooks/useUnreadBadge.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

function formatBadgeCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

type UnreadCountOk = { ok: true; badge?: string; count?: number }
type UnreadCountFail = { ok: false; error: string; count?: number }
type UnreadCountResponse = UnreadCountOk | UnreadCountFail

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function isUnreadCountResponse(x: unknown): x is UnreadCountResponse {
  if (!isRecord(x)) return false
  if (x.ok === true) {
    if ('badge' in x && x.badge != null && typeof x.badge !== 'string') return false
    if ('count' in x && x.count != null && typeof x.count !== 'number') return false
    return true
  }
  if (x.ok === false) {
    if (typeof x.error !== 'string' || x.error.trim().length === 0) return false
    if ('count' in x && x.count != null && typeof x.count !== 'number') return false
    return true
  }
  return false
}

async function safeJson(res: Response): Promise<UnreadCountResponse | null> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null

  try {
    const parsed: unknown = await res.json()
    return isUnreadCountResponse(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function useUnreadBadge(opts?: { initialBadge?: string | null }) {
  const [badge, setBadge] = useState<string | null>(opts?.initialBadge ?? null)

  const cancelledRef = useRef(false)
  const inFlightRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const load = useCallback(async () => {
    if (cancelledRef.current) return
    if (inFlightRef.current) return

    inFlightRef.current = true

    // Abort any previous in-flight request just in case
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const timeoutId = window.setTimeout(() => controller.abort(), 8_000)

    try {
      const res = await fetch('/api/messages/unread-count', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })

      const data = await safeJson(res)
      if (cancelledRef.current) return
      if (!data || data.ok !== true) return

      // Prefer server-provided badge if present
      const badgeRaw = typeof data.badge === 'string' ? data.badge.trim() : ''
      if (badgeRaw.length > 0) {
        setBadge(badgeRaw)
        return
      }

      const n = typeof data.count === 'number' ? data.count : 0
      setBadge(formatBadgeCount(n))
    } catch {
      // ignore transient errors + aborts
    } finally {
      window.clearTimeout(timeoutId)
      inFlightRef.current = false
    }
  }, [])

  const scheduleNext = useCallback(() => {
    stop()
    const base = 15_000
    const jitter = Math.floor(Math.random() * 1_500)

    timerRef.current = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      void load().finally(() => {
        // Only reschedule if still mounted
        if (!cancelledRef.current) scheduleNext()
      })
    }, base + jitter)
  }, [load, stop])

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
      abortRef.current?.abort()
      abortRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [load, scheduleNext, stop])

  return badge
}