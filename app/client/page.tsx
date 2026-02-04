// app/client/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import LastMinuteOpenings from './components/LastMinuteOpenings'
import PendingConsultApprovalBanner from './components/PendingConsultApprovalBanner'
import ClientBookingsHeroCards from './ClientBookingsHeroCards'

export const dynamic = 'force-dynamic'

export default async function ClientDashboardPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }

  const displayName = user.clientProfile?.firstName || user.email || 'there'

  return (
    <main className="mx-auto mt-16 w-full max-w-5xl px-4 pb-12 text-textPrimary">
      <header className="mb-6">
        <h1 className="text-2xl font-black tracking-tight">Your calendar</h1>
        <p className="mt-1 text-sm font-semibold text-textSecondary">Welcome, {displayName}.</p>
      </header>

      <div className="grid gap-4">
        <PendingConsultApprovalBanner />

        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Open now</div>
            <div className="text-xs font-semibold text-textSecondary">Same-day openings near you.</div>
          </div>
          <LastMinuteOpenings />
        </section>

        <Suspense
          fallback={
            <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
              <div className="text-sm font-semibold text-textSecondary">Loading…</div>
            </section>
          }
        >
          <ClientBookingsHeroCards />
        </Suspense>
      </div>
    </main>
  )
}
