// lib/aftercare/aftercareAccessTokens.ts

import { ClientActionTokenKind, Prisma } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { buildPublicAftercareTokenActorKey } from '@/lib/idempotency'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function invalidAftercareToken(
  message: string,
  userMessage = 'That aftercare link is invalid or expired.',
) {
  return bookingError('AFTERCARE_TOKEN_INVALID', {
    message,
    userMessage,
  })
}

function assertRawTokenPresent(rawToken: string): string {
  const normalized = normalizeTrimmed(rawToken)

  if (!normalized) {
    throw bookingError('AFTERCARE_TOKEN_MISSING', {
      message: 'Aftercare access token is missing.',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  return normalized
}

const AFTERCARE_ACCESS_AFTERCARE_SELECT = {
  id: true,
  bookingId: true,
  notes: true,
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  featuredBeforeAssetId: true,
  featuredAfterAssetId: true,
  draftSavedAt: true,
  sentToClientAt: true,
  lastEditedAt: true,
  version: true,
  booking: {
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      offeringId: true,
      scheduledFor: true,
      status: true,
      locationType: true,
      locationId: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
      service: {
        select: {
          id: true,
          name: true,
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
          timeZone: true,
          location: true,
        },
      },
    },
  },
} satisfies Prisma.AftercareSummarySelect

type AftercareAccessAftercareRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof AFTERCARE_ACCESS_AFTERCARE_SELECT
}>

const AFTERCARE_ACCESS_TOKEN_USAGE_SELECT = {
  id: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  singleUse: true,
} satisfies Prisma.ClientActionTokenSelect

type AftercareAccessTokenUsage = Prisma.ClientActionTokenGetPayload<{
  select: typeof AFTERCARE_ACCESS_TOKEN_USAGE_SELECT
}>

const AFTERCARE_ACCESS_TOKEN_SELECT = {
  id: true,
  kind: true,
  singleUse: true,
  bookingId: true,
  aftercareSummaryId: true,
  clientId: true,
  professionalId: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  revokedAt: true,
  revokeReason: true,
  aftercareSummary: {
    select: AFTERCARE_ACCESS_AFTERCARE_SELECT,
  },
} satisfies Prisma.ClientActionTokenSelect

type AftercareAccessTokenRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof AFTERCARE_ACCESS_TOKEN_SELECT
}>

export type ResolveAftercareAccessTokenArgs = {
  rawToken: string
  tx?: Prisma.TransactionClient
}

export type MarkAftercareAccessTokenUsedArgs = {
  tokenId: string
  tx?: Prisma.TransactionClient
  now?: Date
}

export type ResolvedAftercareAccessToken = {
  accessSource: 'clientActionToken'
  token: AftercareAccessTokenUsage
  idempotencyActorKey: string
  aftercare: {
    id: string
    bookingId: string
    notes: string | null
    rebookMode: AftercareAccessAftercareRecord['rebookMode']
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
    featuredBeforeAssetId: string | null
    featuredAfterAssetId: string | null
    draftSavedAt: Date | null
    sentToClientAt: Date | null
    lastEditedAt: Date | null
    version: number
  }
  booking: {
    id: string
    clientId: string
    professionalId: string
    serviceId: string | null
    offeringId: string | null
    scheduledFor: Date
    status: AftercareAccessAftercareRecord['booking']['status']
    locationType: AftercareAccessAftercareRecord['booking']['locationType']
    locationId: string
    subtotalSnapshot: Prisma.Decimal
    totalDurationMinutes: number
    service: AftercareAccessAftercareRecord['booking']['service']
    professional: AftercareAccessAftercareRecord['booking']['professional']
  }
}

function assertAftercareAccessTokenUsable(
  token: AftercareAccessTokenRecord | null,
  now: Date,
): asserts token is AftercareAccessTokenRecord {
  if (!token) {
    throw invalidAftercareToken('Aftercare access token was not found.')
  }

  if (token.kind !== ClientActionTokenKind.AFTERCARE_ACCESS) {
    throw invalidAftercareToken(
      `Unexpected client action token kind for aftercare access. tokenId=${token.id} kind=${String(
        token.kind,
      )}`,
    )
  }

  if (!token.aftercareSummaryId) {
    throw invalidAftercareToken(
      `Aftercare access token is missing aftercareSummaryId. tokenId=${token.id}`,
    )
  }

  if (token.revokedAt) {
    throw invalidAftercareToken(
      `Aftercare access token was revoked. tokenId=${token.id}`,
    )
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw invalidAftercareToken(
      `Aftercare access token expired. tokenId=${token.id}`,
    )
  }

  if (token.singleUse && token.firstUsedAt) {
    throw invalidAftercareToken(
      `Aftercare access token was already used. tokenId=${token.id}`,
      'That aftercare link has already been used.',
    )
  }
}

