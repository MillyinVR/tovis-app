import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.hoisted(() => vi.fn())
const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

import ClientLayout from './layout'
import {
  resolvePostAuthNavigation,
  sanitizeInternalPath,
  sanitizeRedirectTarget,
} from '@/app/(auth)/_components/postAuthRedirect'

function makeClientUser(args?: {
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  isFullyVerified?: boolean
  clientProfile?: { id: string } | null
}) {
  return {
    id: 'user_1',
    email: 'client@example.com',
    phone: '+15551234567',
    role: 'CLIENT' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    sessionKind: args?.sessionKind ?? 'ACTIVE',
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: args?.isFullyVerified ?? true,
    clientProfile:
      args?.clientProfile === undefined ? { id: 'client_1' } : args.clientProfile,
    professionalProfile: null,
  }
}

describe('app/client/layout', () => {
  beforeEach(() => {
    mockRedirect.mockReset()
    mockGetCurrentUser.mockReset()
    mockHeaders.mockReset()
    mockHeaders.mockResolvedValue(new Headers())

    mockRedirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`)
    })
  })

  it('redirects to login when there is no authenticated client user', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(
      ClientLayout({
        children: <div>client page</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?from=%2Fclient')
  })

  it('redirects to login when the user is missing a client profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeClientUser({
        clientProfile: null,
      }),
    )

    await expect(
      ClientLayout({
        children: <div>client page</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?from=%2Fclient')
  })

  it('redirects unverified or verification-session users to verify-phone', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeClientUser({
        sessionKind: 'VERIFICATION',
        isFullyVerified: false,
      }),
    )

    await expect(
      ClientLayout({
        children: <div>client page</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/verify-phone?next=%2Fclient')
  })

  it('returns the viewer to the page they asked for, query included', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(
      new Headers({
        'x-pathname': '/client/bookings/booking_1',
        'x-search': '?step=aftercare',
      }),
    )

    await expect(
      ClientLayout({
        children: <div>client page</div>,
      }),
    ).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fclient%2Fbookings%2Fbooking_1%3Fstep%3Daftercare',
    )
  })

  it('falls back to the client home when the requested path is forged', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(
      new Headers({ 'x-current-path': '//evil.example/steal' }),
    )

    await expect(
      ClientLayout({
        children: <div>client page</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?from=%2Fclient')
  })

  it('allows a fully verified active client user', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeClientUser({
        sessionKind: 'ACTIVE',
        isFullyVerified: true,
      }),
    )

    const result = await ClientLayout({
      children: <div>client page</div>,
    })

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(React.isValidElement(result)).toBe(true)
  })
})

/**
 * The emitter and the login screen are two halves of ONE contract: the layout
 * writes `?from=`, LoginClient re-reads it through its own sanitizers and hands
 * the survivor to `resolvePostAuthNavigation`. Asserting only the emitted href
 * would prove nothing about where the viewer actually lands.
 */
describe('app/client/layout -> login round trip', () => {
  beforeEach(() => {
    mockRedirect.mockReset()
    mockGetCurrentUser.mockReset()
    mockHeaders.mockReset()
    mockHeaders.mockResolvedValue(new Headers())
  })

  function landingFor(loginUrl: string): string | null {
    const fromRaw = new URL(loginUrl, 'https://app.tovis.app').searchParams.get(
      'from',
    )
    const fromSafe = sanitizeRedirectTarget(sanitizeInternalPath(fromRaw))

    const nav = resolvePostAuthNavigation(
      {
        user: { role: 'CLIENT' },
        isPhoneVerified: true,
        isEmailVerified: true,
        isFullyVerified: true,
      },
      { nextSafe: null, fromSafe },
    )

    return nav.kind === 'navigate' ? nav.url : null
  }

  it('lands a signed-out aftercare tap back on the aftercare step', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(
      new Headers({
        'x-pathname': '/client/bookings/booking_1',
        'x-search': '?step=aftercare',
      }),
    )

    let loginUrl = ''
    mockRedirect.mockImplementation((href: string) => {
      loginUrl = href
      throw new Error(`NEXT_REDIRECT:${href}`)
    })

    await expect(
      ClientLayout({ children: <div>client page</div> }),
    ).rejects.toThrow('NEXT_REDIRECT:')

    expect(landingFor(loginUrl)).toBe(
      '/client/bookings/booking_1?step=aftercare',
    )
  })

  it('still refuses a crafted external from at the login screen', () => {
    expect(landingFor('/login?from=https%3A%2F%2Fevil.example%2Fx')).toBe(
      '/looks',
    )
    expect(landingFor('/login?from=%2F%2Fevil.example%2Fx')).toBe('/looks')
    expect(landingFor('/login?from=%2Flogin%3Ffrom%3D%2Fclient')).toBe('/looks')
  })
})
