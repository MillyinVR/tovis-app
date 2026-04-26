// app/pro/dashboard/page.tsx
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import {
  loadProOverviewPage,
  type ProOverviewSearchParams,
} from '@/lib/analytics/proMonthlyAnalytics'

import ProOverviewDashboard from './ProOverviewDashboard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function ProDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<ProOverviewSearchParams>
}) {
  const user = await getCurrentUser().catch(() => null)
  const professionalProfile =
    user?.role === Role.PRO ? user.professionalProfile : null

  if (!professionalProfile) {
    redirect('/login?from=/pro/dashboard')
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const overview = await loadProOverviewPage({
    professionalId: professionalProfile.id,
    professionalTimeZone: professionalProfile.timeZone,
    searchParams: resolvedSearchParams,
    now: new Date(),
  })

  return <ProOverviewDashboard overview={overview} />
}