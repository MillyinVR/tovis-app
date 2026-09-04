import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The SECOND signed-out bounce on the client booking surface. The gated layout
 * catches a viewer with no session at all; this one catches a signed-in user
 * whose account carries no client profile, and it used to hard-code
 * `/client/bookings/{id}` — dropping `?step=`, which is the param that selects
 * the tab. A tap on an aftercare link therefore landed on the overview after
 * login. Same bug as the layout's, so it takes the same fix.
 */
const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  headers: vi.fn(),
  loadClientBookingPage: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}))

vi.mock('./_data/loadClientBookingPage', () => ({
  loadClientBookingPage: mocks.loadClientBookingPage,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: vi.fn() },
    consultSession: { findUnique: vi.fn() },
  },
}))

import ClientBookingPage from './page'

function renderPage() {
  return ClientBookingPage({
    params: Promise.resolve({ id: 'booking_1' }),
    searchParams: Promise.resolve({ step: 'aftercare' }),
  })
}

describe('client booking page — signed-out bounce', () => {
  beforeEach(() => {
    mocks.redirect.mockReset()
    mocks.notFound.mockReset()
    mocks.headers.mockReset()
    mocks.loadClientBookingPage.mockReset()

    mocks.redirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`)
    })
    // No client profile → the branch under test.
    mocks.loadClientBookingPage.mockResolvedValue({
      user: { id: 'user_1', role: 'CLIENT', clientProfile: null },
      raw: null,
      aftercare: null,
      existingReview: null,
      media: [],
      paymentSettings: null,
      rebookedNextBooking: null,
      depositCredit: null,
      creatorCreditBalanceCents: 0,
      checkoutProductItems: [],
      prep: null,
      boards: [],
    })
    mocks.headers.mockResolvedValue(new Headers())
  })

  it('returns the viewer to the step they asked for, query included', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-pathname': '/client/bookings/booking_1',
        'x-search': '?step=aftercare',
      }),
    )

    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fclient%2Fbookings%2Fbooking_1%3Fstep%3Daftercare',
    )
  })

  it('falls back to the booking itself when no path header is present', async () => {
    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fclient%2Fbookings%2Fbooking_1',
    )
  })

  it('falls back to the booking itself when the requested path is forged', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({ 'x-current-path': '//evil.example/steal' }),
    )

    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fclient%2Fbookings%2Fbooking_1',
    )
  })
})
