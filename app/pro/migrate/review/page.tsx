// app/pro/migrate/review/page.tsx

import { redirect } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import { getCurrentUser } from '@/lib/currentUser'
import { loadMigrationReviewSummary } from '@/lib/migration/migrationReview'

import { buildReviewViewModel } from './buildReviewViewModel'
import { MigrateReviewClient } from './MigrateReviewClient'

export const dynamic = 'force-dynamic'

export default async function ProMigrateReviewPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/migrate/review')
  }

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  const summary = await loadMigrationReviewSummary(user.professionalProfile.id)

  return <MigrateReviewClient copy={copy.review} vm={buildReviewViewModel(summary)} />
}
