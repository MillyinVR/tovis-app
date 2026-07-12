// lib/clients/issueClaimLinkForBooking.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    booking: {
      findUnique: vi.fn(),
    },
    clientProfile: {
      findUnique: vi.fn(),
    },
    proClientInvite: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  createProClientInviteToken: vi.fn(),
  hashProClientInviteToken: vi.fn(),
  normalizeProClientInviteToken: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/clients/proClientInviteTokens', () => ({
  createProClientInviteToken: mocks.createProClientInviteToken,
  hashProClientInviteToken: mocks.hashProClientInviteToken,
  normalizeProClientInviteToken: mocks.normalizeProClientInviteToken,
}))

import {
  issueClaimLinkForBooking,
  issueClaimLinkForClient,
} from './clientClaimLinks'

function makeBooking(overrides?: {
  clientOverrides?: Record<string, unknown>
  professionalId?: string
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    client: {
      id: 'client_1',
      userId: null,
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      ...(overrides?.clientOverrides ?? {}),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createProClientInviteToken.mockReturnValue('raw-token-123')
  mocks.hashProClientInviteToken.mockReturnValue('hash-token-123')
})

describe('issueClaimLinkForBooking', () => {
  it('returns not_found when the booking or client is missing', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(null)

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result).toEqual({ kind: 'not_found' })
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('returns already_claimed when the client already has a user', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(
      makeBooking({ clientOverrides: { userId: 'user_9' } }),
    )

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result).toEqual({ kind: 'already_claimed' })
  })

  it('returns already_claimed when claimStatus is CLAIMED', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(
      makeBooking({
        clientOverrides: { claimStatus: ClientClaimStatus.CLAIMED },
      }),
    )

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result).toEqual({ kind: 'already_claimed' })
  })

  it('returns revoked when an existing invite is revoked', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(makeBooking())
    mocks.prisma.proClientInvite.findUnique.mockResolvedValue({
      id: 'invite_1',
      status: ProClientInviteStatus.REVOKED,
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
  })

  it('creates a fresh invite when none exists and returns the raw token', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(makeBooking())
    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue({ id: 'invite_new' })

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result.kind).toBe('ok')
    expect(result).toMatchObject({ rawToken: 'raw-token-123' })
    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: 'pro_1',
          clientId: 'client_1',
          bookingId: 'booking_1',
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
          status: ProClientInviteStatus.PENDING,
          token: null,
          tokenHash: 'hash-token-123',
        }),
      }),
    )
  })

  it('rotates the token hash on an existing, non-revoked invite', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(makeBooking())
    mocks.prisma.proClientInvite.findUnique.mockResolvedValue({
      id: 'invite_existing',
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })
    mocks.prisma.proClientInvite.update.mockResolvedValue({
      id: 'invite_existing',
    })

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result.kind).toBe('ok')
    expect(result).toMatchObject({ rawToken: 'raw-token-123' })
    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invite_existing' },
        data: expect.objectContaining({
          status: ProClientInviteStatus.PENDING,
          token: null,
          tokenHash: 'hash-token-123',
        }),
      }),
    )
  })

  it('falls back to "Client" and SMS preference for a phone-only client', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(
      makeBooking({
        clientOverrides: {
          firstName: null,
          lastName: null,
          email: null,
          phone: '+15555550100',
        },
      }),
    )
    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue({ id: 'invite_new' })

    const result = await issueClaimLinkForBooking({ bookingId: 'booking_1' })

    expect(result.kind).toBe('ok')
    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invitedName: 'Client',
          invitedEmail: null,
          invitedPhone: '+15555550100',
          preferredContactMethod: ContactMethod.SMS,
        }),
      }),
    )
  })
})

function makeClient(overrides?: Record<string, unknown>) {
  return {
    id: 'client_1',
    userId: null,
    firstName: 'Tori',
    lastName: 'Morales',
    email: 'tori@example.com',
    phone: null,
    claimStatus: ClientClaimStatus.UNCLAIMED,
    ...(overrides ?? {}),
  }
}

describe('issueClaimLinkForClient', () => {
  it('returns not_found when the client is missing', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(null)

    const result = await issueClaimLinkForClient({ clientId: 'client_1' })

    expect(result).toEqual({ kind: 'not_found' })
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('returns already_claimed when the client already has a user', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(
      makeClient({ userId: 'user_9' }),
    )

    const result = await issueClaimLinkForClient({ clientId: 'client_1' })

    expect(result).toEqual({ kind: 'already_claimed' })
  })

  it('creates a fresh PRO-LESS booking-less invite (bookingId null) when none exists', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(makeClient())
    mocks.prisma.proClientInvite.findFirst.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue({ id: 'invite_new' })

    const result = await issueClaimLinkForClient({ clientId: 'client_1' })

    expect(result.kind).toBe('ok')
    expect(result).toMatchObject({ rawToken: 'raw-token-123' })
    expect(mocks.prisma.proClientInvite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client_1', bookingId: null },
      }),
    )
    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: null,
          clientId: 'client_1',
          bookingId: null,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          preferredContactMethod: ContactMethod.EMAIL,
          status: ProClientInviteStatus.PENDING,
          tokenHash: 'hash-token-123',
        }),
      }),
    )
  })

  it('attributes a provided professionalId (pro-facing invite)', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(makeClient())
    mocks.prisma.proClientInvite.findFirst.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue({ id: 'invite_new' })

    await issueClaimLinkForClient({ clientId: 'client_1', professionalId: 'pro_7' })

    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ professionalId: 'pro_7', bookingId: null }),
      }),
    )
  })

  it('rotates an existing booking-less invite and keeps its pro when passed null', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(makeClient())
    mocks.prisma.proClientInvite.findFirst.mockResolvedValue({
      id: 'invite_existing',
      professionalId: 'pro_earlier',
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })
    mocks.prisma.proClientInvite.update.mockResolvedValue({ id: 'invite_existing' })

    const result = await issueClaimLinkForClient({ clientId: 'client_1' })

    expect(result.kind).toBe('ok')
    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invite_existing' },
        data: expect.objectContaining({
          professionalId: 'pro_earlier',
          tokenHash: 'hash-token-123',
        }),
      }),
    )
  })

  it('returns revoked when the existing booking-less invite is revoked', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(makeClient())
    mocks.prisma.proClientInvite.findFirst.mockResolvedValue({
      id: 'invite_existing',
      professionalId: null,
      status: ProClientInviteStatus.REVOKED,
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = await issueClaimLinkForClient({ clientId: 'client_1' })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
  })
})
