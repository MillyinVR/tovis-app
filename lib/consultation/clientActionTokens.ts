// lib/consultation/clientActionTokens.ts

import crypto from 'crypto'
import {
  ClientActionTokenKind,
  ContactMethod,
  Prisma,
} from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { prisma } from '@/lib/prisma'

export const CONSULTATION_ACTION_TOKEN_EXPIRY_MS =
  1000 * 60 * 60 * 24 * 3 // 72 hours

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function normalizeTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullableJsonCreateInput(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

function assertNonEmptyBookingId(bookingId: string): string {
  const normalized = normalizeTrimmed(bookingId)
  if (!normalized) {
    throw bookingError('BOOKING_ID_REQUIRED')
  }
  return normalized
}

function assertNonEmptyClientId(clientId: string): string {
  const normalized = normalizeTrimmed(clientId)
  if (!normalized) {
    throw bookingError('CLIENT_ID_REQUIRED')
  }
  return normalized
}

function assertNonEmptyProfessionalId(professionalId: string): string {
  const normalized = normalizeTrimmed(professionalId)
  if (!normalized) {
    throw bookingError('FORBIDDEN', {
      message: 'Missing professional id for client action token.',
      userMessage: 'That link is invalid or expired.',
    })
  }
  return normalized
}

function assertNonEmptyConsultationApprovalId(
  consultationApprovalId: string,
): string {
  const normalized = normalizeTrimmed(consultationApprovalId)
  if (!normalized) {
    throw bookingError('FORBIDDEN', {
      message: 'Missing consultation approval id for client action token.',
      userMessage: 'That link is invalid or expired.',
    })
  }
  return normalized
}

function assertRawTokenPresent(rawToken: string): string {
  const normalized = normalizeTrimmed(rawToken)
  if (!normalized) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation action token is missing.',
      userMessage: 'That link is invalid or expired.',
    })
  }
  return normalized
}

function resolveExpiresAt(expiresAt?: Date | null): Date {
  if (expiresAt == null) {
    return new Date(Date.now() + CONSULTATION_ACTION_TOKEN_EXPIRY_MS)
  }

  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation action token expiry is invalid.',
      userMessage: 'That link could not be created.',
    })
  }

  if (expiresAt.getTime() <= Date.now()) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation action token expiry must be in the future.',
      userMessage: 'That link could not be created.',
    })
  }

  return expiresAt
}

export function generateClientActionToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashClientActionToken(rawToken: string): string {
  return sha256(assertRawTokenPresent(rawToken))
}

const CONSUME_CONSULTATION_ACTION_TOKEN_SELECT = {
  id: true,
  kind: true,
  singleUse: true,
  bookingId: true,
  consultationApprovalId: true,
  clientId: true,
  professionalId: true,
  deliveryMethod: true,
  recipientEmailSnapshot: true,
  recipientPhoneSnapshot: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  revokedAt: true,
  revokeReason: true,
} satisfies Prisma.ClientActionTokenSelect

type ConsumedConsultationActionTokenRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof CONSUME_CONSULTATION_ACTION_TOKEN_SELECT
}>

export type IssueConsultationActionTokenArgs = {
  bookingId: string
  consultationApprovalId: string
  clientId: string
  professionalId: string
  issuedByUserId?: string | null
  deliveryMethod?: ContactMethod | null
  recipientEmailSnapshot?: string | null
  recipientPhoneSnapshot?: string | null
  expiresAt?: Date | null
  metadata?: Prisma.InputJsonValue | null
  tx?: Prisma.TransactionClient
}

export type IssueConsultationActionTokenResult = {
  id: string
  rawToken: string
  expiresAt: Date
}

export async function issueConsultationActionToken(
  args: IssueConsultationActionTokenArgs,
): Promise<IssueConsultationActionTokenResult> {
  const db = getDb(args.tx)

  const bookingId = assertNonEmptyBookingId(args.bookingId)
  const consultationApprovalId = assertNonEmptyConsultationApprovalId(
    args.consultationApprovalId,
  )
  const clientId = assertNonEmptyClientId(args.clientId)
  const professionalId = assertNonEmptyProfessionalId(args.professionalId)
  const issuedByUserId = normalizeTrimmed(args.issuedByUserId)
  const recipientEmailSnapshot = normalizeTrimmed(args.recipientEmailSnapshot)
  const recipientPhoneSnapshot = normalizeTrimmed(args.recipientPhoneSnapshot)
  const expiresAt = resolveExpiresAt(args.expiresAt)

  const rawToken = generateClientActionToken()
  const tokenHash = sha256(rawToken)

  const created = await db.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.CONSULTATION_ACTION,
      tokenHash,
      singleUse: true,
      bookingId,
      consultationApprovalId,
      clientId,
      professionalId,
      deliveryMethod: args.deliveryMethod ?? null,
      recipientEmailSnapshot,
      recipientPhoneSnapshot,
      issuedByUserId,
      expiresAt,
      metadata: toNullableJsonCreateInput(args.metadata),
    },
    select: {
      id: true,
      expiresAt: true,
    },
  })

  return {
    id: created.id,
    rawToken,
    expiresAt: created.expiresAt,
  }
}

export type ConsumeConsultationActionTokenArgs = {
  rawToken: string
  tx?: Prisma.TransactionClient
}

export type ConsumedConsultationActionToken = {
  id: string
  bookingId: string
  consultationApprovalId: string
  clientId: string
  professionalId: string
  deliveryMethod: ContactMethod | null
  destinationSnapshot: string | null
  expiresAt: Date
  firstUsedAt: Date | null
  lastUsedAt: Date | null
  useCount: number
}

