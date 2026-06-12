import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.hoisted(() => vi.fn())
const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockCheckProReadiness = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadiness: mockCheckProReadiness,
}))

import ProRootLayout from './layout'

function makeHeaders(values: Record<string, string | null> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null
    },
  } as Headers
}

function makeProUser(args?: {
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  isFullyVerified?: boolean
  professionalProfile?:
    | {
        id: string
        businessName: string | null
        handle: string | null
        avatarUrl: string | null
        timeZone: string | null
        location: string | null
      }
    | null
}) {
  return {
    id: 'user_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: 'PRO' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    sessionKind: args?.sessionKind ?? 'ACTIVE',
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: args?.isFullyVerified ?? true,
    clientProfile: null,
    professionalProfile:
      args?.professionalProfile === undefined
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
          }
        : args.professionalProfile,
  }
}

describe('app/pro/layout', () => {
  beforeEach(() => {
    mockRedirect.mockReset()
    mockGetCurrentUser.mockReset()
    mockHeaders.mockReset()
    mockCheckProReadiness.mockReset()

    mockRedirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`)
    })

    mockHeaders.mockResolvedValue(makeHeaders({ 'x-pathname': '/pro/calendar' }))

    mockCheckProReadiness.mockResolvedValue({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('redirects to login when there is no authenticated pro user', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?from=%2Fpro%2Fcalendar')

    expect(mockCheckProReadiness).not.toHaveBeenCalled()
  })

  it('redirects to login with PRO_REQUIRED when the user is not a pro', async () => {
    mockGetCurrentUser.mockResolvedValue({
      ...makeProUser(),
      role: 'CLIENT' as const,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
    })

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fpro%2Fcalendar&reason=PRO_REQUIRED',
    )

    expect(mockCheckProReadiness).not.toHaveBeenCalled()
  })

  it('redirects to login with PRO_SETUP_REQUIRED when the pro profile is missing', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeProUser({
        professionalProfile: null,
      }),
    )

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fpro%2Fcalendar&reason=PRO_SETUP_REQUIRED',
    )

    expect(mockCheckProReadiness).not.toHaveBeenCalled()
  })

  it('redirects unverified or verification-session users to verify-phone', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeProUser({
        sessionKind: 'VERIFICATION',
        isFullyVerified: false,
      }),
    )

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/verify-phone?next=%2Fpro%2Fcalendar')

    expect(mockCheckProReadiness).not.toHaveBeenCalled()
  })

  it('allows a fully verified active ready pro user', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeProUser({
        sessionKind: 'ACTIVE',
        isFullyVerified: true,
      }),
    )

    const result = await ProRootLayout({
      children: <div>pro page</div>,
      modal: <div>modal</div>,
    })

    expect(mockCheckProReadiness).toHaveBeenCalledWith('pro_1')
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(React.isValidElement(result)).toBe(true)
  })

  it('redirects an unready pro away from blocked pro paths', async () => {
    mockGetCurrentUser.mockResolvedValue(makeProUser())
    mockHeaders.mockResolvedValue(
      makeHeaders({ 'x-pathname': '/pro/bookings/new' }),
    )
    mockCheckProReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    })

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/pro/services')

    expect(mockCheckProReadiness).toHaveBeenCalledWith('pro_1')
  })

  it('allows an unready pro to access setup paths', async () => {
    mockGetCurrentUser.mockResolvedValue(makeProUser())
    mockHeaders.mockResolvedValue(
      makeHeaders({ 'x-pathname': '/pro/services' }),
    )
    mockCheckProReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    })

    const result = await ProRootLayout({
      children: <div>pro services</div>,
      modal: <div>modal</div>,
    })

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(React.isValidElement(result)).toBe(true)
  })

  it('routes the working-hours blocker to the calendar hours editor', async () => {
    mockGetCurrentUser.mockResolvedValue(makeProUser())
    mockHeaders.mockResolvedValue(
      makeHeaders({ 'x-pathname': '/pro/bookings/new' }),
    )
    mockCheckProReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['LOCATION_MISSING_WORKING_HOURS'],
    })

    await expect(
      ProRootLayout({
        children: <div>pro page</div>,
        modal: <div>modal</div>,
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/pro/calendar')
  })
})