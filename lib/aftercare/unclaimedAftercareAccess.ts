// lib/aftercare/unclaimedAftercareAccess.ts

import { Prisma } from '@prisma/client'

import {
  markAftercareAccessTokenUsed,
  resolveAftercareAccessTokenForRead,
  type ResolvedAftercareAccessToken,
} from '@/lib/aftercare/aftercareAccessTokens'

export type ResolveAftercareAccessByTokenArgs = {
  rawToken: string
  tx?: Prisma.TransactionClient
}

export type ResolveAftercareAccessByTokenResult = Omit<
  ResolvedAftercareAccessToken,
  'idempotencyActorKey'
>

/**
 * Read resolver for public aftercare/rebook pages.
 *
 * This resolves a ClientActionToken-backed AFTERCARE_ACCESS token and marks
 * read usage for the existing public aftercare page behavior.
 *
 * Mutation routes should prefer:
 * - resolveAftercareAccessTokenForMutation()
 * - markAftercareAccessTokenUsed()
 *
 * Do not use AftercareSummary.publicToken for active aftercare access.
 */
export async function resolveAftercareAccessByToken(
  args: ResolveAftercareAccessByTokenArgs,
): Promise<ResolveAftercareAccessByTokenResult> {
  const resolved = await resolveAftercareAccessTokenForRead({
    rawToken: args.rawToken,
    tx: args.tx,
  })

  const token = await markAftercareAccessTokenUsed({
    tokenId: resolved.token.id,
    tx: args.tx,
  })

  return {
    accessSource: resolved.accessSource,
    token,
    aftercare: resolved.aftercare,
    booking: resolved.booking,
  }
}