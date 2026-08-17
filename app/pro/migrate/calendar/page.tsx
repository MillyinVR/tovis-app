// app/pro/migrate/calendar/page.tsx

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrateCalendarClient } from './MigrateCalendarClient'

export default async function ProMigrateCalendarPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateCalendarClient copy={copy.calendar} />
}
