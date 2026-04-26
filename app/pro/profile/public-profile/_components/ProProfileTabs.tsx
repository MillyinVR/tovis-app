// app/pro/profile/public-profile/_components/ProProfileTabs.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

import type {
  ProProfileManagementRoutes,
  ProProfileManagementTab,
} from '../_data/proProfileManagementTypes'

type ProProfileTabsProps = {
  activeTab: ProProfileManagementTab
  routes: ProProfileManagementRoutes
}

type ProProfileTabItem = {
  id: ProProfileManagementTab
  label: string
  href: string
}

export default function ProProfileTabs({
  activeTab,
  routes,
}: ProProfileTabsProps) {
  const tabs = buildProProfileTabs(routes)

  return (
    <nav
      className="brand-pro-profile-tabs"
      aria-label="Professional profile sections"
    >
      {tabs.map((tab) => (
        <ProProfileTabLink
          key={tab.id}
          href={tab.href}
          active={activeTab === tab.id}
        >
          {tab.label}
        </ProProfileTabLink>
      ))}
    </nav>
  )
}

function buildProProfileTabs(
  routes: ProProfileManagementRoutes,
): ProProfileTabItem[] {
  return [
    {
      id: 'portfolio',
      label: 'portfolio',
      href: routes.proPublicProfile,
    },
    {
      id: 'services',
      label: 'services',
      href: `${routes.proPublicProfile}?tab=services`,
    },
    {
      id: 'reviews',
      label: 'reviews',
      href: `${routes.proPublicProfile}?tab=reviews`,
    },
  ]
}

function ProProfileTabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className="brand-pro-profile-tab brand-focus"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  )
}