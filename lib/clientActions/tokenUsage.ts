// lib/clientActions/tokenUsage.ts
//
// Shared usage-marking for ClientActionToken rows, extracted from the aftercare
// module (K10-B) so the deposit-payment token doesn't duplicate the
// single-use/repeat-use branching. Behaviour is byte-identical to the original
// aftercare implementation, parameterized only by the token kind and the
// error builder.

import { ClientActionTokenKind, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

export const CLIENT_ACTION_TOKEN_USAGE_SELECT = {
  id: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  singleUse: true,
} satisfies Prisma.ClientActionTokenSelect

export type ClientActionTokenUsage = Prisma.ClientActionTokenGetPayload<{
  select: typeof CLIENT_ACTION_TOKEN_USAGE_SELECT
}>

export type MarkClientActionTokenUsedArgs = {
  tokenId: string
  kind: ClientActionTokenKind
  tx?: Prisma.TransactionClient
  now?: Date
  /** Build the domain error thrown on any invalid/failed transition. */
  invalidError: (message: string, userMessage?: string) => Error
  /** Copy for the single-use "already used" refusal. */
  alreadyUsedUserMessage: string
}

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

async function refreshUsage(
  db: DbClient,
  tokenId: string,
  invalidError: MarkClientActionTokenUsedArgs['invalidError'],
): Promise<ClientActionTokenUsage> {
  const refreshed = await db.clientActionToken.findUnique({
    where: { id: tokenId },
    select: CLIENT_ACTION_TOKEN_USAGE_SELECT,
  })

  if (!refreshed) {
    throw invalidError(
      `Client action token disappeared after usage update. tokenId=${tokenId}`,
    )
  }

  return refreshed
}

/**
 * Marks an already-validated client-action token as used.
 *
 * Single-use tokens consume exactly once (conditional update guarded on
 * firstUsedAt null); non-single-use tokens stamp firstUsedAt on the first call
 * and increment lastUsedAt/useCount on every later one, never blocking.
 */
export async function markClientActionTokenUsed(
  args: MarkClientActionTokenUsedArgs,
): Promise<ClientActionTokenUsage> {
  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const token = await db.clientActionToken.findUnique({
    where: { id: args.tokenId },
    select: CLIENT_ACTION_TOKEN_USAGE_SELECT,
  })

  if (!token) {
    throw args.invalidError(
      `Client action token was not found. tokenId=${args.tokenId}`,
    )
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw args.invalidError(
      `Client action token expired. tokenId=${token.id}`,
    )
  }

  if (token.singleUse) {
    const updated = await db.clientActionToken.updateMany({
      where: {
        id: token.id,
        kind: args.kind,
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
      throw args.invalidError(
        `Client action token could not be consumed exactly once. tokenId=${token.id}`,
        args.alreadyUsedUserMessage,
      )
    }

    return refreshUsage(db, token.id, args.invalidError)
  }

  if (!token.firstUsedAt) {
    const firstUseUpdate = await db.clientActionToken.updateMany({
      where: {
        id: token.id,
        kind: args.kind,
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
      return refreshUsage(db, token.id, args.invalidError)
    }
  }

  const repeatUseUpdate = await db.clientActionToken.updateMany({
    where: {
      id: token.id,
      kind: args.kind,
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
    throw args.invalidError(
      `Client action token usage update did not succeed. tokenId=${token.id}`,
    )
  }

  return refreshUsage(db, token.id, args.invalidError)
}
