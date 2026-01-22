// app/(main)/booking/AvailabilityDrawer/hooks/useHoldTimer.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function formatMmSs(ms: number) {
  const clamped = Math.max(0, ms)
  const s = Math.floor(clamped / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function useHoldTimer(holdUntil: number | null) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    // stop ticking if no hold
    if (!holdUntil) {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
      return
    }

    // tick while active
    setNowMs(Date.now())
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = window.setInterval(() => {
      setNowMs(Date.now())
    }, 500)

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [holdUntil])

  const remainingMs = useMemo(() => {
    if (!holdUntil) return null
    return holdUntil - nowMs
  }, [holdUntil, nowMs])

  const label = useMemo(() => {
    if (remainingMs == null) return null
    return formatMmSs(remainingMs)
  }, [remainingMs])

  const urgent = useMemo(() => {
    if (remainingMs == null) return false
    return remainingMs <= 2 * 60_000 && remainingMs > 0
  }, [remainingMs])

  const expired = useMemo(() => {
    if (remainingMs == null) return false
    return remainingMs <= 0
  }, [remainingMs])

  return { label, urgent, expired, nowMs }
}
