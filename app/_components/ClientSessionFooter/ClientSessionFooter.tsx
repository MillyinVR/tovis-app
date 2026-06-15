// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import BadgeDot from './BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'
import { CLIENT_TABS, CENTER_BUTTON } from '@/app/config/clientNav'

function isActivePath(pathname: string, href: string) {
  const base = href.split('?')[0]
  return pathname === base || pathname.startsWith(base + '/')
}

export default function ClientSessionFooter({ messagesBadge }: { messagesBadge?: string | null }) {
  const pathname = usePathname()
  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })
  const path = pathname ?? ''

  return (
    <div
      className="w-full"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: 'rgb(var(--bg-primary))',
      }}
    >
      <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-around px-4">
        {CLIENT_TABS.map((tab) => {
          const active = isActivePath(path, tab.href)
          const Icon = tab.icon

          if (tab.center) {
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className="grid place-items-center rounded-full hover:opacity-90 active:scale-[0.98] no-underline"
                style={{
                  width: 68,
                  height: 68,
                  position: 'relative',
                  top: -14,
                  backgroundColor: active ? CENTER_BUTTON.bgActive : CENTER_BUTTON.bgInactive,
                  color: active ? CENTER_BUTTON.colorActive : CENTER_BUTTON.colorInactive,
                  boxShadow: active ? CENTER_BUTTON.shadowActive : CENTER_BUTTON.shadowInactive,
                }}
                title={tab.label}
                aria-label={tab.label}
              >
                <Icon size={30} aria-hidden="true" />
              </Link>
            )
          }

          return (
            <NavItem
              key={tab.id}
              label={tab.label}
              href={tab.href}
              icon={<Icon size={28} />}
              active={active}
              rightSlot={tab.hasBadge && badge ? <BadgeDot label={badge} /> : null}
            />
          )
        })}
      </div>
    </div>
  )
}