'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Live-sync Layer 1 (web): keep the page fresh without manual reloads.
 *
 * - `focus` (default true): re-fetch when the tab regains focus or becomes
 *   visible — so switching from the phone back to the salon computer always
 *   shows current data.
 * - `pollMs`: while the tab is visible, re-fetch on this interval — so a
 *   left-open salon screen updates even when nobody touches it.
 *
 * `router.refresh()` re-runs the server components for the current route, so the
 * data comes from the same loaders/endpoints (single source of truth intact).
 * Layer 2 (Supabase Realtime) will make the poll mostly redundant; this is the
 * zero-infra baseline.
 */
export function RefreshOnFocus({
  pollMs,
  focus = true,
}: {
  pollMs?: number
  focus?: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }

    if (focus) {
      window.addEventListener('focus', refreshIfVisible)
      document.addEventListener('visibilitychange', refreshIfVisible)
    }

    let intervalId: ReturnType<typeof setInterval> | undefined
    if (pollMs && pollMs > 0) {
      intervalId = setInterval(refreshIfVisible, pollMs)
    }

    return () => {
      if (focus) {
        window.removeEventListener('focus', refreshIfVisible)
        document.removeEventListener('visibilitychange', refreshIfVisible)
      }
      if (intervalId) clearInterval(intervalId)
    }
  }, [router, pollMs, focus])

  return null
}
