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

  const displayName =
    user.clientProfile?.firstName?.trim() ||
    user.email?.split('@')[0] ||
    'You'
  const handle = (user.email?.split('@')[0] ?? 'you')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
  const avatarUrl = user.clientProfile?.avatarUrl ?? null
  const memberSince = (() => {
    const d = user.createdAt ? new Date(String(user.createdAt)) : null
    if (!d || isNaN(d.getTime())) return null
    const month = d.toLocaleDateString('en-US', { month: 'short' })
    const year = d.getFullYear().toString().slice(-2)
    return `${month} '${year}`
  })()

  return (
    <main className="h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] overflow-hidden">
      <Suspense fallback={<div className="text-sm font-semibold text-textSecondary">Loading…</div>}>
        <ClientBookingsDashboard
          displayName={displayName}
          handle={handle}
          avatarUrl={avatarUrl}
          memberSince={memberSince}
        />
      </Suspense>
    </main>
  )
}