// app/client/(gated)/_components/NotificationsBell.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isRecord } from '@/lib/guards'

/**
 * Client home-header notification-center entry point. Links to
 * /client/notifications and shows a gold dot when ANY notification is unread.
 *
 * The dot reads `GET /api/v1/client/notifications?unread=true&take=1` — the
 * presence of a single unread item — so it covers every event type (the bucketed
 * `/summary` only counts booking/consult/aftercare/reminder). Polls gently and
 * refreshes on focus/visibility, matching the messages InboxBell behaviour.
 */
export default function NotificationsBell() {
  const [hasUnread, setHasUnread] = useState(false)
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
    if (cancelledRef.current || inFlightRef.current) return
    inFlightRef.current = true

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000)

    try {
      const res = await fetch(
        '/api/v1/client/notifications?unread=true&take=1',
        {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      )
      const json: unknown = await res.json().catch(() => null)
      if (cancelledRef.current || !res.ok || !isRecord(json)) return
      const items = json.items
      setHasUnread(Array.isArray(items) && items.length > 0)
    } catch {
      // ignore transient errors + aborts
    } finally {
      window.clearTimeout(timeoutId)
      inFlightRef.current = false
    }
  }, [])

  const scheduleNext = useCallback(() => {
    stop()
    const base = 20_000
    const jitter = Math.floor(Math.random() * 2_000)
    timerRef.current = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      void load().finally(() => {
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

  return (
    <Link
      href="/client/notifications"
      aria-label="Notifications"
      className="relative grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-textPrimary/16 text-textMuted transition hover:border-textPrimary/25 hover:text-textSecondary"
    >
      <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
        <path
          d="M8 1.6a4.4 4.4 0 0 1 4.4 4.4c0 2.3.5 3.7 1.4 4.7H2.2c.9-1 1.4-2.4 1.4-4.7A4.4 4.4 0 0 1 8 1.6Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M6.4 13.8a1.6 1.6 0 0 0 3.2 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
      {hasUnread ? (
        <span className="absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-bgPrimary bg-gold" />
      ) : null}
    </Link>
  )
}
