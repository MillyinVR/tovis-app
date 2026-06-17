// app/pro/migrate/_constants.ts

import type { MigrationStepKey, SourceApp } from './_types'

// Raise-ramp policy floor lives in the canonical ramp module; re-exported here
// so UI imports stay local. (Contract: 10% every 10 weeks, never gentler.)
export { RAISE_FLOOR_PCT, RAISE_FLOOR_WEEKS } from '@/lib/migration/priceRamp'

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
