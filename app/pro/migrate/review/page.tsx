// app/pro/migrate/review/page.tsx

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import { getCurrentUser } from '@/lib/currentUser'
import { loadMigrationReviewSummary } from '@/lib/migration/migrationReview'

import { buildReviewViewModel } from './buildReviewViewModel'
import { MigrateReviewClient } from './MigrateReviewClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export const dynamic = 'force-dynamic'

export default async function ProMigrateReviewPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/migrate/review')
  }

  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  const summary = await loadMigrationReviewSummary(user.professionalProfile.id)

  return <MigrateReviewClient copy={copy.review} vm={buildReviewViewModel(summary)} />
}
