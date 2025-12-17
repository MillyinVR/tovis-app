// app/pro/ProHeader.tsx
'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type SummaryResponse = {
  hasUnread: boolean
  count: number
}

function titleFromPath(pathname: string | null): string {
  if (!pathname) return 'TOVIS Pro'

  if (pathname === '/pro') return 'Professional Dashboard'
  if (pathname.startsWith('/pro/calendar')) return 'Calendar'
  if (pathname.startsWith('/pro/notifications')) return 'Notifications'
  if (pathname.startsWith('/pro/bookings')) return 'Bookings'
  if (pathname.startsWith('/pro/clients')) return 'Clients'
  if (pathname.startsWith('/pro/profile')) return 'Profile'

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
        const res = await fetch('/api/pro/notifications/summary', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as SummaryResponse
        if (!cancelled) {
          setHasUnread(!!data.hasUnread)
        }
      } catch {
        // ignore, header still works
      }
    }

    // only on /pro subtree
    if (pathname && pathname.startsWith('/pro')) {
      loadSummary()
    }

    return () => {
      cancelled = true
    }
  }, [pathname])

  // Don’t show header at all outside /pro
  if (!pathname || !pathname.startsWith('/pro')) {
    return null
  }

  const title = titleFromPath(pathname)

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        padding: '8px 12px',
        background: '#ffffff',
        borderBottom: '1px solid #e5e5e5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 50,
        fontFamily: 'system-ui',
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.back()}
        style={{
          border: 'none',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 13,
          color: '#111',
        }}
      >
        <span style={{ fontSize: 18 }}>‹</span>
        <span>Back</span>
      </button>

      {/* Page title */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          textAlign: 'center',
          flex: 1,
        }}
      >
        {title}
      </div>

      {/* Bell → notifications page */}
      <button
        type="button"
        onClick={() => router.push('/pro/notifications')}
        style={{
          border: 'none',
          background: 'transparent',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 18 }}>🔔</span>
        {hasUnread && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#ef4444',
              border: '1px solid #fff',
            }}
          />
        )}
      </button>
    </header>
  )
}
