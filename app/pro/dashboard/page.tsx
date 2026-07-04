// app/pro/dashboard/page.tsx
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import ProOverviewDashboard from './ProOverviewDashboard'

import { getCurrentUser } from '@/lib/currentUser'
import {
  loadProOverviewPage,
  type ProOverviewSearchParams,
} from '@/lib/analytics/proMonthlyAnalytics'
import { loadCreatorLooksAnalytics } from '@/lib/looks/creatorAnalytics'

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

  const [overview, looksAnalytics] = await Promise.all([
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
  ])

  return (
    <section
      className="brand-pro-overview-page brand-pro-page-with-fixed-header"
      aria-labelledby="pro-page-title"
    >
      <ProOverviewDashboard
        overview={overview}
        looksAnalytics={looksAnalytics}
      />
    </section>
  )
}