function assertAftercareSummaryIsUsable(
  aftercare: AftercareAccessAftercareRecord | null,
): asserts aftercare is AftercareAccessAftercareRecord {
  if (!aftercare) {
    throw invalidAftercareToken(
      'Aftercare summary was not found for token-backed access.',
    )
  }

  if (!aftercare.booking) {
    throw invalidAftercareToken(
      `Aftercare summary is missing booking context. aftercareId=${aftercare.id}`,
    )
  }

  if (!aftercare.sentToClientAt) {
    throw invalidAftercareToken(
      `Aftercare summary has not been sent to the client yet. aftercareId=${aftercare.id}`,
    )
  }
}

function assertAftercareTokenRelationIntegrity(
  token: AftercareAccessTokenRecord,
  aftercare: AftercareAccessAftercareRecord,
): void {
  if (aftercare.id !== token.aftercareSummaryId) {
    throw invalidAftercareToken(
      `Aftercare token summary mismatch. tokenId=${token.id} tokenAftercareId=${token.aftercareSummaryId} actualAftercareId=${aftercare.id}`,
    )
  }

  if (aftercare.bookingId !== token.bookingId) {
    throw invalidAftercareToken(
      `Aftercare token booking mismatch. tokenId=${token.id} tokenBookingId=${token.bookingId} actualBookingId=${aftercare.bookingId}`,
    )
  }

  if (aftercare.booking.clientId !== token.clientId) {
    throw invalidAftercareToken(
      `Aftercare token client mismatch. tokenId=${token.id} tokenClientId=${token.clientId} actualClientId=${aftercare.booking.clientId}`,
    )
  }

  if (aftercare.booking.professionalId !== token.professionalId) {
    throw invalidAftercareToken(
      `Aftercare token professional mismatch. tokenId=${token.id} tokenProfessionalId=${token.professionalId} actualProfessionalId=${aftercare.booking.professionalId}`,
    )
  }
}

function toResolvedAccessResult(args: {
  token: AftercareAccessTokenUsage
  aftercare: AftercareAccessAftercareRecord
}): ResolvedAftercareAccessToken {
  const { aftercare, token } = args
  const booking = aftercare.booking

  return {
    accessSource: 'clientActionToken',
    token,
    idempotencyActorKey: buildPublicAftercareTokenActorKey(token.id),
    aftercare: {
      id: aftercare.id,
      bookingId: aftercare.bookingId,
      notes: aftercare.notes,
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
      featuredBeforeAssetId: aftercare.featuredBeforeAssetId,
      featuredAfterAssetId: aftercare.featuredAfterAssetId,
      draftSavedAt: aftercare.draftSavedAt,
      sentToClientAt: aftercare.sentToClientAt,
      lastEditedAt: aftercare.lastEditedAt,
      version: aftercare.version,
    },
    booking: {
      id: booking.id,
      clientId: booking.clientId,
      professionalId: booking.professionalId,
      serviceId: booking.serviceId,
      offeringId: booking.offeringId,
      scheduledFor: booking.scheduledFor,
      status: booking.status,
      locationType: booking.locationType,
      locationId: booking.locationId,
      subtotalSnapshot: booking.subtotalSnapshot,
      totalDurationMinutes: booking.totalDurationMinutes,
      service: booking.service,
      professional: booking.professional,
    },
  }
}

async function getAftercareAccessTokenOrFail(args: {
  db: DbClient
  rawToken: string
  now: Date
}): Promise<AftercareAccessTokenRecord> {
  const rawToken = assertRawTokenPresent(args.rawToken)
  const tokenHash = hashClientActionToken(rawToken)

  const token = await args.db.clientActionToken.findUnique({
    where: { tokenHash },
    select: AFTERCARE_ACCESS_TOKEN_SELECT,
  })

  assertAftercareAccessTokenUsable(token, args.now)

  const aftercare = token.aftercareSummary
  assertAftercareSummaryIsUsable(aftercare)
  assertAftercareTokenRelationIntegrity(token, aftercare)

  return token
}

