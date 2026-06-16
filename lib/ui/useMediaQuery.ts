// lib/ui/useMediaQuery.ts
'use client'

import { useSyncExternalStore } from 'react'

/**
 * SSR-safe media-query hook. Returns whether `query` currently matches,
 * subscribing to changes via matchMedia. During SSR / first paint it returns
 * `serverDefault` (default false → mobile-first), then reconciles on the
 * client. Use sparingly — prefer Tailwind responsive utilities in markup.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  )
}
