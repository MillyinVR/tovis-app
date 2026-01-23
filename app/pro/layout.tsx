// app/pro/layout.tsx
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

import ProHeader from './ProHeader'
import ProTopTabs from './ProTopTabs'

export const dynamic = 'force-dynamic'

const UI = { headerH: 48, tabsH: 56 } as const

export default async function ProRootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro')
  }

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <ProHeader />
      <ProTopTabs />

      <main
        style={{
          paddingTop: UI.headerH + UI.tabsH,
          minHeight: '100dvh',
        }}
      >
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </main>
    </div>
  )
}
