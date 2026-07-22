// app/pro/last-minute/OpeningsClient.test.tsx
//
// F16, on the surface the pro actually looks at. The list is driven through its
// REAL fetch → parse → render path (a stubbed response, not a stubbed row), so
// this fails if `clientVisibility` stops reaching the card for any reason —
// including the parser dropping a field nobody re-read.
//
// The ALLOW cases matter more than the badges here: a card that badges
// everything would satisfy every "it warned" assertion in the file.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import OpeningsClient from './OpeningsClient'

const START = '2026-08-01T20:00:00.000Z'

function openingPayload(over?: Record<string, unknown>) {
  return {
    id: 'opening_1',
    professionalId: 'pro_1',
    status: 'ACTIVE',
    visibilityMode: 'PUBLIC_AT_DISCOVERY',
    startAt: START,
    endAt: null,
    launchAt: null,
    expiresAt: null,
    publicVisibleFrom: null,
    publicVisibleUntil: null,
    bookedAt: null,
    cancelledAt: null,
    note: null,
    locationType: 'SALON',
    locationId: 'loc_1',
    timeZone: 'America/Los_Angeles',
    clientVisibility: 'VISIBLE',
    recipientCount: 3,
    location: {
      id: 'loc_1',
      type: 'SALON',
      name: 'Main Salon',
      city: null,
      state: null,
      formattedAddress: null,
      timeZone: 'America/Los_Angeles',
      lat: null,
      lng: null,
    },
    services: [
      {
        id: 'os_1',
        openingId: 'opening_1',
        serviceId: 'svc_1',
        offeringId: 'off_1',
        sortOrder: 0,
        createdAt: START,
        service: {
          id: 'svc_1',
          name: 'Balayage',
          minPrice: '120.00',
          defaultDurationMinutes: 60,
          isAddOnEligible: false,
          addOnGroup: null,
        },
        offering: {
          id: 'off_1',
          title: null,
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: '120.00',
          salonDurationMinutes: 60,
          mobilePriceStartingAt: null,
          mobileDurationMinutes: null,
        },
      },
    ],
    tierPlans: [],
    ...over,
  }
}

function respondWith(openings: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, openings }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

async function renderList(over?: Record<string, unknown>) {
  respondWith([openingPayload(over)])
  render(<OpeningsClient offerings={[]} view="list" />)
  await waitFor(() => expect(screen.getByText('Balayage')).toBeInTheDocument())
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OpeningsClient — client-visibility badge', () => {
  // ALLOW CASE.
  it('says nothing on an opening clients can still see', async () => {
    await renderList({ clientVisibility: 'VISIBLE' })

    expect(screen.queryByText(/Not visible to clients/i)).toBeNull()
    expect(screen.queryByText(/On hold/i)).toBeNull()
  })

  // ALLOW CASE, and the one an over-eager badge breaks: an older server that
  // does not send the field at all must read as silence, not as a fault.
  it('says nothing when the server sent no verdict', async () => {
    await renderList({ clientVisibility: undefined })

    expect(screen.queryByText(/Not visible to clients/i)).toBeNull()
  })

  it('tells the pro when the slot was booked out from under the opening', async () => {
    await renderList({ clientVisibility: 'TIME_BOOKED' })

    expect(
      screen.getByText('Not visible to clients — that time is already booked.'),
    ).toBeInTheDocument()
  })

  it('names the block, so the pro knows what to delete', async () => {
    await renderList({ clientVisibility: 'TIME_BLOCKED' })

    expect(
      screen.getByText('Not visible to clients — you have blocked that time.'),
    ).toBeInTheDocument()
  })

  it('names the hours, so the pro knows what to re-open', async () => {
    await renderList({ clientVisibility: 'OUTSIDE_WORKING_HOURS' })

    expect(
      screen.getByText(
        'Not visible to clients — that time is outside your working hours.',
      ),
    ).toBeInTheDocument()
  })

  // A claim in flight is the feature WORKING. It must not read as a fault, and
  // it must not be silent either — the pro should know why the card is quiet.
  it('reports a claim in progress without calling it a problem', async () => {
    await renderList({ clientVisibility: 'BEING_CLAIMED' })

    expect(
      screen.getByText('On hold — a booking for this time is in progress.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Not visible to clients/i)).toBeNull()
  })

  // F16 is a SIGNAL, not a filter: F15 deliberately left this list unfiltered so
  // a dead opening can still be cancelled, and the pro is the only one who can.
  it('keeps a dark opening in the list, still cancellable', async () => {
    await renderList({ clientVisibility: 'TIME_BOOKED' })

    expect(screen.getByText('Balayage')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cancel opening' }),
    ).toBeEnabled()
  })
})
