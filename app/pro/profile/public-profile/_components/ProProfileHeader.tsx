// app/pro/profile/public-profile/_components/ProProfileHeader.tsx
import Link from 'next/link'

import type { ProProfileManagementRoutes } from '../_data/proProfileManagementTypes'

const DEFAULT_NOTIFICATIONS_HREF = '/pro/notifications'

type ProProfileHeaderProps = {
  routes: ProProfileManagementRoutes
  unreadNotificationCount: number
  title?: string
  notificationsHref?: string
}

export default function ProProfileHeader({
  routes,
  unreadNotificationCount,
  title = 'Public Profile',
  notificationsHref = DEFAULT_NOTIFICATIONS_HREF,
}: ProProfileHeaderProps) {
  const hasUnreadNotifications = unreadNotificationCount > 0
  const notificationLabel = hasUnreadNotifications
    ? `Notifications, ${unreadNotificationCount} unread`
    : 'Notifications'

  return (
    <header className="brand-pro-profile-header">
      <div className="brand-pro-profile-header-row">
        <Link
          href={routes.proHome}
          className="brand-pro-profile-back brand-focus"
        >
          <span aria-hidden="true">‹</span>
          Back
        </Link>

        <div className="brand-pro-profile-title">{title}</div>

        <Link
          href={notificationsHref}
          className="brand-icon-button brand-focus"
          aria-label={notificationLabel}
          title={notificationLabel}
        >
          <span aria-hidden="true">🔔</span>

          {hasUnreadNotifications ? (
            <span className="brand-notification-dot" aria-hidden="true" />
          ) : null}
        </Link>
      </div>
    </header>
  )
}