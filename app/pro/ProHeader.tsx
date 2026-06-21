// app/pro/ProHeader.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useBrand } from '@/lib/brand/BrandProvider'
import { PRO_PUBLIC_PROFILE_PATH } from '@/lib/routes'
import ProAccountMenu from './_components/ProAccountMenu'

type ProHeaderProps = {
  businessName?: string | null
  subtitle?: string | null
  publicUrl?: string | null
  /**
   * Whether the pro migration/import flow is enabled (ENABLE_PRO_MIGRATION).
   * Resolved server-side and passed in so the client header never reads
   * process.env. When false the Import tab is omitted entirely.
   */
  migrationEnabled?: boolean
}

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
  { path: '/pro/calendar', title: 'Calendar' },
  { path: '/pro/notifications', title: 'Notifications' },
  { path: '/pro/clients', title: 'Clients' },
  { path: '/pro/profile', title: 'Profile' },
  { path: PRO_PUBLIC_PROFILE_PATH, title: 'Public Profile' },
  { path: '/pro/media', title: 'Media' },
  { path: '/pro/locations', title: 'Locations' },
  { path: '/pro/verification', title: 'Verification' },
  { path: '/pro/migrate', title: 'Import' },
]

const PRO_HEADER_TABS: ProHeaderTabItem[] = [
  { href: '/pro/dashboard', label: 'Overview', match: 'exact' },
  { href: '/pro/reviews', label: 'Reviews', match: 'prefix' },
  { href: '/pro/aftercare', label: 'Aftercare', match: 'prefix' },
  { href: '/pro/bookings', label: 'Bookings', match: 'prefix' },
  { href: '/pro/last-minute', label: 'Last Minute', match: 'prefix' },
  { href: '/pro/locations', label: 'Locations', match: 'prefix' },
]

// Only surfaced when the migration flag is on (see migrationEnabled prop). The
// flow lives behind ENABLE_PRO_MIGRATION, so with the flag off the tab would be
// a dead link that just redirects to the dashboard.
const PRO_MIGRATE_TAB: ProHeaderTabItem = {
  href: '/pro/migrate',
  label: 'Import',
  match: 'prefix',
}

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

export default function ProHeader({
  businessName,
  subtitle,
  publicUrl,
  migrationEnabled = false,
}: ProHeaderProps) {
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

            <div className="flex items-center gap-2">
              <NotificationsLink hasUnread={hasUnread} />

              <ProAccountMenu
                businessName={businessName}
                subtitle={subtitle}
                publicUrl={publicUrl}
                looksHref="/looks"
                proServicesHref={`${PRO_PUBLIC_PROFILE_PATH}?tab=services`}
                uploadHref="/pro/media/new"
                messagesHref="/messages"
              />
            </div>
          </div>

          <ProHeaderTabs pathname={pathname} migrationEnabled={migrationEnabled} />
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
  migrationEnabled,
}: {
  pathname: string
  migrationEnabled: boolean
}) {
  const tabs = migrationEnabled
    ? [...PRO_HEADER_TABS, PRO_MIGRATE_TAB]
    : PRO_HEADER_TABS

  return (
    <nav className="brand-pro-overview-tabs no-scroll" aria-label="Pro tabs">
      {tabs.map((tab) => (
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