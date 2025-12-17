import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ProHeader from './ProHeader'
import ProSessionFooter from './ProSessionFooter'
import ProTopTabs from './ProTopTabs'

export const dynamic = 'force-dynamic'

export default async function ProLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro')
  }

  return (
    <>
      <ProHeader />
      <ProTopTabs />

      <div
        style={{
          paddingTop: 56,   // header height only
          paddingBottom: 72,
          background: '#fff',
          minHeight: '100vh',
        }}
      >
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px' }}>
          {children}
        </div>
      </div>

      <ProSessionFooter />
    </>
  )
}
