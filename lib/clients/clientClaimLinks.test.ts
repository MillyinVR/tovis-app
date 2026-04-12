import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    proClientInvite: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import {
  getClientClaimLinkByToken,
  getClientClaimLinkPublicState,
  markClientClaimLinkAcceptedAudit,
  upsertClientClaimLink,
} from './clientClaimLinks'

function makeLink(overrides?: {
  id?: string
  token?: string
  professionalId?: string
  clientId?: string
  bookingId?: string
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  acceptedByUserId?: string | null
  revokedAt?: Date | null
  revokedByUserId?: string | null
  revokeReason?: string | null
  createdAt?: Date
  updatedAt?: Date
  client?: {
    id?: string
    userId?: string | null
    claimStatus?: ClientClaimStatus
    claimedAt?: Date | null
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: overrides?.token ?? 'token_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    invitedName: overrides?.invitedName ?? 'Tori Morales',
    invitedEmail:
      overrides?.invitedEmail !== undefined
        ? overrides.invitedEmail
        : 'tori@example.com',
    invitedPhone:
      overrides?.invitedPhone !== undefined ? overrides.invitedPhone : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    acceptedByUserId:
      overrides?.acceptedByUserId !== undefined
        ? overrides.acceptedByUserId
        : null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    revokedByUserId:
      overrides?.revokedByUserId !== undefined
        ? overrides.revokedByUserId
        : null,
    revokeReason:
      overrides?.revokeReason !== undefined ? overrides.revokeReason : null,
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-12T10:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-12T10:00:00.000Z'),
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: null,
          },
  }
}

describe('upsertClientClaimLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue(makeLink())
    mocks.prisma.proClientInvite.update.mockResolvedValue(makeLink())
  })

  it('creates a new pending link when none exists for the booking', async () => {
    const createdLink = makeLink({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
    })

    mocks.prisma.proClientInvite.create.mockResolvedValueOnce(createdLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: '  Tori Morales  ',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.prisma.proClientInvite.findUnique).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      select: expect.any(Object),
    })

    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.EMAIL,
        status: ProClientInviteStatus.PENDING,
      },
      select: expect.any(Object),
    })

    expect(result).toEqual(createdLink)
  })

  it('returns a revoked existing link unchanged', async () => {
    const revokedLink = makeLink({
      status: ProClientInviteStatus.REVOKED,
      revokedAt: new Date('2026-04-12T11:00:00.000Z'),
      revokedByUserId: 'admin_1',
      revokeReason: 'Admin revoked link',
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(revokedLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_2',
      clientId: 'client_2',
      bookingId: 'booking_1',
      invitedName: 'Changed Name',
      invitedEmail: 'changed@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })

    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(result).toEqual(revokedLink)
  })

  it('returns the existing pending link unchanged when nothing changed', async () => {
    const existingLink = makeLink({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: '  Tori Morales  ',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(result).toEqual(existingLink)
  })

  it('updates a pending link when fields changed', async () => {
    const existingLink = makeLink({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Old Name',
      invitedEmail: 'old@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })

    const updatedLink = makeLink({
      id: 'invite_existing_1',
      professionalId: 'pro_2',
      clientId: 'client_2',
      bookingId: 'booking_1',
      invitedName: 'New Name',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingLink)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_2',
      clientId: 'client_2',
      bookingId: 'booking_1',
      invitedName: '  New Name  ',
      invitedEmail: null,
      invitedPhone: '  +16195551234  ',
      preferredContactMethod: ContactMethod.SMS,
    })

    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite_existing_1' },
      data: {
        professionalId: 'pro_2',
        clientId: 'client_2',
        invitedName: 'New Name',
        invitedEmail: null,
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
      },
      select: expect.any(Object),
    })

    expect(result).toEqual(updatedLink)
  })

  it('normalizes blank optional email to null when a phone channel still exists', async () => {
    const existingLink = makeLink({
      id: 'invite_existing_1',
      invitedEmail: 'tori@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })

    const updatedLink = makeLink({
      id: 'invite_existing_1',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingLink)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: '   ',
      invitedPhone: '  +16195551234  ',
      preferredContactMethod: ContactMethod.SMS,
    })

    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite_existing_1' },
      data: {
        professionalId: 'pro_1',
        clientId: 'client_1',
        invitedName: 'Tori Morales',
        invitedEmail: null,
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
      },
      select: expect.any(Object),
    })

    expect(result).toEqual(updatedLink)
  })

  it('updates a pending link when only clientId changed', async () => {
    const existingLink = makeLink({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_old',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
    })

    const updatedLink = makeLink({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_new',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingLink)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedLink)

    const result = await upsertClientClaimLink({
      professionalId: 'pro_1',
      clientId: 'client_new',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite_existing_1' },
      data: {
        professionalId: 'pro_1',
        clientId: 'client_new',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.EMAIL,
      },
      select: expect.any(Object),
    })

    expect(result).toEqual(updatedLink)
  })

  it('throws when professionalId is blank after trimming', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: '   ',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('clientClaimLinks: professionalId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
  })

  it('throws when clientId is blank after trimming', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: '   ',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('clientClaimLinks: clientId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
  })

  it('throws when bookingId is blank after trimming', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: '   ',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('clientClaimLinks: bookingId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
  })

  it('throws when invitedName is blank after trimming', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: '   ',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('clientClaimLinks: invitedName is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
  })

  it('throws when both invitedEmail and invitedPhone are missing', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: '   ',
        invitedPhone: '   ',
      }),
    ).rejects.toThrow(
      'clientClaimLinks: invitedEmail or invitedPhone is required.',
    )
  })

  it('throws when preferredContactMethod is EMAIL without invitedEmail', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: null,
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.EMAIL,
      }),
    ).rejects.toThrow(
      'clientClaimLinks: invitedEmail is required when preferredContactMethod is EMAIL.',
    )
  })

  it('throws when preferredContactMethod is SMS without invitedPhone', async () => {
    await expect(
      upsertClientClaimLink({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.SMS,
      }),
    ).rejects.toThrow(
      'clientClaimLinks: invitedPhone is required when preferredContactMethod is SMS.',
    )
  })
})

