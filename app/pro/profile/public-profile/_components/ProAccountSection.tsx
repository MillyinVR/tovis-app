// app/pro/profile/public-profile/_components/ProAccountSection.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeftRight,
  BellRing,
  Clock,
  Gift,
  LogOut,
  Star,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'

import ThemeToggle from '@/lib/brand/ThemeToggle'
import { clientSignOut } from '@/lib/auth/clientSignOut'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import SwitchAccountSheet from '@/app/_components/AdminSessionFooter/SwitchAccountSheet'

type NavRow = {
  label: string
  hint?: string
  href: string
  Icon: LucideIcon
}

// Mirrors the iOS pro Profile tab's account section (Business / Growth groups).
// Working hours are managed on the calendar and no-show fees inside Payment
// settings, so those link to their real web homes rather than to standalone
// pages that don't exist here.
const BUSINESS_ROWS: NavRow[] = [
  { label: 'Clients', href: '/pro/clients', Icon: Users },
  { label: 'Working hours', href: '/pro/calendar', Icon: Clock },
  { label: 'Appointment reminders', href: '/pro/notifications/settings', Icon: BellRing },
]

const GROWTH_ROWS: NavRow[] = [
  { label: 'Your Looks performance', href: '/pro/dashboard', Icon: TrendingUp },
  { label: 'Referral activity', href: '/pro/referral-rewards', Icon: Gift },
  { label: 'Membership', href: '/pro/membership', Icon: Star },
]

type ProAccountSectionProps = {
  workspaces?: WorkspaceOption[]
}

export default function ProAccountSection({
  workspaces = [],
}: ProAccountSectionProps) {
  const router = useRouter()
  const [switchOpen, setSwitchOpen] = useState(false)

  const canSwitchWorkspace = workspaces.length > 1

  async function handleSignOut(): Promise<void> {
    await clientSignOut()
    router.replace('/login?from=/pro')
    router.refresh()
  }

  return (
    <div className="brand-pro-profile-account">
      {canSwitchWorkspace ? (
        <section
          className="brand-pro-profile-account-group"
          aria-label="Workspace"
        >
          <div className="brand-pro-profile-account-label">Workspace</div>
          <button
            type="button"
            onClick={() => setSwitchOpen(true)}
            className="brand-pro-profile-nav-row brand-focus"
          >
            <span className="brand-pro-profile-nav-row-icon" aria-hidden="true">
              <ArrowLeftRight size={19} />
            </span>
            <span className="brand-pro-profile-nav-row-body">
              <span className="brand-pro-profile-nav-row-label">
                Switch workspace
              </span>
              <span className="brand-pro-profile-nav-row-hint">
                Browse &amp; book as a client
              </span>
            </span>
            <span className="brand-pro-profile-nav-row-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </section>
      ) : null}

      <NavGroup label="Business" rows={BUSINESS_ROWS} />
      <NavGroup label="Growth" rows={GROWTH_ROWS} />

      <section
        className="brand-pro-profile-account-group"
        aria-label="Appearance"
      >
        <div className="brand-pro-profile-account-label">Appearance</div>
        <div className="brand-pro-profile-appearance">
          <ThemeToggle />
        </div>
      </section>

      <button
        type="button"
        onClick={handleSignOut}
        className="brand-pro-profile-signout brand-focus"
      >
        <LogOut size={18} aria-hidden="true" />
        Sign out
      </button>

      <SwitchAccountSheet
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        options={workspaces}
      />
    </div>
  )
}

function NavGroup({ label, rows }: { label: string; rows: NavRow[] }) {
  return (
    <section className="brand-pro-profile-account-group" aria-label={label}>
      <div className="brand-pro-profile-account-label">{label}</div>
      {rows.map((row) => (
        <Link
          key={row.href}
          href={row.href}
          className="brand-pro-profile-nav-row brand-focus"
        >
          <span className="brand-pro-profile-nav-row-icon" aria-hidden="true">
            <row.Icon size={19} />
          </span>
          <span className="brand-pro-profile-nav-row-body">
            <span className="brand-pro-profile-nav-row-label">{row.label}</span>
            {row.hint ? (
              <span className="brand-pro-profile-nav-row-hint">{row.hint}</span>
            ) : null}
          </span>
          <span className="brand-pro-profile-nav-row-chev" aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </section>
  )
}
