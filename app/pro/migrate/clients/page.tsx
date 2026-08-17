// app/pro/migrate/clients/page.tsx

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrateClientsClient } from './MigrateClientsClient'

export default async function ProMigrateClientsPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateClientsClient copy={copy.clients} />
}
