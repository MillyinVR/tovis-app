// app/pro/portfolio/page.test.tsx
import { describe, expect, it, vi } from 'vitest'

const mockPermanentRedirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
)

vi.mock('next/navigation', () => ({
  permanentRedirect: mockPermanentRedirect,
}))

import ProPortfolioPage from './page'

async function redirectTarget(
  searchParams?: Record<string, string | string[]>,
): Promise<string> {
  try {
    await ProPortfolioPage(
      searchParams ? { searchParams: Promise.resolve(searchParams) } : {},
    )
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : ''
    return message.replace('NEXT_REDIRECT:', '')
  }

  throw new Error('expected a redirect')
}

describe('app/pro/portfolio/page', () => {
  it('sends a bare visit to the profile’s portfolio tab', async () => {
    await expect(redirectTarget()).resolves.toBe(
      '/pro/profile/public-profile?tab=portfolio',
    )
  })

  /**
   * Every filter chip and every group's "Show N more" used to write
   * `?filter=` URLs against this route, so a bookmarked one has to land on the
   * same view rather than on an unfiltered grid.
   */
  it('carries a filter across', async () => {
    await expect(redirectTarget({ filter: 'WAITING' })).resolves.toBe(
      '/pro/profile/public-profile?tab=portfolio&filter=WAITING',
    )
  })

  it('carries a search query across', async () => {
    await expect(redirectTarget({ q: 'balayage' })).resolves.toBe(
      '/pro/profile/public-profile?tab=portfolio&q=balayage',
    )
  })

  it('drops a filter value that is not a real filter key', async () => {
    await expect(redirectTarget({ filter: 'NONSENSE' })).resolves.toBe(
      '/pro/profile/public-profile?tab=portfolio',
    )
  })

  it('drops ALL rather than pinning it, so the chip row reads as unfiltered', async () => {
    await expect(redirectTarget({ filter: 'ALL' })).resolves.toBe(
      '/pro/profile/public-profile?tab=portfolio',
    )
  })
})
