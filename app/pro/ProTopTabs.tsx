// app/pro/ProTopTabs.tsx

'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

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

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const update = () => {
      setHasOverflow(el.scrollWidth > el.clientWidth + 2)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  return (
    <div
      className="sticky z-40 border-b border-white/10 bg-bgPrimary/80 backdrop-blur"
      style={{ top: 48 }}
    >
      {/* subtle top highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

      <div className="relative mx-auto max-w-5xl">
        <div
          ref={scrollerRef}
          className="flex gap-2 overflow-x-auto px-3 py-2 looksNoScrollbar"
        >
          {tabs.map((t) => {
            const active = isActive(pathname, t)

            return (
              <Link
                key={t.href}
                href={withMonth(t.href)}
                className={[
                  'relative shrink-0 rounded-full px-4 py-2 text-[12px] font-black transition-all duration-300',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                  active
                    ? [
                        // ACTIVE = luxe, tactile, magnetic
                        'bg-bgSecondary/90 text-textPrimary',
                        'border border-white/20',
                        'shadow-[0_8px_30px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)]',
                        'scale-[1.04]',
                      ].join(' ')
                    : [
                        // INACTIVE = calm, secondary
                        'text-textSecondary',
                        'border border-transparent',
                        'hover:bg-bgSecondary/60 hover:text-textPrimary',
                        'hover:shadow-[0_4px_18px_rgba(0,0,0,0.25)]',
                      ].join(' '),
                ].join(' ')}
              >
                {t.label}
              </Link>
            )
          })}
        </div>

        {/* Stronger edge fades (intentional, not shy) */}
        {hasOverflow && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-bgPrimary via-bgPrimary/90 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bgPrimary via-bgPrimary/90 to-transparent" />
          </>
        )}

        {/* bottom depth */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-transparent to-black/15" />
      </div>
    </div>
  )
}
