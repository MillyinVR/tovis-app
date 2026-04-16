import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, VerificationStatus } from '@prisma/client'

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/app/_components/ProSessionFooter/ProSessionFooter', () => ({
  default: () => <div data-testid="pro-session-footer">ProSessionFooter</div>,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: vi.fn(() => true),
}))

import VanityProfilePage from './page'

function makePro(args?: {
  id?: string
  verificationStatus?: VerificationStatus
}) {
  return {
    id: args?.id ?? 'pro_1',
    userId: 'user_pro_1',
    verificationStatus: args?.verificationStatus ?? VerificationStatus.APPROVED,
    businessName: 'TOVIS Studio',
    bio: 'Trusted beauty pro.',
    avatarUrl: null,
    professionType: 'BARBER',
    location: 'San Diego, CA',
    timeZone: 'America/Los_Angeles',
    isPremium: true,
  }
}

function makeOwnerViewer(args?: { professionalProfileId?: string }) {
  return {
    id: 'viewer_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: Role.PRO,
    sessionKind: 'ACTIVE' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: {
      id: args?.professionalProfileId ?? 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: null,
      timeZone: 'America/Los_Angeles',
      location: 'San Diego, CA',
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      verificationStatus: VerificationStatus.PENDING,
    },
  }
}

async function renderPage(args?: { handle?: string }) {
  const ui = await VanityProfilePage({
    params: Promise.resolve({ handle: args?.handle ?? 'TOVISStudio' }),
  })

  return render(ui)
}

describe('app/p/[handle]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetCurrentUser.mockResolvedValue(null)

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )
  })

  it('allows non-owners to view an approved vanity profile', async () => {
    await renderPage()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    expect(screen.getByText('Trusted beauty pro.')).toBeInTheDocument()
    expect(screen.getByText('Time zone:')).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /open full profile/i }),
    ).toHaveAttribute('href', '/professionals/pro_1')

    expect(screen.getByTestId('pro-session-footer')).toBeInTheDocument()

    expect(mocks.prisma.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { handleNormalized: 'tovisstudio' },
      select: {
        id: true,
        userId: true,
        verificationStatus: true,
        businessName: true,
        bio: true,
        avatarUrl: true,
        professionType: true,
        location: true,
        timeZone: true,
        isPremium: true,
      },
    })
  })

  it('shows the pending verification surface to non-owners when the pro is not approved', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.PENDING }),
    )

    await renderPage()

    expect(
      screen.getByText('This profile is pending verification'),
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        'We’re verifying the professional’s license and details. Check back soon.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.queryByTestId('pro-session-footer'),
    ).not.toBeInTheDocument()
  })

  it('allows the owner to preview their own pending vanity profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ id: 'pro_1', verificationStatus: VerificationStatus.PENDING }),
    )

    await renderPage()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /open full profile/i }),
    ).toHaveAttribute('href', '/professionals/pro_1')

    expect(screen.getByTestId('pro-session-footer')).toBeInTheDocument()
  })

  it('calls notFound when the vanity handle does not resolve to a professional profile', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})