import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.hoisted(() => vi.fn())
const mockGetCurrentUser = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

import ClientLayout from './layout'

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