describe('getClientClaimLinkByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(makeLink())
  })

  it('loads a link by token', async () => {
    const result = await getClientClaimLinkByToken({
      token: 'token_1',
    })

    expect(mocks.prisma.proClientInvite.findUnique).toHaveBeenCalledWith({
      where: { token: 'token_1' },
      select: expect.any(Object),
    })

    expect(result).toEqual(makeLink())
  })

  it('throws when token is blank after trimming', async () => {
    await expect(
      getClientClaimLinkByToken({
        token: '   ',
      }),
    ).rejects.toThrow('clientClaimLinks: token is required.')
  })
})

describe('getClientClaimLinkPublicState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_found when link does not exist', async () => {
    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(null)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns not_found when link exists but linked client identity is missing', async () => {
    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(
      makeLink({ client: null }),
    )

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns revoked when link status is REVOKED', async () => {
    const link = makeLink({
      status: ProClientInviteStatus.REVOKED,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(link)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({
      kind: 'revoked',
      link,
    })
  })

  it('returns revoked when revokedAt is already set even if status is still PENDING', async () => {
    const link = makeLink({
      status: ProClientInviteStatus.PENDING,
      revokedAt: new Date('2026-04-12T11:00:00.000Z'),
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(link)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({
      kind: 'revoked',
      link,
    })
  })

  it('returns already_claimed when linked client claimStatus is CLAIMED', async () => {
    const link = makeLink({
      client: {
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: new Date('2026-04-12T09:00:00.000Z'),
        preferredContactMethod: null,
      },
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(link)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({
      kind: 'already_claimed',
      link,
    })
  })

  it('returns already_claimed when linked client already has a userId', async () => {
    const link = makeLink({
      client: {
        id: 'client_1',
        userId: 'user_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        preferredContactMethod: null,
      },
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(link)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({
      kind: 'already_claimed',
      link,
    })
  })

  it('returns ready when link is claimable', async () => {
    const link = makeLink({
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
      client: {
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        preferredContactMethod: null,
      },
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(link)

    const result = await getClientClaimLinkPublicState({
      token: 'token_1',
    })

    expect(result).toEqual({
      kind: 'ready',
      link,
    })
  })
})

describe('markClientClaimLinkAcceptedAudit', () => {
  const tx = {
    proClientInvite: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    tx.proClientInvite.updateMany.mockResolvedValue({ count: 1 })
    tx.proClientInvite.findUnique.mockResolvedValue(null)
  })

  it('writes acceptance audit successfully', async () => {
    const acceptedAt = new Date('2026-04-12T12:00:00.000Z')

    const result = await markClientClaimLinkAcceptedAudit({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt,
      tx,
    })

    expect(tx.proClientInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite_1',
        revokedAt: null,
      },
      data: {
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt,
        acceptedByUserId: 'user_1',
      },
    })

    expect(result).toBe('ok')
  })

  it('returns revoked when audit update loses a race to revocation', async () => {
    tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      status: ProClientInviteStatus.REVOKED,
      revokedAt: new Date('2026-04-12T12:00:00.000Z'),
    })

    const result = await markClientClaimLinkAcceptedAudit({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
      tx,
    })

    expect(result).toBe('revoked')
  })

  it('returns not_found when audit update loses a race to deletion', async () => {
    tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    tx.proClientInvite.findUnique.mockResolvedValueOnce(null)

    const result = await markClientClaimLinkAcceptedAudit({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
      tx,
    })

    expect(result).toBe('not_found')
  })

  it('returns conflict when audit update does not succeed and link is still not revoked', async () => {
    tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      status: ProClientInviteStatus.PENDING,
      revokedAt: null,
    })

    const result = await markClientClaimLinkAcceptedAudit({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
      tx,
    })

    expect(result).toBe('conflict')
  })

  it('throws when inviteId is blank after trimming', async () => {
    await expect(
      markClientClaimLinkAcceptedAudit({
        inviteId: '   ',
        actingUserId: 'user_1',
        acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
        tx,
      }),
    ).rejects.toThrow('clientClaimLinks: inviteId is required.')
  })

  it('throws when actingUserId is blank after trimming', async () => {
    await expect(
      markClientClaimLinkAcceptedAudit({
        inviteId: 'invite_1',
        actingUserId: '   ',
        acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
        tx,
      }),
    ).rejects.toThrow('clientClaimLinks: actingUserId is required.')
  })
})