// app/pro/waitlist/WaitlistOutreachClient.travel.test.tsx
//
// What the PRO actually reads about a pending MOBILE offer, rendered.
//
// The server-side half of this rule is proven in
// tests/integration/waitlist-mobile-offer.test.ts (the response carries no
// address at any precision). This is the other half: that the row RENDERS the
// trip summary at all — a field can be added to a DTO, covered by a shape test,
// and still never reach a pixel — and that a salon row stays silent about a trip
// it does not involve.

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/app/_components/live/useLiveChannels', () => ({
  useLiveChannels: () => {},
}))

import WaitlistOutreachClient from './WaitlistOutreachClient'

const MOBILE_TRAVEL = {
  distanceMiles: 1.87,
  areaLabel: 'Coronado, CA',
  summary: '1.9 mi away · Coronado, CA',
}

function feed(pendingOffer: Record<string, unknown> | null) {
  return {
    ok: true,
    total: 1,
    services: [
      {
        serviceId: 'svc_1',
        serviceName: 'Balayage',
        entries: [
          {
            rank: 1,
            waitlistEntryId: 'wle_1',
            clientName: 'Nadia Waiter',
            avatarUrl: null,
            clientProfileHref: null,
            preferenceLabel: 'Any time',
            joinedAt: '2026-08-20T02:31:50.817Z',
            pendingOffer,
          },
        ],
      },
    ],
  }
}

function renderWithFeed(pendingOffer: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => feed(pendingOffer) }),
  )
  render(<WaitlistOutreachClient />)
}

describe('WaitlistOutreachClient — the trip on a pending mobile offer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the server’s summary verbatim, and no address', async () => {
    renderWithFeed({
      id: 'wof_1',
      startsAt: '2026-09-01T17:00:00.000Z',
      locationType: 'MOBILE',
      travel: MOBILE_TRAVEL,
    })

    await screen.findByText(/You’d travel · 1\.9 mi away · Coronado, CA/)
    // The wording is the server's; this surface must not re-derive it from the
    // parts, or the two platforms drift on the phrasing of a privacy boundary.
    expect(screen.queryByText(/Orange Ave/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('says nothing about a trip for an IN-SALON offer', async () => {
    renderWithFeed({
      id: 'wof_2',
      startsAt: '2026-09-01T17:00:00.000Z',
      locationType: 'SALON',
      travel: null,
    })

    await screen.findByText(/Offered ·/)
    expect(screen.queryByText(/You’d travel/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('renders a legacy mobile offer that predates the trip columns', async () => {
    // A row written before this shipped has no distance and no area. The card
    // must still render — silently — rather than showing an empty chip or
    // throwing on a missing field.
    renderWithFeed({
      id: 'wof_3',
      startsAt: '2026-09-01T17:00:00.000Z',
      locationType: 'MOBILE',
      travel: { distanceMiles: null, areaLabel: null, summary: null },
    })

    await screen.findByText(/Offered ·/)
    expect(screen.queryByText(/You’d travel/)).toBeNull()

    vi.unstubAllGlobals()
  })

  it('survives a server that has no `travel` on the offer at all', async () => {
    renderWithFeed({
      id: 'wof_4',
      startsAt: '2026-09-01T17:00:00.000Z',
      locationType: 'MOBILE',
    })

    await waitFor(() => {
      expect(screen.getByText(/Offered ·/)).toBeTruthy()
    })
    expect(screen.queryByText(/You’d travel/)).toBeNull()

    vi.unstubAllGlobals()
  })
})
