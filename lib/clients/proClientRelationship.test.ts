import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ClientChartShareStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    clientProfile: { findUnique: vi.fn() },
    clientChartShare: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  hasEstablishedProClientRelationship,
  hasGrantedProClientChartShare,
  loadProClientRelationship,
  PRO_CLIENT_RELATIONSHIP_REFUSAL,
} from './proClientRelationship'

const PRO = 'pro_1'
const CLIENT = 'client_1'

function profile(overrides?: {
  createdByProfessionalId?: string | null
  bookings?: { id: string }[]
  chartShares?: { id: string }[]
  waitlistEntries?: { id: string }[]
}) {
  return {
    createdByProfessionalId: overrides?.createdByProfessionalId ?? null,
    bookings: overrides?.bookings ?? [],
    chartShares: overrides?.chartShares ?? [],
    waitlistEntries: overrides?.waitlistEntries ?? [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.clientProfile.findUnique.mockResolvedValue(null)
  mocks.prisma.clientChartShare.findUnique.mockResolvedValue(null)
})

describe('loadProClientRelationship', () => {
  it('answers a missing client without leaking that it is missing', async () => {
    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({ found: false, established: false, reason: null })
  })

  it('admits a client this pro created', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({ createdByProfessionalId: PRO }),
    )

    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({ found: true, established: true, reason: 'CREATED_BY_PRO' })
  })

  it('does not count a booking written under this very refusal as history', async () => {
    // The relation read filters `proCreatedWithoutRelationship: false`, so a
    // stamped booking never comes back here. Pinned as the filter's shape in
    // the select assertion below; this case states the rule it encodes —
    // otherwise a second pro-created booking would cite the first as history
    // and the pair would let itself in after two POSTs.
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({ createdByProfessionalId: 'pro_other', bookings: [] }),
    )

    expect(
      await hasEstablishedProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toBe(false)
  })

  it('admits a pair with any booking history, whatever its status', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({
        createdByProfessionalId: 'pro_other',
        bookings: [{ id: 'booking_cancelled_last_year' }],
      }),
    )

    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({ found: true, established: true, reason: 'PRIOR_BOOKING' })
  })

  it('admits a client who granted chart access, with no shared history', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({
        createdByProfessionalId: 'pro_other',
        chartShares: [{ id: 'share_1' }],
      }),
    )

    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({
      found: true,
      established: true,
      reason: 'CHART_SHARE_GRANTED',
    })
  })

  it('admits a client who asked this pro for a slot (waitlist)', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({
        createdByProfessionalId: 'pro_other',
        waitlistEntries: [{ id: 'waitlist_1' }],
      }),
    )

    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({ found: true, established: true, reason: 'WAITLIST_ENTRY' })
  })

  it('refuses another pro\'s client — the whole point of the module', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      profile({ createdByProfessionalId: 'pro_other' }),
    )

    expect(
      await loadProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toEqual({ found: true, established: false, reason: null })
    expect(
      await hasEstablishedProClientRelationship({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toBe(false)
  })

  it('scopes every relation read to the asking pro, and only asks EXISTS', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(profile())

    await loadProClientRelationship({ professionalId: PRO, clientId: CLIENT })

    expect(mocks.prisma.clientProfile.findUnique).toHaveBeenCalledWith({
      where: { id: CLIENT },
      select: {
        createdByProfessionalId: true,
        bookings: {
          where: {
            professionalId: PRO,
            proCreatedWithoutRelationship: false,
          },
          select: { id: true },
          take: 1,
        },
        chartShares: {
          where: {
            professionalId: PRO,
            status: ClientChartShareStatus.GRANTED,
          },
          select: { id: true },
          take: 1,
        },
        waitlistEntries: {
          where: { professionalId: PRO },
          select: { id: true },
          take: 1,
        },
      },
    })
  })

  it('refuses to treat a bare message thread as a relationship', () => {
    // A pro can mint a thread against any claimed client with no consent
    // (lib/messagesResolve.ts, resolveProProfileThreadSeed), so a thread must
    // never appear as a clause here. Asserted on the source because the module
    // never queries threads at all — there is no call to assert on.
    const src = readFileSync(
      join(__dirname, 'proClientRelationship.ts'),
      'utf8',
    )
    expect(/messageThread\.|messageThreads:/.test(src)).toBe(false)
  })
})

describe('hasGrantedProClientChartShare', () => {
  it.each([
    [ClientChartShareStatus.GRANTED, true],
    [ClientChartShareStatus.REQUESTED, false],
    [ClientChartShareStatus.DECLINED, false],
    [ClientChartShareStatus.REVOKED, false],
  ])('%s → %s', async (status, expected) => {
    mocks.prisma.clientChartShare.findUnique.mockResolvedValue({ status })

    expect(
      await hasGrantedProClientChartShare({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toBe(expected)
  })

  it('treats no row as no consent', async () => {
    expect(
      await hasGrantedProClientChartShare({
        professionalId: PRO,
        clientId: CLIENT,
      }),
    ).toBe(false)
  })
})

describe('no re-divergence of the relationship rule', () => {
  // Sibling of the guard in clientVisibility.test.ts. Every surface that has to
  // answer "is this pro's relationship with this client real" must consume this
  // module, never re-derive the clauses — the booking-create path re-deriving
  // NOTHING (it simply never asked) is the bug this module exists to close.
  const root = join(__dirname, '..', '..')

  const consumers = [
    'lib/booking/resolveProBookingClient.ts',
    'lib/clientVisibility.ts',
    'app/api/v1/pro/clients/[id]/invite/route.ts',
    // The CONTROL, not just the writer: this page decides whether to offer a
    // pre-filled client at all, and must not offer one the POST will refuse.
    'app/pro/bookings/new/BookingCreateContent.tsx',
  ]

  it.each(consumers)('%s imports the shared predicate', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8')
    expect(src).toContain('@/lib/clients/proClientRelationship')
  })

  it('nobody re-inlines the createdBy ownership clause', () => {
    const ownershipClause = /createdByProfessionalId\s*===/
    for (const rel of consumers) {
      const src = readFileSync(join(root, rel), 'utf8')
      expect(
        ownershipClause.test(src),
        `${rel} must not re-derive the ownership clause`,
      ).toBe(false)
    }
  })

  it('keeps one refusal shape for missing and not-yours alike', () => {
    expect(PRO_CLIENT_RELATIONSHIP_REFUSAL).toEqual({
      status: 404,
      error: 'Client not found.',
      code: 'CLIENT_NOT_FOUND',
    })
  })
})
