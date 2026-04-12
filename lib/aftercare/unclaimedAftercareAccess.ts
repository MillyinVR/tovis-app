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

function assertRawTokenPresent(rawToken: string): string {
  const normalized = normalizeTrimmed(rawToken)
  if (!normalized) {
    throw bookingError('FORBIDDEN', {
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
  accessSource: 'clientActionToken' | 'legacyPublicToken'
  token: null | {
    id: string
    expiresAt: Date
    firstUsedAt: Date | null
    lastUsedAt: Date | null
    useCount: number
    singleUse: boolean
  }
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
    throw bookingError('FORBIDDEN', {
      message: 'Aftercare access token was not found.',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (token.kind !== ClientActionTokenKind.AFTERCARE_ACCESS) {
    throw bookingError('FORBIDDEN', {
      message: `Unexpected client action token kind for aftercare access. tokenId=${token.id} kind=${String(token.kind)}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (!token.aftercareSummaryId) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare access token is missing aftercareSummaryId. tokenId=${token.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (token.revokedAt) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare access token was revoked. tokenId=${token.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare access token expired. tokenId=${token.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (token.singleUse && token.firstUsedAt) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare access token was already used. tokenId=${token.id}`,
      userMessage: 'That aftercare link has already been used.',
    })
  }
}

function assertAftercareSummaryIsUsable(
  aftercare: AftercareAccessAftercareRecord | null,
): asserts aftercare is AftercareAccessAftercareRecord {
  if (!aftercare) {
    throw bookingError('FORBIDDEN', {
      message: 'Aftercare summary was not found for public access.',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (!aftercare.booking) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare summary is missing booking context. aftercareId=${aftercare.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (!aftercare.sentToClientAt) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare summary has not been sent to the client yet. aftercareId=${aftercare.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }
}

function assertAftercareTokenRelationIntegrity(
  token: AftercareAccessTokenRecord,
  aftercare: AftercareAccessAftercareRecord,
): void {
  if (aftercare.id !== token.aftercareSummaryId) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare token summary mismatch. tokenId=${token.id} tokenAftercareId=${token.aftercareSummaryId} actualAftercareId=${aftercare.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (aftercare.bookingId !== token.bookingId) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare token booking mismatch. tokenId=${token.id} tokenBookingId=${token.bookingId} actualBookingId=${aftercare.bookingId}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (aftercare.booking.clientId !== token.clientId) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare token client mismatch. tokenId=${token.id} tokenClientId=${token.clientId} actualClientId=${aftercare.booking.clientId}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (aftercare.booking.professionalId !== token.professionalId) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare token professional mismatch. tokenId=${token.id} tokenProfessionalId=${token.professionalId} actualProfessionalId=${aftercare.booking.professionalId}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }
}

async function markAftercareAccessTokenUsed(
  db: DbClient,
  token: AftercareAccessTokenRecord,
  now: Date,
): Promise<{
  id: string
  expiresAt: Date
  firstUsedAt: Date | null
  lastUsedAt: Date | null
  useCount: number
  singleUse: boolean
}> {
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
      throw bookingError('FORBIDDEN', {
        message: `Aftercare access token could not be consumed exactly once. tokenId=${token.id}`,
        userMessage: 'That aftercare link is invalid or has already been used.',
      })
    }
  } else {
    await db.clientActionToken.update({
      where: { id: token.id },
      data: {
        firstUsedAt: token.firstUsedAt ?? now,
        lastUsedAt: now,
        useCount: {
          increment: 1,
        },
      },
    })
  }

  const refreshed = await db.clientActionToken.findUnique({
    where: { id: token.id },
    select: {
      id: true,
      expiresAt: true,
      firstUsedAt: true,
      lastUsedAt: true,
      useCount: true,
      singleUse: true,
    },
  })

  if (!refreshed) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare access token disappeared after access update. tokenId=${token.id}`,
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  return refreshed
}

function toResolvedAccessResult(args: {
  accessSource: 'clientActionToken' | 'legacyPublicToken'
  token: ResolveAftercareAccessByTokenResult['token']
  aftercare: AftercareAccessAftercareRecord
}): ResolveAftercareAccessByTokenResult {
  const { aftercare } = args
  const booking = aftercare.booking

  return {
    accessSource: args.accessSource,
    token: args.token,
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

  if (tokenRecord) {
    assertAftercareAccessTokenUsable(tokenRecord, now)

    const aftercareFromToken = tokenRecord.aftercareSummary
    assertAftercareSummaryIsUsable(aftercareFromToken)
    assertAftercareTokenRelationIntegrity(tokenRecord, aftercareFromToken)

    const tokenUsage = await markAftercareAccessTokenUsed(db, tokenRecord, now)

    return toResolvedAccessResult({
      accessSource: 'clientActionToken',
      token: tokenUsage,
      aftercare: aftercareFromToken,
    })
  }

  const legacyAftercare = await db.aftercareSummary.findUnique({
    where: { publicToken: rawToken },
    select: AFTERCARE_ACCESS_AFTERCARE_SELECT,
  })

  assertAftercareSummaryIsUsable(legacyAftercare)

  return toResolvedAccessResult({
    accessSource: 'legacyPublicToken',
    token: null,
    aftercare: legacyAftercare,
  })
}