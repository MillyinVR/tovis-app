// app/_components/AdminSessionFooter/AdminSessionFooter.tsx
'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  ArrowLeftRight,
  Bell,
  HeadphonesIcon,
  LayoutDashboard,
  Nfc,
  Scissors,
  UserCheck,
} from 'lucide-react'
import NavItem from '@/app/_components/navigation/FooterNavItem'
import { isActivePath } from '@/app/_components/navigation/activePath'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import SwitchAccountSheet from './SwitchAccountSheet'

type Props = {
  supportBadge?: string | null
  /** Unread admin-notification count badge. */
  notificationsBadge?: string | null
  /** Workspaces the user can switch into (resolved server-side). */
  workspaces?: WorkspaceOption[]
}

const ROUTES = {
  dashboard: '/admin',
  approve: '/admin/professionals',
  services: '/admin/services',
  nfc: '/admin/nfc',
  support: '/admin/support',
  notifications: '/admin/notifications',
} as const

/** Small red count pill shared by the footer's badged nav items. */
function CountBadge({ value }: { value?: string | null }) {
  if (!value) return null

  return (
    <span
      style={{
        display: 'grid',
        placeItems: 'center',
        height: 18,
        minWidth: 18,
        padding: '0 4px',
        borderRadius: 999,
        background: 'rgb(var(--tone-danger))',
        color: 'rgb(var(--on-accent))',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: '0 10px 22px rgb(0 0 0 / 0.35)',
      }}
    >
      {value}
    </span>
  )
}

export default function AdminSessionFooter({
  supportBadge,
  notificationsBadge,
  workspaces = [],
}: Props) {
  // If pathname is temporarily null during hydration, still render (don’t disappear).
  const pathname = usePathname() ?? ''
  const [switchOpen, setSwitchOpen] = useState(false)

  return (
    <div className="tovis-footer-root">
      <nav className="tovis-footer-bar tovis-footer-bar--wide" aria-label="Admin">
        <NavItem label="Dashboard" href={ROUTES.dashboard} icon={<LayoutDashboard size={20} />} active={isActivePath(pathname, ROUTES.dashboard, { exact: true })} />
        <NavItem label="Approve" href={ROUTES.approve} icon={<UserCheck size={20} />} active={isActivePath(pathname, ROUTES.approve)} />
        <NavItem label="Services" href={ROUTES.services} icon={<Scissors size={20} />} active={isActivePath(pathname, ROUTES.services)} />
        <NavItem label="NFC" href={ROUTES.nfc} icon={<Nfc size={20} />} active={isActivePath(pathname, ROUTES.nfc)} />
        <NavItem
          label="Alerts"
          href={ROUTES.notifications}
          icon={<Bell size={20} />}
          active={isActivePath(pathname, ROUTES.notifications)}
          rightSlot={<CountBadge value={notificationsBadge} />}
        />
        <NavItem
          label="Support"
          href={ROUTES.support}
          icon={<HeadphonesIcon size={20} />}
          active={isActivePath(pathname, ROUTES.support)}
          rightSlot={<CountBadge value={supportBadge} />}
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
