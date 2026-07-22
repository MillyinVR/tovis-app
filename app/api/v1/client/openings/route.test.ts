// app/api/v1/client/openings/route.test.ts
//
// The feed's F15 wiring. The schedule check itself is driven against real
// Postgres (tests/integration/opening-liveness.test.ts); this pins that the
// route actually asks it, for THIS client, before serving a stored time.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LastMinuteRecipientStatus,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  recipientFindMany: vi.fn(),
  filterStillOpenRows: vi.fn(),
}))

vi.mock('@/app/api/_utils', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/api/_utils')>('@/app/api/_utils')
  return {
    ...actual,
    requireClient: mocks.requireClient,
    jsonOk: mocks.jsonOk,
    jsonFail: mocks.jsonFail,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: { lastMinuteRecipient: { findMany: mocks.recipientFindMany } },
}))

vi.mock('@/lib/booking/storedSlotLiveness', () => ({
  filterStillOpenRows: mocks.filterStillOpenRows,
}))

import { GET } from './route'

function recipientRow(over?: { openingId?: string; services?: unknown[] }) {
  return {
    id: `recip_${over?.openingId ?? 'opening_1'}`,
    firstMatchedTier: 'WAITLIST',
    notifiedTier: 'WAITLIST',
    status: LastMinuteRecipientStatus.ENQUEUED,
    notifiedAt: new Date('2026-07-20T18:00:00.000Z'),
    openedAt: null,
    clickedAt: null,
    bookedAt: null,
    createdAt: new Date('2026-07-20T18:00:00.000Z'),
    opening: {
      id: over?.openingId ?? 'opening_1',
      professionalId: 'pro_1',
      startAt: new Date('2026-07-25T20:00:00.000Z'),
      endAt: new Date('2026-07-25T21:00:00.000Z'),
      note: null,
      status: 'ACTIVE',
      visibilityMode: 'PUBLIC_AT_DISCOVERY',
      publicVisibleFrom: null,
      publicVisibleUntil: null,
      bookedAt: null,
      cancelledAt: null,
      timeZone: 'America/Los_Angeles',
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      location: null,
      professional: {
        id: 'pro_1',
        businessName: 'Opening Studio',
        firstName: 'Opie',
        lastName: 'Pro',
        handle: 'opie',
        nameDisplay: 'FULL',
        avatarUrl: null,
        professionType: null,
        location: null,
        timeZone: 'America/Los_Angeles',
      },
      services: over?.services ?? [
        {
          id: 'svcrow_1',
          openingId: over?.openingId ?? 'opening_1',
          serviceId: 'svc_1',
          offeringId: 'off_1',
          sortOrder: 0,
          service: {
            id: 'svc_1',
            name: 'Balayage',
            minPrice: '100.00',
            defaultDurationMinutes: 60,
          },
          offering: {
            id: 'off_1',
            title: null,
            salonPriceStartingAt: null,
            mobilePriceStartingAt: null,
            salonDurationMinutes: 90,
            mobileDurationMinutes: null,
            offersInSalon: true,
            offersMobile: false,
          },
        },
      ],
      tierPlans: [],
    },
  }
}

function payloadFromLastCall(): { notifications: { id: string }[] } {
  const [payload] = mocks.jsonOk.mock.calls[0]!
  return payload as { notifications: { id: string }[] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })
  mocks.jsonOk.mockImplementation((body: unknown, status = 200) => ({ body, status }))
  mocks.jsonFail.mockImplementation((status: number, error: string) => ({ status, error }))
  mocks.recipientFindMany.mockResolvedValue([recipientRow()])
  mocks.filterStillOpenRows.mockImplementation(
    async (args: { rows: unknown[] }) => args.rows,
  )
})

describe('GET /api/v1/client/openings', () => {
  it('serves the openings the schedule still supports', async () => {
    await GET(new Request('https://tovis.test/api/v1/client/openings'))

    expect(payloadFromLastCall().notifications).toHaveLength(1)
  })

  // F15 — the row's own state never changes when the slot is lost to an
  // ordinary booking, a block, or narrowed hours, so the feed has to ask.
  it('drops an opening the pro’s live schedule can no longer serve', async () => {
    mocks.recipientFindMany.mockResolvedValue([
      recipientRow({ openingId: 'opening_1' }),
      recipientRow({ openingId: 'opening_2' }),
    ])
    mocks.filterStillOpenRows.mockImplementation(
      async (args: { rows: { opening: { id: string } }[] }) =>
        args.rows.filter((row) => row.opening.id === 'opening_1'),
    )

    await GET(new Request('https://tovis.test/api/v1/client/openings'))

    const { notifications } = payloadFromLastCall()
    expect(notifications.map((n) => n.id)).toEqual(['recip_opening_1'])
  })

  it('asks about the opening as the CLIENT hold path will claim it', async () => {
    await GET(new Request('https://tovis.test/api/v1/client/openings'))

    const [args] = mocks.filterStillOpenRows.mock.calls[0]!
    const call = args as {
      viewerClientId: string
      onUncheckable: string
      toCandidate: (row: ReturnType<typeof recipientRow>) => Record<string, unknown> | null
    }

    // Scoped to the viewer: their own plain hold must not hide the card from
    // them while they are mid-checkout on it.
    expect(call.viewerClientId).toBe('client_1')
    expect(call.onUncheckable).toBe('drop')

    expect(call.toCandidate(recipientRow())).toMatchObject({
      key: 'opening_1',
      professionalId: 'pro_1',
      professionalTimeZone: 'America/Los_Angeles',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      startUtc: new Date('2026-07-25T20:00:00.000Z'),
      // The offering's own salon duration, not the service default.
      durationMinutes: 90,
      // The claim is a CLIENT hold: an off-grid start is fatal, and the
      // viewer's own plain hold is dropped by that claim before it checks.
      commitGate: 'CLIENT_HOLD',
      releasedHoldId: null,
    })
  })

  // An opening whose services all went inactive has nothing to claim, so it is
  // dropped before the schedule is asked — which is also why `onUncheckable`
  // can be 'drop' here without hiding anything a client could have taken.
  it('never asks about an opening with no active service', async () => {
    mocks.recipientFindMany.mockResolvedValue([recipientRow({ services: [] })])

    await GET(new Request('https://tovis.test/api/v1/client/openings'))

    const [args] = mocks.filterStillOpenRows.mock.calls[0]!
    expect((args as { rows: unknown[] }).rows).toHaveLength(0)
    expect(payloadFromLastCall().notifications).toEqual([])
  })
})
