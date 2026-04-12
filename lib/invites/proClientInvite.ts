import {
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function normalizeRequiredString(value: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('createProClientInvite: invitedName is required.')
  }
  return normalized
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

export const PRO_CLIENT_INVITE_EXPIRY_HOURS = 72

export type CreateProClientInviteArgs = {
  professionalId: string
  bookingId: string
  invitedName: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  tx?: Prisma.TransactionClient
}

export async function createProClientInvite(args: CreateProClientInviteArgs) {
  const db = getDb(args.tx)

  const invitedName = normalizeRequiredString(args.invitedName)
  const invitedEmail = normalizeOptionalString(args.invitedEmail)
  const invitedPhone = normalizeOptionalString(args.invitedPhone)
  const preferredContactMethod = args.preferredContactMethod ?? null

  const existing = await db.proClientInvite.findUnique({
    where: { bookingId: args.bookingId },
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

  if (!existing) {
    return db.proClientInvite.create({
      data: {
        professionalId: args.professionalId,
        bookingId: args.bookingId,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod,
        expiresAt: addHours(new Date(), PRO_CLIENT_INVITE_EXPIRY_HOURS),
        status: ProClientInviteStatus.PENDING,
      },
    })
  }

  if (
    existing.status === ProClientInviteStatus.ACCEPTED ||
    existing.acceptedAt != null
  ) {
    return existing
  }

  const needsUpdate =
    existing.professionalId !== args.professionalId ||
    existing.invitedName !== invitedName ||
    existing.invitedEmail !== invitedEmail ||
    existing.invitedPhone !== invitedPhone ||
    existing.preferredContactMethod !== preferredContactMethod

  if (!needsUpdate) {
    return existing
  }

  return db.proClientInvite.update({
    where: { id: existing.id },
    data: {
      professionalId: args.professionalId,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    },
  })
}