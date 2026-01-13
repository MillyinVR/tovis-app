// app/pro/ProTopTabs.tsx
'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Tab = { href: string; label: string; match?: 'exact' | 'prefix' }

const tabs: Tab[] = [
  { href: '/pro/dashboard', label: 'Overview', match: 'exact' },
  { href: '/pro/services', label: 'Services', match: 'prefix' },
  { href: '/pro/reviews', label: 'Reviews', match: 'prefix' },
  { href: '/pro/aftercare', label: 'Aftercare', match: 'prefix' },
  { href: '/pro/bookings', label: 'Bookings', match: 'prefix' },
  { href: '/pro/last-minute', label: 'Last Minute', match: 'prefix' },
  { href: '/pro/store', label: 'Store', match: 'prefix' },
  { href: '/pro/trending-services', label: 'Trending Services', match: 'prefix' },
]

function isActive(pathname: string | null, tab: Tab) {
  if (!pathname) return false
  if (tab.match === 'exact') return pathname === tab.href
  return pathname === tab.href || pathname.startsWith(tab.href + '/')
}

export default function ProTopTabs() {
  const pathname = usePathname()
  const search = useSearchParams()
  const month = search?.get('month')
  const withMonth = (href: string) => (month ? `${href}?month=${encodeURIComponent(month)}` : href)

  return (
    <div className="sticky z-40 border-b border-white/10 bg-bgPrimary/80 backdrop-blur"
         style={{ top: 48 }}>
      <nav className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {tabs.map((t) => {
          const active = isActive(pathname, t)

          return (
            <Link
              key={t.href}
              href={withMonth(t.href)}
              className={[
                'inline-flex shrink-0 items-center rounded-full border px-3 py-2 text-[12px] font-black transition',
                active
                  ? 'border-white/20 bg-bgSecondary text-textPrimary'
                  : 'border-transparent bg-transparent text-textSecondary hover:border-white/10 hover:bg-bgSecondary/60',
              ].join(' ')}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
