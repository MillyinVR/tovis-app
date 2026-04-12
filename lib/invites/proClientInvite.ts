// lib/invites/proClientInvite.ts
import {
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

const proClientInviteSelect = {
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
  acceptedByUserId: true,
  revokedAt: true,
  revokedByUserId: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProClientInviteSelect

type SelectedProClientInvite = Prisma.ProClientInviteGetPayload<{
  select: typeof proClientInviteSelect
}>

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
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

function validateInviteChannels(args: {
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}) {
  if (!args.invitedEmail && !args.invitedPhone) {
    throw new Error(
      'createProClientInvite: invitedEmail or invitedPhone is required.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.EMAIL &&
    !args.invitedEmail
  ) {
    throw new Error(
      'createProClientInvite: invitedEmail is required when preferredContactMethod is EMAIL.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.SMS &&
    !args.invitedPhone
  ) {
    throw new Error(
      'createProClientInvite: invitedPhone is required when preferredContactMethod is SMS.',
    )
  }
}

function isAcceptedInvite(invite: Pick<SelectedProClientInvite, 'status' | 'acceptedAt'>): boolean {
  return (
    invite.status === ProClientInviteStatus.ACCEPTED ||
    invite.acceptedAt != null
  )
}

function isRevokedInvite(invite: Pick<SelectedProClientInvite, 'status' | 'revokedAt'>): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  )
}

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

  validateInviteChannels({
    invitedEmail,
    invitedPhone,
    preferredContactMethod,
  })

  const existing = await db.proClientInvite.findUnique({
    where: { bookingId: args.bookingId },
    select: proClientInviteSelect,
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
        status: ProClientInviteStatus.PENDING,
      },
      select: proClientInviteSelect,
    })
  }

  if (isAcceptedInvite(existing) || isRevokedInvite(existing)) {
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
    select: proClientInviteSelect,
  })
}