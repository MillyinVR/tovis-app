// app/admin/looks/anomalies/page.tsx — §5.6 anti-gaming review queue. Surfaces
// looks whose recent engagement outruns its matching impressions, or spikes far
// above the look's own historical pattern, across all pros — a manual-review
// triage lead, never an automatic penalty. SUPER_ADMIN or REVIEWER (the API
// enforces it; the page gates on Role.ADMIN like the rest of /admin).
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import AnomaliesClient from './AnomaliesClient'

export const dynamic = 'force-dynamic'

export default async function AdminLookAnomaliesPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Engagement anomalies</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Looks whose recent saves + likes outrun the impressions they were shown
          (you can’t save what you never saw), or spike far above the look’s own
          historical pattern. Rate-based scoring makes fake engagement produce
          impossible rates — this is the review queue that catches them. Nothing
          here is penalized automatically; impressions are best-effort sampled, so
          a flag is a lead to review the pro, not a verdict. Use “Review pro” to
          jump to the moderation queue.
        </p>
      </div>
      <AnomaliesClient />
    </main>
  )
}
