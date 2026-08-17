// app/pro/migrate/page.tsx

import { redirect } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import { getCurrentUser } from '@/lib/currentUser'
import { loadMigrationReviewSummary } from '@/lib/migration/migrationReview'

import { MigrateEntryClient } from './MigrateEntryClient'

export const dynamic = 'force-dynamic'

export default async function ProMigrateEntryPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/migrate')
  }

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  const summary = await loadMigrationReviewSummary(user.professionalProfile.id)

  return (
    <MigrateEntryClient
      copy={copy.entry}
      progress={{
        services: summary.offerings,
        clients: summary.clients,
        calendar: summary.importedBookings + summary.importedBlocks,
      }}
    />
  )
}
