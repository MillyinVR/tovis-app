// The gate, and the order it runs in.
//
// The defect this pins was invisible to typecheck, lint, every guard and every
// other test: the gated LAYOUT redirects a signed-out visitor, but a layout and
// its page render in parallel, so this page still ran its loader and shipped
// the look — name and opted-in pros — inside the RSC payload of a 200. Caught
// by curling the route anonymously, not by reasoning about it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  getCurrentUser: vi.fn(),
  loadLiveViralLookForClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mocks.getCurrentUser }))

vi.mock('@/lib/viralRequests/liveLooks', () => ({
  loadLiveViralLookForClient: mocks.loadLiveViralLookForClient,
}))

import ViralLookPage from './page'

const LOOK_ID = 'viral_1'

function params() {
  return { params: Promise.resolve({ id: LOOK_ID }) }
}

describe('/client/viral/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: 'CLIENT',
      clientProfile: { id: 'client_1' },
    })
  })

  it('refuses a signed-out visitor BEFORE loading the look', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    await expect(ViralLookPage(params())).rejects.toThrow('NEXT_REDIRECT')

    // The assertion that matters. Redirecting is not enough on its own — if the
    // loader still ran, its answer still reaches the response body.
    expect(mocks.loadLiveViralLookForClient).not.toHaveBeenCalled()
  })

  it('refuses a PRO the same way', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_2',
      role: 'PRO',
      clientProfile: null,
    })

    await expect(ViralLookPage(params())).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.loadLiveViralLookForClient).not.toHaveBeenCalled()
  })

  it('sends the client back HERE after login, not to the home screen', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    await expect(ViralLookPage(params())).rejects.toThrow(
      `NEXT_REDIRECT:/login?from=${encodeURIComponent(`/client/viral/${LOOK_ID}`)}`,
    )
  })

  it('404s a look that is not live, rather than rendering an empty page', async () => {
    mocks.loadLiveViralLookForClient.mockResolvedValue(null)

    await expect(ViralLookPage(params())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('asks the loader for the id in the route', async () => {
    mocks.loadLiveViralLookForClient.mockResolvedValue(null)

    await expect(ViralLookPage(params())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.loadLiveViralLookForClient).toHaveBeenCalledWith(LOOK_ID)
  })
})
