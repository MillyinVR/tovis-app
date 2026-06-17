// app/pro/migrate/clients/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { mockClientsViewModel } from '../_mock'
import { MigrateClientsClient } from './MigrateClientsClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export default async function ProMigrateClientsPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateClientsClient copy={copy.clients} vm={mockClientsViewModel()} />
}
