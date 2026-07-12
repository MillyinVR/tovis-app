// app/claim/[token]/page.test.tsx
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),

  acceptClientClaimFromLink: vi.fn(),
  getClientClaimLinkPublicState: vi.fn(),
  normalizeProClientInviteToken: vi.fn(),

  formatAppointmentWhen: vi.fn(),
  getCurrentUser: vi.fn(),
  pickString: vi.fn(),
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

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  getClientClaimLinkPublicState: mocks.getClientClaimLinkPublicState,
}))

vi.mock('@/lib/clients/proClientInviteTokens', () => ({
  normalizeProClientInviteToken: mocks.normalizeProClientInviteToken,
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

vi.mock('@/lib/timeZone', () => ({
  sanitizeTimeZone: mocks.sanitizeTimeZone,
  friendlyTimeZoneLabel: (tz: string | null | undefined) => tz ?? null,
}))

import ClaimInvitePage from './page'

function makeRedirectError(href: string): Error {
  return new Error(`REDIRECT:${href}`)
}

function makeNotFoundError(): Error {
  return new Error('NOT_FOUND')
}

function makeBooking(clientId = 'client_1') {
  return {
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
  }
}

function makeClient(args?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  claimedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
}) {
  return {
    id: args?.id ?? 'client_1',
    userId: args?.userId ?? null,
    claimStatus: args?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    claimedAt: args?.claimedAt ?? null,
    preferredContactMethod: args?.preferredContactMethod ?? null,
  }
}

function makeInvite(overrides?: {
  token?: string | null
  tokenHash?: string | null
  clientId?: string
  invitedName?: string | null
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  acceptedByUserId?: string | null
  revokedAt?: Date | null
  revokedByUserId?: string | null
  revokeReason?: string | null
  clientClaimStatus?: ClientClaimStatus
  client?: ReturnType<typeof makeClient> | null
  booking?: ReturnType<typeof makeBooking> | null
}) {
  const token = overrides && 'token' in overrides ? overrides.token : null
  const tokenHash =
    overrides && 'tokenHash' in overrides ? overrides.tokenHash : 'hash_tok_1'
  const clientId = overrides?.clientId ?? 'client_1'

  return {
    id: 'invite_1',
    token,
    tokenHash,
    professionalId: 'pro_1',
    clientId,
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
    preferredContactMethod:
      overrides && 'preferredContactMethod' in overrides
        ? overrides.preferredContactMethod
        : null,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides && 'acceptedAt' in overrides ? overrides.acceptedAt : null,
    acceptedByUserId:
      overrides && 'acceptedByUserId' in overrides
        ? overrides.acceptedByUserId
        : null,
    revokedAt:
      overrides && 'revokedAt' in overrides ? overrides.revokedAt : null,
    revokedByUserId:
      overrides && 'revokedByUserId' in overrides
        ? overrides.revokedByUserId
        : null,
    revokeReason:
      overrides && 'revokeReason' in overrides
        ? overrides.revokeReason
        : null,
    createdAt: new Date('2026-04-12T10:00:00.000Z'),
    updatedAt: new Date('2026-04-12T10:00:00.000Z'),
    client:
      overrides && 'client' in overrides
        ? overrides.client
        : makeClient({
            id: clientId,
            claimStatus:
              overrides?.clientClaimStatus ?? ClientClaimStatus.UNCLAIMED,
          }),
    booking:
      overrides && 'booking' in overrides
        ? overrides.booking
        : makeBooking(clientId),
  }
}

function makeClientUser(args?: {
  id?: string
  clientId?: string
  sessionKind?: 'ACTIVE' | 'LIMITED'
  isFullyVerified?: boolean
}) {
  return {
    id: args?.id ?? 'user_1',
    role: 'CLIENT',
    clientProfile: {
      id: args?.clientId ?? 'client_1',
    },
    sessionKind: args?.sessionKind ?? 'ACTIVE',
    isFullyVerified: args?.isFullyVerified ?? true,
  }
}

function makeProUser() {
  return {
    id: 'user_pro_1',
    role: 'PRO',
    professionalProfile: {
      id: 'pro_1',
    },
    sessionKind: 'ACTIVE',
    isFullyVerified: true,
  }
}

function mockInviteState(
  kind: 'ready' | 'revoked' | 'already_claimed',
  invite = makeInvite(),
) {
  mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
    kind,
    link: invite,
  })
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

    mocks.getClientClaimLinkPublicState.mockResolvedValue({
      kind: 'ready',
      link: makeInvite(),
    })

    mocks.normalizeProClientInviteToken.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.formatAppointmentWhen.mockReturnValue('Apr 13, 2026 at 11:00 AM')

    mocks.getCurrentUser.mockResolvedValue(null)

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.sanitizeTimeZone.mockImplementation(
      (value: string | null | undefined, fallback: string) => value ?? fallback,
    )
  })

  it('calls notFound when route token is blank', async () => {
    await expect(renderPage({ token: '   ' })).rejects.toThrow('NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
  })

  it('calls notFound when the invite does not exist', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'not_found',
    })

    await expect(renderPage()).rejects.toThrow('NOT_FOUND')

    expect(mocks.getClientClaimLinkPublicState).toHaveBeenCalledWith({
      token: 'tok_1',
    })
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('calls notFound when invite is missing client relation', async () => {
    mockInviteState(
      'ready',
      makeInvite({
        client: null,
      }),
    )

    await expect(renderPage()).rejects.toThrow('NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('renders a booking-less claim (no 404) when the invite has no booking', async () => {
    mockInviteState(
      'ready',
      makeInvite({
        booking: null,
      }),
    )

    const html = await renderPage()

    expect(mocks.notFound).not.toHaveBeenCalled()
    // Booking-less frame: "Your history" pill + generic claim header instead of
    // the booking overview.
    expect(html).toContain('Your history')
    expect(html).toContain('Claim your client history')
    expect(html).toContain('This profile was created for')
  })

  it('renders the booking overview for an unauthenticated ready invite without redirecting', async () => {
    const html = await renderPage()

    // Leads with the booking frame; claim is the secondary action.
    expect(html).toContain('Your booking')
    expect(html).toContain('Silk Press with TOVIS Studio')
    expect(html).toContain('Apr 13, 2026 at 11:00 AM')
    expect(html).toContain('Claim your client history')
    expect(html).toContain('no account needed to view them')
    expect(mocks.redirect).not.toHaveBeenCalled()

    // Account creation is offered as an optional next step, carrying the
    // claim context + prefill data into signup.
    const signupHref = /href="(\/signup\?[^"]+)"/.exec(html)?.[1] ?? ''
    expect(signupHref).not.toBe('')

    const decodedHref = signupHref.replace(/&amp;/g, '&')
    const params = new URLSearchParams(decodedHref.split('?')[1] ?? '')

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
    mockInviteState(
      'revoked',
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
    mocks.getCurrentUser.mockResolvedValueOnce(
      makeClientUser({
        clientId: 'client_1',
        sessionKind: 'LIMITED',
        isFullyVerified: false,
      }),
    )

    const html = await renderPage()

    expect(html).toContain(
      'Verify your account first, then come right back here to finish the claim.',
    )
    expect(html).toContain('/verify-phone?next=%2Fclaim%2Ftok_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders mismatch state for a different signed-in client account', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(
      makeClientUser({
        id: 'user_2',
        clientId: 'client_other',
      }),
    )

    const html = await renderPage()

    expect(html).toContain('You are signed into a different client account')
    expect(html).toContain('/login?from=%2Fclaim%2Ftok_1')
    expect(html).toContain('/signup?from=%2Fclaim%2Ftok_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders already-claimed state and shows booking link for the matching client', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(
      makeClientUser({
        clientId: 'client_1',
      }),
    )

    mockInviteState(
      'already_claimed',
      makeInvite({
        clientClaimStatus: ClientClaimStatus.CLAIMED,
      }),
    )

    const html = await renderPage()

    expect(html).toContain('This client history is already claimed')
    expect(html).toContain('/client/bookings/booking_1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders ready claim action for a matching verified client', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(
      makeClientUser({
        clientId: 'client_1',
      }),
    )

    const html = await renderPage()

    expect(html).toContain('Ready to claim')
    expect(html).toContain('Claim this history')
    expect(html).toContain(
      'This will attach this history to your client identity.',
    )
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders conflict state from query params', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(
      makeClientUser({
        clientId: 'client_1',
      }),
    )

    const html = await renderPage({
      searchParams: {
        state: 'conflict',
      },
    })

    expect(html).toContain('We could not finish the claim')
    expect(html).toContain(
      'Nothing was deleted. Please try again. If this keeps happening, support should inspect the client identity and invite audit state.',
    )
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders client-account requirement for a signed-in non-client user', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeProUser())

    const html = await renderPage()

    expect(html).toContain('This link must be claimed from a client account.')
    expect(html).toContain('Continue as client')
    expect(html).toContain('Create a client account')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})