import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    proClientInvite: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { createProClientInvite } from './proClientInvite'

function makeInvite(overrides?: {
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
      overrides?.invitedPhone !== undefined
        ? overrides.invitedPhone
        : null,
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
      overrides?.createdAt ?? new Date('2026-04-12T00:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-12T00:00:00.000Z'),
  }
}

const expectedSelect = {
  id: true,
  token: true,
  professionalId: true,
  clientId: true,
  bookingId: true,
  invitedName: true,
  invitedEmail: true,
  invitedPhone: true,
  preferredContactMethod: true,
  status: true,
  acceptedAt: true,
  acceptedByUserId: true,
  revokedAt: true,
  revokedByUserId: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
}

describe('createProClientInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue(makeInvite())
    mocks.prisma.proClientInvite.update.mockResolvedValue(makeInvite())
  })

  it('creates a new pending invite when none exists for the booking', async () => {
    const createdInvite = makeInvite({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
    })

    mocks.prisma.proClientInvite.create.mockResolvedValueOnce(createdInvite)

    const result = await createProClientInvite({
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
      select: expectedSelect,
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
      select: expectedSelect,
    })

    expect(result).toEqual(createdInvite)
  })

  it('returns an accepted invite unchanged', async () => {
    const acceptedInvite = makeInvite({
      status: ProClientInviteStatus.ACCEPTED,
      acceptedAt: new Date('2026-04-12T13:00:00.000Z'),
      acceptedByUserId: 'user_1',
      invitedName: 'Accepted Client',
      invitedEmail: 'accepted@example.com',
      preferredContactMethod: ContactMethod.EMAIL,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(acceptedInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Changed Name',
      invitedEmail: 'changed@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })

    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(result).toEqual(acceptedInvite)
  })

  it('returns an accepted-at invite unchanged even if status was not flipped correctly', async () => {
    const acceptedInvite = makeInvite({
      status: ProClientInviteStatus.PENDING,
      acceptedAt: new Date('2026-04-12T13:00:00.000Z'),
      invitedName: 'Accepted Client',
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(acceptedInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Changed Name',
      invitedEmail: 'changed@example.com',
      invitedPhone: '+16195551234',
    })

    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(result).toEqual(acceptedInvite)
  })

  it('returns a revoked invite unchanged', async () => {
    const revokedInvite = makeInvite({
      status: ProClientInviteStatus.REVOKED,
      revokedAt: new Date('2026-04-12T14:00:00.000Z'),
      revokedByUserId: 'admin_1',
      revokeReason: 'Admin revoked link',
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(revokedInvite)

    const result = await createProClientInvite({
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
    expect(result).toEqual(revokedInvite)
  })

  it('updates a pending invite when its fields changed', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Old Name',
      invitedEmail: 'old@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    const updatedInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_2',
      clientId: 'client_2',
      bookingId: 'booking_1',
      invitedName: 'New Name',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedInvite)

    const result = await createProClientInvite({
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
      select: expectedSelect,
    })

    expect(result).toEqual(updatedInvite)
  })

  it('returns the existing pending invite unchanged when nothing changed', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)

    const result = await createProClientInvite({
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
    expect(result).toEqual(existingInvite)
  })

  it('normalizes blank optional email to null when a phone channel still exists', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    const updatedInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      invitedName: 'Tori Morales',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedInvite)

    const result = await createProClientInvite({
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
      select: expectedSelect,
    })

    expect(result).toEqual(updatedInvite)
  })

  it('updates a pending invite when only clientId changed', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_old',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    const updatedInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      clientId: 'client_new',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedInvite)

    const result = await createProClientInvite({
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
      select: expectedSelect,
    })

    expect(result).toEqual(updatedInvite)
  })

  it('throws when professionalId is blank after trimming', async () => {
    await expect(
      createProClientInvite({
        professionalId: '   ',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('createProClientInvite: professionalId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('throws when clientId is blank after trimming', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: '   ',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('createProClientInvite: clientId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('throws when bookingId is blank after trimming', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: '   ',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('createProClientInvite: bookingId is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('throws when invitedName is blank after trimming', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: '   ',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('createProClientInvite: invitedName is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('throws when both invitedEmail and invitedPhone are missing', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: '   ',
        invitedPhone: '   ',
      }),
    ).rejects.toThrow(
      'createProClientInvite: invitedEmail or invitedPhone is required.',
    )

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })

  it('throws when preferredContactMethod is EMAIL without invitedEmail', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: null,
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.EMAIL,
      }),
    ).rejects.toThrow(
      'createProClientInvite: invitedEmail is required when preferredContactMethod is EMAIL.',
    )
  })

  it('throws when preferredContactMethod is SMS without invitedPhone', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.SMS,
      }),
    ).rejects.toThrow(
      'createProClientInvite: invitedPhone is required when preferredContactMethod is SMS.',
    )
  })
})