// app/client/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ClientBookingsDashboard from './ClientBookingsDashboard'
import LastMinuteOpenings from './components/LastMinuteOpenings'
import PendingConsultApprovalBanner from './components/PendingConsultApprovalBanner'

export const dynamic = 'force-dynamic'

export default async function ClientDashboardPage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT') {
    redirect('/login?from=/client')
  }

  const displayName = user.clientProfile?.firstName || user.email || 'there'

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Your calendar</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Welcome, {displayName}.</p>
      </div>

      {/* ✅ Shows ONLY when a pending consult approval exists */}
      <PendingConsultApprovalBanner />
      <div style={{ height: 12 }} />

      {/* Open now */}
      <LastMinuteOpenings />
      <div style={{ height: 12 }} />

      <Suspense fallback={<div style={{ color: '#6b7280', fontSize: 13 }}>Loading your bookings…</div>}>
        <ClientBookingsDashboard />
      </Suspense>
    </main>
  )
}
