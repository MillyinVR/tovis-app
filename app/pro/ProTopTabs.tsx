'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Tab = {
  href: string
  label: string
  match?: 'exact' | 'prefix'
}

const tabs: Tab[] = [
  { href: '/pro', label: 'Overview', match: 'exact' },
  { href: '/pro/services', label: 'Services', match: 'prefix' },
  { href: '/pro/reviews', label: 'Reviews', match: 'prefix' },
  { href: '/pro/aftercare', label: 'Aftercare', match: 'prefix' },
  { href: '/pro/bookings', label: 'Bookings', match: 'prefix' },
  { href: '/pro/last-minute', label: 'Last Minute', match: 'prefix' },
  { href: '/pro/store', label: 'Store', match: 'prefix' }, // placeholder
  { href: '/pro/trending-services', label: 'Trending Services', match: 'prefix' }, // placeholder
]

function isActive(pathname: string | null, tab: Tab) {
  if (!pathname) return false
  if (tab.match === 'exact') return pathname === tab.href
  return pathname === tab.href || pathname.startsWith(tab.href + '/')
}

export default function ProTopTabs() {
  const pathname = usePathname()
  const search = useSearchParams()

  // Keep the month selector when moving around, if present
  const month = search?.get('month')
  const withMonth = (href: string) => (month ? `${href}?month=${encodeURIComponent(month)}` : href)

  return (
    <div
      style={{
        position: 'sticky',
        top: 56, // sits under ProHeader (your layout already pads for header)
        zIndex: 150,
        background: '#fff',
        borderBottom: '1px solid #eee',
      }}
    >
      <nav
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '10px 16px',
          display: 'flex',
          gap: 14,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((t) => {
          const active = isActive(pathname, t)
          return (
            <Link
              key={t.href}
              href={withMonth(t.href)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 999,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: active ? 900 : 700,
                color: active ? '#111' : '#6b7280',
                border: active ? '1px solid #111' : '1px solid transparent',
                background: active ? '#f9fafb' : 'transparent',
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
