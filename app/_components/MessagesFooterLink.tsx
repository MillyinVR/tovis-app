// app/_components/MessagesFooterLink.tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function MessagesFooterLink() {
  const [count, setCount] = useState<number>(0)

  async function refresh() {
    try {
      const res = await fetch('/api/messages/unread-count', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) setCount(Number(data.count || 0))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 8000) // light polling
    return () => window.clearInterval(t)
  }, [])

  return (
    <Link href="/messages" className="relative inline-flex items-center justify-center">
      <span className="text-[12px] font-black">Messages</span>

      {count > 0 ? (
        <span className="absolute -right-3 -top-2 rounded-full bg-accentPrimary px-2 py-0.5 text-[10px] font-black text-bgPrimary">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
