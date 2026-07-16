// app/admin/looks/metrics/page.tsx — §9 personalization funnel + health metrics.
// Platform-wide read-only rollup: is the personalization loop turning saves into
// bookings, and where does it leak? SUPER_ADMIN or REVIEWER (the API enforces it;
// the page gates on Role.ADMIN like the rest of /admin).
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import MetricsClient from './MetricsClient'

export const dynamic = 'force-dynamic'

export default async function AdminPersonalizationMetricsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Personalization metrics</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          How the discovery + re-engagement loop is actually performing:
          save→book conversion, the saved-not-booked gap that feeds the nudges,
          board→booking, the “not for me” hide rate, per-trigger notification
          opt-out, and lifetime rebook rate. Recomputed live from the database —
          per-serve freshness % and boosted counts live in the feed serve logs,
          not here.
        </p>
      </div>
      <MetricsClient />
    </main>
  )
}
