// app/pro/migrate/review/buildReviewViewModel.ts
//
// Maps the real migration summary counts into the review page's view model.

import type { MigrationReviewSummary } from '@/lib/migration/migrationReview'

import type { MigrateReviewViewModel } from '../_types'

function cadenceLabel(raise: MigrationReviewSummary['raises'][number]): string {
  const step = raise.stepMode === 'PCT' ? `${raise.stepValue}%` : `$${raise.stepValue}`
  return `${step} / ${raise.cadenceWeeks} wks`
}

export function buildReviewViewModel(
  summary: MigrationReviewSummary,
): MigrateReviewViewModel {
  return {
    cards: [
      {
        key: 'services',
        tone: 'gold',
        title: 'Service menu',
        subtitle: 'Mapped to the catalog',
        stats: [
          { value: String(summary.offerings), label: 'services' },
          { value: String(summary.raises.length), label: 'raises' },
        ],
        editLabel: 'Edit services',
        editHref: '/pro/migrate/services',
      },
      {
        key: 'clients',
        tone: 'accent',
        title: 'Clients',
        subtitle: 'Imported to your roster',
        stats: [{ value: String(summary.clients), label: 'with upcoming bookings' }],
        editLabel: 'Edit clients',
        editHref: '/pro/migrate/clients',
      },
      {
        key: 'calendar',
        tone: 'violet',
        title: 'Calendar',
        subtitle: 'Bookings + held time',
        stats: [
          { value: String(summary.importedBookings), label: 'bookings' },
          { value: String(summary.importedBlocks), label: 'blocked' },
        ],
        editLabel: 'Edit calendar',
        editHref: '/pro/migrate/calendar',
      },
    ],
    raiseRecap: summary.raises.map((r) => ({
      serviceName: r.serviceName,
      from: r.from,
      to: r.to,
      cadenceLabel: cadenceLabel(r),
    })),
    checklist: [
      { label: 'Service menu reviewed', done: summary.offerings > 0 },
      { label: 'Clients imported', done: summary.clients > 0 },
      {
        label: 'Calendar transferred',
        done: summary.importedBookings + summary.importedBlocks > 0,
      },
      { label: 'No notifications sent to clients', done: true },
    ],
  }
}
