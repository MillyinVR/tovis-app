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

function loginHref(
  from: string,
  reason?: 'PRO_REQUIRED' | 'PRO_SETUP_REQUIRED',
) {
  const base = `/login?from=${encodeURIComponent(from)}`
  return reason ? `${base}&reason=${encodeURIComponent(reason)}` : base
}

export default async function ProRootLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect(loginHref(PRO_HOME))
  }

  if (user.role !== 'PRO') {
    redirect(loginHref(PRO_HOME, 'PRO_REQUIRED'))
  }

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

      {modal}
    </div>
  )
}