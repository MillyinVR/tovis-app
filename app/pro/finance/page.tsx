// app/pro/finance/page.tsx
//
// Server entry for the Pro Finance & Tax tab. Loads the initial month's data
// (a superset of the Overview view-model) server-side for a fast first paint,
// then hands off to the client screen which owns month switching + expense CRUD.
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { getCurrentUser } from '@/lib/currentUser'
import {
  loadProFinancePage,
  type ProFinancePageData,
} from '@/lib/finance/proFinanceSummary'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import type { ProOverviewSearchParams } from '@/lib/analytics/proMonthlyAnalytics'

import ProFinanceScreen from './ProFinanceScreen'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProFinancePageProps = {
  searchParams?: Promise<ProOverviewSearchParams>
}

const PRO_FINANCE_PATH = '/pro/finance'
const LOGIN_PATH = `/login?from=${encodeURIComponent(PRO_FINANCE_PATH)}`

export default async function ProFinancePage({
  searchParams,
}: ProFinancePageProps) {
  const user = await getCurrentUser().catch(() => null)

  const professionalProfile =
    user?.role === Role.PRO ? user.professionalProfile : null

  if (!professionalProfile) {
    redirect(LOGIN_PATH)
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const tenantContext = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenantContext)

  const initialData: ProFinancePageData = await loadProFinancePage({
    professionalId: professionalProfile.id,
    professionalTimeZone: professionalProfile.timeZone,
    searchParams: resolvedSearchParams,
    now: new Date(),
    brandName: brand.displayName,
  })

  return <ProFinanceScreen initialData={initialData} />
}
