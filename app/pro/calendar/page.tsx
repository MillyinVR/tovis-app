// app/pro/calendar/page.tsx

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

import { ProCalendarClientPage } from './ProCalendarClientPage'

export default async function ProCalendarPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return <ProCalendarClientPage copy={brand.proCalendar} />
}