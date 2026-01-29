// app/pro/notifications/MarkReadOnMount.tsx
'use client'

import { useEffect } from 'react'

export default function MarkReadOnMount() {
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch('/api/pro/notifications/mark-read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          keepalive: true,
        })

        if (!res.ok && !cancelled) {
          // ignore (silent)
        }
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
