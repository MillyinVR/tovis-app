// app/pro/calendar/page.tsx

import { headers } from 'next/headers'

import { getBrandConfig } from '@/lib/brand'

import { ProCalendarClientPage } from './ProCalendarClientPage'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host')

  return forwardedHost ?? requestHeaders.get('host')
}

export default async function ProCalendarPage() {
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })

  return <ProCalendarClientPage copy={brand.proCalendar} />
}