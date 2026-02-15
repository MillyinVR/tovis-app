// app/_components/GuestSessionFooter/GuestSessionFooter.tsx
'use client'

import { usePathname } from 'next/navigation'
import NavItem from '../navigation/FooterNavItem'

const ROUTES = {
  home: '/',
  search: '/search',
  looks: '/looks',
  login: '/login',
  signup: '/signup',
} as const

function isActivePath(pathname: string, href: string) {
  const base = href.split('?')[0]
  return pathname === base || pathname.startsWith(base + '/')
}

export default function GuestSessionFooter() {
  const pathname = usePathname()
  if (!pathname) return null

  const homeActive = isActivePath(pathname, ROUTES.home)
  const searchActive = isActivePath(pathname, ROUTES.search)
  const looksActive = isActivePath(pathname, ROUTES.looks)
  const loginActive = isActivePath(pathname, ROUTES.login) || isActivePath(pathname, ROUTES.signup)

  return (
    <div className="fixed inset-x-0 bottom-0 z-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Home" href={ROUTES.home} icon="🏠" active={homeActive} />

          <NavItem label="Search" href={ROUTES.search} icon="🗺️" active={searchActive} />

          {/* Center CTA: Looks */}
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

          <NavItem label="Log in" href={ROUTES.login} icon="🔑" active={loginActive} />

          <NavItem label="Sign up" href={ROUTES.signup} icon="✨" active={isActivePath(pathname, ROUTES.signup)} />
        </div>
      </div>
    </div>
  )
}