function buildConsultationTokenDestinationSnapshot(
  token: Pick<
    ConsumedConsultationActionTokenRecord,
    'deliveryMethod' | 'recipientEmailSnapshot' | 'recipientPhoneSnapshot'
  >,
): string | null {
  if (token.deliveryMethod === ContactMethod.EMAIL) {
    return token.recipientEmailSnapshot ?? null
  }

  if (token.deliveryMethod === ContactMethod.SMS) {
    return token.recipientPhoneSnapshot ?? null
  }

  return token.recipientEmailSnapshot ?? token.recipientPhoneSnapshot ?? null
}

function assertConsultationTokenUsable(
  token: ConsumedConsultationActionTokenRecord | null,
  now: Date,
): asserts token is ConsumedConsultationActionTokenRecord & {
  consultationApprovalId: string
} {
  if (!token) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation action token was not found.',
      userMessage: 'That link is invalid or expired.',
    })
  }

  if (token.kind !== ClientActionTokenKind.CONSULTATION_ACTION) {
    throw bookingError('FORBIDDEN', {
      message: `Unexpected client action token kind: ${String(token.kind)}`,
      userMessage: 'That link is invalid or expired.',
    })
  }

  if (!token.consultationApprovalId) {
    throw bookingError('FORBIDDEN', {
      message: `Consultation action token is missing consultationApprovalId. tokenId=${token.id}`,
      userMessage: 'That link is invalid or expired.',
    })
  }

  if (token.revokedAt) {
    throw bookingError('FORBIDDEN', {
      message: `Consultation action token was revoked. tokenId=${token.id}`,
      userMessage: 'That link is invalid or expired.',
    })
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw bookingError('FORBIDDEN', {
      message: `Consultation action token expired. tokenId=${token.id}`,
      userMessage: 'That link is invalid or expired.',
    })
  }

  if (token.singleUse && token.firstUsedAt) {
    throw bookingError('FORBIDDEN', {
      message: `Consultation action token was already used. tokenId=${token.id}`,
      userMessage: 'That link has already been used.',
    })
  }
}

export async function consumeConsultationActionToken(
  args: ConsumeConsultationActionTokenArgs,
): Promise<ConsumedConsultationActionToken> {
  const db = getDb(args.tx)
  const now = new Date()
  const tokenHash = hashClientActionToken(args.rawToken)

  const existing = await db.clientActionToken.findUnique({
    where: { tokenHash },
    select: CONSUME_CONSULTATION_ACTION_TOKEN_SELECT,
  })

  assertConsultationTokenUsable(existing, now)

  if (existing.singleUse) {
    const updated = await db.clientActionToken.updateMany({
      where: {
        id: existing.id,
        kind: ClientActionTokenKind.CONSULTATION_ACTION,
        revokedAt: null,
        expiresAt: { gt: now },
        firstUsedAt: null,
      },
      data: {
        firstUsedAt: now,
        lastUsedAt: now,
        useCount: {
          increment: 1,
        },
      },
    })

    if (updated.count !== 1) {
      throw bookingError('FORBIDDEN', {
        message: `Consultation action token could not be consumed exactly once. tokenId=${existing.id}`,
        userMessage: 'That link is invalid or has already been used.',
      })
    }
  } else {
    await db.clientActionToken.update({
      where: { id: existing.id },
      data: {
        firstUsedAt: existing.firstUsedAt ?? now,
        lastUsedAt: now,
        useCount: {
          increment: 1,
        },
      },
    })
  }

  const consumed = await db.clientActionToken.findUnique({
  where: { id: existing.id },
  select: CONSUME_CONSULTATION_ACTION_TOKEN_SELECT,
})

if (!consumed) {
  throw bookingError('FORBIDDEN', {
    message: `Consultation action token disappeared after consume. tokenId=${existing.id}`,
    userMessage: 'That link is invalid or expired.',
  })
}

if (!consumed.consultationApprovalId) {
  throw bookingError('FORBIDDEN', {
    message: `Consultation action token is missing consultationApprovalId after consume. tokenId=${existing.id}`,
    userMessage: 'That link is invalid or expired.',
  })
}

return {
  id: consumed.id,
  bookingId: consumed.bookingId,
  consultationApprovalId: consumed.consultationApprovalId,
  clientId: consumed.clientId,
  professionalId: consumed.professionalId,
  deliveryMethod: consumed.deliveryMethod ?? null,
  destinationSnapshot: buildConsultationTokenDestinationSnapshot(consumed),
  expiresAt: consumed.expiresAt,
  firstUsedAt: consumed.firstUsedAt ?? null,
  lastUsedAt: consumed.lastUsedAt ?? null,
  useCount: consumed.useCount,
}
}

export type RevokeConsultationActionTokensForBookingArgs = {
  bookingId: string
  revokeReason?: string | null
  revokedAt?: Date
  tx?: Prisma.TransactionClient
}

export async function revokeConsultationActionTokensForBooking(
  args: RevokeConsultationActionTokensForBookingArgs,
): Promise<{ count: number }> {
  const db = getDb(args.tx)
  const bookingId = assertNonEmptyBookingId(args.bookingId)
  const revokedAt =
    args.revokedAt instanceof Date && !Number.isNaN(args.revokedAt.getTime())
      ? args.revokedAt
      : new Date()
  const revokeReason = normalizeTrimmed(args.revokeReason)

  return db.clientActionToken.updateMany({
    where: {
      bookingId,
      kind: ClientActionTokenKind.CONSULTATION_ACTION,
      revokedAt: null,
      firstUsedAt: null,
    },
    data: {
      revokedAt,
      revokeReason,
    },
  })
}