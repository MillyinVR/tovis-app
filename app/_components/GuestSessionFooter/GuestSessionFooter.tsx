// app/_components/GuestSessionFooter/GuestSessionFooter.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, House, LogIn, UserPlus } from 'lucide-react'
import NavItem from '../navigation/FooterNavItem'
import TovisFeatherMark from '../footer/TovisFeatherMark'

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
  const loginActive =
    isActivePath(pathname, ROUTES.login) || isActivePath(pathname, ROUTES.signup)

  return (
    <div className="tovis-footer-root">
      <nav className="tovis-footer-bar" aria-label="Primary">
        <NavItem label="Home" href={ROUTES.home} icon={<House size={24} />} active={homeActive} />
        <NavItem label="Search" href={ROUTES.search} icon={<Compass size={24} />} active={searchActive} />

        {/* Center: the Looks feed, as the tovis feather mark */}
        <Link
          href={ROUTES.looks}
          className="tovis-center-lift no-underline tovis-focus"
          style={{ display: 'grid', placeItems: 'center' }}
          title="Looks"
          aria-label="Looks"
          aria-current={isActivePath(pathname, ROUTES.looks) ? 'page' : undefined}
        >
          <TovisFeatherMark size={66} />
        </Link>

        <NavItem label="Log in" href={ROUTES.login} icon={<LogIn size={24} />} active={loginActive} />
        <NavItem label="Sign up" href={ROUTES.signup} icon={<UserPlus size={24} />} active={isActivePath(pathname, ROUTES.signup)} />
      </nav>
    </div>
  )
}
