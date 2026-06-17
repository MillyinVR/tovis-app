// app/preview-migrate/[step]/page.tsx
//
// TEMPORARY throwaway preview route — renders any migration step outside the
// auth-gated /pro layout so the flow can be visually verified without a pro session.
// DELETE before opening a PR. Not linked from anywhere.

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { getBrandConfig } from '@/lib/brand'
import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import {
  mockCalendarViewModel,
  mockReviewViewModel,
  mockServicesViewModel,
} from '../../pro/migrate/_mock'
import { MigrateEntryClient } from '../../pro/migrate/MigrateEntryClient'
import { MigrateCalendarClient } from '../../pro/migrate/calendar/MigrateCalendarClient'
import { MigrateClientsClient } from '../../pro/migrate/clients/MigrateClientsClient'
import { MigrateReviewClient } from '../../pro/migrate/review/MigrateReviewClient'
import { MigrateServicesClient } from '../../pro/migrate/services/MigrateServicesClient'

async function getRequestHost(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
}

export default async function PreviewMigrateStepPage({
  params,
}: {
  params: Promise<{ step: string }>
}) {
  const { step } = await params
  const host = await getRequestHost()
  const brand = getBrandConfig({ host })
  const copy = defaultMigrationCopy(brand.assets.wordmark.text)

  const body = (() => {
    switch (step) {
      case 'entry':
        return <MigrateEntryClient copy={copy.entry} />
      case 'services':
        return (
          <MigrateServicesClient copy={copy.services} vm={mockServicesViewModel()} />
        )
      case 'clients':
        return <MigrateClientsClient copy={copy.clients} />
      case 'calendar':
        return (
          <MigrateCalendarClient copy={copy.calendar} vm={mockCalendarViewModel()} />
        )
      case 'review':
        return <MigrateReviewClient copy={copy.review} vm={mockReviewViewModel()} />
      default:
        return null
    }
  })()

  if (!body) notFound()

  return <div className="bg-bgPrimary">{body}</div>
}
