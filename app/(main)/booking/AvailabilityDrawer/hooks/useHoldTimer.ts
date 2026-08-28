// app/(main)/booking/AvailabilityDrawer/hooks/useHoldTimer.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  formatHoldCountdown,
  isHoldCountdownUrgent,
} from '@/lib/booking/holdCountdown'

const TICK_MS = 500

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

    return formatHoldCountdown(remainingMs)
  }, [remainingMs])

  const urgent = useMemo(() => {
    if (remainingMs === null) return false

    return isHoldCountdownUrgent(remainingMs)
  }, [remainingMs])

  const expired = useMemo(() => {
    if (remainingMs === null) return false

    return remainingMs <= 0
  }, [remainingMs])

  return { label, urgent, expired, nowMs }
}