// lib/consult/lookBookEntry.client.test.ts
//
// What a look's Book button does when a consult for that (client, pro, look)
// already exists — including the two statuses it cannot come back from on its
// own.
//
// 🔴 The defect this pins: the availability read returns the existing session
// whatever its status, and a unique index makes a second one impossible. So a
// terminal consult captured the Book button permanently — every tap landed on a
// screen with no forward action, and the ordinary booking drawer beneath was
// never reached.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveLookConsultEntry } from './lookBookEntry.client'

const LOOK = 'look_1'

function availabilityResponse(consult: { id: string; status: string } | null) {
  return {
    ok: true,
    json: async () => ({ ok: true, availability: { available: true, consult } }),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveLookConsultEntry — an existing consult', () => {
  it('sends a completed consult to its booking door', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      availabilityResponse({ id: 'c1', status: 'COMPLETED' }) as never,
    )

    await expect(resolveLookConsultEntry(LOOK)).resolves.toEqual({
      href: '/client/consult/c1/book',
    })
  })

  it('resumes one still mid-flow', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      availabilityResponse({ id: 'c1', status: 'INTAKE_READY' }) as never,
    )

    await expect(resolveLookConsultEntry(LOOK)).resolves.toEqual({
      href: '/client/consult/c1',
    })
  })

  // Revoked is NOT terminal: accepting a fresh agreement moves the session back
  // to CONSENT_REQUIRED server-side, and the flow's consent step is where that
  // happens — so the button must still open it.
  it('still opens a consult whose consent was revoked, because it can be restarted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      availabilityResponse({ id: 'c1', status: 'CONSENT_REVOKED' }) as never,
    )

    await expect(resolveLookConsultEntry(LOOK)).resolves.toEqual({
      href: '/client/consult/c1',
    })
  })

  // 🔴 Cancelled has no recovery transition. Returning null hands the tap back
  // to the ordinary availability drawer instead of parking it forever.
  it('gives the button back when the consult was cancelled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      availabilityResponse({ id: 'c1', status: 'CANCELLED' }) as never,
    )

    await expect(resolveLookConsultEntry(LOOK)).resolves.toBeNull()
    // …and it does NOT try to start another one: the unique index would just
    // hand back the same cancelled session.
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
  })

  it('starts one when there is none, and routes on what the server answers', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(availabilityResponse(null) as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ consult: { id: 'c2', status: 'CONSENT_REQUIRED' } }),
      } as never)

    await expect(resolveLookConsultEntry(LOOK)).resolves.toEqual({
      href: '/client/consult/c2',
    })
  })

  it('gives the button back when a freshly-read session is cancelled', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(availabilityResponse(null) as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ consult: { id: 'c2', status: 'CANCELLED' } }),
      } as never)

    await expect(resolveLookConsultEntry(LOOK)).resolves.toBeNull()
  })
})
