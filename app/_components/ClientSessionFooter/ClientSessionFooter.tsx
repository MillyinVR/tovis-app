// app/_components/ClientSessionFooter/ClientSessionFooter.tsx
'use client'

import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'
import BadgeDot from './BadgeDot'
import { useClientFooterBadge } from './useClientFooterBadge'

const ROUTES = {
  home: '/client',
  // ✅ new: search page you created
  search: '/search', // <-- change if your route is different (ex: '/client/search')
  // ✅ center CTA becomes Looks
  looks: '/looks',
  messages: '/messages',
  bookings: '/client/bookings',
} as const

function isActivePath(pathname: string, href: string) {
  const base = href.split('?')[0]
  return pathname === base || pathname.startsWith(base + '/')
}

function shouldHideOnPath(pathname: string) {
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) return true
  if (pathname.startsWith('/pro')) return true
  return false
}

export default function ClientSessionFooter({ messagesBadge }: { messagesBadge?: string | null }) {
  const pathname = usePathname()
  if (!pathname) return null
  if (shouldHideOnPath(pathname)) return null

  const fetched = useClientFooterBadge()
  const badge = messagesBadge ?? fetched

  const looksActive = isActivePath(pathname, ROUTES.looks)
  const searchActive = isActivePath(pathname, ROUTES.search)

  return (
    <div className="fixed inset-x-0 bottom-0 z-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Home" href={ROUTES.home} icon="🏠" active={isActivePath(pathname, ROUTES.home)} />

          {/* ✅ Looks slot becomes Search */}
          <NavItem label="Search" href={ROUTES.search} icon="🗺️" active={searchActive} />

          {/* ✅ Center action becomes Looks */}
          <div className="relative -mt-8 flex w-22 justify-center">
            <a
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
            </a>
          </div>

          <NavItem
            label="Messages"
            href={ROUTES.messages}
            icon="💬"
            active={isActivePath(pathname, ROUTES.messages)}
            rightSlot={badge ? <BadgeDot label={badge} /> : null}
          />

          <NavItem label="Bookings" href={ROUTES.bookings} icon="🗓️" active={isActivePath(pathname, ROUTES.bookings)} />
        </div>
      </div>
    </div>
  )
}
