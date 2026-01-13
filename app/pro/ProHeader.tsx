// app/pro/ProHeader.tsx
'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type SummaryResponse = { hasUnread: boolean; count: number }

function titleFromPath(pathname: string | null): string {
  if (!pathname) return 'TOVIS Pro'
  if (pathname === '/pro/dashboard') return 'Professional Dashboard'
  if (pathname.startsWith('/pro/calendar')) return 'Calendar'
  if (pathname.startsWith('/pro/notifications')) return 'Notifications'
  if (pathname.startsWith('/pro/bookings')) return 'Bookings'
  if (pathname.startsWith('/pro/clients')) return 'Clients'
  if (pathname.startsWith('/pro/profile')) return 'Profile'
  if (pathname.startsWith('/pro/public-profile')) return 'Public Profile'
  if (pathname.startsWith('/pro/media')) return 'Media'
  return 'TOVIS Pro'
}

export default function ProHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadSummary() {
      try {
        const res = await fetch('/api/pro/notifications/summary', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as SummaryResponse
        if (!cancelled) setHasUnread(!!data.hasUnread)
      } catch {
        // ignore
      }
    }

    if (pathname?.startsWith('/pro')) loadSummary()
    return () => {
      cancelled = true
    }
  }, [pathname])

  if (!pathname?.startsWith('/pro')) return null

  const title = titleFromPath(pathname)

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-bgPrimary/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-3 font-sans">
        {/* Back */}
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          <span className="text-[16px] leading-none">‹</span>
          <span>Back</span>
        </button>

        {/* Title */}
        <div className="px-3 text-center text-[13px] font-black text-textPrimary">
          {title}
        </div>

        {/* Bell */}
        <button
          type="button"
          onClick={() => router.push('/pro/notifications')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20"
          aria-label="Notifications"
        >
          <span className="text-[16px]">🔔</span>
          {hasUnread && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-toneDanger ring-2 ring-bgSecondary" />
          )}
        </button>
      </div>
    </header>
  )
}
