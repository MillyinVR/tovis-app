// lib/booking/depositPaymentTokens.ts
//
// K10-B: resolve + mark-used for the unauthenticated deposit pay link
// (ClientActionTokenKind.DEPOSIT_PAYMENT, /client/deposit/<token>).
//
// Mirrors lib/aftercare/aftercareAccessTokens.ts: the resolvers VALIDATE
// without consuming (usage is recorded separately, and the token is not
// single-use — payment completion is enforced by the booking's depositStatus,
// never by burning the link). The resolver deliberately does NOT require the
// deposit to still be PENDING: the page must render "already paid" and
// "booking cancelled" states rather than 404 on a link the client was texted.

import { ClientActionTokenKind, Prisma } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import {
  markClientActionTokenUsed,
  type ClientActionTokenUsage,
} from '@/lib/clientActions/tokenUsage'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { buildPublicDepositTokenActorKey } from '@/lib/idempotency'
import { prisma } from '@/lib/prisma'
import { professionalPublicDisplayNameSelect } from '@/lib/privacy/professionalDisplayName'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function invalidDepositToken(
  message: string,
  userMessage = 'That payment link is invalid or expired.',
) {
  return bookingError('DEPOSIT_TOKEN_INVALID', {
    message,
    userMessage,
  })
}

function assertRawTokenPresent(rawToken: string): string {
  const normalized = typeof rawToken === 'string' ? rawToken.trim() : ''

  if (!normalized) {
    throw bookingError('DEPOSIT_TOKEN_MISSING', {
      message: 'Deposit payment token is missing.',
      userMessage: 'That payment link is invalid or expired.',
    })
  }

  return normalized
}

const DEPOSIT_PAYMENT_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  locationTimeZone: true,
  depositStatus: true,
  depositAmount: true,
  depositDueAt: true,
  depositPaidAt: true,
  discoveryFeeAmount: true,
  service: {
    select: {
      id: true,
      name: true,
    },
  },
  professional: {
    select: {
      id: true,
      timeZone: true,
      ...professionalPublicDisplayNameSelect,
    },
  },
} satisfies Prisma.BookingSelect

type DepositPaymentBookingRecord = Prisma.BookingGetPayload<{
  select: typeof DEPOSIT_PAYMENT_BOOKING_SELECT
}>

const DEPOSIT_PAYMENT_TOKEN_SELECT = {
  id: true,
  kind: true,
  singleUse: true,
  bookingId: true,
  clientId: true,
  professionalId: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  revokedAt: true,
  booking: {
    select: DEPOSIT_PAYMENT_BOOKING_SELECT,
  },
} satisfies Prisma.ClientActionTokenSelect

type DepositPaymentTokenRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof DEPOSIT_PAYMENT_TOKEN_SELECT
}>

export type ResolvedDepositPaymentToken = {
  accessSource: 'clientActionToken'
  token: {
    id: string
    expiresAt: Date
    firstUsedAt: Date | null
    lastUsedAt: Date | null
    useCount: number
    singleUse: boolean
  }
  idempotencyActorKey: string
  booking: DepositPaymentBookingRecord
}

function assertDepositPaymentTokenUsable(
  token: DepositPaymentTokenRecord | null,
  now: Date,
): asserts token is DepositPaymentTokenRecord {
  if (!token) {
    throw invalidDepositToken('Deposit payment token was not found.')
  }

  if (token.kind !== ClientActionTokenKind.DEPOSIT_PAYMENT) {
    throw invalidDepositToken(
      `Unexpected client action token kind for deposit payment. tokenId=${token.id} kind=${String(
        token.kind,
      )}`,
    )
  }

  if (token.revokedAt) {
    throw invalidDepositToken(
      `Deposit payment token was revoked. tokenId=${token.id}`,
    )
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw invalidDepositToken(
      `Deposit payment token expired. tokenId=${token.id}`,
    )
  }
}

function assertDepositTokenRelationIntegrity(
  token: DepositPaymentTokenRecord,
): asserts token is DepositPaymentTokenRecord & {
  booking: DepositPaymentBookingRecord
} {
  const booking = token.booking

  if (!booking) {
    throw invalidDepositToken(
      `Deposit payment token is missing its booking. tokenId=${token.id}`,
    )
  }

  if (booking.clientId !== token.clientId) {
    throw invalidDepositToken(
      `Deposit token client mismatch. tokenId=${token.id} tokenClientId=${token.clientId} actualClientId=${booking.clientId}`,
    )
  }

  if (booking.professionalId !== token.professionalId) {
    throw invalidDepositToken(
      `Deposit token professional mismatch. tokenId=${token.id} tokenProfessionalId=${token.professionalId} actualProfessionalId=${booking.professionalId}`,
    )
  }
}

/**
 * Validates a raw deposit payment token and returns its booking context
 * without mutating token usage.
 */
export async function resolveDepositPaymentTokenForRead(args: {
  rawToken: string
  tx?: Prisma.TransactionClient
}): Promise<ResolvedDepositPaymentToken> {
  const db = getDb(args.tx)
  const now = new Date()

  const rawToken = assertRawTokenPresent(args.rawToken)
  const tokenHash = hashClientActionToken(rawToken)

  const token = await db.clientActionToken.findUnique({
    where: { tokenHash },
    select: DEPOSIT_PAYMENT_TOKEN_SELECT,
  })

  assertDepositPaymentTokenUsable(token, now)
  assertDepositTokenRelationIntegrity(token)

  return {
    accessSource: 'clientActionToken',
    token: {
      id: token.id,
      expiresAt: token.expiresAt,
      firstUsedAt: token.firstUsedAt,
      lastUsedAt: token.lastUsedAt,
      useCount: token.useCount,
      singleUse: token.singleUse,
    },
    idempotencyActorKey: buildPublicDepositTokenActorKey(token.id),
    booking: token.booking,
  }
}

/**
 * Validates a raw deposit payment token for a mutation without consuming it.
 * Kept as a separate export so mutation routes express intent clearly
 * (mirrors resolveAftercareAccessTokenForMutation).
 */
export async function resolveDepositPaymentTokenForMutation(args: {
  rawToken: string
  tx?: Prisma.TransactionClient
}): Promise<ResolvedDepositPaymentToken> {
  return resolveDepositPaymentTokenForRead(args)
}

/**
 * Records usage on an already-validated deposit payment token. Non-blocking
 * for this kind (singleUse false): first use stamps firstUsedAt, later uses
 * increment the counters.
 */
export async function markDepositPaymentTokenUsed(args: {
  tokenId: string
  tx?: Prisma.TransactionClient
  now?: Date
}): Promise<ClientActionTokenUsage> {
  return markClientActionTokenUsed({
    tokenId: args.tokenId,
    kind: ClientActionTokenKind.DEPOSIT_PAYMENT,
    tx: args.tx,
    now: args.now,
    invalidError: (message, userMessage) =>
      invalidDepositToken(
        message.replace('Client action token', 'Deposit payment token'),
        userMessage,
      ),
    alreadyUsedUserMessage:
      'That payment link is invalid or has already been used.',
  })
}
