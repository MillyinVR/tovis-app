// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import { isActivePath } from '../navigation/activePath'
import BadgeDot from './BadgeDot'
import TovisFeatherMark from '../footer/TovisFeatherMark'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'
import { CLIENT_TABS } from '@/app/config/clientNav'

export default function ClientSessionFooter({
  messagesBadge,
}: {
  messagesBadge?: string | null
}) {
  const pathname = usePathname()
  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })
  const path = pathname ?? ''

  return (
    <div className="tovis-footer-root">
      <nav className="tovis-footer-bar" aria-label="Primary">
        {CLIENT_TABS.map((tab) => {
          const active = isActivePath(path, tab.href)
          const Icon = tab.icon

          if (tab.center) {
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className="tovis-center-lift no-underline tovis-focus"
                style={{ display: 'grid', placeItems: 'center' }}
                title={tab.label}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
              >
                <TovisFeatherMark size={66} />
              </Link>
            )
          }

          return (
            <NavItem
              key={tab.id}
              label={tab.label}
              href={tab.href}
              icon={<Icon size={24} />}
              active={active}
              rightSlot={tab.hasBadge && badge ? <BadgeDot label={badge} /> : null}
            />
          )
        })}
      </nav>
    </div>
  )
}
