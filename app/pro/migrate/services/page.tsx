// app/pro/migrate/services/page.tsx

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrateServicesClient } from './MigrateServicesClient'

export default async function ProMigrateServicesPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateServicesClient copy={copy.services} />
}
