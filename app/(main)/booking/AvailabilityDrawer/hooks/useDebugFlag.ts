// app/(main)/booking/AvailabilityDrawer/hooks/useDebugFlag.ts
'use client'

import { useState } from 'react'

const DEBUG_QUERY_VALUE = 'availability'
const DEBUG_STORAGE_KEY = 'debug:availability'
const DEBUG_STORAGE_ENABLED_VALUE = '1'

function readDebugFlag(): boolean {
  if (typeof window === 'undefined') return false

  try {
    const url = new URL(window.location.href)
    const queryValue = url.searchParams.get('debug')
    const storageValue = window.localStorage.getItem(DEBUG_STORAGE_KEY)

    return (
      queryValue === DEBUG_QUERY_VALUE ||
      storageValue === DEBUG_STORAGE_ENABLED_VALUE
    )
  } catch {
    return false
  }
}

/**
 * Enable via:
 * - URL: ?debug=availability
 * - localStorage: localStorage.setItem('debug:availability', '1')
 */
export function useDebugFlag(): boolean {
  const [debug] = useState(readDebugFlag)

  return debug
}