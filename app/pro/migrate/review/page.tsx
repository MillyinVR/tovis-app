// app/pro/migrate/review/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { mockReviewViewModel } from '../_mock'
import { MigrateReviewClient } from './MigrateReviewClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export default async function ProMigrateReviewPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateReviewClient copy={copy.review} vm={mockReviewViewModel()} />
}
