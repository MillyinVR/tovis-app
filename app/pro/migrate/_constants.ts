// app/pro/migrate/_constants.ts

import type { MigrationStepKey, SourceApp } from './_types'

// Raise-ramp policy floor (contract: 10% every 10 weeks — not a per-pro setting).
// A pro may go faster (bigger step / shorter cadence), never gentler.
export const RAISE_FLOOR_PCT = 10
export const RAISE_FLOOR_WEEKS = 10

export const MIGRATION_STEPS: ReadonlyArray<{
  key: MigrationStepKey
  label: string
  href: string
}> = [
  { key: 'services', label: 'Service menu', href: '/pro/migrate/services' },
  { key: 'clients', label: 'Clients', href: '/pro/migrate/clients' },
  { key: 'calendar', label: 'Calendar', href: '/pro/migrate/calendar' },
  { key: 'review', label: 'Review', href: '/pro/migrate/review' },
]

export const SOURCE_APPS: ReadonlyArray<SourceApp> = [
  'Vagaro',
  'GlossGenius',
  'Booksy',
  'Square',
  'StyleSeat',
  'Fresha',
  'Acuity',
  'Other',
]
