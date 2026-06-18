// app/_components/AdminSessionFooter/AdminSessionFooter.tsx
'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  ArrowLeftRight,
  HeadphonesIcon,
  LayoutDashboard,
  Nfc,
  Scissors,
  UserCheck,
} from 'lucide-react'
import NavItem from '@/app/_components/navigation/FooterNavItem'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import SwitchAccountSheet from './SwitchAccountSheet'

type Props = {
  supportBadge?: string | null
  /** Workspaces the user can switch into (resolved server-side). */
  workspaces?: WorkspaceOption[]
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

export default function AdminSessionFooter({ supportBadge, workspaces = [] }: Props) {
  // If pathname is temporarily null during hydration, still render (don’t disappear).
  const pathname = usePathname() ?? ''
  const [switchOpen, setSwitchOpen] = useState(false)

  return (
    <div className="tovis-footer-root">
      <nav className="tovis-footer-bar tovis-footer-bar--wide" aria-label="Admin">
        <NavItem label="Dashboard" href={ROUTES.dashboard} icon={<LayoutDashboard size={20} />} active={isActivePath(pathname, ROUTES.dashboard)} />
        <NavItem label="Approve" href={ROUTES.approve} icon={<UserCheck size={20} />} active={isActivePath(pathname, ROUTES.approve)} />
        <NavItem label="Services" href={ROUTES.services} icon={<Scissors size={20} />} active={isActivePath(pathname, ROUTES.services)} />
        <NavItem label="NFC" href={ROUTES.nfc} icon={<Nfc size={20} />} active={isActivePath(pathname, ROUTES.nfc)} />
        <NavItem
          label="Support"
          href={ROUTES.support}
          icon={<HeadphonesIcon size={20} />}
          active={isActivePath(pathname, ROUTES.support)}
          rightSlot={
            supportBadge ? (
              <span
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  height: 18,
                  minWidth: 18,
                  padding: '0 4px',
                  borderRadius: 999,
                  background: 'rgb(var(--tone-danger))',
                  color: '#fff',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  boxShadow: '0 10px 22px rgb(0 0 0 / 0.35)',
                }}
              >
                {supportBadge}
              </span>
            ) : null
          }
        />

        {/* Switch account — opens the sheet that also houses Sign out */}
        <button
          type="button"
          onClick={() => setSwitchOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={switchOpen}
          className="tovis-focus"
          style={{
            display: 'grid',
            gap: 4,
            justifyItems: 'center',
            padding: '0 6px',
            border: 'none',
            background: 'transparent',
            color: 'rgb(var(--text-muted))',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true" style={{ display: 'flex' }}>
            <ArrowLeftRight size={20} />
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Switch
          </span>
        </button>
      </nav>

      <SwitchAccountSheet
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        options={workspaces}
      />
    </div>
  )
}
