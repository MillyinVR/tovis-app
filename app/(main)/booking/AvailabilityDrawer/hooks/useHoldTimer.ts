// app/(main)/booking/AvailabilityDrawer/hooks/useHoldTimer.ts

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function formatMmSs(ms: number) {
  const s = Math.floor(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function useHoldTimer(holdUntil: number | null) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    if (!holdUntil) return
    setNowMs(Date.now())
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = window.setInterval(() => setNowMs(Date.now()), 500)

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [holdUntil])

  const label = useMemo(() => {
    if (!holdUntil) return null
    return formatMmSs(Math.max(0, holdUntil - nowMs))
  }, [holdUntil, nowMs])

  const urgent = useMemo(() => {
    if (!holdUntil) return false
    return holdUntil - nowMs <= 2 * 60_000
  }, [holdUntil, nowMs])

  const expired = useMemo(() => {
    if (!holdUntil) return false
    return nowMs >= holdUntil
  }, [nowMs, holdUntil])

  return { label, urgent, expired, nowMs }
}
