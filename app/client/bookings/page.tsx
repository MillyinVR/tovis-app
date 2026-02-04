// app/client/bookings/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ClientBookingsDashboard from '../ClientBookingsDashboard'

export const dynamic = 'force-dynamic'

export default async function ClientBookingsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/bookings')
  }

  return (
    <main className="h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] overflow-hidden">
      <Suspense fallback={<div className="text-sm font-semibold text-textSecondary">Loading…</div>}>
        <ClientBookingsDashboard />
      </Suspense>
    </main>
  )
}