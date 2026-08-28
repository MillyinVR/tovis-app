// app/pro/calendar/_hooks/useHoldCountdown.ts
'use client'

import { useEffect, useMemo, useState } from 'react'

import { formatHoldCountdown } from '@/lib/booking/holdCountdown'

const TICK_MS = 1_000

/**
 * The live time left on a client's checkout reservation, for the pro's tile.
 *
 * ⚠️ The ticker is deliberately per-card and starts ONLY when `expiresAtIso` is
 * present. Every other kind of event passes `null`, so a calendar full of
 * bookings sets no interval and re-renders exactly as often as it did before —
 * a second-by-second clock lifted to the grid would have re-rendered every tile
 * on the screen once a second to animate the one or two that can hold.
 *
 * `expired` is the pro-facing half of the same truth the write path already
 * enforces: every conflict query filters `expiresAt > now`, so the moment this
 * flips the slot is genuinely free again and the tile has to stop claiming it.
 * (The server does not push anything at expiry — a hold lapses by the clock, not
 * by a request — so this is what makes the tile leave on its own.)
 */
export function useHoldCountdown(expiresAtIso: string | null): {
  label: string | null
  expired: boolean
} {
  const expiresAtMs = useMemo(() => {
    if (!expiresAtIso) return null

    const parsed = Date.parse(expiresAtIso)

    return Number.isFinite(parsed) ? parsed : null
  }, [expiresAtIso])

  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (expiresAtMs === null) return undefined

    const readClock = () => {
      setNowMs(Date.now())
    }

    const intervalId = window.setInterval(readClock, TICK_MS)

    // A backgrounded tab has its timers throttled to about one tick a minute,
    // so a pro coming back to the calendar would read a countdown that is
    // stale by up to that minute — on a ten-minute reservation. Re-reading on
    // the way back in is the same thing the grid's now-line does
    // (`useNowSnapshot`), for the same reason.
    document.addEventListener('visibilitychange', readClock)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', readClock)
    }
  }, [expiresAtMs])

  const remainingMs = expiresAtMs === null ? null : expiresAtMs - nowMs

  return {
    label: remainingMs === null ? null : formatHoldCountdown(remainingMs),
    expired: remainingMs !== null && remainingMs <= 0,
  }
}
