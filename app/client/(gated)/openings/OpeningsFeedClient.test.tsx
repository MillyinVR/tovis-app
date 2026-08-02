// app/client/(gated)/openings/OpeningsFeedClient.test.tsx
//
// The pro's name on an opening card used to be pre-joined into one meta string
// ("Glow Studio · Los Angeles"), which made it impossible to link. These pin the
// split: name = link, the rest = plain text, and the two still read as one line.
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/presence/usePresenceSignalsBatch', () => ({
  usePresenceSignalsBatch: () => ({}),
}))

import OpeningsFeedClient from './OpeningsFeedClient'

function makeNotification(overrides?: {
  professional?: Record<string, unknown> | null
}) {
  return {
    id: 'notif_1',
    tier: 'WAITLIST',
    opening: {
      id: 'opening_1',
      startAt: '2026-08-05T18:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      locationType: 'SALON',
      professional:
        overrides && 'professional' in overrides
          ? overrides.professional
          : {
              id: 'pro_1',
              displayName: 'Glow Studio',
              locationLabel: 'Los Angeles',
            },
      services: [
        {
          offeringId: 'offering_1',
          serviceId: 'service_1',
          service: { id: 'service_1', name: 'Balayage', minPrice: 180 },
          offering: { title: 'Balayage', salonPriceStartingAt: 180 },
        },
      ],
    },
  }
}

function mockFetchOnce(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => payload,
    })),
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('OpeningsFeedClient', () => {
  it('links the pro name on an opening card and keeps the rest of the meta line', async () => {
    mockFetchOnce({ notifications: [makeNotification()] })

    render(<OpeningsFeedClient />)

    const proLink = await screen.findByRole('link', { name: 'Glow Studio' })
    expect(proLink).toHaveAttribute('href', '/professionals/pro_1')

    // The location still sits on the same line, after the linked name.
    expect(screen.getByText(/· Los Angeles/)).toBeInTheDocument()
  })

  it('links the card avatar to the pro too', async () => {
    mockFetchOnce({ notifications: [makeNotification()] })

    render(<OpeningsFeedClient />)

    const avatarLink = await screen.findByRole('link', {
      name: "View Glow Studio's profile",
    })
    expect(avatarLink).toHaveAttribute('href', '/professionals/pro_1')
  })

  // The feed parses an untyped API payload, so a pro with no id is reachable
  // state — it must degrade to text, not to `/professionals/undefined`.
  it('renders the fallback pro name inert when the payload has no pro', async () => {
    mockFetchOnce({ notifications: [makeNotification({ professional: null })] })

    render(<OpeningsFeedClient />)

    await waitFor(() => {
      expect(screen.getByText(/Your pro/)).toBeInTheDocument()
    })
    expect(
      screen
        .queryAllByRole('link')
        .some((a) => (a.getAttribute('href') ?? '').startsWith('/professionals/')),
    ).toBe(false)
  })
})
