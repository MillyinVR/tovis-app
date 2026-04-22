// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import BadgeDot from './BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'
import { CLIENT_TABS } from '@/app/config/clientNav'

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
        background: 'linear-gradient(transparent, rgba(10,9,7,0.85) 40%)',
      }}
    >
      <div>
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
                    width: 52,
                    height: 52,
                    backgroundColor: 'var(--terra, #E05A28)',
                    color: '#ffffff',
                    boxShadow: '0 8px 24px rgba(224,90,40,0.45)',
                  }}
                  title={tab.label}
                  aria-label={tab.label}
                >
                  <Icon size={22} aria-hidden="true" />
                </Link>
              )
            }

            return (
              <NavItem
                key={tab.id}
                label={tab.label}
                href={tab.href}
                icon={<Icon size={20} />}
                active={active}
                rightSlot={tab.hasBadge && badge ? <BadgeDot label={badge} /> : null}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

