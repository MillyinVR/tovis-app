// app/_components/GuestSessionFooter/GuestSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, House, LogIn, UserPlus } from 'lucide-react'
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
  // If pathname is temporarily null during hydration, still render (don’t disappear).
  const pathname = usePathname() ?? ''

  const homeActive = isActivePath(pathname, ROUTES.home)
  const searchActive = isActivePath(pathname, ROUTES.search)
  const looksActive = isActivePath(pathname, ROUTES.looks)
  const loginActive = isActivePath(pathname, ROUTES.login) || isActivePath(pathname, ROUTES.signup)

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
          <NavItem label="Home" href={ROUTES.home} icon={<House size={20} />} active={homeActive} />
          <NavItem label="Search" href={ROUTES.search} icon={<Compass size={20} />} active={searchActive} />

          {/* Center CTA: Looks */}
          <Link
            href={ROUTES.looks}
            className="grid place-items-center rounded-full hover:opacity-90 active:scale-[0.98] no-underline"
            style={{
              width: 52,
              height: 52,
              backgroundColor: 'var(--terra, #E05A28)',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(224,90,40,0.45)',
            }}
            title="Looks"
            aria-label="Looks"
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Looks
            </span>
          </Link>

          <NavItem label="Log in" href={ROUTES.login} icon={<LogIn size={20} />} active={loginActive} />
          <NavItem label="Sign up" href={ROUTES.signup} icon={<UserPlus size={20} />} active={isActivePath(pathname, ROUTES.signup)} />
        </div>
      </div>
    </div>
  )
}