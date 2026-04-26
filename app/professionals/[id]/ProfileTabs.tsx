// app/professionals/[id]/ProfileTabs.tsx
// app/professionals/[id]/ProfileTabs.tsx
import Link from 'next/link'

import type {
  PublicProfileTab,
  PublicProfileTabItem,
} from '@/lib/profiles/publicProfileFormatting'

type ProfileTabLink = PublicProfileTabItem & {
  href: string
}

type ProfileTabsProps = {
  tabs: ProfileTabLink[]
  activeTab: PublicProfileTab
}

export default function ProfileTabs({ tabs, activeTab }: ProfileTabsProps) {
  return (
    <nav
      className="brand-profile-divider flex gap-6 px-5"
      aria-label="Professional profile sections"
    >
      {tabs.map((tab) => (
        <ProfileTab
          key={tab.id}
          href={tab.href}
          active={activeTab === tab.id}
        >
          {tab.label}
        </ProfileTab>
      ))}
    </nav>
  )
}

function ProfileTab({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: string
}) {
  return (
    <Link
      href={href}
      className="brand-profile-tab brand-focus py-3"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  )
}