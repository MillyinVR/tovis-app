// app/(main)/booking/AvailabilityDrawer/hooks/useHoldTimer.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const TICK_MS = 500
const URGENT_THRESHOLD_MS = 2 * 60_000

function formatMmSs(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')

  return `${minutes}:${seconds}`
}

function clearTick(intervalId: number | null): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId)
  }
}

export function useHoldTimer(holdUntil: number | null) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    clearTick(tickRef.current)
    tickRef.current = null

    if (!holdUntil) {
      return undefined
    }

    tickRef.current = window.setInterval(() => {
      setNowMs(Date.now())
    }, TICK_MS)

    return () => {
      clearTick(tickRef.current)
      tickRef.current = null
    }
  }, [holdUntil])

  const remainingMs = useMemo(() => {
    if (!holdUntil) return null

    return holdUntil - nowMs
  }, [holdUntil, nowMs])

  const label = useMemo(() => {
    if (remainingMs === null) return null

    return formatMmSs(remainingMs)
  }, [remainingMs])

  const urgent = useMemo(() => {
    if (remainingMs === null) return false

    return remainingMs <= URGENT_THRESHOLD_MS && remainingMs > 0
  }, [remainingMs])

  const expired = useMemo(() => {
    if (remainingMs === null) return false

    return remainingMs <= 0
  }, [remainingMs])

  return { label, urgent, expired, nowMs }
}