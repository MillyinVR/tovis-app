// app/_components/ClientSessionFooter/useClientFooterBadge.ts
'use client'

import { useEffect, useState } from 'react'

function normalizeBadge(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

export function useClientFooterBadge() {
  const [badge, setBadge] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/client/footer', { method: 'GET', cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((data: any) => {
        if (cancelled) return
        if (data?.ok !== true) return
        setBadge(normalizeBadge(data?.inboxBadge))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return badge
}
