// app/pro/dashboard/page.tsx
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import ProOverviewDashboard from './ProOverviewDashboard'

import { getCurrentUser } from '@/lib/currentUser'
import {
  loadProOverviewPage,
  type ProOverviewSearchParams,
} from '@/lib/analytics/proMonthlyAnalytics'
import { loadProRetentionInsights } from '@/lib/analytics/proRetentionInsights'
import { loadCreatorLooksAnalytics } from '@/lib/looks/creatorAnalytics'
import { loadProVisibilityHealth } from '@/lib/pro/visibilityHealth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProDashboardPageProps = {
  searchParams?: Promise<ProOverviewSearchParams>
}

const PRO_DASHBOARD_PATH = '/pro/dashboard'
const LOGIN_PATH = `/login?from=${encodeURIComponent(PRO_DASHBOARD_PATH)}`

export default async function ProDashboardPage({
  searchParams,
}: ProDashboardPageProps) {
  const user = await getCurrentUser().catch(() => null)

  const professionalProfile =
    user?.role === Role.PRO ? user.professionalProfile : null

  if (!professionalProfile) {
    redirect(LOGIN_PATH)
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const now = new Date()

  const [overview, looksAnalytics, visibility] = await Promise.all([
    loadProOverviewPage({
      professionalId: professionalProfile.id,
      professionalTimeZone: professionalProfile.timeZone,
      searchParams: resolvedSearchParams,
      now,
    }),
    loadCreatorLooksAnalytics({
      professionalId: professionalProfile.id,
      now,
    }),
    loadProVisibilityHealth({
      professionalId: professionalProfile.id,
      now,
    }),
  ])

  // Paid `advanced_analytics` surface. Returns { state: 'locked' } without
  // touching the DB when the pro is not entitled, so a free pro's dashboard costs
  // no extra queries.
  //
  // 🔴 Sequenced AFTER the overview on purpose: loadProOverviewPage is what
  // ensures the current month's analytics snapshot, and this loader reads
  // snapshots without forcing a recompute. Run inside the Promise.all above it
  // raced that upsert and the current month rendered as "not measured".
  const retention = await loadProRetentionInsights({
    professionalId: professionalProfile.id,
    professionalTimeZone: professionalProfile.timeZone,
    now,
  })

  return (
    <section
      className="brand-pro-overview-page brand-pro-page-with-fixed-header"
      aria-labelledby="pro-page-title"
    >
      <ProOverviewDashboard
        overview={overview}
        looksAnalytics={looksAnalytics}
        visibility={visibility}
        retention={retention}
      />
    </section>
  )
}