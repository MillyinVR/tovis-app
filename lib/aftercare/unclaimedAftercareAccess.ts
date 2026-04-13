import {
  ClientActionTokenKind,
  Prisma,
} from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { prisma } from '@/lib/prisma'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'

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
  publicToken: true,
  notes: true,
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
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

export type ResolveAftercareAccessByTokenArgs = {
  rawToken: string
  tx?: Prisma.TransactionClient
}

export type ResolveAftercareAccessByTokenResult = {
  accessSource: 'clientActionToken'
  token: AftercareAccessTokenUsage
  aftercare: {
    id: string
    bookingId: string
    publicToken: string
    notes: string | null
    rebookMode: AftercareAccessAftercareRecord['rebookMode']
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
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
      `Unexpected client action token kind for aftercare access. tokenId=${token.id} kind=${String(token.kind)}`,
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

async function markAftercareAccessTokenUsed(
  db: DbClient,
  token: AftercareAccessTokenRecord,
  now: Date,
): Promise<AftercareAccessTokenUsage> {
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

function toResolvedAccessResult(args: {
  token: AftercareAccessTokenUsage
  aftercare: AftercareAccessAftercareRecord
}): ResolveAftercareAccessByTokenResult {
  const { aftercare, token } = args
  const booking = aftercare.booking

  return {
    accessSource: 'clientActionToken',
    token,
    aftercare: {
      id: aftercare.id,
      bookingId: aftercare.bookingId,
      publicToken: aftercare.publicToken,
      notes: aftercare.notes,
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
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

export async function resolveAftercareAccessByToken(
  args: ResolveAftercareAccessByTokenArgs,
): Promise<ResolveAftercareAccessByTokenResult> {
  const db = getDb(args.tx)
  const rawToken = assertRawTokenPresent(args.rawToken)
  const now = new Date()
  const tokenHash = hashClientActionToken(rawToken)

  const tokenRecord = await db.clientActionToken.findUnique({
    where: { tokenHash },
    select: AFTERCARE_ACCESS_TOKEN_SELECT,
  })

  assertAftercareAccessTokenUsable(tokenRecord, now)

  const aftercare = tokenRecord.aftercareSummary
  assertAftercareSummaryIsUsable(aftercare)
  assertAftercareTokenRelationIntegrity(tokenRecord, aftercare)

  const tokenUsage = await markAftercareAccessTokenUsed(db, tokenRecord, now)

  return toResolvedAccessResult({
    token: tokenUsage,
    aftercare,
  })
}