// app/pro/dashboard/ProRetentionSection.test.tsx
//
// The rendered destination of a retention bucket's client name.
//
// Worth a test of its own because this link is UNCONDITIONAL — unlike the
// bookings/waitlist/reviews lists, it has no nullable-href handoff and no
// `/u/[handle]` fallback. That is only sound because the loader scopes its
// roster with `proClientVisibilityWhere` (pinned by the where-clause assertion
// in lib/analytics/proRetentionInsightsGate.test.ts and the SSOT-consumer grep
// in lib/clientVisibility.test.ts). Those two guard the DATA; this one guards
// the ARTIFACT — that the anchor a pro actually clicks carries the chart route,
// built by the href SSOT rather than interpolated here.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Only href and children are forwarded: `prefetch` is a Next-only prop, and
// spreading it onto a DOM <a> makes React warn about an unknown attribute.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

import ProRetentionSection from './ProRetentionSection'

import type {
  ProRetentionBucket,
  ProRetentionInsightsDTO,
} from '@/lib/analytics/proRetentionInsights'

function lapsingBucket(
  clients: ProRetentionBucket['clients'],
  count = clients.length,
): ProRetentionBucket {
  return {
    key: 'lapsing',
    label: 'Slipping away',
    hint: 'Well past their usual gap with nothing booked. Reach out first.',
    status: 'ACTION',
    count,
    clients,
  }
}

function ready(buckets: ProRetentionBucket[]): ProRetentionInsightsDTO {
  return {
    state: 'ready',
    trend: [],
    headlineRebookRatePct: 62,
    headlineDeltaPoints: null,
    buckets,
    notEnoughHistoryCount: 0,
    unmeasuredMonths: 0,
  }
}

describe('ProRetentionSection client links', () => {
  it('links a bucket client to their chart', () => {
    render(
      <ProRetentionSection
        insights={ready([
          lapsingBucket([
            {
              clientId: 'cl_1',
              displayName: 'Ada Lovelace',
              lastVisitLabel: '14 wks ago',
              cadenceLabel: 'usually every 6 wks',
              completedVisits: 4,
            },
          ]),
        ])}
      />,
    )

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/pro/clients/cl_1',
    )
  })

  // Guards the route-shape SSOT specifically: a hand-rolled
  // `/pro/clients/${id}` template leaves this id raw. Ids are cuids today, so
  // this asserts the mechanism rather than a live failure.
  it('encodes the id, because the href comes from proClientChartHref', () => {
    render(
      <ProRetentionSection
        insights={ready([
          lapsingBucket([
            {
              clientId: 'cl 1/2',
              displayName: 'Grace Hopper',
              lastVisitLabel: null,
              cadenceLabel: null,
              completedVisits: 2,
            },
          ]),
        ])}
      />,
    )

    expect(screen.getByRole('link', { name: 'Grace Hopper' })).toHaveAttribute(
      'href',
      '/pro/clients/cl%201%2F2',
    )
  })

  // The preview caps at RETENTION_BUCKET_PREVIEW; the overflow line is a count,
  // never a link — there is no client id behind it to gate.
  it('renders the overflow remainder as text, not a link', () => {
    render(
      <ProRetentionSection
        insights={ready([
          lapsingBucket(
            [
              {
                clientId: 'cl_1',
                displayName: 'Ada Lovelace',
                lastVisitLabel: '14 wks ago',
                cadenceLabel: null,
                completedVisits: 4,
              },
            ],
            5,
          ),
        ])}
      />,
    )

    expect(screen.getByText('+ 4 more')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
