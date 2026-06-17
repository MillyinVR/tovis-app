// app/pro/migrate/services/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrateServicesClient } from './MigrateServicesClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host')

  return forwardedHost ?? requestHeaders.get('host')
}

export default async function ProMigrateServicesPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateServicesClient copy={copy.services} />
}
