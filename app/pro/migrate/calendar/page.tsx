// app/pro/migrate/calendar/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { mockCalendarViewModel } from '../_mock'
import { MigrateCalendarClient } from './MigrateCalendarClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export default async function ProMigrateCalendarPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  return <MigrateCalendarClient copy={copy.calendar} vm={mockCalendarViewModel()} />
}
