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

import {
  createProClientInvite,
  PRO_CLIENT_INVITE_EXPIRY_HOURS,
} from './proClientInvite'

function makeInvite(overrides?: {
  id?: string
  token?: string
  professionalId?: string
  bookingId?: string
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  expiresAt?: Date
  createdAt?: Date
  updatedAt?: Date
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: overrides?.token ?? 'token_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
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
    expiresAt:
      overrides?.expiresAt ?? new Date('2026-04-15T00:00:00.000Z'),
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-12T00:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-12T00:00:00.000Z'),
  }
}

describe('createProClientInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.prisma.proClientInvite.create.mockResolvedValue(makeInvite())
    mocks.prisma.proClientInvite.update.mockResolvedValue(makeInvite())
  })

  it('creates a new pending invite when none exists for the booking', async () => {
    const now = new Date('2026-04-12T12:00:00.000Z')
    vi.setSystemTime(now)

    const createdInvite = makeInvite({
      expiresAt: new Date(
        now.getTime() + PRO_CLIENT_INVITE_EXPIRY_HOURS * 60 * 60 * 1000,
      ),
    })

    mocks.prisma.proClientInvite.create.mockResolvedValueOnce(createdInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: '  Tori Morales  ',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.prisma.proClientInvite.findUnique).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      select: {
        id: true,
        token: true,
        professionalId: true,
        bookingId: true,
        invitedName: true,
        invitedEmail: true,
        invitedPhone: true,
        preferredContactMethod: true,
        status: true,
        acceptedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    expect(mocks.prisma.proClientInvite.create).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        bookingId: 'booking_1',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.EMAIL,
        expiresAt: new Date(
          now.getTime() + PRO_CLIENT_INVITE_EXPIRY_HOURS * 60 * 60 * 1000,
        ),
        status: ProClientInviteStatus.PENDING,
      },
    })

    expect(result).toEqual(createdInvite)

    vi.useRealTimers()
  })

  it('returns an accepted invite unchanged', async () => {
    const acceptedInvite = makeInvite({
      status: ProClientInviteStatus.ACCEPTED,
      acceptedAt: new Date('2026-04-12T13:00:00.000Z'),
      invitedName: 'Accepted Client',
      invitedEmail: 'accepted@example.com',
      preferredContactMethod: ContactMethod.EMAIL,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(acceptedInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
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
      bookingId: 'booking_1',
      invitedName: 'Changed Name',
      invitedEmail: 'changed@example.com',
    })

    expect(mocks.prisma.proClientInvite.update).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
    expect(result).toEqual(acceptedInvite)
  })

  it('updates a pending invite when its fields changed', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Old Name',
      invitedEmail: 'old@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
    })

    const updatedInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_2',
      bookingId: 'booking_1',
      invitedName: 'New Name',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_2',
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
        invitedName: 'New Name',
        invitedEmail: null,
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
      },
    })

    expect(result).toEqual(updatedInvite)
  })

  it('returns the existing pending invite unchanged when nothing changed', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
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

  it('normalizes blank optional strings to null before comparing/updating', async () => {
    const existingInvite = makeInvite({
      id: 'invite_existing_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
    })

    const updatedInvite = makeInvite({
      id: 'invite_existing_1',
      invitedName: 'Tori Morales',
      invitedEmail: null,
      invitedPhone: null,
      preferredContactMethod: null,
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
    })

    mocks.prisma.proClientInvite.findUnique.mockResolvedValueOnce(existingInvite)
    mocks.prisma.proClientInvite.update.mockResolvedValueOnce(updatedInvite)

    const result = await createProClientInvite({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: '   ',
      invitedPhone: '   ',
      preferredContactMethod: null,
    })

    expect(mocks.prisma.proClientInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite_existing_1' },
      data: {
        professionalId: 'pro_1',
        invitedName: 'Tori Morales',
        invitedEmail: null,
        invitedPhone: null,
        preferredContactMethod: null,
      },
    })

    expect(result).toEqual(updatedInvite)
  })

  it('throws when invitedName is blank after trimming', async () => {
    await expect(
      createProClientInvite({
        professionalId: 'pro_1',
        bookingId: 'booking_1',
        invitedName: '   ',
        invitedEmail: 'tori@example.com',
      }),
    ).rejects.toThrow('createProClientInvite: invitedName is required.')

    expect(mocks.prisma.proClientInvite.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.proClientInvite.create).not.toHaveBeenCalled()
  })
})