async function refreshAftercareAccessTokenUsage(
  db: DbClient,
  tokenId: string,
): Promise<AftercareAccessTokenUsage> {
  const refreshed = await db.clientActionToken.findUnique({
    where: { id: tokenId },
    select: AFTERCARE_ACCESS_TOKEN_USAGE_SELECT,
  })

  if (!refreshed) {
    throw invalidAftercareToken(
      `Aftercare access token disappeared after usage update. tokenId=${tokenId}`,
    )
  }

  return refreshed
}

async function getAftercareAccessTokenUsageOrFail(
  db: DbClient,
  tokenId: string,
): Promise<AftercareAccessTokenUsage> {
  const token = await db.clientActionToken.findUnique({
    where: { id: tokenId },
    select: AFTERCARE_ACCESS_TOKEN_USAGE_SELECT,
  })

  if (!token) {
    throw invalidAftercareToken(
      `Aftercare access token was not found. tokenId=${tokenId}`,
    )
  }

  return token
}

/**
 * Validates a raw aftercare access token and returns its booking/aftercare
 * context without mutating token usage.
 *
 * Use this before beginning an idempotent mutation so replay/conflict handling
 * can happen before token consumption.
 */
export async function resolveAftercareAccessTokenForRead(
  args: ResolveAftercareAccessTokenArgs,
): Promise<ResolvedAftercareAccessToken> {
  const db = getDb(args.tx)
  const now = new Date()

  const token = await getAftercareAccessTokenOrFail({
    db,
    rawToken: args.rawToken,
    now,
  })

  const aftercare = token.aftercareSummary
  assertAftercareSummaryIsUsable(aftercare)

  return toResolvedAccessResult({
    token: {
      id: token.id,
      expiresAt: token.expiresAt,
      firstUsedAt: token.firstUsedAt,
      lastUsedAt: token.lastUsedAt,
      useCount: token.useCount,
      singleUse: token.singleUse,
    },
    aftercare,
  })
}

/**
 * Validates a raw aftercare access token for a mutation without consuming it.
 * This is intentionally the same as the read resolver for now, but kept as a
 * separate export so mutation routes can express intent clearly.
 */
export async function resolveAftercareAccessTokenForMutation(
  args: ResolveAftercareAccessTokenArgs,
): Promise<ResolvedAftercareAccessToken> {
  return resolveAftercareAccessTokenForRead(args)
}

/**
 * Marks an already-validated aftercare token as used.
 *
 * Call this only after the idempotency ledger has started the mutation, or
 * after the mutation commits if the caller wants token usage to represent
 * successful completion only.
 */
export async function markAftercareAccessTokenUsed(
  args: MarkAftercareAccessTokenUsedArgs,
): Promise<AftercareAccessTokenUsage> {
  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const token = await getAftercareAccessTokenUsageOrFail(db, args.tokenId)

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw invalidAftercareToken(
      `Aftercare access token expired. tokenId=${token.id}`,
    )
  }

  if (token.singleUse) {
    const updated = await db.clientActionToken.updateMany({
      where: {
        id: token.id,
        kind: ClientActionTokenKind.AFTERCARE_ACCESS,
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
      throw invalidAftercareToken(
        `Aftercare access token could not be consumed exactly once. tokenId=${token.id}`,
        'That aftercare link is invalid or has already been used.',
      )
    }

    return refreshAftercareAccessTokenUsage(db, token.id)
  }

  if (!token.firstUsedAt) {
    const firstUseUpdate = await db.clientActionToken.updateMany({
      where: {
        id: token.id,
        kind: ClientActionTokenKind.AFTERCARE_ACCESS,
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

    if (firstUseUpdate.count === 1) {
      return refreshAftercareAccessTokenUsage(db, token.id)
    }
  }

  const repeatUseUpdate = await db.clientActionToken.updateMany({
    where: {
      id: token.id,
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      lastUsedAt: now,
      useCount: {
        increment: 1,
      },
    },
  })

  if (repeatUseUpdate.count !== 1) {
    throw invalidAftercareToken(
      `Aftercare access token usage update did not succeed. tokenId=${token.id}`,
    )
  }

  return refreshAftercareAccessTokenUsage(db, token.id)
}