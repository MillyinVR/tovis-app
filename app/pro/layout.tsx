// app/pro/layout.tsx
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

import ProHeader from './ProHeader'
import ProTopTabs from './ProTopTabs'
import ProComplianceBanner from './ProComplianceBanner'

export const dynamic = 'force-dynamic'

const UI = { headerH: 48, tabsH: 56 } as const

const PRO_HOME = '/pro/calendar'

function loginHref(from: string, reason?: 'PRO_REQUIRED' | 'PRO_SETUP_REQUIRED') {
  const base = `/login?from=${encodeURIComponent(from)}`
  return reason ? `${base}&reason=${encodeURIComponent(reason)}` : base
}

export default async function ProRootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()

  // Not signed in → send to login, and after login send them to the real pro home.
  if (!user) {
    redirect(loginHref(PRO_HOME))
  }

  // Signed in, but not a PRO account → send to login with a clear reason.
  if (user.role !== 'PRO') {
    redirect(loginHref(PRO_HOME, 'PRO_REQUIRED'))
  }

  // PRO user exists, but profile missing → this is a provisioning/setup issue.
  // We still send to login (so they see messaging), but with a different reason.
  if (!user.professionalProfile) {
    redirect(loginHref(PRO_HOME, 'PRO_SETUP_REQUIRED'))
  }

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <ProHeader />
      <ProComplianceBanner />
      <ProTopTabs />

      <main
        style={{
          paddingTop: `calc(${UI.headerH + UI.tabsH}px + var(--pro-banner-h, 0px))`,
          minHeight: '100dvh',
        }}
      >
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </main>
    </div>
  )
}