// app/pro/waitlist/WaitlistOutreachClient.live.test.tsx
//
// The same shape as the calendar bug #840 fixed, on a second surface: this page
// holds its waitlist rows in component state fetched from /api/v1/pro/waitlist,
// so the pro shell's `router.refresh()` — which only re-runs SERVER components —
// never reached them. A client accepting an offer, or walking away from a live
// one, left the pro's list stale until a manual reload, even though the server
// had already pinged (client/waitlist-offers/[id] broadcasts).
//
// Pinned here: a live ping re-runs this component's own fetch.

import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  onChanged: { current: null as null | (() => void) },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/app/_components/live/useLiveChannels', () => ({
  useLiveChannels: (_channels: string[], onChanged: () => void) => {
    mocks.onChanged.current = onChanged
  },
}))

import { LiveRefresh } from '@/app/_components/live/LiveRefresh'

import WaitlistOutreachClient from './WaitlistOutreachClient'

function payload(total: number) {
  return {
    ok: true,
    total,
    services: [],
  }
}

describe('WaitlistOutreachClient — live-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onChanged.current = null
  })

  it('re-runs its own fetch when a live ping arrives', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload(0) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <LiveRefresh channels={['pro:pro_1']}>
        <WaitlistOutreachClient />
      </LiveRefresh>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/waitlist',
      expect.anything(),
    )

    // The client acts; the server pings the pro's channel.
    await act(async () => {
      mocks.onChanged.current?.()
    })

    // router.refresh() alone would leave this component rendering its old rows.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    vi.unstubAllGlobals()
  })

  it('still renders without a LiveRefresh boundary above it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload(0) })
    vi.stubGlobal('fetch', fetchMock)

    // Realtime unconfigured, or the surface rendered outside the pro shell.
    // useLiveChanged must no-op rather than throw — load-on-mount still works,
    // which is the graceful degradation this whole feature promises.
    render(<WaitlistOutreachClient />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(/No one on your waitlist yet/i),
    ).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
