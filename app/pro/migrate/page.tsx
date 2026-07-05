// app/pro/migrate/page.tsx

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import { getCurrentUser } from '@/lib/currentUser'
import { loadMigrationReviewSummary } from '@/lib/migration/migrationReview'

import { MigrateEntryClient } from './MigrateEntryClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export const dynamic = 'force-dynamic'

export default async function ProMigrateEntryPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/migrate')
  }

  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
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
