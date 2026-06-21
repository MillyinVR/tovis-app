'use client'

import { useEffect, useState } from 'react'

import { formatElapsed } from '@/lib/proSession/elapsed'

/**
 * Live "ELAPSED" timer for the pro active-session view.
 *
 * The session page is a server component, so it can only render the elapsed
 * value once at request time. This client component ticks once per second so
 * the timer actually counts up while a service is in progress.
 */
export default function ElapsedTimer({
  startedAt,
}: {
  startedAt: Date | string | null
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return

    // Tick once per second. The first tick (≤1s away) resyncs any staleness
    // between the server render snapshot and the client clock.
    const intervalId = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [startedAt])

  // suppressHydrationWarning: the server snapshot and the first client render
  // can differ by a second; the effect resyncs on mount.
  return <span suppressHydrationWarning>{formatElapsed(startedAt, nowMs)}</span>
}
