'use client'

import { useSyncExternalStore } from 'react'

import { DEFAULT_TIME_ZONE, getViewerTimeZone, getZonedParts } from '@/lib/time'

function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// The store never changes after mount; we only need the client/server snapshot
// split, so the subscribe callback is a no-op.
const noopSubscribe = () => () => {}

/**
 * Time-of-day greeting resolved in the VIEWER's timezone.
 *
 * The home shell is a server component, so computing the hour there reads the
 * server zone (UTC on Vercel) and mislabels the greeting for anyone outside it.
 * useSyncExternalStore renders the neutral server snapshot during SSR +
 * hydration (so markup matches), then swaps to the viewer-zone greeting on the
 * client — no setState-in-effect, no hydration mismatch.
 */
export default function ClientGreeting({
  fallback = 'Welcome back',
}: {
  fallback?: string
}) {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const tz = getViewerTimeZone() ?? DEFAULT_TIME_ZONE
      return timeOfDayGreeting(getZonedParts(new Date(), tz).hour)
    },
    () => fallback,
  )
}
