// app/pro/ProHeader.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useBrand } from '@/lib/brand/BrandProvider'

type NotificationSummaryResponse = {
  hasUnread: boolean
  count: number
}

type ProHeaderRouteTitle = {
  path: string
  title: string
}

type ProHeaderTabItem = {
  href: string
  label: string
  match: 'exact' | 'prefix'
}

const PRO_HEADER_ROUTE_TITLES: ProHeaderRouteTitle[] = [
  { path: '/pro/dashboard', title: 'Overview' },
  { path: '/pro/reviews', title: 'Reviews' },
  { path: '/pro/aftercare', title: 'Aftercare' },
  { path: '/pro/bookings', title: 'Bookings' },
  { path: '/pro/last-minute', title: 'Last Minute' },
  { path: '/pro/store', title: 'Store' },
  { path: '/pro/calendar', title: 'Calendar' },
  { path: '/pro/notifications', title: 'Notifications' },
  { path: '/pro/clients', title: 'Clients' },
  { path: '/pro/profile', title: 'Profile' },
  { path: '/pro/public-profile', title: 'Public Profile' },
  { path: '/pro/media', title: 'Media' },
]

const PRO_HEADER_TABS: ProHeaderTabItem[] = [
  { href: '/pro/dashboard', label: 'Overview', match: 'exact' },
  { href: '/pro/reviews', label: 'Reviews', match: 'prefix' },
  { href: '/pro/aftercare', label: 'Aftercare', match: 'prefix' },
  { href: '/pro/bookings', label: 'Bookings', match: 'prefix' },
  { href: '/pro/last-minute', label: 'Last Minute', match: 'prefix' },
  { href: '/pro/store', label: 'Store', match: 'prefix' },
]

function titleFromPath(pathname: string | null, brandName: string): string {
  if (!pathname) return `${brandName} Pro`

  const routeTitle = PRO_HEADER_ROUTE_TITLES.find((route) =>
    pathname.startsWith(route.path),
  )

  return routeTitle?.title ?? `${brandName} Pro`
}

function isTabActive(pathname: string, tab: ProHeaderTabItem): boolean {
  if (tab.match === 'exact') {
    return pathname === tab.href
  }

  return pathname === tab.href || pathname.startsWith(`${tab.href}/`)
}

export default function ProHeader() {
  const pathname = usePathname()
  const { brand } = useBrand()
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    if (!pathname?.startsWith('/pro')) return

    let cancelled = false

    async function loadNotificationSummary() {
      try {
        const response = await fetch('/api/pro/notifications/summary', {
          cache: 'no-store',
        })

        if (!response.ok) return

        const data: NotificationSummaryResponse = await response.json()

        if (!cancelled) {
          setHasUnread(data.hasUnread)
        }
      } catch {
        // Notification state is non-critical UI.
      }
    }

    loadNotificationSummary()

    return () => {
      cancelled = true
    }
  }, [pathname])

  if (!pathname?.startsWith('/pro')) return null

  const title = titleFromPath(pathname, brand.displayName)

  return (
    <header className="brand-pro-app-header">
      <div className="brand-pro-app-header-shell">
        <div className="brand-pro-overview-header">
          <div className="brand-pro-overview-header-row">
            <div>
              <div className="brand-cap brand-pro-overview-kicker">
                ◆ PRO MODE
              </div>

              <h1 id="pro-page-title" className="brand-pro-overview-title">
                {title}
              </h1>
            </div>

            <NotificationsLink hasUnread={hasUnread} />
          </div>

          <ProHeaderTabs pathname={pathname} />
        </div>
      </div>
    </header>
  )
}

function NotificationsLink({
  hasUnread,
}: {
  hasUnread: boolean
}) {
  return (
    <Link
      href="/pro/notifications"
      className="brand-pro-overview-bell brand-focus"
      aria-label="Notifications"
      title="Notifications"
    >
      <BellIcon />

      {hasUnread ? (
        <span
          className="brand-pro-overview-bell-dot"
          aria-hidden="true"
        />
      ) : null}
    </Link>
  )
}

function ProHeaderTabs({
  pathname,
}: {
  pathname: string
}) {
  return (
    <nav className="brand-pro-overview-tabs no-scroll" aria-label="Pro tabs">
      {PRO_HEADER_TABS.map((tab) => (
        <ProHeaderTab
          key={tab.href}
          tab={tab}
          active={isTabActive(pathname, tab)}
        />
      ))}
    </nav>
  )
}

function ProHeaderTab({
  tab,
  active,
}: {
  tab: ProHeaderTabItem
  active: boolean
}) {
  return (
    <Link
      href={tab.href}
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      className="brand-pro-overview-tab brand-focus"
    >
      {tab.label}
    </Link>
  )
}

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="brand-pro-overview-icon"
    >
      <path
        d="M12 22a2.4 2.4 0 0 0 2.35-1.9h-4.7A2.4 2.4 0 0 0 12 22Zm7.2-5.4-1.65-1.65V10a5.58 5.58 0 0 0-4.35-5.45V3.7a1.2 1.2 0 0 0-2.4 0v.85A5.58 5.58 0 0 0 6.45 10v4.95L4.8 16.6a1 1 0 0 0 .7 1.7h13a1 1 0 0 0 .7-1.7Z"
        fill="currentColor"
      />
    </svg>
  )
}