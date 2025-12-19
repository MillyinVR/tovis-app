// app/client/bookings/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ClientBookingsDashboard from '../ClientBookingsDashboard'
import LastMinuteOpenings from '../components/LastMinuteOpenings'

export const dynamic = 'force-dynamic'

export default async function ClientBookingsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT') redirect('/login?from=/client/bookings')

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Your bookings</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Everything in one place.</p>
      </div>

      <LastMinuteOpenings />
      <div style={{ height: 12 }} />

      <Suspense fallback={<div style={{ color: '#6b7280', fontSize: 13 }}>Loading your bookings…</div>}>
        <ClientBookingsDashboard />
      </Suspense>
    </main>
  )
}
