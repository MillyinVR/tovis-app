// The gate, and the order it runs in.
//
// The defect this pins was invisible to typecheck, lint, every guard and every
// other test: the gated LAYOUT redirects a signed-out visitor, but a layout and
// its page render in parallel, so this page still ran its loader and shipped
// the look — name and opted-in pros — inside the RSC payload of a 200. Caught
// by curling the route anonymously, not by reasoning about it.
import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rootTenantContext } from '@/lib/tenant/context'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  getCurrentUser: vi.fn(),
  loadLiveViralLookForClient: vi.fn(),
  getBrandForTenantContext: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mocks.getCurrentUser }))

vi.mock('@/lib/viralRequests/liveLooks', () => ({
  loadLiveViralLookForClient: mocks.loadLiveViralLookForClient,
}))

// The page resolves its brand through the tenant context, so the context has to
// exist for the call to be made at all.
vi.mock('@/lib/tenant/layoutContext', () => ({
  resolveTenantContextForLayout: async () => rootTenantContext('tenant_root'),
}))

vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: mocks.getBrandForTenantContext,
}))

import ViralLookPage from './page'

const LOOK_ID = 'viral_1'

function params() {
  return { params: Promise.resolve({ id: LOOK_ID }) }
}

/** A live look with `count` opted-in pros and nothing this page can leak. */
function liveLook(count: number) {
  return {
    id: LOOK_ID,
    name: 'Wolf Cut',
    sourceUrl: null,
    coverImage: null,
    approvedAt: new Date('2026-09-01T00:00:00.000Z'),
    categoryName: 'Hair',
    pros: [],
    offeringProCount: count,
  }
}

/**
 * The page's own decisions, read off the element it returns rather than from a
 * render: what it puts in the lede, and what it hands the list below.
 */
type ClientPageProps = { lede: string; children: unknown }

/**
 * The first element in the returned tree carrying `key` as a prop.
 *
 * A search rather than a path, because indexing into `children` positionally
 * would break the moment anything is added above the list — which says nothing
 * about whether the list got the right props.
 */
function findPropsWith(
  node: unknown,
  key: string,
): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPropsWith(child, key)
      if (hit) return hit
    }
    return null
  }

  if (!isValidElement<Record<string, unknown>>(node)) return null
  if (key in node.props) return node.props

  return findPropsWith(node.props.children, key)
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

  it('does not resolve a tenant for a look nobody may see', async () => {
    // Ordering, not an optimisation: resolving the tenant reads request headers,
    // and doing it before the 404 made this path depend on a request scope it
    // never needed. The two tests above are what caught it.
    mocks.loadLiveViralLookForClient.mockResolvedValue(null)

    await expect(ViralLookPage(params())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getBrandForTenantContext).not.toHaveBeenCalled()
  })
})

describe('/client/viral/[id] — what the lede claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: 'CLIENT',
      clientProfile: { id: 'client_1' },
    })
    // Not 'TOVIS': a brand-shaped literal here would pass while the page
    // hardcoded its own, which is the white-label failure the guard exists for.
    mocks.getBrandForTenantContext.mockReturnValue({ displayName: 'Brandenburg' })
  })

  async function ledeFor(count: number) {
    mocks.loadLiveViralLookForClient.mockResolvedValue(liveLook(count))

    const page = (await ViralLookPage(params())) as ReactElement<ClientPageProps>

    return page.props.lede
  }

  it('names the platform the count is counted over', async () => {
    // Tori, 2026-09-15: the count stays platform-wide, but it has to say so —
    // "3 pros have said they can do this look" reads as "3 near me", and the
    // matching query has no geography in it at all.
    expect(await ledeFor(3)).toBe(
      '3 pros on Brandenburg have said they can do this look.',
    )
  })

  it('agrees in number at one, which is the ordinary case', async () => {
    expect(await ledeFor(1)).toBe(
      '1 pro on Brandenburg has said they can do this look.',
    )
  })

  it('says nobody at zero, the state every approved look starts in', async () => {
    expect(await ledeFor(0)).toBe('No pro has taken this one on yet.')
  })

  it('hands the same brand name to the list, so the two cannot disagree', async () => {
    mocks.loadLiveViralLookForClient.mockResolvedValue(liveLook(3))

    const page = (await ViralLookPage(params())) as ReactElement<ClientPageProps>
    // The list heading states the same count as the lede. Reading either from a
    // second source is how "3 pros" ends up beside a sentence about 2.
    const list = findPropsWith(page.props.children, 'offeringProCount')

    expect(list).not.toBeNull()
    expect(list?.brandName).toBe('Brandenburg')
    expect(list?.offeringProCount).toBe(3)
  })
})
