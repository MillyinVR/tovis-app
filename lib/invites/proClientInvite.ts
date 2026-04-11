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
  const now = new Date()

  return db.proClientInvite.upsert({
    where: { bookingId: args.bookingId },
    update: {},
    create: {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      invitedName: args.invitedName,
      invitedEmail: args.invitedEmail ?? null,
      invitedPhone: args.invitedPhone ?? null,
      preferredContactMethod: args.preferredContactMethod ?? null,
      expiresAt: addHours(now, PRO_CLIENT_INVITE_EXPIRY_HOURS),
      status: ProClientInviteStatus.PENDING,
    },
  })
}