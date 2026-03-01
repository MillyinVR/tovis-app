// app/_components/AdminSessionFooter/AdminSessionFooter.tsx
'use client'

import { usePathname } from 'next/navigation'
import NavItem from '@/app/_components/navigation/FooterNavItem'

type Props = {
  supportBadge?: string | null
}

const ROUTES = {
  dashboard: '/admin',
  approve: '/admin/professionals',
  services: '/admin/services',
  nfc: '/admin/nfc',
  support: '/admin/support',
} as const

function isActivePath(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function AdminSessionFooter({ supportBadge }: Props) {
  // If pathname is temporarily null during hydration, still render (don’t disappear).
  const pathname = usePathname() ?? ''

  return (
    <div className="w-full" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-[1100px] items-center justify-between px-4">
          <NavItem label="Dashboard" href={ROUTES.dashboard} icon="⌂" active={isActivePath(pathname, ROUTES.dashboard)} />
          <NavItem label="Approve" href={ROUTES.approve} icon="✓" active={isActivePath(pathname, ROUTES.approve)} />
          <NavItem label="Services" href={ROUTES.services} icon="✦" active={isActivePath(pathname, ROUTES.services)} />
          <NavItem label="NFC" href={ROUTES.nfc} icon="⌁" active={isActivePath(pathname, ROUTES.nfc)} />
          <NavItem
            label="Support"
            href={ROUTES.support}
            icon="❢"
            active={isActivePath(pathname, ROUTES.support)}
            rightSlot={
              supportBadge ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-toneDanger px-1 text-[10px] font-black text-white shadow-[0_10px_22px_rgb(0_0_0/0.35)]">
                  {supportBadge}
                </span>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  )
}