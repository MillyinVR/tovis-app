// app/(main)/booking/AvailabilityDrawer/hooks/useDebugFlag.ts

'use client'

import { useEffect, useState } from 'react'

/**
 * Enable via:
 *  - URL: ?debug=availability
 *  - localStorage: localStorage.setItem('debug:availability', '1')
 */
export function useDebugFlag() {
  const [debug, setDebug] = useState(false)

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const qs = url.searchParams.get('debug')
      const ls = window.localStorage.getItem('debug:availability')
      setDebug(qs === 'availability' || ls === '1')
    } catch {
      setDebug(false)
    }
  }, [])

  return debug
}
