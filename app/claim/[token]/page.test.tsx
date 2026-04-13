import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),

  acceptClientClaimFromLink: vi.fn(),
  formatAppointmentWhen: vi.fn(),
  getCurrentUser: vi.fn(),
  pickString: vi.fn(),
  inviteFindUnique: vi.fn(),
  sanitizeTimeZone: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('next/link', () => ({
  default: (props: {
    href: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement(
      'a',
      {
        href: props.href,
        className: props.className,
      },
      props.children,
    ),
}))

vi.mock('@/lib/clients/clientClaim', () => ({
  acceptClientClaimFromLink: mocks.acceptClientClaimFromLink,
}))

vi.mock('@/lib/formatInTimeZone', () => ({
  formatAppointmentWhen: mocks.formatAppointmentWhen,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    proClientInvite: {
      findUnique: mocks.inviteFindUnique,
    },
  },
}))

vi.mock('@/lib/timeZone', () => ({
  sanitizeTimeZone: mocks.sanitizeTimeZone,
}))

import ClaimInvitePage from './page'

function makeRedirectError(href: string): Error {
  return new Error(`REDIRECT:${href}`)
}

function makeNotFoundError(): Error {
  return new Error('NOT_FOUND')
}

function makeInvite(overrides?: {
  token?: string
  clientId?: string
  invitedName?: string | null
  invitedEmail?: string | null
  invitedPhone?: string | null
  status?: ProClientInviteStatus
  revokedAt?: Date | null
  clientClaimStatus?: ClientClaimStatus
}) {
  const token = overrides?.token ?? 'tok_1'
  const clientId = overrides?.clientId ?? 'client_1'

  return {
    id: 'invite_1',
    token,
    clientId,
    professionalId: 'pro_1',
    bookingId: 'booking_1',
    invitedName:
      overrides && 'invitedName' in overrides
        ? overrides.invitedName
        : 'Tori Morales',
    invitedEmail:
      overrides && 'invitedEmail' in overrides
        ? overrides.invitedEmail
        : 'tori@example.com',
    invitedPhone:
      overrides && 'invitedPhone' in overrides
        ? overrides.invitedPhone
        : '+16195551234',
    preferredContactMethod: null,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt: null,
    revokedAt:
      overrides && 'revokedAt' in overrides ? overrides.revokedAt : null,
    client: {
      id: clientId,
      claimStatus:
        overrides?.clientClaimStatus ?? ClientClaimStatus.UNCLAIMED,
    },
    booking: {
      id: 'booking_1',
      clientId,
      scheduledFor: new Date('2026-04-13T18:00:00.000Z'),
      locationTimeZone: 'America/Los_Angeles',
      service: {
        name: 'Silk Press',
      },
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        location: 'San Diego',
        timeZone: 'America/Los_Angeles',
        user: {
          email: 'pro@example.com',
        },
      },
      location: {
        name: 'Downtown Studio',
        formattedAddress: '123 Main St, San Diego, CA',
        city: 'San Diego',
        state: 'CA',
        timeZone: 'America/Los_Angeles',
      },
    },
  }
}

async function renderPage(args?: {
  token?: string
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const element = await ClaimInvitePage({
    params: Promise.resolve({
      token: args?.token ?? 'tok_1',
    }),
    searchParams: Promise.resolve(args?.searchParams),
  })

  return renderToStaticMarkup(element)
}

describe('app/claim/[token]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.notFound.mockImplementation(() => {
      throw makeNotFoundError()
    })

    mocks.acceptClientClaimFromLink.mockResolvedValue({
      kind: 'ok',
      bookingId: 'booking_1',
    })

    mocks.formatAppointmentWhen.mockReturnValue('Apr 13, 2026 at 11:00 AM')

    mocks.getCurrentUser.mockResolvedValue(null)

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.inviteFindUnique.mockResolvedValue(makeInvite())

    mocks.sanitizeTimeZone.mockImplementation(
      (value: string | null | undefined, fallback: string) => value ?? fallback,
    )
  })

  it('calls notFound when the invite does not exist', async () => {
    mocks.inviteFindUnique.mockResolvedValueOnce(null)

    await expect(renderPage()).rejects.toThrow('NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('redirects an unauthenticated ready invite into signup with claim context and prefill data', async () => {
    await expect(renderPage()).rejects.toThrow(/^REDIRECT:/)

    expect(mocks.redirect).toHaveBeenCalledTimes(1)

    const href = String(mocks.redirect.mock.calls[0]?.[0] ?? '')
    expect(href.startsWith('/signup?')).toBe(true)

    const query = href.split('?')[1] ?? ''
    const params = new URLSearchParams(query)

    expect(params.get('from')).toBe('/claim/tok_1')
    expect(params.get('next')).toBe('/claim/tok_1')
    expect(params.get('role')).toBe('CLIENT')
    expect(params.get('intent')).toBe('CLAIM_INVITE')
    expect(params.get('inviteToken')).toBe('tok_1')
    expect(params.get('name')).toBe('Tori Morales')
    expect(params.get('email')).toBe('tori@example.com')
    expect(params.get('phone')).toBe('+16195551234')
  })

  it('renders revoked state without redirecting unauthenticated users', async () => {
    mocks.inviteFindUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
        revokedAt: new Date('2026-04-13T19:00:00.000Z'),
      }),
    )

    const html = await renderPage()

    expect(html).toContain('This claim link is no longer available')
    expect(html).toContain('Silk Press with TOVIS Studio')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders verify flow for the matching client when the account still needs verification', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user_1',
      role: 'CLIENT',
      clientProfile: { id: 'client_1' },
      sessionKind: 'LIMITED',
      isFullyVerified: false,
    })

    const html = await renderPage()

    expect(html).toContain(
      'Verify your account first, then come right back here to finish the claim.',
    )
    expect(html).toContain('/verify-phone?next=%2Fclaim%2Ftok_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders mismatch state for a different signed-in client account', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user_2',
      role: 'CLIENT',
      clientProfile: { id: 'client_other' },
      sessionKind: 'ACTIVE',
      isFullyVerified: true,
    })

    const html = await renderPage()

    expect(html).toContain(
      'You are signed into a different client account',
    )
    expect(html).toContain('/login?from=%2Fclaim%2Ftok_1')
    expect(html).toContain('/signup?from=%2Fclaim%2Ftok_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders already-claimed state and shows booking link for the matching client', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user_1',
      role: 'CLIENT',
      clientProfile: { id: 'client_1' },
      sessionKind: 'ACTIVE',
      isFullyVerified: true,
    })

    mocks.inviteFindUnique.mockResolvedValueOnce(
      makeInvite({
        clientClaimStatus: ClientClaimStatus.CLAIMED,
      }),
    )

    const html = await renderPage()

    expect(html).toContain('This client history is already claimed')
    expect(html).toContain('/client/bookings/booking_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})