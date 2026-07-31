// lib/booking/appointmentConfirmationTokens.ts
//
// K12: resolve + mark-used for the appointment-confirmation action link
// (ClientActionTokenKind.APPOINTMENT_CONFIRMATION, /client/appointment/<token>)
// that appointment reminders carry.
//
// Mirrors lib/booking/depositPaymentTokens.ts: the resolvers VALIDATE without
// consuming (the token is not single-use — a client may confirm and later come
// back through the same message to cancel or reschedule; every action
// re-validates against the booking's own state, and the token expires at the
// appointment start). The resolver deliberately does NOT require the booking
// to still be actionable: the page must render honest "already cancelled" /
// "already happened" states rather than 404 on a link the client was texted.

import { BookingStatus, ClientActionTokenKind, Prisma } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import {
  markClientActionTokenUsed,
  type ClientActionTokenUsage,
} from '@/lib/clientActions/tokenUsage'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { buildPublicAppointmentTokenActorKey } from '@/lib/idempotency'
import { prisma } from '@/lib/prisma'
import { professionalPublicDisplayNameSelect } from '@/lib/privacy/professionalDisplayName'

import { CLIENT_CONFIRMATION_SELECT } from './clientConfirmation'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function invalidAppointmentToken(
  message: string,
  userMessage = 'That appointment link is invalid or expired.',
) {
  return bookingError('APPOINTMENT_TOKEN_INVALID', {
    message,
    userMessage,
  })
}

function assertRawTokenPresent(rawToken: string): string {
  const normalized = typeof rawToken === 'string' ? rawToken.trim() : ''

  if (!normalized) {
    throw bookingError('APPOINTMENT_TOKEN_MISSING', {
      message: 'Appointment confirmation token is missing.',
      userMessage: 'That appointment link is invalid or expired.',
    })
  }

  return normalized
}

export const APPOINTMENT_CONFIRMATION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  totalDurationMinutes: true,
  locationId: true,
  locationType: true,
  locationTimeZone: true,
  clientAddressId: true,
  offeringId: true,
  depositStatus: true,
  depositAmount: true,
  ...CLIENT_CONFIRMATION_SELECT,
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

export type AppointmentConfirmationBookingRecord = Prisma.BookingGetPayload<{
  select: typeof APPOINTMENT_CONFIRMATION_BOOKING_SELECT
}>

const APPOINTMENT_CONFIRMATION_TOKEN_SELECT = {
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
    select: APPOINTMENT_CONFIRMATION_BOOKING_SELECT,
  },
} satisfies Prisma.ClientActionTokenSelect

type AppointmentConfirmationTokenRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof APPOINTMENT_CONFIRMATION_TOKEN_SELECT
}>

export type ResolvedAppointmentConfirmationToken = {
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
  booking: AppointmentConfirmationBookingRecord
}

function assertAppointmentTokenUsable(
  token: AppointmentConfirmationTokenRecord | null,
  now: Date,
): asserts token is AppointmentConfirmationTokenRecord {
  if (!token) {
    throw invalidAppointmentToken(
      'Appointment confirmation token was not found.',
    )
  }

  if (token.kind !== ClientActionTokenKind.APPOINTMENT_CONFIRMATION) {
    throw invalidAppointmentToken(
      `Unexpected client action token kind for appointment confirmation. tokenId=${token.id} kind=${String(
        token.kind,
      )}`,
    )
  }

  if (token.revokedAt) {
    throw invalidAppointmentToken(
      `Appointment confirmation token was revoked. tokenId=${token.id}`,
    )
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw invalidAppointmentToken(
      `Appointment confirmation token expired. tokenId=${token.id}`,
      'This link has expired — the appointment time has passed.',
    )
  }
}

function assertAppointmentTokenRelationIntegrity(
  token: AppointmentConfirmationTokenRecord,
): asserts token is AppointmentConfirmationTokenRecord & {
  booking: AppointmentConfirmationBookingRecord
} {
  const booking = token.booking

  if (!booking) {
    throw invalidAppointmentToken(
      `Appointment confirmation token is missing its booking. tokenId=${token.id}`,
    )
  }

  if (booking.clientId !== token.clientId) {
    throw invalidAppointmentToken(
      `Appointment token client mismatch. tokenId=${token.id} tokenClientId=${token.clientId} actualClientId=${booking.clientId}`,
    )
  }

  if (booking.professionalId !== token.professionalId) {
    throw invalidAppointmentToken(
      `Appointment token professional mismatch. tokenId=${token.id} tokenProfessionalId=${token.professionalId} actualProfessionalId=${booking.professionalId}`,
    )
  }
}

/**
 * The statuses a confirmation ANSWER (confirm/decline) may be recorded
 * against. IN_PROGRESS/COMPLETED/NO_SHOW answers a question that no longer
 * exists; CANCELLED has nothing to attend. Cancel/reschedule apply their own,
 * stricter write-boundary gates on top.
 */
export const APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES: ReadonlySet<BookingStatus> =
  new Set([BookingStatus.PENDING, BookingStatus.ACCEPTED])

/**
 * Validates a raw appointment confirmation token and returns its booking
 * context without mutating token usage.
 */
export async function resolveAppointmentConfirmationTokenForRead(args: {
  rawToken: string
  tx?: Prisma.TransactionClient
  now?: Date
}): Promise<ResolvedAppointmentConfirmationToken> {
  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const rawToken = assertRawTokenPresent(args.rawToken)
  const tokenHash = hashClientActionToken(rawToken)

  const token = await db.clientActionToken.findUnique({
    where: { tokenHash },
    select: APPOINTMENT_CONFIRMATION_TOKEN_SELECT,
  })

  assertAppointmentTokenUsable(token, now)
  assertAppointmentTokenRelationIntegrity(token)

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
    idempotencyActorKey: buildPublicAppointmentTokenActorKey(token.id),
    booking: token.booking,
  }
}

/**
 * Validates a raw appointment confirmation token for a mutation without
 * consuming it (mirrors resolveDepositPaymentTokenForMutation).
 */
export async function resolveAppointmentConfirmationTokenForMutation(args: {
  rawToken: string
  tx?: Prisma.TransactionClient
  now?: Date
}): Promise<ResolvedAppointmentConfirmationToken> {
  return resolveAppointmentConfirmationTokenForRead(args)
}

/**
 * Records usage on an already-validated appointment confirmation token.
 * Non-blocking for this kind (singleUse false): first use stamps firstUsedAt,
 * later uses increment the counters.
 */
export async function markAppointmentConfirmationTokenUsed(args: {
  tokenId: string
  tx?: Prisma.TransactionClient
  now?: Date
}): Promise<ClientActionTokenUsage> {
  return markClientActionTokenUsed({
    tokenId: args.tokenId,
    kind: ClientActionTokenKind.APPOINTMENT_CONFIRMATION,
    tx: args.tx,
    now: args.now,
    invalidError: (message, userMessage) =>
      invalidAppointmentToken(
        message.replace('Client action token', 'Appointment confirmation token'),
        userMessage,
      ),
    alreadyUsedUserMessage:
      'That appointment link is invalid or has already been used.',
  })
}
