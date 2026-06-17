// app/pro/migrate/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrateEntryClient } from './MigrateEntryClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export default async function ProMigrateEntryPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateEntryClient copy={copy.entry} />
}
