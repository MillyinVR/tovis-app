// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import BadgeDot from './BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'

const ROUTES = {
  home: '/client',
  search: '/search',
  looks: '/looks',
  messages: '/messages',
  bookings: '/client/bookings',
} as const

function isActivePath(pathname: string, href: string) {
  const base = href.split('?')[0]
  return pathname === base || pathname.startsWith(base + '/')
}

export default function ClientSessionFooter({ messagesBadge }: { messagesBadge?: string | null }) {
  const pathname = usePathname()
  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })

  const path = pathname ?? ''

  const looksActive = isActivePath(path, ROUTES.looks)
  const searchActive = isActivePath(path, ROUTES.search)

  return (
    <div className="w-full pt-8" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Home" href={ROUTES.home} icon="🏠" active={isActivePath(path, ROUTES.home)} />
          <NavItem label="Search" href={ROUTES.search} icon="🗺️" active={searchActive} />

          <div className="relative -mt-8 flex w-22 justify-center">
            <Link
              href={ROUTES.looks}
              className={[
                'tovis-glass',
                'grid h-16 w-16 place-items-center rounded-full border border-white/15',
                'text-[11px] font-black text-textPrimary',
                'hover:border-white/25 active:scale-[0.98]',
                'ring-2 ring-white/10',
                looksActive ? 'border-white/25 ring-white/20' : '',
                'no-underline',
              ].join(' ')}
              title="Looks"
              aria-label="Looks"
            >
              <span className="leading-none">Looks</span>
            </Link>
          </div>

          <NavItem
            label="Messages"
            href={ROUTES.messages}
            icon="💬"
            active={isActivePath(path, ROUTES.messages)}
            rightSlot={badge ? <BadgeDot label={badge} /> : null}
          />

          <NavItem label="Bookings" href={ROUTES.bookings} icon="🗓️" active={isActivePath(path, ROUTES.bookings)} />
        </div>
      </div>
    </div>
  )
}