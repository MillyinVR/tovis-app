// app/pro/clients/[id]/VisitHistoryList.test.tsx
//
// Proves the card that MERGED the chart's two visit tabs. "History" showed a row
// per booking and "Photos" showed a grid per booking — the same visits, grouped
// twice — so the risk in merging them is losing a field from one side or
// rendering an empty photo shell on the many visits that have no frames.
import { render, screen, within } from '@testing-library/react'
import { BookingStatus, ClientRelationshipLabel, Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import type { ChartVisitRow } from '@/lib/clients/chartVisitFilters'

import VisitHistoryList, { type VisitPhoto } from './VisitHistoryList'

const PRO_ID = 'pro_me'
const TZ = 'America/Los_Angeles'

function visit(overrides: Partial<ChartVisitRow> = {}): ChartVisitRow {
  return {
    id: 'bk_1',
    status: BookingStatus.COMPLETED,
    clientRelationshipLabel: ClientRelationshipLabel.RR,
    scheduledFor: new Date('2026-03-04T18:00:00.000Z'),
    locationTimeZone: TZ,
    createdAt: new Date('2026-02-01T18:00:00.000Z'),
    finishedAt: new Date('2026-03-04T20:00:00.000Z'),
    totalDurationMinutes: 90,
    totalAmount: new Prisma.Decimal('180.00'),
    subtotalSnapshot: new Prisma.Decimal('180.00'),
    professionalId: PRO_ID,
    serviceId: 'svc_balayage',
    service: {
      name: 'Balayage',
      category: { name: 'Color' },
    },
    professional: {
      businessName: 'Studio Mave',
      firstName: 'Ana',
      lastName: 'Rivera',
    },
    aftercareSummary: { notes: 'Sulfate-free shampoo only for two weeks.' },
    ...overrides,
  } as ChartVisitRow
}

function photo(overrides: Partial<VisitPhoto> = {}): VisitPhoto {
  return {
    id: 'ph_1',
    phase: 'BEFORE',
    caption: null,
    imageUrl: 'https://example.test/before.jpg',
    ...overrides,
  }
}

function renderList(args: {
  rows: ChartVisitRow[]
  photos?: Map<string, VisitPhoto[]>
  allCount?: number
}) {
  return render(
    <VisitHistoryList
      bookingRowsFiltered={args.rows}
      bookingRowsAll={
        args.allCount ? Array.from({ length: args.allCount }, () => visit()) : args.rows
      }
      photosByBooking={args.photos ?? new Map()}
      proId={PRO_ID}
      tz={TZ}
    />,
  )
}

describe('VisitHistoryList — the fields the History tab used to own', () => {
  it('keeps every field the old service-history row rendered', () => {
    renderList({ rows: [visit()] })

    expect(screen.getByText('Balayage')).toBeTruthy() // service
    expect(screen.getByText('Completed')).toBeTruthy() // status pill, labelled
    expect(screen.getByText('Studio Mave')).toBeTruthy() // pro name
    expect(screen.getByText(/Color/)).toBeTruthy() // category
    expect(screen.getByText('Me')).toBeTruthy() // it's the viewing pro's own
    expect(
      screen.getByText(/Sulfate-free shampoo only for two weeks\./),
    ).toBeTruthy() // aftercare
    // Date in the VISIT's zone: 18:00Z on Mar 4 is still Mar 4 in LA.
    expect(screen.getByText('Mar 4, 2026')).toBeTruthy()
    // Duration and total share a line, exactly as the old row rendered them.
    expect(screen.getByText(/90 min\s*•\s*\$180/)).toBeTruthy()
  })

  it('links the card to the booking, as it always did', () => {
    renderList({ rows: [visit({ id: 'bk_xyz' })] })

    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/pro/bookings/bk_xyz',
    )
  })

  it('truncates a long aftercare note at 120 characters', () => {
    const long = 'x'.repeat(200)
    renderList({ rows: [visit({ aftercareSummary: { notes: long } })] })

    expect(screen.getByText(new RegExp(`${'x'.repeat(120)}…`))).toBeTruthy()
    expect(screen.queryByText(new RegExp('x'.repeat(121)))).toBeNull()
  })

  it('shows the K5 mark on the viewing pro’s own visit', () => {
    renderList({ rows: [visit()] })
    expect(screen.getByText('RR')).toBeTruthy()
  })

  it('does NOT show the K5 mark or "Me" on another pro’s visit', () => {
    renderList({ rows: [visit({ professionalId: 'pro_other' })] })

    expect(screen.queryByText('RR')).toBeNull()
    expect(screen.queryByText('Me')).toBeNull()
  })

  it('still reports filtered-of-total', () => {
    renderList({ rows: [visit()], allCount: 7 })
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('says so when nothing matches, instead of an empty card', () => {
    renderList({ rows: [] })
    expect(screen.getByText('No visits match your search/filter.')).toBeTruthy()
  })
})

describe('VisitHistoryList — the photos the Photos tab used to own', () => {
  it('renders the visit’s frames inline on its own card, in the order given', () => {
    renderList({
      rows: [visit({ id: 'bk_1' })],
      photos: new Map([
        [
          'bk_1',
          [
            photo({ id: 'ph_b', phase: 'BEFORE' }),
            photo({
              id: 'ph_a',
              phase: 'AFTER',
              imageUrl: 'https://example.test/after.jpg',
            }),
          ],
        ],
      ]),
    })

    const card = screen.getByRole('link')
    const images = within(card).getAllByRole('img')
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://example.test/before.jpg',
      'https://example.test/after.jpg',
    ])
    expect(within(card).getByText('BEFORE')).toBeTruthy()
    expect(within(card).getByText('AFTER')).toBeTruthy()
  })

  it('renders NO photo section at all for a visit with no frames', () => {
    // The failure this guards: most visits have no photos, so an empty grid or a
    // "no photos yet" placeholder per card would bury the list in noise.
    renderList({ rows: [visit()], photos: new Map() })

    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.queryByText(/no.*photo/i)).toBeNull()
  })

  it('puts each visit’s frames on that visit’s card and no other', () => {
    renderList({
      rows: [
        visit({ id: 'bk_1' }),
        visit({ id: 'bk_2', service: { name: 'Trim', category: { name: 'Cut' } } }),
      ],
      photos: new Map([['bk_2', [photo({ id: 'ph_2' })]]]),
    })

    const [first, second] = screen.getAllByRole('link')
    if (!first || !second) throw new Error('expected two visit cards')
    expect(within(first).queryAllByRole('img')).toHaveLength(0)
    expect(within(second).getAllByRole('img')).toHaveLength(1)
  })

  it('explains another pro’s frames as client-shared', () => {
    // Without this the grid on someone else's visit reads as a leak; the access
    // matrix only lets them through once the CLIENT promoted them publicly.
    renderList({
      rows: [visit({ id: 'bk_1', professionalId: 'pro_other' })],
      photos: new Map([['bk_1', [photo()]]]),
    })

    expect(screen.getByText('Client-shared')).toBeTruthy()
  })

  it('does not label the viewing pro’s own frames as client-shared', () => {
    renderList({
      rows: [visit({ id: 'bk_1' })],
      photos: new Map([['bk_1', [photo()]]]),
    })

    expect(screen.queryByText('Client-shared')).toBeNull()
  })
})
