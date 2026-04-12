import {
  ClientClaimStatus,
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

type ClientClaimLinkAuditTx = {
  proClientInvite: Pick<
    Prisma.TransactionClient['proClientInvite'],
    'updateMany' | 'findUnique'
  >
}

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`clientClaimLinks: ${fieldName} is required.`)
  }
  return normalized
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function validateClaimChannels(args: {
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}) {
  if (!args.invitedEmail && !args.invitedPhone) {
    throw new Error(
      'clientClaimLinks: invitedEmail or invitedPhone is required.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.EMAIL &&
    !args.invitedEmail
  ) {
    throw new Error(
      'clientClaimLinks: invitedEmail is required when preferredContactMethod is EMAIL.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.SMS &&
    !args.invitedPhone
  ) {
    throw new Error(
      'clientClaimLinks: invitedPhone is required when preferredContactMethod is SMS.',
    )
  }
}

function isLinkRevoked(
  invite: Pick<ClientClaimLinkRow, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED || invite.revokedAt != null
  )
}

function isClientAlreadyClaimed(
  invite: Pick<ClientClaimLinkRow, 'client'>,
): boolean {
  return (
    invite.client?.claimStatus === ClientClaimStatus.CLAIMED ||
    invite.client?.userId != null
  )
}

const clientClaimLinkSelect = Prisma.validator<Prisma.ProClientInviteSelect>()({
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
  client: {
    select: {
      id: true,
      userId: true,
      claimStatus: true,
      claimedAt: true,
      preferredContactMethod: true,
    },
  },
} satisfies Prisma.ProClientInviteSelect)

export type ClientClaimLinkRow = Prisma.ProClientInviteGetPayload<{
  select: typeof clientClaimLinkSelect
}>

export type UpsertClientClaimLinkArgs = {
  professionalId: string
  clientId: string
  bookingId: string
  invitedName: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  tx?: Prisma.TransactionClient
}

export type GetClientClaimLinkByTokenArgs = {
  token: string
  tx?: Prisma.TransactionClient
}

export type ClientClaimLinkPublicState =
  | { kind: 'not_found' }
  | { kind: 'revoked'; link: ClientClaimLinkRow }
  | { kind: 'already_claimed'; link: ClientClaimLinkRow }
  | { kind: 'ready'; link: ClientClaimLinkRow }

export type MarkClientClaimLinkAcceptedAuditArgs = {
  inviteId: string
  actingUserId: string
  acceptedAt: Date
  tx: ClientClaimLinkAuditTx
}

export async function upsertClientClaimLink(
  args: UpsertClientClaimLinkArgs,
): Promise<ClientClaimLinkRow> {
  const db = getDb(args.tx)

  const professionalId = normalizeRequiredString(
    args.professionalId,
    'professionalId',
  )
  const clientId = normalizeRequiredString(args.clientId, 'clientId')
  const bookingId = normalizeRequiredString(args.bookingId, 'bookingId')
  const invitedName = normalizeRequiredString(args.invitedName, 'invitedName')
  const invitedEmail = normalizeOptionalString(args.invitedEmail)
  const invitedPhone = normalizeOptionalString(args.invitedPhone)
  const preferredContactMethod = args.preferredContactMethod ?? null

  validateClaimChannels({
    invitedEmail,
    invitedPhone,
    preferredContactMethod,
  })

  const existing = await db.proClientInvite.findUnique({
    where: { bookingId },
    select: clientClaimLinkSelect,
  })

  if (!existing) {
    return db.proClientInvite.create({
      data: {
        professionalId,
        clientId,
        bookingId,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod,
        status: ProClientInviteStatus.PENDING,
      },
      select: clientClaimLinkSelect,
    })
  }

  if (isLinkRevoked(existing)) {
    return existing
  }

  const needsUpdate =
    existing.professionalId !== professionalId ||
    existing.clientId !== clientId ||
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
      professionalId,
      clientId,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    },
    select: clientClaimLinkSelect,
  })
}

export async function getClientClaimLinkByToken(
  args: GetClientClaimLinkByTokenArgs,
): Promise<ClientClaimLinkRow | null> {
  const db = getDb(args.tx)
  const token = normalizeRequiredString(args.token, 'token')

  return db.proClientInvite.findUnique({
    where: { token },
    select: clientClaimLinkSelect,
  })
}

export async function getClientClaimLinkPublicState(
  args: GetClientClaimLinkByTokenArgs,
): Promise<ClientClaimLinkPublicState> {
  const link = await getClientClaimLinkByToken(args)

  if (!link || !link.client) {
    return { kind: 'not_found' }
  }

  if (isLinkRevoked(link)) {
    return { kind: 'revoked', link }
  }

  if (isClientAlreadyClaimed(link)) {
    return { kind: 'already_claimed', link }
  }

  return { kind: 'ready', link }
}

export async function markClientClaimLinkAcceptedAudit(
  args: MarkClientClaimLinkAcceptedAuditArgs,
): Promise<'ok' | 'revoked' | 'not_found' | 'conflict'> {
  const inviteId = normalizeRequiredString(args.inviteId, 'inviteId')
  const actingUserId = normalizeRequiredString(args.actingUserId, 'actingUserId')

  const updateResult = await args.tx.proClientInvite.updateMany({
    where: {
      id: inviteId,
      revokedAt: null,
    },
    data: {
      status: ProClientInviteStatus.ACCEPTED,
      acceptedAt: args.acceptedAt,
      acceptedByUserId: actingUserId,
    },
  })

  if (updateResult.count === 1) {
    return 'ok'
  }

  const currentInvite = await args.tx.proClientInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      status: true,
      revokedAt: true,
    },
  })

  if (!currentInvite) {
    return 'not_found'
  }

  if (
    currentInvite.status === ProClientInviteStatus.REVOKED ||
    currentInvite.revokedAt != null
  ) {
    return 'revoked'
  }

  return 'conflict'
}