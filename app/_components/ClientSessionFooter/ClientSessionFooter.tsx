// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import { isActivePath } from '../navigation/activePath'
import BadgeDot from './BadgeDot'
import LooksMark from '../footer/LooksMark'
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

  // The bar is split around the raised mark rather than rendered as one flat
  // row. With six tabs the flanks are uneven (2 left, 3 right), and a flat
  // `space-around` row would drift the mark ~20px toward the short side; the
  // matching 1fr flanks of .tovis-footer-bar--split pin it to the true centre.
  // Derived from `center` in CLIENT_TABS, so moving the mark in config moves the
  // split with it.
  const centerIndex = CLIENT_TABS.findIndex((tab) => tab.center)
  const hasCenter = centerIndex >= 0
  const leftTabs = hasCenter ? CLIENT_TABS.slice(0, centerIndex) : CLIENT_TABS
  const centerTab = hasCenter ? CLIENT_TABS[centerIndex] : null
  const rightTabs = hasCenter ? CLIENT_TABS.slice(centerIndex + 1) : []

  const renderTab = (tab: (typeof CLIENT_TABS)[number]) => {
    const Icon = tab.icon

    return (
      <NavItem
        key={tab.id}
        label={tab.label}
        href={tab.href}
        icon={<Icon size={24} />}
        active={isActivePath(path, tab.href)}
        rightSlot={tab.hasBadge && badge ? <BadgeDot label={badge} /> : null}
      />
    )
  }

  return (
    <div className="tovis-footer-root">
      <nav
        className="tovis-footer-bar tovis-footer-bar--split"
        aria-label="Primary"
      >
        <div className="tovis-footer-group">{leftTabs.map(renderTab)}</div>

        {centerTab ? (
          <Link
            href={centerTab.href}
            className="tovis-center-lift no-underline tovis-focus"
            style={{ display: 'grid', placeItems: 'center' }}
            title={centerTab.label}
            aria-label={centerTab.label}
            aria-current={
              isActivePath(path, centerTab.href) ? 'page' : undefined
            }
          >
            <LooksMark size={66} />
          </Link>
        ) : null}

        <div className="tovis-footer-group">{rightTabs.map(renderTab)}</div>
      </nav>
    </div>
  )
}
